import { randomUUID } from 'node:crypto';
import { digest } from '@verdict/core';
import type { AgentEvent, AgentUsage } from '@verdict/protocol';
import type { ServerConfig } from './config.js';
import { Store } from './store.js';

export type ObservationSink=(agentId:string,kind:string,data:unknown)=>void;
const object=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const pick=(value:unknown,keys:string[])=>Object.fromEntries(keys.filter(k=>object(value)[k]!==undefined).map(k=>[k,object(value)[k]]));
const toolNames=new Set(['start_task','find_service','request_verified_state','get_evidence_summary','replay_evidence','stop_task']);
export class Observability {
  private timer?:ReturnType<typeof setInterval>;
  private sending:Promise<void>|null=null;
  private stopped=false;
  private lastError:string|null=null;
  private lastSentAt:string|null=null;
  private dropped=0;
  private unavailable=false;
  constructor(readonly store:Store,readonly config:ServerConfig){
    if(!config.observability)return;
    try{store.db.exec(`CREATE TABLE IF NOT EXISTS obs_sessions(agent_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS obs_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,body TEXT NOT NULL);`);}catch{this.unavailable=true;this.lastError='OUTBOX_INIT_FAILED';return;}
    this.timer=setInterval(()=>{void this.flush();},config.observability.flushMs);this.timer.unref();
  }
  private scrub(value:unknown){
    let text=JSON.stringify(value);
    for(const env of [this.config.agent?.apiKeyEnv,this.config.guard?.apiKeyEnv,this.config.guardReports?.signingKeyEnv,this.config.observability?.tokenEnv]){
      const key=env?process.env[env]:undefined;if(key)text=text.split(key).join('[REDACTED]');
    }
    return JSON.parse(text);
  }
  // This sink accepts only executor-built projections. Never pass prompts, model text or raw tool output here.
  record:ObservationSink=(agentId,kind,data)=>{
    if(!this.config.observability||this.stopped||this.unavailable)return;
    try{
      this.store.transaction(()=>{
        const count=(this.store.db.prepare('SELECT count(*) AS n FROM obs_outbox').get() as {n:number}).n;
        if(count>=9998){this.dropped++;this.lastError='OUTBOX_FULL';return;}
        let session=this.store.db.prepare('SELECT * FROM obs_sessions WHERE agent_id=?').get(agentId) as {session_id:string;seq:number}|undefined;
        if(!session){
          session={session_id:randomUUID(),seq:-1};this.store.db.prepare('INSERT INTO obs_sessions VALUES(?,?,?)').run(agentId,session.session_id,-1);
          this.insert(agentId,session,'session_start',{reason:'startup',pi_version:'1.0.4',adapter:'verdict-v1',authoritative:false});
        }
        if(kind==='verdict.model_request')this.insert(agentId,session,'turn_start',{turn_index:object(data).request});
        this.insert(agentId,session,'custom',{custom_type:kind,data:this.scrub(data)});
        if(kind==='verdict.model_response')this.insert(agentId,session,'turn_end',{turn_index:object(data).request});
        if(kind==='verdict.status'&&['COMPLETED','STOPPED','ERROR'].includes(object(data).status))this.insert(agentId,session,'session_shutdown',{reason:'quit'});
      });
    }catch{this.dropped++;this.lastError='OUTBOX_WRITE_FAILED';}
  };
  private insert(agentId:string,session:{session_id:string;seq:number},type:string,payload:unknown){
    const source=this.config.agent?.source??'NOT_CONFIGURED';
    const event={event_id:randomUUID(),ts:new Date().toISOString(),session_id:session.session_id,cwd:'',agent_name:`Verdict ${agentId.slice(0,8)}`,pool:'verdict',tags:[this.config.instanceId,source,'metadata-only'],model:this.config.agent?.modelId??'unconfigured',provider:'configured-compatible',type,payload,seq:++session.seq};
    const body=JSON.stringify(this.scrub(event));
    if(Buffer.byteLength(body)>32768)throw new Error('OBS_EVENT_TOO_LARGE');
    this.store.db.prepare('INSERT INTO obs_outbox(event_id,body) VALUES(?,?)').run(event.event_id,body);
    this.store.db.prepare('UPDATE obs_sessions SET seq=? WHERE agent_id=?').run(session.seq,agentId);
  }
  private publication(evidenceId:unknown){
    if(typeof evidenceId!=='string')return null;
    try{return pick(this.store.evidenceRow(evidenceId).publication,['status','adapter','error']);}catch{return null;}
  }
  agentEvent(event:AgentEvent){
    const d=object(event.data),name=event.toolName&&toolNames.has(event.toolName)?event.toolName:undefined;
    if(event.type==='ASSISTANT_TEXT')return;
    let data:unknown;
    switch(event.type){
      case 'STATUS':data={status:d.status};break;
      case 'MODEL_REQUEST':data={request:d.request,role:'actor'};break;
      case 'MODEL_RESPONSE':data={role:'actor',...pick(d,['request','headersMs','firstByteMs','firstEventMs','firstOutputMs','totalMs','httpStatus','completion','timeoutStage'])};break;
      case 'TOOL_START':data={tool:name,callId:event.toolCallId?digest(event.toolCallId):null,argumentsDigest:digest(d.arguments??{})};break;
      case 'TOOL_END':{
        let result:any={};
        if(Array.isArray(event.data)){
          try{result=JSON.parse(event.data.filter(v=>object(v).type==='text').map(v=>object(v).text).join(''));}catch{}
        }
        data={tool:name,callId:event.toolCallId?digest(event.toolCallId):null,error:d.error??null,...pick(result,['runId','status','stopReason','evidenceId','consistent','artifactIntegrity']),adopted:!!result.accepted,
          attempts:Array.isArray(result.attempts)?result.attempts.slice(0,32).map((a:any)=>({...pick(a,['serviceId','runtimeReason','evidenceId']),verification:pick(a.verification,['verdict','dataVerdict','attributionStatus','reasonCodes']),publication:this.publication(a.evidenceId)})):[]};break;
      }
      case 'ERROR':data={reason:d.reason};break;
      default:return;
    }
    this.record(event.agentId,`verdict.${event.type.toLowerCase()}`,data);
  }
  usage(id:string,role:'actor'|'reviewer',usage:AgentUsage,modelId:string,source:string){
    this.record(id,'verdict.model_usage',{role,modelId,source,...usage,cumulative:true});
  }
  sessionURL(agentId:string){
    if(!this.config.observability||this.unavailable)return null;
    const row=this.store.db.prepare('SELECT session_id FROM obs_sessions WHERE agent_id=?').get(agentId) as {session_id:string}|undefined;
    return row?`${this.config.observability.endpoint}/#sid=${row.session_id}`:null;
  }
  info(){
    let pending=0;
    if(this.config.observability)try{pending=(this.store.db.prepare('SELECT count(*) AS n FROM obs_outbox').get() as {n:number}).n;}catch{}
    return {enabled:!!this.config.observability,configured:!!this.config.observability&&!!process.env[this.config.observability.tokenEnv],dashboardURL:this.config.observability?.endpoint??null,pending,dropped:this.dropped,lastError:this.lastError,lastSentAt:this.lastSentAt,authority:'OBSERVATION_ONLY',privacy:'METADATA_ONLY'};
  }
  flush():Promise<void>{
    if(this.sending)return this.sending;
    if(this.stopped||!this.config.observability||this.unavailable)return Promise.resolve();
    this.sending=this.send().catch(()=>{this.lastError='OBSERVER_UNAVAILABLE';}).finally(()=>{this.sending=null;});return this.sending;
  }
  private async send(){
    const config=this.config.observability!;
    const token=process.env[config.tokenEnv];if(!token){this.lastError='TOKEN_NOT_CONFIGURED';return;}
    const rows=this.store.db.prepare('SELECT id,event_id,body FROM obs_outbox ORDER BY id LIMIT 50').all() as {id:number;event_id:string;body:string}[];
    if(!rows.length)return;
    try{
      const response=await fetch(config.endpoint+'/events',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(rows.map(r=>JSON.parse(r.body))),signal:AbortSignal.timeout(config.timeoutMs)});
      if(!response.ok)throw new Error('HTTP');
      const ack=await response.json() as {ingested:number;rejected:string[]};
      if(!Number.isSafeInteger(ack.ingested)||!Array.isArray(ack.rejected)||ack.ingested+ack.rejected.length!==rows.length||ack.rejected.some(id=>!rows.some(r=>r.event_id===id)))throw new Error('ACK');
      this.store.transaction(()=>{for(const row of rows)this.store.db.prepare('DELETE FROM obs_outbox WHERE id=?').run(row.id);});
      this.lastSentAt=new Date().toISOString();this.lastError=null;
    }catch{this.lastError='OBSERVER_UNAVAILABLE';}
  }
  async close(){if(this.timer)clearInterval(this.timer);await this.flush();this.stopped=true;}
}
