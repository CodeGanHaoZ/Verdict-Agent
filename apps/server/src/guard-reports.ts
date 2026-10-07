import { sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';
import { digest } from '@verdict/core';
import { RuleCandidateSchema, canonical_json, SignedSecurityIncidentSchema, SecurityIncidentSchema, type SecurityIncident, type RuleCandidate } from '@verdict/protocol';
import { Store, ApiError } from './store.js';
import { randomUUID } from 'node:crypto';
import { Guard, boundaryViolation } from './guard.js';
import type { ServerConfig } from './config.js';

export class GuardReports {
 constructor(readonly store:Store,readonly config:ServerConfig){
  store.db.exec('CREATE TABLE IF NOT EXISTS guard_reports(id TEXT PRIMARY KEY,incident_key TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,result TEXT NOT NULL); CREATE TABLE IF NOT EXISTS guard_rules(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS guard_exports(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
 }
 export(raw:Omit<SecurityIncident,'sharedMaterials'> & {sharedMaterials?:string[]},publicMaterialReviewed=false){
  const c=this.config.guardReports;
  if(!c||!process.env[c.signingKeyEnv])throw new ApiError(503,'REPORT_SIGNER_NOT_CONFIGURED');
  const incident=SecurityIncidentSchema.parse({...raw,reporterId:c.reporterId});
  const serialized=canonical_json(incident);
  for(const name of [c.signingKeyEnv,this.config.agent?.apiKeyEnv,this.config.guard?.apiKeyEnv]){
    const secret=name?process.env[name]:undefined;
    if(secret&&serialized.includes(secret))throw new ApiError(400,'REPORT_CONTAINS_CREDENTIAL');
  }
  if((incident.sharedMaterials.length||incident.relatedEvidence?.length)&&!publicMaterialReviewed)throw new ApiError(400,'RAW_MATERIAL_EXPORT_REQUIRES_REDACTION');
  const key=createPrivateKey(process.env[c.signingKeyEnv]!);
  if(key.asymmetricKeyType!=='ed25519')throw new ApiError(400,'REPORT_KEY_MUST_BE_ED25519');
  const exportKey=digest({...incident,at:null});
  const existing=this.store.db.prepare('SELECT body FROM guard_exports WHERE id=?').get(exportKey) as {body:string}|undefined;
  if(existing)return SignedSecurityIncidentSchema.parse(JSON.parse(existing.body));
  const hash=digest(incident);
  const packet={incident,digest:hash,signature:sign(null,Buffer.from(canonical_json(incident)),key).toString('base64')};
  this.store.db.prepare('INSERT INTO guard_exports VALUES(?,?)').run(exportKey,JSON.stringify(packet));
  return packet;
 }
 import(raw:unknown){
  const packet=SignedSecurityIncidentSchema.parse(raw),i=packet.incident;
  const pem=this.config.guardReports?.trustedReporters[i.reporterId];
  if(!pem)throw new ApiError(400,'REPORTER_NOT_TRUSTED');
  const key=createPublicKey(pem);
  if(key.asymmetricKeyType!=='ed25519'||digest(i)!==packet.digest||!verify(null,Buffer.from(canonical_json(i)),key,Buffer.from(packet.signature,'base64')))throw new ApiError(400,'REPORT_SIGNATURE_INVALID');
  // Recompute facts, never adopt the source's model judgment or status.
  const violation=i.action==='start_task'&&i.proposed?boundaryViolation(i.boundary,i.proposed):null;
  const result={reportedStatus:i.status,status:i.status==='REVOKED'?'REVOKED':i.status==='FALSE_POSITIVE'?'FALSE_POSITIVE':violation?'REPRODUCED':'UNREPLAYABLE',reason:violation??'NECESSARY_MATERIAL_NOT_SHARED',attribution:'REPORTER_ONLY',basis:i.redaction==='SCOPE_RELATIONS'?'REDACTED_SCOPE_RELATION':'REPORTED_SCOPE',weight:1};
  return this.store.transaction(()=>{
   const old=this.store.db.prepare('SELECT body,result FROM guard_reports WHERE id=?').get(packet.digest) as {body:string;result:string}|undefined;
   if(old)return {id:packet.digest,duplicate:true,...this.get(packet.digest).replay};
   const versions=this.store.db.prepare('SELECT body FROM guard_reports WHERE incident_key=?').all(i.incidentKey) as {body:string}[];
   if(versions.some(r=>{const p=SignedSecurityIncidentSchema.parse(JSON.parse(r.body));return p.incident.reporterId===i.reporterId&&p.incident.revision>=i.revision;}))throw new ApiError(409,'REPORT_REVISION_CONFLICT');
   this.store.db.prepare('INSERT INTO guard_reports VALUES(?,?,?,?,?)').run(packet.digest,i.incidentKey,i.revision,JSON.stringify(packet),JSON.stringify(result));
   if(i.status==='REVOKED'||i.status==='FALSE_POSITIVE') {
     for(const rule of this.rules()) {
       const source=this.get(rule.sourceIncident).packet.incident;
       if(source.incidentKey===i.incidentKey&&source.reporterId===i.reporterId){rule.status='REVOKED';this.store.db.prepare('UPDATE guard_rules SET body=? WHERE id=?').run(JSON.stringify(rule),rule.id);}
     }
   }
   return {id:packet.digest,duplicate:false,...result};
  });
 }
 get(id:string){const row=this.store.db.prepare('SELECT body,result FROM guard_reports WHERE id=?').get(id) as {body:string;result:string}|undefined;if(!row)throw new ApiError(404,'REPORT_NOT_FOUND');const packet=SignedSecurityIncidentSchema.parse(JSON.parse(row.body));
 const related=this.store.db.prepare('SELECT body FROM guard_reports WHERE incident_key=?').all(packet.incident.incidentKey) as {body:string}[];
 const revoked=related.some(r=>{const p=SignedSecurityIncidentSchema.parse(JSON.parse(r.body));return p.incident.reporterId===packet.incident.reporterId&&p.incident.revision>=packet.incident.revision&&['REVOKED','FALSE_POSITIVE'].includes(p.incident.status);});
 return {packet,replay:{...JSON.parse(row.result),...(revoked?{status:packet.incident.status==='FALSE_POSITIVE'?'FALSE_POSITIVE':'REVOKED'}:{})}};}
 async replay(id:string,guard:Guard){
  const report=this.get(id);
  if(['REPRODUCED','REVOKED','FALSE_POSITIVE'].includes(report.replay.status))return report.replay;
  const packet=report.packet,c=this.config.guard;
  if(!packet.incident.sharedMaterials.length)return {...report.replay,status:'UNREPLAYABLE',reason:'NECESSARY_MATERIAL_NOT_SHARED'};
  if(!c||!process.env[c.apiKeyEnv])return {...report.replay,status:'UNREPLAYABLE',reason:'REVIEWER_NOT_CONFIGURED'};
  // No business tools or side effects: independently judge explicitly shared material.
  const taskId='security-replay-'+randomUUID(),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),c.maxDurationMs);
  try{
   await guard.lock(taskId,c,'Independent review of reported material',packet.incident.boundary,{},x=>x as typeof packet.incident.boundary,controller.signal);
   try{await guard.authorize(taskId,c,'external_material',{materials:packet.incident.sharedMaterials},()=>null,controller.signal);}catch{}
   const state=guard.state(taskId),decision=state.decisions.at(-1);
   return {status:decision?.verdict==='BLOCK'?'MODEL_SUSPECTED':decision?.verdict==='ALLOW'?'MODEL_NOT_REPRODUCED':'UNREPLAYABLE',basis:'INDEPENDENT_MODEL_JUDGMENT',modelSource:c.source,modelId:c.modelId,decision,usage:state.usage};
  }finally{clearTimeout(timer);try{guard.stop(taskId);}catch{}}
 }
 candidate(id:string){
  const report=this.get(id);
  const related=this.store.db.prepare('SELECT body FROM guard_reports WHERE incident_key=?').all(report.packet.incident.incidentKey) as {body:string}[];
  if(related.some(row=>{const p=SignedSecurityIncidentSchema.parse(JSON.parse(row.body));return p.incident.reporterId===report.packet.incident.reporterId&&p.incident.status==='REVOKED'&&p.incident.revision>=report.packet.incident.revision;}))throw new ApiError(409,'REPORT_REVOKED');
  if(report.replay.status!=='REPRODUCED')throw new ApiError(409,'REPORT_NOT_REPRODUCED');
  const kinds:Record<string,RuleCandidate['kind']>={SCOPE_account:'SCOPE_ACCOUNT',SCOPE_blockHash:'SCOPE_BLOCK',SCOPE_candidates:'SCOPE_CANDIDATES',SCOPE_budget:'SCOPE_BUDGET'};
  const kind=kinds[report.replay.reason];if(!kind)throw new ApiError(400,'RULE_KIND_UNSUPPORTED');
  const rule:RuleCandidate={id:digest({source:id,kind,version:1}),version:1,sourceIncident:id,kind,status:'CANDIDATE',regression:null};
  this.store.db.prepare('INSERT OR IGNORE INTO guard_rules VALUES(?,?)').run(rule.id,JSON.stringify(rule));return rule;
 }
 // Maintainer-only local operation. Intentionally not reachable from model tools or HTTP.
 maintain(id:string,action:'test'|'enable'|'revoke'){
  const rule=RuleCandidateSchema.parse(this.rules().find(r=>r.id===id));
  if(action==='revoke')rule.status='REVOKED';
  else if(action==='enable'){
   if(rule.status!=='TESTED'||!rule.regression||rule.regression.falseBlocks!==0||rule.regression.blocked!==rule.regression.attacks)throw new ApiError(409,'RULE_REGRESSION_REQUIRED');
   this.candidate(rule.sourceIncident);rule.status='ENABLED';
  }else{
   if(rule.status==='REVOKED')throw new ApiError(409,'RULE_REVOKED');
   const original=this.get(rule.sourceIncident).packet.incident;
   const b=original.boundary;
   const attacks=[{...b,account:'0x'+'f'.repeat(40)},{...b,blockHash:'0x'+'f'.repeat(64)},{...b,candidateIds:[...b.candidateIds,'outside']},{...b,budget:{...b.budget,maxAttempts:b.budget.maxAttempts+1}}];
   const controls=[b,{...b,candidateIds:b.candidateIds.slice(0,1)},{...b,budget:{...b.budget,maxAttempts:1}}];
   rule.regression={attacks:attacks.length,blocked:attacks.filter(p=>boundaryViolation(b,p)).length,controls:controls.length,falseBlocks:controls.filter(p=>boundaryViolation(b,p)).length};rule.status='TESTED';
  }
  this.store.db.prepare('UPDATE guard_rules SET body=? WHERE id=?').run(JSON.stringify(rule),id);return rule;
 }
 rules(){return (this.store.db.prepare('SELECT body FROM guard_rules').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
}
