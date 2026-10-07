import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {harness} from '../../tests/integration/pi-harness.js';
import {AgentGraphRecordingSchema} from '@verdict/protocol';
const dir='fixtures/graph';mkdirSync(dir,{recursive:true});const files=[];
for(const [id,title] of [['success','正常完成'],['fallback','失败后替换'],['blocked','执行前拦截']]){
 const h=await harness();
 try{
  const {missing,explanation,...constraints}=structuredClone(h.proposal);
  if(id==='success'){constraints.candidateIds=['demo-valid'];h.proposal.candidateIds=['demo-valid'];h.scripted.mode='redteam-valid';}
  if(id==='blocked'){h.proposal.account='0x'+'9'.repeat(40);h.scripted.mode='redteam-valid';}
  const {agentId}=h.app.agents.createAgent({clientRequestId:'record-graph-'+id,prompt:'只按调用者约束执行；这是公开冻结证明的录制样本。',constraints});
  for(let i=0;i<400&&!h.app.agents.store.agent(agentId).finishedAt;i++)await new Promise(r=>setTimeout(r,25));
  const page=h.app.agents.graph.page(agentId,0);
  if(!page.task.finishedAt||page.hasMore)throw new Error('Incomplete recording');
  const passed=page.events.filter(e=>e.phase==='OUTCOME'&&e.status==='ADOPTED');
  if(id==='blocked'?(page.events.some(e=>e.phase==='EXECUTION')||!page.events.some(e=>e.status==='BLOCK')):passed.length!==1)throw new Error('Recording outcome mismatch');
  const recording=AgentGraphRecordingSchema.parse({graphVersion:'1.0.0',id,title,mode:'RECORDED',recordedAt:new Date().toISOString(),provenance:'REAL_SIGNED_DEMO_SERVICES_AND_A_KERNEL',source:'TEST_TRANSPORT',page});
  const data=JSON.stringify(recording,null,2)+'\n';writeFileSync(`${dir}/${id}.json`,data);files.push({path:`${id}.json`,sha256:createHash('sha256').update(data).digest('hex'),events:page.events.length,status:page.task.status});
 }finally{await h.close();}
}
writeFileSync(`${dir}/manifest.json`,JSON.stringify({version:'1.0.0',license:'MIT',producer:'scripts/dev/record-agent-graph.ts',dataSource:'fixtures/core/ethereum-mainnet-26134149/snapshot.json',services:'real local HTTP, generated EIP-712 signers, injected faults',modelSource:'TEST_TRANSPORT',files},null,2)+'\n');console.log(JSON.stringify(files));
