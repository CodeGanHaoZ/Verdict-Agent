import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {harness} from './pi-harness.js';
import {ServerConfigSchema} from '../../apps/server/src/config.js';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('Observer is passive, ordered, metadata-only, and survives outage and restart without duplicate ingest',async()=>{
 const received=new Map<string,any>();let enabled=false,loseAck=true;
 const server=createServer(async(req,res)=>{
  if(!enabled){res.writeHead(503);res.end();return;}
  assert.equal(req.headers.authorization,'Bearer obs-test-secret');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const events=JSON.parse(Buffer.concat(chunks).toString());let ingested=0;const rejected=[];
  for(const event of events){if(received.has(event.event_id))rejected.push(event.event_id);else{received.set(event.event_id,event);ingested++;}}
  if(loseAck){loseAck=false;res.writeHead(503);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ingested,rejected}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 process.env.VERDICT_OBS_TEST_TOKEN='obs-test-secret';
 const h=await harness();
 h.config.observability=ServerConfigSchema.shape.observability.unwrap().parse({endpoint:`http://127.0.0.1:${(server.address() as {port:number}).port}`,tokenEnv:'VERDICT_OBS_TEST_TOKEN',flushMs:100,timeoutMs:100});
 try{
  await h.restart();const {missing,explanation,...constraints}=h.proposal;
  const {agentId}=h.app.agents.createAgent({clientRequestId:'observed',prompt:'PRIVATE_TASK_SENTINEL obs-test-secret',constraints});
  for(let i=0;i<200&&!h.app.agents.store.agent(agentId).finishedAt;i++)await sleep(20);
  assert.equal(h.app.agents.store.agent(agentId).status,'COMPLETED');
  assert.equal(received.size,0);assert.ok(h.app.agents.observer.info().pending>10);
  await h.restart();enabled=true;
  for(let i=0;i<20&&h.app.agents.observer.info().pending;i++)await h.app.agents.observer.flush();
  assert.equal(h.app.agents.observer.info().pending,0);
  const events=[...received.values()];const wire=JSON.stringify(events);
  for(const secret of ['PRIVATE_TASK_SENTINEL','obs-test-secret',constraints.account,'trustedTask','thinking','explanation','"values"'])assert.ok(!wire.includes(secret),secret);
  assert.deepEqual(events.map(e=>e.seq),events.map((_,i)=>i));
  const results=events.filter(e=>e.payload.custom_type==='verdict.tool_end').flatMap(e=>e.payload.data.attempts??[]);
  assert.ok(results.some(a=>a.verification?.verdict==='PASS'));assert.ok(results.some(a=>a.publication?.status==='not_requested'));assert.ok(results.some(a=>a.verification?.verdict==='FAIL'));
  const proposals=events.filter(e=>e.payload.custom_type==='verdict.action_proposed');
  for(const proposal of proposals){const sequence=proposal.payload.data.sequence;
   const decided=events.find(e=>e.payload.custom_type==='verdict.guard_decision'&&e.payload.data.sequence===sequence)!;
   const consumed=events.find(e=>e.payload.custom_type==='verdict.permit_consumed'&&e.payload.data.sequence===sequence)!;
   const executed=events.find(e=>e.payload.custom_type==='verdict.action_executed'&&e.payload.data.sequence===sequence)!;
   assert.ok(proposal.seq<decided.seq&&decided.seq<consumed.seq&&consumed.seq<executed.seq);
  }
  const usage=events.filter(e=>e.payload.custom_type==='verdict.model_usage');assert.ok(usage.some(e=>e.payload.data.role==='reviewer'));assert.ok(usage.every(e=>e.payload.data.costUsd===null));
  const count=received.size;await h.app.agents.observer.flush();assert.equal(received.size,count);
  assert.ok(h.app.agents.observer.sessionURL(agentId)?.includes('#sid='));
 }finally{await h.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));delete process.env.VERDICT_OBS_TEST_TOKEN;}
});
test('Observer endpoint is restricted to a local HTTP origin',()=>{
 const schema=ServerConfigSchema.shape.observability.unwrap();
 for(const endpoint of ['https://external.example','http://127.0.0.1:43190/path','http://user:pass@localhost:43190','http://localhost:43190/?token=secret'])assert.equal(schema.safeParse({endpoint,tokenEnv:'TOKEN'}).success,false);
});
