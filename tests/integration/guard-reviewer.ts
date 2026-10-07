import { createServer } from 'node:http';
import type { AgentConditions } from '@verdict/protocol';
// Explicit test-only transport. No delivery tools, shared actor transcript, or real-model claim.
export async function reviewerFixture(conditions:AgentConditions){
 const state={verdict:'ALLOW',requests:0,delayMs:0,inputs:[] as any[]};
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=JSON.parse(Buffer.concat(chunks).toString());state.requests++;
  if(state.delayMs)await new Promise(r=>setTimeout(r,state.delayMs));
  const content=body.messages.find((m:any)=>m.role==='user').content;
  const prompt=JSON.parse(typeof content==='string'?content:content.map((c:any)=>c.text??'').join(''));
  state.inputs.push(prompt);
  const args=prompt.task ? {conditions:/最新|区块尚未指定/.test(prompt.task)?null:conditions} : {verdict:state.verdict,reasonCode:'TEST_REVIEW'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  const write=(delta:unknown,finish_reason:unknown)=>res.write('data: '+JSON.stringify({id:'guard-test',object:'chat.completion.chunk',created:1,model:'guard-test',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  write({role:'assistant',tool_calls:[{index:0,id:'review',type:'function',function:{name:'submit_review',arguments:JSON.stringify(args)}}]},null);
  write({},'tool_calls');res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {state,baseURL:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
