import { WalletMetaSchema, WalletAddressSchema, type WalletReview } from '@verdict/protocol';
import { primary, request } from '../api';
import { escape as e } from '../view';
import { discoverWallets, GuardedWallet, type WalletChoice } from './provider';
const wei=(value:string)=>{if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value))throw Error('请输入最多 18 位小数的非负金额');const [whole,fraction='']=value.split('.');return BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));};
export function mountWalletUI(root:HTMLElement) {
  root.innerHTML=`<div class="task-layout"><section class="panel task-panel"><div class="panel-heading"><h2>钱包交易审查</h2><span class="step">BEFORE SIGNING</span></div>
  <p class="hint">仅保护经本页发起的交易。先检查实际参数和预执行结果，再交给钱包确认签名。</p>
  <label>选择钱包<select id="wallet-provider"><option value="">未发现浏览器钱包</option></select></label><button class="secondary-button" id="wallet-connect">连接钱包</button> <button class="text-button" id="wallet-disconnect">断开本页连接</button>
  <p id="wallet-session" class="hint">尚未连接。不会读取私钥或助记词。</p><p id="wallet-config" role="status">正在读取审查配置…</p>
  <form id="wallet-form"><fieldset id="wallet-fields" disabled><label>收款地址<input id="wallet-recipient" spellcheck="false" required placeholder="0x…"></label>
  <label>原生币数量<input id="wallet-amount" value="0.0001" inputmode="decimal" required></label>
  <label>最高总网络费（原生币）<input id="wallet-fee" value="0.001" inputmode="decimal" required></label>
  <button class="primary-button" type="submit">审查并提交钱包 →</button></fieldset></form>
  <button class="text-button" id="wallet-cancel" disabled>取消当前审查</button>
  <p class="footnote">首版支持无代码账户之间的原生币转账。代币授权、合约调用和消息签名尚不支持放行。钱包内修改交易会脱离本次审查；请核对钱包最终展示。</p></section>
  <section class="panel audit-panel"><div class="panel-heading"><h2>交易检查过程</h2><span class="step">PI REVIEW</span></div><div id="wallet-result" aria-live="polite">连接钱包后填写交易，审查通过才会弹出钱包。</div><p id="wallet-error" role="alert"></p></section></div>`;
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>root.querySelector<T>('#'+id)!;
  let meta:ReturnType<typeof WalletMetaSchema.parse>|null=null,busy=false;
  const choices=new Map<string,WalletChoice>();
  const update=()=>{
    $('wallet-session').textContent=wallet.account?`账户 ${wallet.account} · 网络 ${wallet.chainId}`:'尚未连接，或钱包账户／网络已切换，请重新连接。';
    const network=meta?.networks.find(n=>n.chainId===wallet.chainId);
    $('wallet-fields').toggleAttribute('disabled',busy||!wallet.account||!meta?.configured||!network?.ready);
    $('wallet-connect').toggleAttribute('disabled',busy);$('wallet-disconnect').toggleAttribute('disabled',busy);
    if(meta)$('wallet-config').textContent=!meta.configured?'交易审查未配置：需要后端 RPC 与独立审查模型。':wallet.account&&!network?'当前钱包网络未配置审查，已停止发送。':network?`当前网络：${network.name}。仅支持原生币转账。`:'审查已配置，连接钱包后核对网络。';
  };
  const wallet=new GuardedWallet((path,body)=>request(primary,path,body),update);
  discoverWallets(choice=>{choices.set(choice.id,choice);const select=$<HTMLSelectElement>('wallet-provider');if(choices.size===1)select.innerHTML='';const option=document.createElement('option');option.value=choice.id;option.textContent=choice.name;select.append(option);});
  const error=(x:unknown)=>{$('wallet-error').textContent=x instanceof Error?x.message:'钱包操作失败';};
  const draw=(r:WalletReview)=>{$('wallet-result').innerHTML=`<p><strong>${e(r.status)}</strong> · ${e(r.reason)}</p><p class="hint">审查模型 ${e(r.reviewer.modelId)} · ${e(r.reviewer.source)} · 请求 ${r.usage.requests} 次</p>
    ${r.checks.map(c=>`<details open><summary>${e(c.status)} · ${e(c.reason)}</summary><pre>${e(JSON.stringify(c.facts,null,2))}</pre></details>`).join('')}
    <ol>${r.events.map(event=>`<li>${e(event.kind)} · ${e(event.name)}</li>`).join('')}</ol><p class="hint">模型判断为辅助审查；RPC 观察不是链上最终性或未来状态保证。服务端没有广播交易。</p>`;};
  $('wallet-connect').onclick=async()=>{try{const choice=choices.get($<HTMLSelectElement>('wallet-provider').value);if(!choice)throw Error('请在支持钱包扩展的浏览器中安装或开启钱包');await wallet.connect(choice.provider);$('wallet-error').textContent='';}catch(x){error(x);}};
  $('wallet-disconnect').onclick=()=>wallet.disconnect();
  $('wallet-cancel').onclick=async()=>{try{await wallet.cancel();$('wallet-error').textContent='已取消审查。';}catch(x){error(x);}};
  $('wallet-form').onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    try{
      if(!wallet.account||!wallet.chainId)throw Error('请先连接钱包');
      const to=WalletAddressSchema.parse($<HTMLInputElement>('wallet-recipient').value.trim());
      const value=wei($<HTMLInputElement>('wallet-amount').value),fee=wei($<HTMLInputElement>('wallet-fee').value);
      const transaction={from:wallet.account,chainId:wallet.chainId,to,value:'0x'+value.toString(16),data:'0x'};
      busy=true;update();$('wallet-cancel').removeAttribute('disabled');$('wallet-error').textContent='';
      const txHash=await wallet.reviewAndSend(transaction,{account:wallet.account,chainId:wallet.chainId,recipient:to,maxValueWei:value.toString(),maxTotalFeeWei:fee.toString(),operation:'native_transfer'},draw);
      const message=document.createElement('p');message.textContent=`钱包返回交易哈希：${txHash}。尚未核实链上确认。`;$('wallet-result').append(message);
    }catch(x){error(x);}finally{busy=false;$('wallet-cancel').setAttribute('disabled','');update();}
  };
  void request(primary,'/api/wallet/meta').then(data=>{meta=WalletMetaSchema.parse(data);update();}).catch(error);
}
