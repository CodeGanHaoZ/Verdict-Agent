import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AgentGraphRecordingSchema,type AgentGraphEvent} from '@verdict/protocol';
import {mergeGraphEvents,graphProjection} from '../../apps/web/src/graph/model.js';
const recordings=['success','fallback','blocked'].map(id=>AgentGraphRecordingSchema.parse(JSON.parse(readFileSync(`fixtures/graph/${id}.json`,'utf8'))));
test('Recorded graph fixtures have reviewed sources and matching hashes',()=>{
 const manifest=JSON.parse(readFileSync('fixtures/graph/manifest.json','utf8'));
 for(const file of manifest.files)assert.equal(createHash('sha256').update(readFileSync('fixtures/graph/'+file.path)).digest('hex'),file.sha256);
 for(const r of recordings){assert.equal(r.source,'TEST_TRANSPORT');assert.equal(r.provenance,'REAL_SIGNED_DEMO_SERVICES_AND_A_KERNEL');assert.ok(!r.page.hasMore);}
});
test('Duplicate/out-of-order graph frames converge, gaps remain unknown and coordinate positions stay stable',()=>{
 const input=recordings[1].page.events;
 const received=mergeGraphEvents([],input.slice().reverse()).events;
 assert.deepEqual(graphProjection(received),graphProjection(input));
 assert.equal(mergeGraphEvents(received,input).events.length,input.length);
 const missing=input.filter(e=>e.sequence!==3),gap=graphProjection(missing);assert.equal(gap.gap,true);assert.equal(gap.events.length,2);
 assert.equal(graphProjection(mergeGraphEvents(missing,[input[2]]).events).gap,false);
 const partial=graphProjection(input.slice(0,12)),full=graphProjection(input);
 for(const n of partial.nodes){const later=full.nodes.find(v=>v.id===n.id)!;assert.equal(n.x,later.x);assert.equal(n.y,later.y);}
 const changed={...input[0],status:'ERROR'} as AgentGraphEvent;assert.equal(mergeGraphEvents(input,[changed]).conflict,true);
});
test('Phase updates reuse nodes; ALLOW alone is neither execution nor adoption; interruption preserves prior accepted data',()=>{
 const input=recordings[0].page.events;
 const untilAllow=input.slice(0,input.findIndex(e=>e.phase==='REVIEW'&&e.status==='ALLOW')+1);
 const early=graphProjection(untilAllow);assert.equal(early.nodes.filter(n=>n.event.phase==='EXECUTION').length,0);assert.equal(early.adopted,null);
 const done=graphProjection(input);assert.ok(done.adopted);assert.equal(new Set(done.nodes.map(n=>n.id)).size,done.nodes.length);
 const error={...input.at(-1)!,sequence:input.length+1,eventId:'explanation-error',status:'ERROR',reasonCode:'MODEL_ERROR'} as AgentGraphEvent;
 const late=graphProjection([...input,error]);assert.equal(late.adopted!.evidenceId,done.adopted!.evidenceId);assert.equal(late.terminal!.status,'ERROR');
 const blocked=graphProjection(recordings[2].page.events);assert.equal(blocked.nodes.filter(n=>n.event.phase==='EXECUTION').length,0);assert.ok(blocked.nodes.some(n=>n.displayStatus==='BLOCK'));
});
test('Missing review evidence cannot fabricate a direct proposal-to-execution approval edge',()=>{
 const input=recordings[0].page.events;
 const missingReview=input.filter(e=>e.phase!=='REVIEW').map((e,i)=>({...e,sequence:i+1}));
 const projection=graphProjection(missingReview);assert.equal(projection.gap,true);
 for(const edge of projection.edges){const from=projection.nodes.find(n=>n.id===edge.source)!,to=projection.nodes.find(n=>n.id===edge.target)!;assert.ok(!(from.event.phase==='PROPOSAL'&&to.event.phase==='EXECUTION'));}
});
