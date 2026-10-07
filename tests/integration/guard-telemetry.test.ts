import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './pi-harness.js';

test('Guard activity ledger exports as pi-telemetry spans with digests only',async()=>{
 const h=await harness();
 try{
  // Wall-clock budgets assume an unloaded machine; widen the agent budget so parallel
  // suite runs on slow hosts measure logic, not scheduler noise.
  h.config.agent!.maxDurationMs=60000;
  await h.restart();
  const {missing,explanation,...scope}=structuredClone(h.proposal);
  h.scripted.mode='redteam-valid';
  h.proposal.account=`0x${'9'.repeat(40)}`; // attacker swaps the account; boundary blocks before binding
  const {agentId}=h.app.agents.createAgent({clientRequestId:'telemetry-export',prompt:'只执行调用者结构化约束',constraints:scope});
  for(let n=0;n<800;n++){
   const a=h.app.agents.store.agent(agentId);
   if(a.finishedAt)break;
   await new Promise(r=>setTimeout(r,25));
  }
  const a=h.app.agents.store.agent(agentId);
  assert.equal(a.error,'GUARD_STOPPED');
  const res=await fetch(h.base+`/api/guard/tasks/${agentId}/telemetry`);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.schema.version,1);
  assert.ok(body.schema.spans['verdict.guard.review']);
  assert.ok(body.spans.length>=1);
  const review=body.spans.find((s:any)=>s.name==='verdict.guard.review'&&s.attributes['verdict.action']==='start_task');
  assert.ok(review,'start_task review span missing');
  assert.equal(review.attributes['verdict.activity_source'],'ACTOR');
  assert.equal(review.attributes['verdict.verdict'],'BLOCK');
  assert.equal(review.attributes['verdict.arguments_status'],'BLOCKED');
  assert.match(review.attributes['verdict.arguments_digest'],/^0x[0-9a-f]{64}$/);
  assert.equal(review.status.status,'error');
  assert.equal(review.status.error.name,'GUARD_BLOCKED');
  const serialized=JSON.stringify(body);
  assert.ok(!serialized.includes('0x9999'),'raw arguments must never enter telemetry');
  assert.ok(!serialized.includes('0x'+'9'.repeat(40)));
  // Round-trip: a third-party plugin re-imports the exported spans as EXTERNAL ledger entries.
  const imp=await fetch(h.base+`/api/guard/tasks/${agentId}/telemetry/import`,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({spans:body.spans.map((s:any)=>({name:s.name,attributes:s.attributes,status:'error'}))})});
  assert.equal(imp.status,200);
  const impBody=await imp.json();
  assert.equal(impBody.ingested,body.spans.length);
  const state=h.app.agents.guard.state(agentId);
  const imported=state.activities.filter((x:any)=>x.source==='EXTERNAL');
  assert.equal(imported.length,body.spans.length);
  assert.ok(imported.every((x:any)=>x.action.startsWith('telemetry.verdict.guard.review')&&x.status==='EXECUTED'&&x.resultDigest));
  // Imported digests are stable: re-export includes them as further spans without raw payloads.
  const res2=await fetch(h.base+`/api/guard/tasks/${agentId}/telemetry`);
  const body2=await res2.json();
  assert.equal(body2.spans.length,body.spans.length+imported.length);
  assert.ok(!JSON.stringify(body2).includes('0x9999'));
 }finally{await h.close();}
});

test('Telemetry import validates payload shape and unknown tasks',async()=>{
 const h=await harness();
 try{
  h.config.agent!.maxDurationMs=60000;
  await h.restart();
  const {missing,explanation,...scope}=structuredClone(h.proposal);
  const {agentId}=h.app.agents.createAgent({clientRequestId:'telemetry-negative',prompt:'只执行调用者结构化约束',constraints:scope});
  for(let n=0;n<800;n++){
   const a=h.app.agents.store.agent(agentId);
   if(a.finishedAt)break;
   await new Promise(r=>setTimeout(r,25));
  }
  const bad=await fetch(h.base+`/api/guard/tasks/${agentId}/telemetry/import`,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({spans:[{name:'bad name!',attributes:{}}]})});
  assert.equal(bad.status,400);
  const notObject=await fetch(h.base+`/api/guard/tasks/${agentId}/telemetry/import`,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({spans:'nope'})});
  assert.equal(notObject.status,400);
  const unknown=await fetch(h.base+'/api/guard/tasks/does-not-exist/telemetry/import',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({spans:[{name:'ok.name'}]})});
  assert.equal(unknown.status,404);
 }finally{await h.close();}
});

test('Imported external activity keeps raw spans local; reviewer projection sees digests only',async()=>{
 const h=await harness();
 h.config.agent!.maxDurationMs=60000;
 await h.restart();
 const {missing,explanation,...scope}=structuredClone(h.proposal);
 try{
  const {agentId}=h.app.agents.createAgent({clientRequestId:'telemetry-context',prompt:'只执行调用者结构化约束',constraints:scope});
  for(let n=0;n<800;n++){
   const a=h.app.agents.store.agent(agentId);
   if(a.finishedAt)break;
   await new Promise(r=>setTimeout(r,25));
  }
  const secret='INJECTION_PAYLOAD_SHOULD_NOT_REACH_REVIEWER';
  const imp=h.app.agents.guardTelemetryImport(agentId,{spans:[{name:'plugin.agent.tool_call',attributes:{'plugin.note':secret,'plugin.tool':'demo-valid'}}]});
  assert.equal(imp.ingested,1);
  const state=h.app.agents.guard.state(agentId);
  const imported=state.activities.at(-1)!;
  assert.equal(imported.source,'EXTERNAL');
  assert.equal(imported.action,'telemetry.plugin.agent.tool_call');
  assert.equal(imported.status,'EXECUTED');
  assert.match(imported.resultDigest!,/^0x[0-9a-f]{64}$/);
  // Local ledger keeps the span for audit; the reviewer-facing projection (same mapping as
  // guard.authorize's behaviorHistory) strips args to digests, so payload text cannot reach the model.
  const localLedger=JSON.stringify(state.activities);
  assert.ok(localLedger.includes(secret),'raw span must be kept locally for audit');
  const reviewerProjection=state.activities.map((a)=>({sequence:a.sequence,action:a.action,source:a.source,status:a.status,argumentsDigest:a.resultDigest??null}));
  assert.ok(!JSON.stringify(reviewerProjection).includes(secret),'digest projection must not leak payload text');
 }finally{await h.close();}
});
