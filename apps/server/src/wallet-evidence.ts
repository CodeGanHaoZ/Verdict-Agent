import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {digest} from '@verdict/core';
import {canonical_json,WalletEvidenceBodySchema,WalletEvidencePacketSchema,WalletHashSchema,type WalletEvidencePacket,type WalletEvidenceReplay} from '@verdict/protocol';
import {Store,ApiError} from './store.js';
import {checkedTransaction,checkedReceipt,observedState,stateDelta,type WalletRpc,WalletObservationFailure} from './wallet-observation.js';
export class WalletEvidenceStore {
  constructor(private store:Store){
    mkdirSync(resolve(store.dir,'wallet-evidence'),{recursive:true,mode:0o700});
    store.db.exec('CREATE TABLE IF NOT EXISTS wallet_evidence(id TEXT PRIMARY KEY,review_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS wallet_evidence_replays(id TEXT PRIMARY KEY,body TEXT NOT NULL);');
  }
  save(raw:unknown){
    const body=WalletEvidenceBodySchema.parse(raw),id=digest(body);
    const packet=WalletEvidencePacketSchema.parse({evidenceRef:id,body});
    const path=resolve(this.store.dir,'wallet-evidence',`${id}.json`);
    try{writeFileSync(path,canonical_json(packet)+'\n',{mode:0o600,flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;this.read(id);}
    this.store.db.prepare('INSERT OR IGNORE INTO wallet_evidence VALUES(?,?)').run(id,body.walletReviewId);
    return id;
  }
  read(id:string):WalletEvidencePacket{
    WalletHashSchema.parse(id);
    let packet:WalletEvidencePacket;
    try{packet=WalletEvidencePacketSchema.parse(JSON.parse(readFileSync(resolve(this.store.dir,'wallet-evidence',`${id}.json`),'utf8')));}catch{throw new ApiError(404,'WALLET_EVIDENCE_UNAVAILABLE');}
    if(packet.evidenceRef!==id||digest(packet.body)!==id)throw new ApiError(409,'WALLET_EVIDENCE_TAMPERED');return packet;
  }
  async replay(packet:WalletEvidencePacket,ask:WalletRpc,source:'LIVE'|'TEST_TRANSPORT',policy:()=>void):Promise<WalletEvidenceReplay>{
    const base={evidenceRef:packet.evidenceRef,integrity:'VERIFIED' as const,authority:'RPC_OBSERVATION_ONLY' as const,reviewAndPermit:'NOT_REPLAYED' as const,observationSource:source};
    if(digest(packet.body)!==packet.evidenceRef)return {...base,integrity:'MISMATCH',status:'MISMATCH',reason:'WALLET_EVIDENCE_TAMPERED'};
    let result:WalletEvidenceReplay;
    try{
      policy();const p=packet.body;
      const transaction=await checkedTransaction(ask,p.preparedTransaction,p.transaction.hash);
      const before=await observedState(ask,p.preparedTransaction,p.before.blockNumber,p.before.blockHash);
      const receipt=await checkedReceipt(ask,transaction,before);
      const after=await observedState(ask,p.preparedTransaction,receipt.blockNumber,receipt.blockHash);
      const postState=stateDelta(before,after,receipt.status==='0x1'?'SUCCESS':'FAIL');
      const same=canonical_json({transaction,before,receipt,after,postState})===canonical_json({transaction:p.transaction,before:p.before,receipt:p.receipt,after:p.after,postState:p.postState});
      result={...base,status:same?'MATCH':'MISMATCH',reason:same?'RPC_OBSERVATIONS_RECOMPUTED':'OBSERVATION_MISMATCH',postState};
    }catch(e){result={...base,status:e instanceof WalletObservationFailure&&e.mismatch?'MISMATCH':'UNKNOWN',reason:e instanceof WalletObservationFailure?e.reason:'RPC_REPLAY_UNAVAILABLE'};}
    this.store.db.prepare('INSERT OR REPLACE INTO wallet_evidence_replays VALUES(?,?)').run(packet.evidenceRef,JSON.stringify(result));return result;
  }
}
