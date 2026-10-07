import {z} from 'zod';
import {WalletHashSchema,WalletQuantitySchema,WalletAddressSchema,WalletObservedTransactionSchema,WalletObservedReceiptSchema,WalletStateObservationSchema,WalletPostStateSchema,type PreparedWalletTransaction,type WalletStateObservation} from '@verdict/protocol';
export type WalletRpc=(method:string,params:unknown[])=>Promise<unknown>;
export class WalletObservationFailure extends Error {
  constructor(readonly reason:string,readonly mismatch=false){super(reason);}
}
export const botChainId='0x3c8';
const blockSchema=z.object({number:WalletQuantitySchema,hash:WalletHashSchema});
const rpcTxSchema=z.object({hash:WalletHashSchema,from:WalletAddressSchema,to:WalletAddressSchema,chainId:WalletQuantitySchema.optional(),value:WalletQuantitySchema,nonce:WalletQuantitySchema,input:z.literal('0x'),gas:WalletQuantitySchema,maxFeePerGas:WalletQuantitySchema,maxPriorityFeePerGas:WalletQuantitySchema,blockNumber:WalletQuantitySchema.nullable(),blockHash:WalletHashSchema.nullable(),authorizationList:z.array(z.unknown()).max(0).optional(),accessList:z.array(z.unknown()).max(0).optional()});
export async function checkedTransaction(ask:WalletRpc,prepared:PreparedWalletTransaction,txHash:string){
  if(prepared.chainId!==botChainId||await ask('eth_chainId',[])!==botChainId)throw new WalletObservationFailure('RPC_CHAIN_MISMATCH',true);
  const raw=await ask('eth_getTransactionByHash',[txHash]);
  if(raw===null)throw new WalletObservationFailure('TX_NOT_FOUND');
  const parsed=rpcTxSchema.safeParse(raw);
  if(!parsed.success)throw new WalletObservationFailure('RPC_TRANSACTION_INVALID');
  const tx=parsed.data;
  if(tx.hash!==txHash||(tx.chainId!==undefined&&tx.chainId!==prepared.chainId)||tx.from!==prepared.from||tx.to!==prepared.to||tx.value!==prepared.value||tx.nonce!==prepared.nonce||tx.gas!==prepared.gas||tx.maxFeePerGas!==prepared.maxFeePerGas||tx.maxPriorityFeePerGas!==prepared.maxPriorityFeePerGas||prepared.data!=='0x')throw new WalletObservationFailure('BROADCAST_TRANSACTION_MISMATCH',true);
  return WalletObservedTransactionSchema.parse({...prepared,hash:tx.hash,blockNumber:tx.blockNumber,blockHash:tx.blockHash});
}
export async function checkedReceipt(ask:WalletRpc,tx:Awaited<ReturnType<typeof checkedTransaction>>,before:WalletStateObservation){
  const raw=await ask('eth_getTransactionReceipt',[tx.hash]);
  if(raw===null)throw new WalletObservationFailure('RECEIPT_NOT_FOUND');
  // Strip logs, arbitrary RPC messages, calldata and implementation-specific extras.
  const parsed=WalletObservedReceiptSchema.safeParse(raw&&typeof raw==='object'?Object.fromEntries(Object.keys(WalletObservedReceiptSchema.shape).map(k=>[k,(raw as Record<string,unknown>)[k]])):raw);
  if(!parsed.success)throw new WalletObservationFailure('RPC_RECEIPT_INVALID');
  const receipt=parsed.data;
  if(receipt.transactionHash!==tx.hash||receipt.from!==tx.from||receipt.to!==tx.to||receipt.blockHash!==tx.blockHash||receipt.blockNumber!==tx.blockNumber||BigInt(receipt.blockNumber)<=BigInt(before.blockNumber)||BigInt(receipt.gasUsed)>BigInt(tx.gas))throw new WalletObservationFailure('RECEIPT_TRANSACTION_MISMATCH',true);
  await assertBlock(ask,receipt.blockNumber,receipt.blockHash);
  return receipt;
}
export async function assertBlock(ask:WalletRpc,number:string,hash:string){
  const parsed=blockSchema.safeParse(await ask('eth_getBlockByNumber',[number,false]));
  if(!parsed.success)throw new WalletObservationFailure('RPC_BLOCK_INVALID');
  if(parsed.data.number!==number||parsed.data.hash!==hash)throw new WalletObservationFailure('BLOCK_CHANGED',true);
}
export async function observedState(ask:WalletRpc,tx:PreparedWalletTransaction,number:string,hash:string):Promise<WalletStateObservation>{
  await assertBlock(ask,number,hash);
  const [sender,recipient,nonce]=await Promise.all([ask('eth_getBalance',[tx.from,number]),ask('eth_getBalance',[tx.to,number]),ask('eth_getTransactionCount',[tx.from,number])]);
  const value=WalletStateObservationSchema.parse({blockNumber:number,blockHash:hash,senderBalance:BigInt(WalletQuantitySchema.parse(sender)).toString(),recipientBalance:BigInt(WalletQuantitySchema.parse(recipient)).toString(),senderNonce:WalletQuantitySchema.parse(nonce)});
  await assertBlock(ask,number,hash);return value;
}
export function stateDelta(before:WalletStateObservation,after:WalletStateObservation,receiptStatus:'SUCCESS'|'FAIL'){
  return WalletPostStateSchema.parse({senderBalanceBefore:before.senderBalance,senderBalanceAfter:after.senderBalance,senderBalanceDelta:(BigInt(after.senderBalance)-BigInt(before.senderBalance)).toString(),recipientBalanceBefore:before.recipientBalance,recipientBalanceAfter:after.recipientBalance,recipientBalanceDelta:(BigInt(after.recipientBalance)-BigInt(before.recipientBalance)).toString(),senderNonceBefore:before.senderNonce,senderNonceAfter:after.senderNonce,senderNonceDelta:(BigInt(after.senderNonce)-BigInt(before.senderNonce)).toString(),receiptStatus,blockNumber:after.blockNumber,blockHash:after.blockHash,source:'RPC_OBSERVATION',confirmation:'RECEIPT_CONFIRMED'});
}
