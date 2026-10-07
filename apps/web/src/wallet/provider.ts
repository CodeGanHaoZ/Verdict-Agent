import { WalletAddressSchema, WalletQuantitySchema, WalletReviewSchema, PreparedWalletTransactionSchema,
  type WalletReview, type WalletTransaction, type WalletIntent, canonical_json } from '@verdict/protocol';
import { z } from 'zod';

export interface WalletProvider {
  request(args:{method:string;params?:unknown[]}):Promise<unknown>;
  on?(event:string,listener:(...args:unknown[])=>void):void;
  removeListener?(event:string,listener:(...args:unknown[])=>void):void;
}
export type WalletChoice={id:string;name:string;provider:WalletProvider};
// EIP-6963 metadata is untrusted display text; never render wallet-supplied HTML/icons.
export function discoverWallets(receive:(choice:WalletChoice)=>void):()=>void {
  const providers=new Set<WalletProvider>();
  const add=(id:string,name:string,p:WalletProvider)=>{if(p&&typeof p.request==='function'&&!providers.has(p)){providers.add(p);receive({id,name:name.slice(0,80),provider:p});}};
  const announce=(event:Event)=>{const detail=(event as CustomEvent).detail;
    if(detail?.info&&typeof detail.info.uuid==='string'&&typeof detail.info.name==='string')add(detail.info.uuid,detail.info.name,detail.provider);};
  window.addEventListener('eip6963:announceProvider',announce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  const legacy=(window as unknown as {ethereum?:WalletProvider}).ethereum;
  if(legacy)add('injected','浏览器钱包',legacy);
  return ()=>window.removeEventListener('eip6963:announceProvider',announce);
}
export type WalletAPI=(path:string,body?:unknown)=>Promise<unknown>;
export class GuardedWallet {
  private provider:WalletProvider|null=null;
  private revision=0;
  private signing=false;
  private starting=false;
  private reviewId:string|null=null;
  private reviewRevision=-1;
  private snapshots=new Map<string,string>();
  account:string|null=null;
  chainId:string|null=null;
  readonly changed=()=>{this.revision++;this.snapshots.clear();const id=this.reviewId;this.reviewId=null;this.account=null;this.chainId=null;
    if(id)void this.api(`/api/wallet/reviews/${id}/cancel`,{}).catch(()=>{});this.onChange();};
  constructor(private api:WalletAPI,private onChange:()=>void=()=>{}){}
  disconnect(){this.provider?.removeListener?.('accountsChanged',this.changed);this.provider?.removeListener?.('chainChanged',this.changed);this.provider?.removeListener?.('disconnect',this.changed);this.provider=null;this.changed();}
  async connect(provider:WalletProvider){
    if(this.signing||this.starting)throw Error('WALLET_BUSY');this.disconnect();this.provider=provider;
    for(const event of ['accountsChanged','chainChanged','disconnect'])provider.on?.(event,this.changed);
    await provider.request({method:'eth_requestAccounts'});
    const epoch=this.revision;
    const accounts=z.array(WalletAddressSchema).min(1).parse(await provider.request({method:'eth_accounts'}));
    const chain=WalletQuantitySchema.parse(await provider.request({method:'eth_chainId'}));
    if(epoch!==this.revision||this.provider!==provider)throw Error('WALLET_CHANGED');
    this.account=accounts[0];this.chainId=chain;this.onChange();
  }
  private async assertSession(provider:WalletProvider,revision:number,account:string,chain:string){
    const accounts=z.array(WalletAddressSchema).parse(await provider.request({method:'eth_accounts'}));
    const current=WalletQuantitySchema.parse(await provider.request({method:'eth_chainId'}));
    if(this.revision!==revision||this.provider!==provider||accounts[0]!==account||current!==chain)throw Error('WALLET_CHANGED');
  }
  async review(transaction:WalletTransaction,intent:WalletIntent):Promise<WalletReview>{
    if(this.starting||this.signing)throw Error('WALLET_BUSY');
    if(!this.provider||!this.account||!this.chainId)throw Error('WALLET_NOT_CONNECTED');
    if(transaction.from!==this.account||transaction.chainId!==this.chainId)throw Error('WALLET_CHANGED');
    this.starting=true;
    const revision=this.revision,provider=this.provider,account=this.account,chain=this.chainId;
    try{
      if(this.reviewId)await this.api(`/api/wallet/reviews/${this.reviewId}/cancel`,{});
      this.snapshots.clear();this.reviewId=null;
      await this.assertSession(provider,revision,account,chain);
      const r=WalletReviewSchema.parse(await this.api('/api/wallet/reviews',{clientRequestId:crypto.randomUUID(),transaction:structuredClone(transaction),intent:structuredClone(intent)}));
      if(revision!==this.revision||provider!==this.provider){await this.api(`/api/wallet/reviews/${r.reviewId}/cancel`,{});throw Error('WALLET_CHANGED');}
      this.reviewId=r.reviewId;this.reviewRevision=revision;return r;
    }finally{this.starting=false;}
  }
  async poll():Promise<WalletReview>{
    if(!this.reviewId)throw Error('NO_ACTIVE_REVIEW');const id=this.reviewId;
    const r=WalletReviewSchema.parse(await this.api(`/api/wallet/reviews/${id}`));
    if(this.reviewId!==id||this.reviewRevision!==this.revision)throw Error('WALLET_CHANGED');
    if(r.status==='ALLOWED'&&r.preparedTransaction)this.snapshots.set(id,canonical_json(r.preparedTransaction));return r;
  }
  async reviewAndSend(transaction:WalletTransaction,intent:WalletIntent,onProgress:(r:WalletReview)=>void=()=>{}):Promise<string>{
    let r=await this.review(transaction,intent);onProgress(r);const deadline=Date.now()+185000;
    while(['QUEUED','REVIEWING'].includes(r.status)){
      if(Date.now()>=deadline){await this.cancel();throw Error('WALLET_REVIEW_TIMEOUT');}
      await new Promise(resolve=>setTimeout(resolve,300));r=await this.poll();onProgress(r);
    }
    if(r.status!=='ALLOWED')throw Error(r.reason);
    return this.send(r);
  }
  async cancel(){if(this.signing)throw Error('WALLET_REQUEST_ALREADY_SENT');const id=this.reviewId;this.reviewId=null;this.snapshots.clear();if(id)await this.api(`/api/wallet/reviews/${id}/cancel`,{});}
  async send(review:WalletReview):Promise<string>{
    if(this.signing||this.starting)throw Error('WALLET_BUSY');
    const provider=this.provider,revision=this.revision,account=this.account,chain=this.chainId;
    if(!provider||!account||!chain)throw Error('WALLET_NOT_CONNECTED');
    if(review.reviewId!==this.reviewId||revision!==this.reviewRevision||review.status!=='ALLOWED'||!review.expiresAt||Date.now()>=review.expiresAt||
       !review.preparedTransaction||this.snapshots.get(review.reviewId)!==canonical_json(review.preparedTransaction))throw Error('WALLET_REVIEW_REQUIRED');
    const tx=PreparedWalletTransactionSchema.parse(structuredClone(review.preparedTransaction));
    if(tx.from!==account||tx.chainId!==chain)throw Error('WALLET_CHANGED');
    this.signing=true;
    try {
      await this.assertSession(provider,revision,account,chain);
      const response=z.object({transaction:PreparedWalletTransactionSchema}).parse(await this.api(`/api/wallet/reviews/${review.reviewId}/consume`,{transaction:tx}));
      this.snapshots.delete(review.reviewId); // A rejected wallet prompt also requires a fresh review.
      if(canonical_json(response.transaction)!==canonical_json(tx))throw Error('WALLET_TRANSACTION_CHANGED');
      await this.assertSession(provider,revision,account,chain);
      if(Date.now()>=review.expiresAt)throw Error('WALLET_REVIEW_EXPIRED');
      const result=await provider.request({method:'eth_sendTransaction',params:[Object.freeze(tx)]});
      return z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(result);
    } finally {this.snapshots.delete(review.reviewId);this.signing=false;}
  }
}
