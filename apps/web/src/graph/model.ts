import {AgentGraphEventSchema,type AgentGraphEvent} from '@verdict/protocol';
export const toolLabels:Record<string,string>={start_task:'锁定任务',find_service:'选择候选',request_verified_state:'请求账户状态',get_evidence_summary:'读取证据',replay_evidence:'复验证据',stop_task:'停止任务',external_material:'检查外部材料',task_boundary:'确定任务边界'};
export const phaseLabels:Record<AgentGraphEvent['phase'],string>={PROPOSAL:'动作提议',REVIEW:'外审检查',EXECUTION:'执行调用',VERIFICATION:'交付验收',OUTCOME:'处理结果',TASK:'任务'};
export const statusLabels:Record<string,string>={PENDING:'已提议',RUNNING:'进行中',ALLOW:'允许',BLOCK:'拦截',UNCERTAIN:'无法判定',COMPLETED:'完成',PASS:'PASS',FAIL:'FAIL',UNVERIFIABLE:'不可验',REUSED:'复用已有结果',ADOPTED:'已采用',STOPPED:'停止',ERROR:'失败',CANCELLED:'已取消',INTERRUPTED:'已中断',UNKNOWN:'未知'};
export type GraphNode={id:string;x:number;y:number;event:AgentGraphEvent;firstAt:string;phase:string;title:string;displayStatus:string;waiting:boolean};
export type GraphEdge={id:string;source:string;target:string;sequence:number;orderOnly:boolean};
export function mergeGraphEvents(old:AgentGraphEvent[],incoming:unknown[]){
 const bySeq=new Map(old.map(e=>[e.sequence,e]));let conflict=false;
 for(const input of incoming){const e=AgentGraphEventSchema.parse(input),previous=bySeq.get(e.sequence);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(e)){conflict=true;continue;}
  bySeq.set(e.sequence,e);
 }
 return {events:[...bySeq.values()].sort((a,b)=>a.sequence-b.sequence),conflict};
}
export function graphProjection(input:AgentGraphEvent[]){
 const unique=new Map<number,AgentGraphEvent>();for(const event of input){if(!unique.has(event.sequence))unique.set(event.sequence,event);}
 const sorted=[...unique.values()].sort((a,b)=>a.sequence-b.sequence),events:AgentGraphEvent[]=[];
 let expected=1;for(const event of sorted){if(event.sequence!==expected)break;events.push(event);expected++;}
 let gap=events.length<sorted.length;
 const terminal=[...events].reverse().find(e=>e.phase==='TASK'&&e.status!=='RUNNING');
 const stageX={PROPOSAL:0,REVIEW:240,EXECUTION:480,VERIFICATION:720,OUTCOME:960,TASK:0};
 const nodes=new Map<string,GraphNode>();const actions=new Map<string,AgentGraphEvent>();
 for(const event of events){
  const task=event.phase==='TASK';const id=task?(event.status==='RUNNING'?'task-start':'task-end'):`${event.actionId}:${event.phase}`;
  const old=nodes.get(id);if(event.actionId)actions.set(event.actionId,event);
  const effective={...old?.event,...event};
  const waiting=effective.status==='RUNNING'&&!terminal;
  let title=task?(event.status==='RUNNING'?'开始任务':'任务结束'):(toolLabels[event.tool??'']??'动作');
  if(event.phase==='EXECUTION'&&event.tool==='request_verified_state')title='获取签名交付';
  if(event.phase==='VERIFICATION')title=event.tool==='replay_evidence'?'重新核验证据':'验证签名与证明';
  if(event.phase==='OUTCOME')title=event.status==='ADOPTED'?'采用本次交付':event.status==='FAIL'||event.status==='UNVERIFIABLE'?'拒收本次交付':event.status==='REUSED'?'使用已有调用记录':'动作处理结果';
  const phase=event.phase==='REVIEW'?(event.reviewerKind==='HARD_RULE'?'范围检查':event.reviewerKind==='NOT_ENABLED'?'执行边界':'外审检查'):event.phase==='VERIFICATION'&&event.tool==='replay_evidence'?'证据复验':phaseLabels[event.phase];
  nodes.set(id,{id,x:task?(id==='task-start'?0:960):stageX[event.phase],y:task?-135:(event.actionOrder-1)*150,event:effective,firstAt:old?.firstAt??event.at,phase,title,displayStatus:id==='task-start'?'COMPLETED':event.status==='RUNNING'&&terminal?'INTERRUPTED':event.status,waiting:waiting&&id!=='task-start'});
 }
 const actionList=[...actions.values()].sort((a,b)=>a.actionOrder-b.actionOrder);
 if(nodes.has('task-end'))nodes.get('task-end')!.y=actionList.length*150;
 const edges:GraphEdge[]=[];
 const add=(source:string,target:string,orderOnly=false)=>{if(nodes.has(source)&&nodes.has(target))edges.push({id:`${source}->${target}`,source,target,sequence:nodes.get(target)!.event.sequence,orderOnly});};
 const last=new Map<string,string>();
 for(const action of actionList){
  const stageNodes=[...nodes.values()].filter(n=>n.event.actionId===action.actionId).sort((a,b)=>a.x-b.x);
  const first=stageNodes[0];if(!first)continue;
  const previous=action.previousActionId?last.get(action.previousActionId):'task-start';if(previous)add(previous,first.id,true);
  for(let i=1;i<stageNodes.length;i++){
    const source=stageNodes[i-1],target=stageNodes[i];
    if((target.event.phase==='EXECUTION'&&source.event.phase!=='REVIEW')||(target.event.phase==='VERIFICATION'&&source.event.phase!=='EXECUTION')){gap=true;continue;}
    add(source.id,target.id);
  }
  last.set(action.actionId!,stageNodes.at(-1)!.id);
 }
 if(nodes.has('task-end'))add(actionList.length?last.get(actionList.at(-1)!.actionId!)!:'task-start','task-end',true);
 return {nodes:[...nodes.values()],edges,gap,terminal,events,adopted:events.find(e=>e.status==='ADOPTED')??null};
}
export function replayDelay(a:AgentGraphEvent,b:AgentGraphEvent){return Math.max(350,Math.min(1000,Date.parse(b.at)-Date.parse(a.at)));}
