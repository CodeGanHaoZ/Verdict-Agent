import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './pi-harness.js';
import {AgentGraphPageSchema} from '@verdict/protocol';
async function settle(h:Awaited<ReturnType<typeof harness>>,id:string){for(let i=0;i<400&&!h.app.agents.store.agent(id).finishedAt;i++)await new Promise(r=>setTimeout(r,20));return h.app.agents.graph.page(id,0);}
test('Graph correlates real calls, reviews, A results and adoption; API persists independently of observer',async()=>{
 const h=await harness();try{
 const {missing,explanation,...constraints}=h.proposal;
 const {agentId}=h.app.agents.createAgent({clientRequestId:'graph-fallback',prompt:'PRIVATE_TASK_CANARY',constraints});
 const page=await settle(h,agentId);assert.equal(page.task.status,'COMPLETED');
 assert.deepEqual(page.events.filter(e=>e.phase==='VERIFICATION'&&e.status!=='RUNNING').map(e=>e.status),['FAIL','FAIL','PASS']);
 const adopted=page.events.filter(e=>e.status==='ADOPTED');assert.equal(adopted.length,1);assert.equal(adopted[0].evidenceId,page.task.adoptedEvidenceId);
 const run=h.app.engine.store.run(page.task.runId!);
 for(const attempt of run.attempts){
  const es=page.events.filter(e=>e.attemptId===attempt.attemptId);assert.equal(es.filter(e=>e.phase==='EXECUTION'&&e.status==='RUNNING').length,1);
  const verified=es.find(e=>e.phase==='VERIFICATION'&&e.status!=='RUNNING')!;assert.equal(verified.status,attempt.verification!.verdict);
  assert.equal(verified.reasonCode,attempt.verification!.reasonCodes[0]);
  assert.equal(es.find(e=>e.phase==='OUTCOME')!.evidenceId,attempt.evidenceId);
  const review=page.events.find(e=>e.actionId===verified.actionId&&e.phase==='REVIEW'&&e.status==='ALLOW')!;
  assert.ok(review.sequence<es[0].sequence);
 }
 const serial=JSON.stringify(page);for(const secret of ['PRIVATE_TASK_CANARY',constraints.account,process.env.VERDICT_PI_TEST_KEY!])assert.ok(!serial.includes(secret));
 const response=await fetch(h.base+`/api/agent/runs/${agentId}/graph?after=3`);const partial=AgentGraphPageSchema.parse(await response.json());assert.equal(partial.events[0].sequence,4);
 assert.equal((await fetch(h.base+`/api/agent/runs/${agentId}/graph?after=-1`)).status,400);
 await h.restart();assert.deepEqual(h.app.agents.graph.page(agentId,0),page);
 }finally{await h.close();}
});
test('Blocked proposal has review and terminal nodes, no execution or adoption',async()=>{
 const h=await harness();try{const {missing,explanation,...constraints}=structuredClone(h.proposal);h.proposal.account='0x'+'9'.repeat(40);h.scripted.mode='redteam-valid';
 const {agentId}=h.app.agents.createAgent({clientRequestId:'graph-block',prompt:'use scope',constraints});const page=await settle(h,agentId);
 assert.equal(page.task.status,'STOPPED');assert.ok(page.events.some(e=>e.status==='BLOCK'&&e.reviewerKind==='HARD_RULE'));
 assert.equal(page.events.filter(e=>e.phase==='EXECUTION'||e.status==='ADOPTED').length,0);assert.equal(page.task.runId,null);
 }finally{await h.close();}
});
test('Old tasks do not invent a graph; cancellation retains a truthful terminal',async()=>{
 const h=await harness();try{h.scripted.mode='timeout';
 const {agentId}=h.app.agents.createAgent({clientRequestId:'graph-cancel',prompt:'use scope',constraints:(({missing,explanation,...c})=>c)(h.proposal)});
 await new Promise(r=>setTimeout(r,30));h.app.agents.stop(agentId);const page=await settle(h,agentId);assert.equal(page.task.error,'CANCELLED');assert.ok(page.events.some(e=>e.phase==='TASK'&&e.status==='CANCELLED'));
 h.app.engine.store.db.prepare('DELETE FROM graph_tasks WHERE agent_id=?').run(agentId);h.app.engine.store.db.prepare('DELETE FROM graph_events WHERE agent_id=?').run(agentId);
 assert.equal(h.app.agents.graph.page(agentId,0).available,false);
 }finally{await h.close();}
});

async function legacy(h:Awaited<ReturnType<typeof harness>>,mode:'duplicate'|'post-pass-error'){
 h.scripted.mode='normal';const {draftId}=h.app.agents.createDraft({clientRequestId:'draft-'+mode,prompt:`核验 ${h.proposal.account} 在冻结检查点 ${h.proposal.blockHash}`});
 for(let i=0;i<200&&h.app.agents.draft(draftId).status==='GENERATING';i++)await new Promise(r=>setTimeout(r,20));
 h.scripted.mode=mode;const {agentId}=h.app.agents.confirmDraft(draftId,{version:h.app.agents.draft(draftId).version});return settle(h,agentId);
}
test('Repeated tool invocation reuses existing attempt without another execution node',async()=>{
 const h=await harness();try{const page=await legacy(h,'duplicate');assert.equal(page.task.status,'COMPLETED');
 const reused=page.events.find(e=>e.status==='REUSED')!;assert.ok(reused);assert.equal(page.events.filter(e=>e.actionId===reused.actionId&&e.phase==='EXECUTION').length,0);
 const original=page.events.find(e=>e.attemptId===reused.attemptId&&e.phase==='EXECUTION'&&e.status==='RUNNING');assert.ok(original);assert.notEqual(original.actionId,reused.actionId);
 assert.equal(h.app.engine.store.run(page.task.runId!).attempts.length,2);
 }finally{await h.close();}
});
test('Explanation failure after adoption preserves adopted evidence and graph outcome',async()=>{
 const h=await harness();try{const page=await legacy(h,'post-pass-error');assert.equal(page.task.status,'ERROR');assert.ok(page.task.adoptedEvidenceId);
 assert.equal(page.events.filter(e=>e.status==='ADOPTED').length,1);assert.equal(page.events.at(-1)!.status,'ERROR');
 assert.equal(h.app.engine.store.run(page.task.runId!).status,'SUCCEEDED');
 }finally{await h.close();}
});
test('Interrupted persisted graph records are recovered once, without resuming services',async()=>{
 const h=await harness();try{
 const {missing,explanation,...constraints}=h.proposal;const {agentId}=h.app.agents.createAgent({clientRequestId:'graph-recovery',prompt:'use scope',constraints});await settle(h,agentId);
 const snapshot=h.app.agents.store.agent(agentId);snapshot.status='RUNNING';snapshot.error=null;snapshot.finishedAt=null;h.app.agents.store.saveAgent(snapshot);
 await h.restart();const first=h.app.agents.graph.page(agentId,0);assert.equal(first.task.error,'INTERRUPTED');assert.equal(first.events.at(-1)!.status,'INTERRUPTED');
 await h.restart();assert.equal(h.app.agents.graph.page(agentId,0).events.length,first.events.length);
 }finally{await h.close();}
});
import {reviewerFixture} from './guard-reviewer.js';
import {AgentConfigSchema} from '../../apps/server/src/config.js';
import type {AgentConditions} from '@verdict/protocol';
test('Reviewer timeout produces UNCERTAIN with timeout reason and no execution',async()=>{
 const h=await harness();const {missing,explanation,...constraints}=h.proposal;const reviewer=await reviewerFixture(constraints as AgentConditions);reviewer.state.delayMs=200;
 h.config.guard=AgentConfigSchema.parse({...h.config.guard!,baseURL:reviewer.baseURL,firstEventTimeoutMs:30,requestTimeoutMs:500});
 try{await h.restart();const {agentId}=h.app.agents.createAgent({clientRequestId:'graph-review-timeout',prompt:'use scope',constraints});const page=await settle(h,agentId);
 assert.equal(page.task.error,'GUARD_STOPPED');assert.ok(page.events.some(e=>e.phase==='REVIEW'&&e.status==='UNCERTAIN'&&e.reasonCode==='MODEL_TIMEOUT'));assert.equal(page.events.filter(e=>e.phase==='EXECUTION').length,0);
 }finally{await h.close();await reviewer.close();}
});
test('Actual service timeout is a failed delivery outcome, never a fabricated A verdict',async()=>{
 const h=await harness();for(const service of h.config.services)service.timeoutMs=1;h.scripted.mode='all-fail';
 try{await h.restart();const {missing,explanation,...constraints}=h.proposal;const {agentId}=h.app.agents.createAgent({clientRequestId:'graph-service-timeout',prompt:'use scope',constraints});const page=await settle(h,agentId);
 assert.equal(page.task.adoptedEvidenceId,null);assert.ok(page.events.some(e=>e.phase==='OUTCOME'&&e.reasonCode==='TIMEOUT'));assert.equal(page.events.filter(e=>e.phase==='VERIFICATION').length,0);
 }finally{await h.close();}
});
