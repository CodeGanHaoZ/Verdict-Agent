import {randomUUID} from 'node:crypto';
import {digest} from '@verdict/core';
import {AgentGraphEventSchema,AgentGraphPageSchema,WalletGraphPageSchema,type AgentGraphEvent,type AgentSnapshot,type AgentGraphPage,type WalletGraphPage} from '@verdict/protocol';
import {Store,ApiError} from './store.js';
import type {ServerConfig} from './config.js';
type Action=Pick<AgentGraphEvent,'actionId'|'actionOrder'|'previousActionId'|'toolCallId'|'tool'|'serviceId'|'targetId'|'argumentsDigest'|'evidenceId'>;
type Detail=Partial<Pick<AgentGraphEvent,'reviewerKind'|'attemptId'|'evidenceId'|'reasonCode'|'durationMs'|'dataVerdict'|'attributionStatus'|'publicationStatus'>>;
type WalletDetail=Partial<Pick<AgentGraphEvent,'argumentsDigest'|'resultDigest'|'evidenceRef'|'chainId'|'blockNumber'|'blockHash'|'reasonCode'|'source'|'observationKind'|'observationSource'>>;
type WalletMeta={reviewId:string;traceId:string;parentAgentId?:string;graphRunId:string;modelSource:'LIVE'|'TEST_TRANSPORT'};
export class GraphStore {
  constructor(readonly store:Store,readonly config:ServerConfig){
    store.db.exec(`CREATE TABLE IF NOT EXISTS graph_tasks(agent_id TEXT PRIMARY KEY,seq INTEGER NOT NULL,source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS graph_actions(agent_id TEXT NOT NULL,action_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,action_id));
      CREATE TABLE IF NOT EXISTS graph_events(agent_id TEXT NOT NULL,seq INTEGER NOT NULL,event_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,seq),UNIQUE(agent_id,event_key));
      CREATE TABLE IF NOT EXISTS wallet_graph_tasks(review_id TEXT PRIMARY KEY,seq INTEGER NOT NULL,meta TEXT NOT NULL,last_event_id TEXT);
      CREATE TABLE IF NOT EXISTS wallet_graph_events(review_id TEXT NOT NULL,seq INTEGER NOT NULL,event_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(review_id,seq),UNIQUE(review_id,event_key));`);
    // AgentStore and Store have already recovered interrupted work; never resume it.
    for(const row of store.db.prepare('SELECT agent_id FROM graph_tasks').all() as {agent_id:string}[]){
      const a=this.agent(row.agent_id);
      if(a.error==='INTERRUPTED')this.append(a.agentId,null,'TASK','INTERRUPTED',{reasonCode:'INTERRUPTED'});
    }
  }
  private agent(id:string):AgentSnapshot {
    const row=this.store.db.prepare('SELECT body FROM agents WHERE id=?').get(id) as {body:string}|undefined;
    if(!row)throw new ApiError(404,'AGENT_NOT_FOUND');return JSON.parse(row.body);
  }
  begin(id:string){
    const a=this.agent(id);this.store.db.prepare('INSERT OR IGNORE INTO graph_tasks VALUES(?,0,?)').run(id,a.modelSource);
    this.append(id,null,'TASK','RUNNING');
  }
  private safe(text:string){
    for(const c of [this.config.agent,this.config.guard]){const key=c?process.env[c.apiKeyEnv]:undefined;if(key)text=text.split(key).join('[REDACTED]');}
    return text.slice(0,160);
  }
  propose(id:string,toolCallId:string,tool:NonNullable<AgentGraphEvent['tool']>,args:unknown):Action {
    const actionId=digest({agentId:id,toolCallId});
    return this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT body FROM graph_actions WHERE agent_id=? AND action_id=?').get(id,actionId) as {body:string}|undefined;
      if(old)return JSON.parse(old.body);
      const rows=(this.store.db.prepare('SELECT body FROM graph_actions WHERE agent_id=?').all(id) as {body:string}[]).map(r=>JSON.parse(r.body) as Action).sort((a,b)=>a.actionOrder-b.actionOrder);
      const input=args&&typeof args==='object'?args as Record<string,unknown>:{};
      const action:Action={actionId,actionOrder:rows.length+1,previousActionId:rows.at(-1)?.actionId??null,toolCallId:digest(toolCallId),tool,argumentsDigest:digest(args??{}),
        ...(typeof input.serviceId==='string'?{serviceId:this.safe(input.serviceId)}:{}),...(typeof input.targetId==='string'?{targetId:this.safe(input.targetId)}:{}),
        ...(typeof input.evidenceId==='string'&&/^0x[0-9a-f]{64}$/.test(input.evidenceId)?{evidenceId:input.evidenceId}:{})};
      this.store.db.prepare('INSERT INTO graph_actions VALUES(?,?,?)').run(id,actionId,JSON.stringify(action));
      this.append(id,action,'PROPOSAL','PENDING');return action;
    });
  }
  action(id:string,toolCallId:string):Action|undefined{
    const row=this.store.db.prepare('SELECT body FROM graph_actions WHERE agent_id=? AND action_id=?').get(id,digest({agentId:id,toolCallId})) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;
  }
  append(id:string,action:Action|null,phase:AgentGraphEvent['phase'],status:AgentGraphEvent['status'],detail:Detail={}){
    return this.store.transaction(()=>{
      const t=this.store.db.prepare('SELECT seq,source FROM graph_tasks WHERE agent_id=?').get(id) as {seq:number;source:'LIVE'|'TEST_TRANSPORT'}|undefined;
      if(!t)return;
      const eventKey=`${action?.actionId??'task'}:${phase}:${status}`;
      if(this.store.db.prepare('SELECT 1 FROM graph_events WHERE agent_id=? AND event_key=?').get(id,eventKey))return;
      const a=this.agent(id);
      const ev=AgentGraphEventSchema.parse({graphVersion:'1.0.0',eventId:randomUUID(),sequence:t.seq+1,at:new Date().toISOString(),agentId:id,runId:a.runId,modelSource:t.source,
        actionId:null,actionOrder:0,previousActionId:null,toolCallId:null,tool:null,...action,phase,status,...detail,...(detail.reasonCode?{reasonCode:this.safe(detail.reasonCode)}:{})});
      this.store.db.prepare('INSERT INTO graph_events VALUES(?,?,?,?)').run(id,ev.sequence,eventKey,JSON.stringify(ev));
      this.store.db.prepare('UPDATE graph_tasks SET seq=? WHERE agent_id=?').run(ev.sequence,id);
      return ev;
    });
  }
  finish(id:string){
    const a=this.agent(id);const status=a.error==='CANCELLED'?'CANCELLED':a.error==='INTERRUPTED'?'INTERRUPTED':a.status==='COMPLETED'?'COMPLETED':a.status==='ERROR'?'ERROR':'STOPPED';
    this.append(id,null,'TASK',status,a.error?{reasonCode:a.error}:{});
  }
  beginWallet(meta:WalletMeta){
    this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT meta FROM wallet_graph_tasks WHERE review_id=?').get(meta.reviewId) as {meta:string}|undefined;
      if(old){if(old.meta!==JSON.stringify(meta))throw new ApiError(409,'WALLET_TRACE_CONFLICT');return;}
      this.store.db.prepare('INSERT INTO wallet_graph_tasks(review_id,seq,meta,last_event_id) VALUES(?,0,?,NULL)').run(meta.reviewId,JSON.stringify(meta));
    });
  }
  appendWallet(reviewId:string,eventType:NonNullable<AgentGraphEvent['eventType']>,stage:NonNullable<AgentGraphEvent['stage']>,status:AgentGraphEvent['status'],detail:WalletDetail={}){
    return this.store.transaction(()=>{
      const row=this.store.db.prepare('SELECT seq,meta,last_event_id FROM wallet_graph_tasks WHERE review_id=?').get(reviewId) as {seq:number;meta:string;last_event_id:string|null}|undefined;
      if(!row)return;
      const meta=JSON.parse(row.meta) as WalletMeta;
      const eventKey=`${eventType}:${stage}:${status}:${detail.resultDigest??detail.evidenceRef??''}`;
      const existing=this.store.db.prepare('SELECT body FROM wallet_graph_events WHERE review_id=? AND event_key=?').get(reviewId,eventKey) as {body:string}|undefined;
      if(existing)return AgentGraphEventSchema.parse(JSON.parse(existing.body));
      const eventId=randomUUID(),at=new Date().toISOString();
      const prior=(this.store.db.prepare('SELECT body FROM wallet_graph_events WHERE review_id=? ORDER BY seq').all(reviewId) as {body:string}[]).map(row=>AgentGraphEventSchema.parse(JSON.parse(row.body)));
      const same=prior.find(e=>e.stage===stage),stages=[...new Set(prior.map(e=>e.stage))];
      const actionOrder=same?.actionOrder??stages.length+1;
      const previousActionId=same?same.previousActionId:prior.at(-1)?.actionId??null;
      const phase:AgentGraphEvent['phase']=stage==='TRANSACTION_INTENT'?'PROPOSAL':stage==='HARD_RULE'||stage==='PI_REVIEW'?'REVIEW':stage==='RECEIPT'||stage==='POST_STATE'||stage==='EVIDENCE_REPLAY'?'VERIFICATION':stage==='EVIDENCE'||stage==='PERMIT'?'OUTCOME':'EXECUTION';
      const ev=AgentGraphEventSchema.parse({graphVersion:'1.0.0',eventId,sequence:row.seq+1,at,timestamp:at,agentId:meta.parentAgentId??`wallet:${reviewId}`,runId:meta.graphRunId,actionId:digest({reviewId,stage}),actionOrder,previousActionId,toolCallId:null,tool:null,phase,status,modelSource:meta.modelSource,traceId:meta.traceId,walletReviewId:reviewId,parentAgentId:meta.parentAgentId,graphRunId:meta.graphRunId,parentEventId:row.last_event_id,eventType,stage,...detail});
      this.store.db.prepare('INSERT INTO wallet_graph_events VALUES(?,?,?,?)').run(reviewId,ev.sequence,eventKey,JSON.stringify(ev));
      this.store.db.prepare('UPDATE wallet_graph_tasks SET seq=?,last_event_id=? WHERE review_id=?').run(ev.sequence,eventId,reviewId);
      return ev;
    });
  }
  walletPage(reviewId:string,after:number,limit=200):WalletGraphPage{
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new ApiError(400,'INVALID_CURSOR');
    const task=this.store.db.prepare('SELECT seq,meta FROM wallet_graph_tasks WHERE review_id=?').get(reviewId) as {seq:number;meta:string}|undefined;
    const review=this.store.db.prepare('SELECT body FROM wallet_reviews WHERE id=?').get(reviewId) as {body:string}|undefined;
    if(!review)throw new ApiError(404,'WALLET_REVIEW_NOT_FOUND');
    const body=JSON.parse(review.body) as import('@verdict/protocol').WalletReview;
    const meta=task?JSON.parse(task.meta) as WalletMeta:{reviewId,traceId:body.traceId??reviewId,graphRunId:body.graphRunId??reviewId,parentAgentId:body.parentAgentId,modelSource:body.reviewer.source};
    const rows=this.store.db.prepare('SELECT body FROM wallet_graph_events WHERE review_id=? AND seq>? ORDER BY seq LIMIT ?').all(reviewId,after,limit+1) as {body:string}[];
    const events=rows.slice(0,limit).map(r=>AgentGraphEventSchema.parse(JSON.parse(r.body)));
    const waiting=['QUEUED','REVIEWING','ALLOWED','CONSUMED'].includes(body.status)&&!['SUCCESS','FAIL','REJECTED'].includes(body.receiptReport?.receiptStatus??'');
    const last=this.store.db.prepare('SELECT body FROM wallet_graph_events WHERE review_id=? ORDER BY seq DESC LIMIT 1').get(reviewId) as {body:string}|undefined;
    const agentId=meta.parentAgentId??`wallet:${reviewId}`;
    return WalletGraphPageSchema.parse({graphVersion:'1.0.0',agentId,available:!!task,walletReviewId:reviewId,traceId:meta.traceId,parentAgentId:meta.parentAgentId??null,graphRunId:meta.graphRunId,events,nextCursor:events.at(-1)?.sequence??after,hasMore:rows.length>limit,status:body.status,receiptStatus:body.receiptReport?.receiptStatus??'NOT_REPORTED',
      task:{status:waiting?'RUNNING':body.receiptReport?.receiptStatus==='SUCCESS'&&body.evidenceRef?'COMPLETED':'STOPPED',modelSource:meta.modelSource,runId:meta.graphRunId,error:null,finishedAt:waiting?null:last?JSON.parse(last.body).at:null,adoptedEvidenceId:null}});
  }
  page(id:string,after:number):AgentGraphPage {
    const a=this.agent(id),task=this.store.db.prepare('SELECT seq FROM graph_tasks WHERE agent_id=?').get(id) as {seq:number}|undefined;
    const rows=this.store.db.prepare('SELECT body FROM graph_events WHERE agent_id=? AND seq>? ORDER BY seq LIMIT 201').all(id,after) as {body:string}[];
    const events=rows.slice(0,200).map(r=>AgentGraphEventSchema.parse(JSON.parse(r.body)));
    return AgentGraphPageSchema.parse({graphVersion:'1.0.0',agentId:id,available:!!task,events,nextCursor:events.at(-1)?.sequence??after,hasMore:rows.length>200,
      task:{status:a.status,modelSource:a.modelSource,runId:a.runId,error:a.error,finishedAt:a.finishedAt,adoptedEvidenceId:a.runId?this.store.run(a.runId).accepted?.evidenceId??null:null}});
  }
}
