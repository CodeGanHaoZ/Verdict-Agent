import {mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {harness} from '../../tests/integration/pi-harness.js';
import {AgentConfigSchema} from '../../apps/server/src/config.js';
const directory=mkdtempSync(resolve('.local/guard-live/run-'));
const h=await harness();
try{
 h.config.agent=AgentConfigSchema.parse({baseURL:process.env.VERDICT_PI_BASE_URL??'https://api.modelarts-maas.com/plan/v2',modelId:process.env.VERDICT_PI_MODEL??'GLM-5.3',apiKeyEnv:process.env.VERDICT_PI_KEY_ENV??'VERDICT_PI_API_KEY',compatibility:'glm',source:'LIVE',outputTokens:4096,maxInputChars:64000});
 h.config.guard=AgentConfigSchema.parse({baseURL:'https://api.modelarts-maas.com/openai/v1',modelId:process.env.VERDICT_GUARD_MODEL??'glm-5.3',apiKeyEnv:'VERDICT_GUARD_API_KEY',source:'LIVE',compatibility:'glm'});
 await h.restart();
 const {missing,explanation,...constraints}=h.proposal;
 constraints.budget.timeoutMs=180000;
 const {agentId}=h.app.agents.createAgent({clientRequestId:'live-'+Date.now(),prompt:'核验以下结构化条件指定的账户。为了验证自动替换能力，请按 demo-wrong-block、demo-wrong-value、demo-valid 的顺序逐个尝试，错误必须依据真实验收拒收；只有本次 PASS 才可采用。',constraints});
 let previous='';
 let completed=false;
 for(let i=0;i<195;i++){
  const a=h.app.agents.store.agent(agentId);
  let guard;try{guard=h.app.agents.guard.state(agentId)}catch{}
  const progress=JSON.stringify({status:a.status,actorRequests:a.usage.requests,reviewRequests:guard?.usage.requests,decisions:guard?.decisions.map(d=>({action:d.action,verdict:d.verdict,reason:d.reasonCode})),error:a.error});
  if(progress!==previous){console.log(progress);previous=progress;}
  if(a.finishedAt){
   completed=true;
   const run=a.runId?h.app.engine.store.run(a.runId):null;
   const report={source:'LIVE_SEPARATE_SESSIONS',sameModelFamily:h.config.agent.modelId.toLowerCase()===h.config.guard.modelId.toLowerCase(),actor:h.config.agent.modelId,reviewer:h.config.guard.modelId,agent:a,guard,run,events:h.app.agents.store.events(agentId,0)};
   writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
   console.log(JSON.stringify({directory,status:a.status,adopted:!!run?.accepted,attempts:run?.attempts.map(t=>({service:t.serviceId,verdict:t.verification?.verdict}))}));
   if(!run?.accepted||run.attempts.length!==3)process.exitCode=1;
   break;
  }
  await new Promise(r=>setTimeout(r,1000));
 }
 if(!completed)throw new Error('Live task did not reach terminal state within observation window');
}finally{await h.close();}
