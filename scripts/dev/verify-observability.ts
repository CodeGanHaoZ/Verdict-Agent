import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {harness} from '../../tests/integration/pi-harness.js';
import {ServerConfigSchema} from '../../apps/server/src/config.js';
const endpoint=process.env.VERDICT_OBS_ENDPOINT??'http://127.0.0.1:43190';
const token=readFileSync('.local/observability/observer.env','utf8').trim().split('=')[1];
process.env.VERDICT_OBS_TOKEN=token;
const output=resolve('.local/observability/verification');mkdirSync(output,{recursive:true});
const h=await harness({instanceId:'observability-verification'});
h.config.observability=ServerConfigSchema.shape.observability.unwrap().parse({endpoint,tokenEnv:'VERDICT_OBS_TOKEN',flushMs:100});
const rows=[];
try{
 await h.restart();
 const {missing,explanation,...constraints}=structuredClone(h.proposal);
 for(const mode of ['normal','scope-attack']){
  if(mode==='scope-attack'){h.proposal.account='0x'+'9'.repeat(40);h.scripted.mode='redteam-valid';}
  const {agentId}=h.app.agents.createAgent({clientRequestId:mode,prompt:'PRIVATE_OBSERVABILITY_TEST: follow structured scope',constraints});
  for(let i=0;i<200&&!h.app.agents.store.agent(agentId).finishedAt;i++)await new Promise(r=>setTimeout(r,25));
  const agent=h.app.agents.store.agent(agentId);
  if(mode==='normal'&&agent.status!=='COMPLETED')throw new Error('Normal flow failed');
  if(mode==='scope-attack'&&(agent.error!=='GUARD_STOPPED'||agent.runId))throw new Error('Attack was not stopped before run creation');
  for(let i=0;i<20&&h.app.agents.observer.info().pending;i++)await h.app.agents.observer.flush();
  if(h.app.agents.observer.info().pending)throw new Error('Observer backlog not drained');
  const url=h.app.agents.observer.sessionURL(agentId)!;
  const sid=new URLSearchParams(new URL(url).hash.slice(1)).get('sid')!;
  const response=await fetch(endpoint+`/sessions/${sid}/events?limit=1000`);const {events}=await response.json() as {events:any[]};
  const wire=JSON.stringify(events);
  if(wire.includes(token)||wire.includes('PRIVATE_OBSERVABILITY_TEST')||wire.includes(constraints.account))throw new Error('Private data leaked to observer');
  const decisions=events.filter(e=>e.payload.custom_type==='verdict.guard_decision');
  if(!decisions.length)throw new Error('Guard events missing');
  if(mode==='scope-attack'&&!decisions.some(e=>e.payload.data.verdict==='BLOCK'))throw new Error('Block missing');
  const duplicate=await fetch(endpoint+'/events',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(events)});
  const ack=await duplicate.json() as any;if(ack.ingested!==0||ack.rejected.length!==events.length)throw new Error('Duplicate ingest failed');
  rows.push({mode,agentId,url,sid,events:events.length,status:agent.status,modelSource:agent.modelSource});
 }
 const denied=await fetch(endpoint+'/events',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'});if(denied.status!==401)throw new Error('Unauthenticated ingest allowed');
 const cross=await fetch(endpoint+'/sessions',{headers:{Origin:'https://external.invalid'}});if(cross.status!==403)throw new Error('Cross-origin read allowed');
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(rows[0].url);await page.waitForFunction(()=>document.body.innerText.includes('外审决定'));
  await page.getByText('外审决定',{exact:false}).first().waitFor();
  await page.waitForTimeout(300);
  h.app.agents.observer.record(rows[0].agentId,'verdict.ui_probe',{source:'TEST_TRANSPORT',sequenceCheck:true,action:'<img src=x onerror=window.__obsInjected=1>'});
  await h.app.agents.observer.flush();
  await page.waitForFunction(()=>document.body.innerText.includes('verdict.ui_probe'));
  if(await page.evaluate(()=>(window as any).__obsInjected))throw new Error('Observer rendered executable event markup');
  await page.screenshot({path:resolve(output,'timeline.png'),fullPage:false});
  for(const view of ['swimlane','race']){
   const params=new URLSearchParams({view,lanes:rows.map(r=>r.sid).join(','),race_lanes:rows.map(r=>r.sid).join(',')});
   await page.goto(endpoint+'/#'+params);await page.reload();
   await page.waitForFunction(expected=>(window as any).__OBS_STATE?.view===expected,view);
   await page.waitForTimeout(1500);
   if(await page.evaluate(()=>(window as any).__obsInjected))throw new Error('Observer rendered executable event markup');
   await page.screenshot({path:resolve(output,view+'.png')});
  }
  if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
 }finally{await browser.close();}
 writeFileSync(resolve(output,'report.json'),JSON.stringify({upstream:'cbb8cc30b9bb2ff1b93a20d4415f72877b019868',transport:'TEST_TRANSPORT',services:'REAL_SIGNED_HTTP',verification:'REAL_A_KERNEL',duplicateSafe:true,privateDataExcluded:true,sseUpdateVerified:true,browserViews:['single','swimlane','race'],rows},null,2));
 console.log(JSON.stringify({output,rows},null,2));
}finally{await h.close();}
