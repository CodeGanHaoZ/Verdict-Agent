import {createServer,type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {harness} from './pi-harness.js';
import {AgentConfigSchema,WalletConfigSchema} from '../../apps/server/src/config.js';
import {WalletReviewSchema,WalletGraphPageSchema,type CreateWalletReviewSchema} from '@verdict/protocol';
import {z} from 'zod';
export const account='0x'+'1'.repeat(40),recipient='0x'+'2'.repeat(40),txHash='0x'+'a'.repeat(64),preHash='0x'+'b'.repeat(64),postHash='0x'+'c'.repeat(64);
export const body=()=>({clientRequestId:randomUUID(),transaction:{chainId:'0x3c8',from:account,to:recipient,value:'0x64',data:'0x'},intent:{account,chainId:'0x3c8',recipient,maxValueWei:'100',maxTotalFeeWei:'1000000',operation:'native_transfer' as const}});
const listen=async(s:Server)=>{await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(s.address() as {port:number}).port}`;};
const close=async(s:Server)=>{s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));};
export async function walletHarness(){
  // Actual HTTP backend + SQLite + PI loop. RPC/model transports are explicit isolated fixtures.
  const h=await harness();
  const rpcState={calls:[] as {method:string;params:any[]}[],txPatch:{} as Record<string,unknown>,receiptPatch:{} as Record<string,unknown>,blockPatch:{} as Record<string,unknown>,chain:'0x3c8',missingTx:false,missingReceipt:false,timeoutMethod:'',errorMethod:'',postStateError:false,postBalance:'0xefce0',delayMethod:'',delayMs:0};
  const rpc=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const {id,method,params}=JSON.parse(Buffer.concat(chunks).toString());rpcState.calls.push({method,params});
    if(method===rpcState.timeoutMethod){return;}
    if(method===rpcState.delayMethod)await new Promise(r=>setTimeout(r,rpcState.delayMs));
    const post=params.at(-1)==='0x11';let result:unknown;
    if(method===rpcState.errorMethod||(post&&method==='eth_getBalance'&&rpcState.postStateError)){
      res.end(JSON.stringify({jsonrpc:'2.0',id,error:{message:'RPC_SECRET_CANARY FULL_CALLDATA_CANARY'}}));return;
    }
    switch(method){
      case 'eth_chainId':result=rpcState.chain;break;
      case 'eth_getBlockByNumber':{const n=params[0]==='latest'?'0x10':params[0];result={number:n,hash:n==='0x10'?preHash:postHash,baseFeePerGas:'0x1',...rpcState.blockPatch};break;}
      case 'eth_getCode':result='0x';break;
      case 'eth_getTransactionCount':result=post?'0x2':'0x1';break;
      case 'eth_getBalance':result=params[0]===account?(post?rpcState.postBalance:'0xf4240'):(post?'0x2bc':'0x1f4');break;
      case 'eth_maxPriorityFeePerGas':result='0x1';break;
      case 'eth_call':result='0x';break;
      case 'eth_estimateGas':result='0x5208';break;
      case 'eth_getTransactionByHash':result=rpcState.missingTx?null:{hash:txHash,chainId:'0x3c8',from:account,to:recipient,value:'0x64',nonce:'0x1',gas:'0x5208',maxFeePerGas:'0x3',maxPriorityFeePerGas:'0x1',input:'0x',blockNumber:'0x11',blockHash:postHash,...rpcState.txPatch};break;
      case 'eth_getTransactionReceipt':result=rpcState.missingReceipt?null:{transactionHash:txHash,from:account,to:recipient,status:'0x1',blockNumber:'0x11',blockHash:postHash,gasUsed:'0x5208',logs:[],...rpcState.receiptPatch};break;
      default:res.statusCode=400;res.end();return;
    }
    res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id,result}));
  });
  const reviewerState={verdict:'ALLOW' as 'ALLOW'|'BLOCK'|'UNCERTAIN',requests:0,reason:'TEST_REVIEW',delayMs:0,invalid:false};
  const model=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString());reviewerState.requests++;
    if(reviewerState.delayMs)await new Promise(r=>setTimeout(r,reviewerState.delayMs));
    const hasReads=request.messages.some((m:any)=>m.role==='tool');
    const calls=hasReads||reviewerState.invalid?[{name:'submit_review',args:{verdict:reviewerState.verdict,reasonCode:reviewerState.reason,evidenceIds:['policy','preflight']}}]:['inspect_transaction','check_policy','simulate_transaction'].map(name=>({name,args:{}}));
    res.writeHead(200,{'content-type':'text/event-stream'});
    const chunk=(delta:unknown,finish_reason:unknown=null)=>res.write('data: '+JSON.stringify({id:'wallet-test',object:'chat.completion.chunk',created:1,model:'TEST_TRANSPORT',choices:[{index:0,delta,finish_reason}]})+'\n\n');
    chunk({role:'assistant',reasoning_content:'HIDDEN_THOUGHT_CANARY',tool_calls:calls.map((c,index)=>({index,id:`tool-${reviewerState.requests}-${index}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))});
    chunk({},'tool_calls');res.end('data: [DONE]\n\n');
  });
  const rpcEnv='VERDICT_RPC_'+randomUUID().replaceAll('-','').toUpperCase(),keyEnv='VERDICT_KEY_'+randomUUID().replaceAll('-','').toUpperCase();
  process.env[rpcEnv]=await listen(rpc);process.env[keyEnv]='WALLET_API_SECRET_CANARY';
  h.config.wallet=WalletConfigSchema.parse({networks:[{chainId:'0x3c8',nativeSymbol:'tBOT',name:'BOT test transport',rpcUrlEnv:rpcEnv,maxValueWei:'10000',maxTotalFeeWei:'1000000'}],rpcTimeoutMs:200,reviewTimeoutMs:3000,permitTtlMs:10000,observationSource:'TEST_TRANSPORT'});
  h.config.guard=AgentConfigSchema.parse({...h.config.guard!,baseURL:(await listen(model))+'/v1',apiKeyEnv:keyEnv,source:'TEST_TRANSPORT',requestTimeoutMs:1500});
  await h.restart();
  const api=async(path:string,input?:unknown)=>{const r=await fetch(h.base+path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});return {code:r.status,data:await r.json() as any};};
  const settle=async(id:string)=>{for(let i=0;i<400;i++){const r=h.app.wallet.get(id);if(!['QUEUED','REVIEWING'].includes(r.status))return r;await new Promise(r=>setTimeout(r,10));}throw Error('wallet fixture deadline');};
  const create=async(input:z.infer<typeof CreateWalletReviewSchema>=body())=>{const {code,data}=await api('/api/wallet/reviews',input);if(code!==202)throw Error(JSON.stringify(data));return settle(data.reviewId);};
  const consumed=async()=>{const r=await create();if(r.status!=='ALLOWED')throw Error(JSON.stringify(r));const reply=await api(`/api/wallet/reviews/${r.reviewId}/consume`,{transaction:r.preparedTransaction});if(reply.code!==200)throw Error(JSON.stringify(reply));return WalletReviewSchema.parse(h.app.wallet.get(r.reviewId));};
  const graph=async(id:string,query='')=>WalletGraphPageSchema.parse((await api(`/api/wallet/reviews/${id}/graph?${query}`)).data);
  return {h,rpcState,reviewerState,api,create,settle,consumed,graph,close:async()=>{await h.close();await close(rpc);await close(model);delete process.env[rpcEnv];delete process.env[keyEnv];}};
}
