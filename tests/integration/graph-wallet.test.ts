import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {digest} from '@verdict/core';
import {AgentGraphPageSchema,WalletEvidenceReplaySchema,WalletReviewSchema} from '@verdict/protocol';
import {walletHarness,body,account,recipient,txHash} from './wallet-graph-harness.js';

test('Wallet graph records real backend stages, pagination, local evidence and observed deltas without A PASS',async()=>{
 const f=await walletHarness();try{
  const r=await f.consumed();const before=await f.graph(r.reviewId);assert.ok(!before.events.some(e=>e.status==='BROADCAST'));
  const reported=await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});assert.equal(reported.code,200);
  const done=WalletReviewSchema.parse(reported.data);assert.equal(done.receiptReport?.receiptStatus,'SUCCESS');
  assert.equal(done.postState!.senderBalanceDelta,(BigInt(f.rpcState.postBalance)-1000000n).toString());assert.equal(done.postState!.recipientBalanceDelta,'200');assert.equal(done.postState!.senderNonceDelta,'1');
  const graph=await f.graph(r.reviewId);assert.doesNotThrow(()=>AgentGraphPageSchema.parse(graph));
  assert.deepEqual([...new Set(graph.events.map(e=>e.eventType))],['wallet.review.created','wallet.balance.observed','wallet.policy.checked','wallet.preflight.completed','wallet.guard.reviewed','wallet.permit.consumed','wallet.broadcast.reported','wallet.receipt.observed','wallet.post_state.checked','wallet.evidence.saved']);
  for(const [index,event] of graph.events.entries()){assert.equal(event.sequence,index+1);assert.equal(event.parentEventId,index===0?null:graph.events[index-1].eventId);assert.equal(event.traceId,r.traceId);assert.equal(event.walletReviewId,r.reviewId);assert.ok(event.argumentsDigest&&event.resultDigest);assert.equal(event.timestamp,event.at);assert.equal(event.observationSource,'TEST_TRANSPORT');assert.ok(!['PASS','ADOPTED'].includes(event.status));assert.equal(event.dataVerdict,undefined);}
  const paged=[];let cursor=0;do{const p=await f.graph(r.reviewId,`after=${cursor}&limit=3`);paged.push(...p.events);cursor=p.nextCursor;if(!p.hasMore)break;}while(true);assert.deepEqual(paged,graph.events);
  assert.equal((await f.graph(r.reviewId,`after=${cursor}`)).events.length,0);
  assert.equal((await f.api(`/api/wallet/reviews/${r.reviewId}/graph?after=-1`)).code,400);
  const evidence=await f.api('/api/wallet/evidence/'+done.evidenceRef);assert.equal(evidence.code,200);assert.equal(digest(evidence.data.body),done.evidenceRef);assert.equal(f.h.app.engine.store.evidenceRows().length,0);
  assert.equal((await f.api('/api/wallet/evidence/replay',{packet:evidence.data})).data.status,'MATCH');
  assert.equal((await f.graph(r.reviewId)).events.at(-1)?.eventType,'wallet.evidence.replayed');
  assert.ok(!f.rpcState.calls.some(c=>/send|sign/i.test(c.method)));
 }finally{await f.close();}
});
test('Hard scope refusal stops before PI/permit/broadcast and does not expose calldata',async()=>{
 const f=await walletHarness();try{
  const input=body();input.transaction.to='0x'+'3'.repeat(40);input.transaction.data='0xdeadbeef';
  const r=await f.create(input);assert.equal(r.status,'BLOCKED');assert.equal(f.reviewerState.requests,0);assert.equal(f.rpcState.calls.length,0);
  const graph=await f.graph(r.reviewId);assert.deepEqual(graph.events.map(e=>e.status),['LOCKED','BLOCK']);assert.ok(!JSON.stringify(graph).includes('deadbeef'));
  assert.equal((await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash})).code,409);
 }finally{await f.close();}
});
for(const verdict of ['BLOCK','UNCERTAIN'] as const)test(`PI ${verdict} cannot consume or report a broadcast`,async()=>{
 const f=await walletHarness();try{f.reviewerState.verdict=verdict;const r=await f.create();assert.equal(r.status,verdict==='BLOCK'?'BLOCKED':'UNCERTAIN');assert.ok((await f.graph(r.reviewId)).events.some(e=>e.stage==='PI_REVIEW'&&e.status===verdict));
 assert.equal((await f.api(`/api/wallet/reviews/${r.reviewId}/consume`,{transaction:r.preparedTransaction})).code,409);assert.equal((await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash})).code,409);assert.ok(!(await f.graph(r.reviewId)).events.some(e=>e.eventType==='wallet.broadcast.reported'));
 }finally{await f.close();}
});
test('Create/consume/report races are idempotent and trace bindings cannot change',async()=>{
 const f=await walletHarness();try{
  const input={...body(),traceId:randomUUID(),graphRunId:randomUUID()};const replies=await Promise.all([f.api('/api/wallet/reviews',input),f.api('/api/wallet/reviews',input)]);assert.equal(replies[0].data.reviewId,replies[1].data.reviewId);
  const r=await f.settle(replies[0].data.reviewId);const calls=f.rpcState.calls.length;
  assert.equal((await f.api('/api/wallet/reviews',input)).data.traceId,input.traceId);assert.equal(f.rpcState.calls.length,calls);
  assert.equal((await f.api('/api/wallet/reviews',{...input,traceId:randomUUID()})).code,409);
  const consume=()=>f.api(`/api/wallet/reviews/${r.reviewId}/consume`,{transaction:r.preparedTransaction});const cs=await Promise.all([consume(),consume()]);assert.deepEqual(cs.map(c=>c.code).sort(),[200,409]);
  f.rpcState.delayMethod='eth_getTransactionByHash';f.rpcState.delayMs=30;
  const report=()=>f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});const reports=await Promise.all([report(),report()]);assert.deepEqual(reports[0],reports[1]);
  const count=f.rpcState.calls.length,graph=await f.graph(r.reviewId);assert.equal((await report()).code,200);assert.equal(count,f.rpcState.calls.length);assert.deepEqual(await f.graph(r.reviewId),graph);assert.equal(graph.events.filter(e=>e.status==='CONSUMED').length,1);
  const second=await f.consumed();assert.equal((await f.api(`/api/wallet/reviews/${second.reviewId}/broadcast`,{txHash})).data.error,'TX_HASH_ALREADY_REPORTED');
 }finally{await f.close();}
});
for(const [field,value] of Object.entries({hash:'0x'+'9'.repeat(64),from:'0x'+'4'.repeat(40),to:'0x'+'5'.repeat(40),value:'0x65',nonce:'0x2',chainId:'0x1'}))test(`RPC transaction ${field} substitution is rejected`,async()=>{
 const f=await walletHarness();try{const r=await f.consumed();f.rpcState.txPatch[field]=value;const result=await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});assert.equal(result.code,409);assert.equal(result.data.error,'BROADCAST_TRANSACTION_MISMATCH');const graph=await f.graph(r.reviewId);assert.ok(!graph.events.some(e=>e.status==='RECEIPT_CONFIRMED'));assert.equal(f.h.app.wallet.get(r.reviewId).receiptReport?.receiptStatus,'REJECTED');
 }finally{await f.close();}
});
test('Receipt hash, status and block mismatches are never successful',async()=>{
 for(const patch of [{transactionHash:'0x'+'9'.repeat(64)},{status:'0x2'},{blockHash:'0x'+'9'.repeat(64)}]){
 const f=await walletHarness();try{const r=await f.consumed();f.rpcState.receiptPatch=patch;await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});assert.ok(['UNKNOWN','REJECTED'].includes(f.h.app.wallet.get(r.reviewId).receiptReport!.receiptStatus));assert.ok(!(await f.graph(r.reviewId)).events.some(e=>e.status==='RECEIPT_CONFIRMED'));}finally{await f.close();}
 }
});
test('RPC timeout, absent transaction and absent receipt stay UNKNOWN; explicit retry can observe later mining',async()=>{
 for(const kind of ['timeout','missingTx','missingReceipt']){
 const f=await walletHarness();try{const r=await f.consumed();if(kind==='timeout')f.rpcState.timeoutMethod='eth_getTransactionReceipt';else if(kind==='missingTx')f.rpcState.missingTx=true;else f.rpcState.missingReceipt=true;
 const report=await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});assert.equal(report.data.receiptReport.receiptStatus,'UNKNOWN');assert.equal(report.data.evidenceRef,undefined);assert.ok(!(await f.graph(r.reviewId)).events.some(e=>e.status==='RECEIPT_CONFIRMED'));
 f.rpcState.timeoutMethod='';f.rpcState.missingTx=false;f.rpcState.missingReceipt=false;
 assert.equal((await f.api(`/api/wallet/reviews/${r.reviewId}/receipt/recheck`,{})).data.receiptReport.receiptStatus,'SUCCESS');
 }finally{await f.close();}
 }
});
test('Failed receipt stays failed; post-state RPC errors preserve receipt but never pretend delta/evidence success',async()=>{
 const f=await walletHarness();try{const r=await f.consumed();f.rpcState.receiptPatch.status='0x0';const result=await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});assert.equal(result.data.receiptReport.receiptStatus,'FAIL');assert.ok((await f.graph(r.reviewId)).events.some(e=>e.status==='RECEIPT_FAILED'));assert.ok(!(await f.graph(r.reviewId)).events.some(e=>e.status==='RECEIPT_CONFIRMED'));}finally{await f.close();}
 const g=await walletHarness();try{const r=await g.consumed();g.rpcState.postStateError=true;const result=await g.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});assert.equal(result.data.receiptReport.receiptStatus,'SUCCESS');assert.equal(result.data.receiptReport.postStateStatus,'UNKNOWN');assert.equal(result.data.evidenceRef,undefined);assert.ok(!(await g.graph(r.reviewId)).events.some(e=>e.status==='SAVED'));}finally{await g.close();}
});
test('Private addresses, keys, model reasoning and arbitrary reason strings never enter graph or public errors',async()=>{
 const f=await walletHarness();try{f.reviewerState.reason='WALLET_API_SECRET_CANARY';const r=await f.consumed();f.rpcState.errorMethod='eth_getTransactionReceipt';const response=await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});const output=JSON.stringify({graph:await f.graph(r.reviewId),error:response.data.receiptReport});for(const marker of [account,recipient,'WALLET_API_SECRET_CANARY','RPC_SECRET_CANARY','HIDDEN_THOUGHT_CANARY','FULL_CALLDATA_CANARY'])assert.ok(!output.includes(marker),marker);
 assert.equal((await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash,status:'SUCCESS'})).code,400);
 }finally{await f.close();}
});
test('Restart retains graph without restarting pending review or completing an unobserved report',async()=>{
 const f=await walletHarness();try{
 const r=await f.create();const row=f.h.app.wallet.get(r.reviewId);row.status='REVIEWING';f.h.app.engine.store.db.prepare('UPDATE wallet_reviews SET body=? WHERE id=?').run(JSON.stringify(row),row.reviewId);
 const calls=f.rpcState.calls.length,requests=f.reviewerState.requests;await f.h.restart();assert.equal(f.h.app.wallet.get(r.reviewId).status,'INTERRUPTED');assert.equal(calls,f.rpcState.calls.length);assert.equal(requests,f.reviewerState.requests);const page=await f.graph(r.reviewId);assert.equal(page.events.at(-1)?.status,'INTERRUPTED');await f.h.restart();assert.deepEqual(await f.graph(r.reviewId),page);
 }finally{await f.close();}
});
test('Second instance replays private packet using its own RPC; tampering, rehashing and unavailable trust cannot self-authorize',async()=>{
 const f=await walletHarness(),g=await walletHarness();try{
 const r=await f.consumed();const done=await f.api(`/api/wallet/reviews/${r.reviewId}/broadcast`,{txHash});const packet=(await f.api('/api/wallet/evidence/'+done.data.evidenceRef)).data;
 const result=WalletEvidenceReplaySchema.parse((await g.api('/api/wallet/evidence/replay',{packet})).data);assert.equal(result.status,'MATCH');assert.equal(result.reviewAndPermit,'NOT_REPLAYED');assert.ok(g.rpcState.calls.some(c=>c.method==='eth_getTransactionReceipt'));assert.equal(g.h.app.engine.store.evidenceRows().length,0);
 const tampered=structuredClone(packet);tampered.body.postState.recipientBalanceDelta='999';assert.equal((await g.api('/api/wallet/evidence/replay',{packet:tampered})).data.integrity,'MISMATCH');tampered.evidenceRef=digest(tampered.body);assert.equal((await g.api('/api/wallet/evidence/replay',{packet:tampered})).data.status,'MISMATCH');
 g.rpcState.chain='0x1';assert.equal((await g.api('/api/wallet/evidence/replay',{packet})).data.status,'MISMATCH');g.rpcState.chain='0x3c8';g.rpcState.timeoutMethod='eth_getBalance';assert.equal((await g.api('/api/wallet/evidence/replay',{packet})).data.status,'UNKNOWN');
 const path=resolve(f.h.config.dataDir,'wallet-evidence',`${packet.evidenceRef}.json`);const original=readFileSync(path);writeFileSync(path,JSON.stringify(tampered));assert.equal((await f.api('/api/wallet/evidence/'+packet.evidenceRef)).code,409);writeFileSync(path,original);
 }finally{await f.close();await g.close();}
});

test('Cancellation and malformed PI output stop before permit; pending reports recover as UNKNOWN without RPC',async()=>{
 const f=await walletHarness();try{
  f.reviewerState.delayMs=300;const created=await f.api('/api/wallet/reviews',body());await f.api(`/api/wallet/reviews/${created.data.reviewId}/cancel`,{});const cancelled=await f.settle(created.data.reviewId);assert.equal(cancelled.status,'CANCELLED');assert.equal((await f.api(`/api/wallet/reviews/${cancelled.reviewId}/broadcast`,{txHash})).code,409);
  f.reviewerState.delayMs=0;f.reviewerState.invalid=true;const invalid=await f.create();assert.equal(invalid.status,'UNCERTAIN');assert.ok(!(await f.graph(invalid.reviewId)).events.some(e=>e.status==='ALLOW'));
  f.reviewerState.invalid=false;const r=await f.consumed();const pending={...r,receiptReport:{txHash,transactionFound:false,receiptStatus:'UNKNOWN',blockNumber:null,blockHash:null,gasUsed:null,error:'REPORT_PENDING',postStateStatus:'NOT_CHECKED'}};
  f.h.app.engine.store.db.prepare('UPDATE wallet_reviews SET body=? WHERE id=?').run(JSON.stringify(pending),r.reviewId);const count=f.rpcState.calls.length;await f.h.restart();assert.equal(f.rpcState.calls.length,count);assert.equal(f.h.app.wallet.get(r.reviewId).receiptReport?.error,'REPORT_INTERRUPTED');assert.equal((await f.graph(r.reviewId)).events.at(-1)?.status,'UNKNOWN');
 }finally{await f.close();}
});
test('Parent links are validated and immutable; old reviews return unavailable rather than invented activity',async()=>{
 const f=await walletHarness();try{
  assert.equal((await f.api('/api/wallet/reviews',{...body(),parentAgentId:randomUUID()})).data.error,'PARENT_AGENT_NOT_FOUND');
  const id=randomUUID(),runId=randomUUID();
  // Only parent lookup is synthetic; wallet review and its execution use the real server path.
  f.h.app.engine.store.db.prepare('INSERT INTO agents VALUES(?,?)').run(id,JSON.stringify({agentId:id,runId}));
  const input={...body(),parentAgentId:id,graphRunId:runId};const r=await f.create(input);assert.equal((await f.graph(r.reviewId)).parentAgentId,id);
  assert.equal((await f.api('/api/wallet/reviews',{...input,clientRequestId:randomUUID(),graphRunId:randomUUID()})).data.error,'PARENT_GRAPH_MISMATCH');
  f.h.app.engine.store.db.prepare('DELETE FROM wallet_graph_tasks WHERE review_id=?').run(r.reviewId);f.h.app.engine.store.db.prepare('DELETE FROM wallet_graph_events WHERE review_id=?').run(r.reviewId);
  const page=await f.graph(r.reviewId);assert.equal(page.available,false);assert.equal(page.events.length,0);
  f.h.app.engine.store.db.prepare('DELETE FROM agents WHERE id=?').run(id);
 }finally{await f.close();}
});
