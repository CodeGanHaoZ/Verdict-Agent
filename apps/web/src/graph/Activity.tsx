import {useEffect,useMemo,useRef,useState,memo} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow,ReactFlowProvider,Controls,Background,Handle,Position,BaseEdge,MarkerType,getSmoothStepPath,type EdgeProps,type NodeProps,useReactFlow,type Node,type Edge} from '@xyflow/react';
import {AgentGraphPageSchema,AgentGraphRecordingSchema,type AgentGraphEvent,type AgentGraphPage,type AgentGraphRecording} from '@verdict/protocol';
import {primary,request} from '../api';
import {graphProjection,mergeGraphEvents,statusLabels,toolLabels,replayDelay,type GraphNode} from './model';
import success from '../../../../fixtures/graph/success.json';
import fallback from '../../../../fixtures/graph/fallback.json';
import blocked from '../../../../fixtures/graph/blocked.json';
import '@xyflow/react/dist/style.css';
import './graph.css';
const recordings=[success,fallback,blocked].map(value=>AgentGraphRecordingSchema.parse(value));
type CardData={node:GraphNode;clock:number} & Record<string,unknown>;
type FlowNode=Node<CardData,'action'>;
const ActionCard=memo(({data,selected}:NodeProps<FlowNode>)=>{
 const {node,clock}=data,e=node.event;
 const tone=['ADOPTED','PASS'].includes(node.displayStatus)?'good':['FAIL','BLOCK','ERROR'].includes(node.displayStatus)?'bad':['UNCERTAIN','UNVERIFIABLE','UNKNOWN','INTERRUPTED'].includes(node.displayStatus)?'warn':node.waiting?'active':'neutral';
 const elapsed=e.durationMs!==undefined?`${Math.round(e.durationMs)} ms`:node.waiting?`等待 ${Math.max(0,Math.floor((clock-Date.parse(node.firstAt))/1000))} s`:null;
 return <div className={`ag-node ${tone}${selected?' selected':''}`} data-phase={e.phase} data-status={node.displayStatus}>
  <Handle type="target" position={Position.Left}/>
  <div className="ag-node-kicker">{e.actionOrder>0?String(e.actionOrder).padStart(2,'0'):'●'} <span>{node.phase}</span></div>
  <div className="ag-node-title">{node.title}</div>
  {e.serviceId&&<div className="ag-node-target">{e.serviceId}</div>}
  <div className="ag-node-bottom"><span className="ag-state">{node.waiting&&<span className="ag-wait"/>}{statusLabels[node.displayStatus]??node.displayStatus}</span>{elapsed&&<span>{elapsed}</span>}</div>
  {e.reviewerKind==='NOT_ENABLED'&&<div className="ag-small">未启用模型外审</div>}
  <Handle type="source" position={Position.Right}/>
 </div>;
});
const FlowEdge=memo((props:EdgeProps)=>{
 const [path]=getSmoothStepPath({...props,borderRadius:18,offset:35});
 const animate=!!props.data?.pulse;
 return <><BaseEdge path={path} markerEnd={props.markerEnd} style={{stroke:props.data?.orderOnly?'#c4ccc7':'#99aca4',strokeWidth:1.3,strokeDasharray:props.data?.orderOnly?'4 4':undefined}}/>{animate&&<circle r="3.5" className="ag-particle"><animateMotion dur="0.65s" repeatCount="1" path={path} fill="freeze"/></circle>}</>;
});
const nodeTypes={action:ActionCard};const edgeTypes={flow:FlowEdge};
function ActivityGraph(){
 const routeAgent=()=>new URLSearchParams(location.hash.split('?')[1]??'').get('agent')??'';
 const [agentId,setAgentId]=useState(routeAgent),[inputId,setInputId]=useState(routeAgent),[demoId,setDemoId]=useState('fallback');
 const [events,setEvents]=useState<AgentGraphEvent[]>([]),[page,setPage]=useState<AgentGraphPage|null>(null),[cursor,setCursor]=useState(0),[playing,setPlaying]=useState(false),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[clock,setClock]=useState(Date.now());
 const [visible,setVisible]=useState(location.hash.startsWith('#activity'));
 const [reduced,setReduced]=useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
 const [pulses,setPulses]=useState(new Set<string>()),[following,setFollowing]=useState(true);
 const flow=useReactFlow<FlowNode>();const previousEdges=useRef(new Set<string>());const eventsRef=useRef(events);eventsRef.current=events;
 const requestGeneration=useRef(0),canvasRef=useRef<HTMLDivElement>(null);
 const [canvasSize,setCanvasSize]=useState({width:0,height:0});
 const recording=recordings.find(r=>r.id===demoId)!;
 const live=agentId!=='';
 useEffect(()=>{const listener=()=>{setAgentId(routeAgent());setInputId(routeAgent());setVisible(location.hash.startsWith('#activity'));};window.addEventListener('hashchange',listener);return()=>window.removeEventListener('hashchange',listener);},[]);
 useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)'),listener=()=>setReduced(query.matches);query.addEventListener('change',listener);return()=>query.removeEventListener('change',listener);},[]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{const element=canvasRef.current;if(!element)return;const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;setCanvasSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});});observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  const generation=++requestGeneration.current;setSelected(null);setError('');setConflict(false);setPlaying(false);setFollowing(true);previousEdges.current.clear();
  if(!live){eventsRef.current=recording.page.events;setEvents(recording.page.events);setPage(recording.page);setCursor(1);return;}
  setEvents([]);eventsRef.current=[];setCursor(0);setPage(null);
  return()=>{if(requestGeneration.current===generation)requestGeneration.current++;};
 },[agentId,demoId]);
 useEffect(()=>{
  if(!live||!visible)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const generation=requestGeneration.current;
  const load=async()=>{
   try{
    const prior=eventsRef.current;let after=graphProjection(prior).events.at(-1)?.sequence??0;let all=prior,next:AgentGraphPage;
    do{
     next=AgentGraphPageSchema.parse(await request(primary,`/api/agent/runs/${encodeURIComponent(agentId)}/graph?after=${after}`));
     if(stopped||generation!==requestGeneration.current)return;
     if(next.agentId!==agentId||next.events.some(event=>event.agentId!==agentId))throw new Error('收到其他任务的图记录，已拒绝显示');
     const merged=mergeGraphEvents(all,next.events);all=merged.events;if(merged.conflict)setConflict(true);
     if(next.hasMore&&next.nextCursor<=after)throw new Error('图事件游标未前进');after=next.nextCursor;
    }while(next.hasMore);
    eventsRef.current=all;setEvents(all);setPage(next);setError('');
    if(following)setCursor(all.length);
    if(!next.task.finishedAt)timer=setTimeout(load,500);
   }catch(e){if(stopped)return;setError(e instanceof Error?e.message:'图记录暂时不可用');timer=setTimeout(load,1500);}
  };void load();return()=>{stopped=true;if(timer)clearTimeout(timer);};
 },[agentId,visible,following]);
 useEffect(()=>{if(!playing||cursor>=events.length)return;const timer=setTimeout(()=>setCursor(n=>n+1),replayDelay(events[Math.max(0,cursor-1)],events[cursor]));return()=>clearTimeout(timer);},[playing,cursor,events]);
 useEffect(()=>{if(!visible)setPlaying(false);},[visible]);
 useEffect(()=>{if(cursor>=events.length)setPlaying(false);},[cursor,events.length]);
 const projection=useMemo(()=>graphProjection(events.slice(0,cursor)),[events,cursor]);
 const current=projection.nodes.find(n=>n.id===selected)??null;
 useEffect(()=>{
  const active=new Set<string>();for(const edge of projection.edges){if(!previousEdges.current.has(edge.id))active.add(edge.id);}
  previousEdges.current=new Set(projection.edges.map(e=>e.id));setPulses(reduced||error||projection.terminal?new Set():active);
  const timer=setTimeout(()=>setPulses(new Set()),700);return()=>clearTimeout(timer);
 },[projection.edges.map(e=>e.id).join('|'),reduced,error,!!projection.terminal]);
 useEffect(()=>{
  if(!visible||!projection.nodes.length||canvasSize.width<=0)return;
  const {width,height}=canvasSize;
  const active=projection.nodes.find(n=>n.event.sequence===projection.events.at(-1)?.sequence)??projection.nodes.at(-1)!;
  // Keep desktop rows stable; on narrow screens follow the current stage at readable scale.
  const zoom=width<600?.85:Math.min(.9,(width-50)/1170);
  const x=width<600?24-active.x*zoom:25;
  const top=32+135*zoom;
  const y=Math.min(top,height-80-(active.y+140)*zoom);
  const timer=setTimeout(()=>{void flow.setViewport({x,y,zoom},{duration:reduced?0:180});},0);
  return()=>clearTimeout(timer);
 },[cursor,visible,agentId,demoId,canvasSize,reduced,flow]);
 const displayClock=live&&following?clock:events[Math.max(0,cursor-1)]?Date.parse(events[Math.max(0,cursor-1)].at):clock;
 const terminalGap=!!(live&&following&&page?.task.finishedAt&&!projection.terminal);
 const nodes:FlowNode[]=projection.nodes.map(original=>{const n=terminalGap&&original.waiting?{...original,waiting:false,displayStatus:'UNKNOWN'}:original;return ({id:n.id,type:'action',position:{x:n.x,y:n.y},data:{node:n,clock:displayClock},draggable:false,selected:n.id===selected,ariaLabel:`${n.phase} ${n.title} ${statusLabels[n.displayStatus]}`,focusable:true});});
 const edges:Edge[]=projection.edges.map(e=>({...e,type:'flow',data:{pulse:pulses.has(e.id),orderOnly:e.orderOnly},animated:false,markerEnd:{type:MarkerType.ArrowClosed,width:14,height:14,color:'#99aca4'}}));
 const step=(value:number)=>{setPlaying(false);setFollowing(false);setCursor(Math.max(1,Math.min(events.length,value)));};
 const modeLabel=live?(following?'实时任务':'任务回放'):'录制回放';
 const taskStatus=projection.terminal?.status??(projection.nodes.length?'RUNNING':'PENDING');
 const stats={actions:new Set(projection.events.map(e=>e.actionId).filter(Boolean)).size,passed:projection.nodes.filter(n=>n.event.phase==='VERIFICATION'&&n.displayStatus==='PASS').length,rejected:projection.nodes.filter(n=>n.event.phase==='VERIFICATION'&&['FAIL','UNVERIFIABLE'].includes(n.displayStatus)).length};
 return <div className="agent-graph">
  <div className="ag-top"><div><span className="ag-eyebrow">ACTIVITY GRAPH</span><h2>每一步，都看得见。</h2><p>动作提议、外审、实际执行与验收，沿着同一条轨迹展开。</p></div><div className="ag-mode"><span>{modeLabel}</span><b>{page?.task.modelSource??'—'}</b></div></div>
  <div className="ag-sourcebar"><div className="ag-scenarios" aria-label="录制场景">{recordings.map(r=><button key={r.id} className={!live&&demoId===r.id?'active':''} aria-pressed={!live&&demoId===r.id} onClick={()=>{setDemoId(r.id);if(live)location.hash='activity';}}>{r.title}</button>)}</div><form onSubmit={e=>{e.preventDefault();if(inputId.trim())location.hash=`activity?agent=${encodeURIComponent(inputId.trim())}`;}}><label className="sr-only" htmlFor="graph-agent-id">任务 Agent ID</label><input id="graph-agent-id" placeholder="输入 Agent ID 查看真实任务" value={inputId} onChange={e=>setInputId(e.target.value)}/><button type="submit">查看任务</button></form></div>
  <div className="ag-statusbar" aria-live="polite"><span className={`ag-overall ${projection.adopted?'good':''}`}>{projection.adopted?`已有真实采用结果 · ${statusLabels[taskStatus]}`:statusLabels[taskStatus]}</span><span>{stats.actions} 个动作</span><span>{stats.passed} 次通过 / {stats.rejected} 次拒收</span><span className="ag-hint">{live?'只读展示 · 不发起额外交付':'冻结证明 + 签名演示服务 · 压缩等待时间 · 原始耗时保留'}</span></div>
  <div className="ag-controls"><button onClick={()=>{setFollowing(false);if(cursor>=events.length)setCursor(1);setPlaying(p=>!p);}} disabled={!events.length} aria-label={playing?'暂停回放':'播放回放'}>{playing?'Ⅱ 暂停':'▶ 播放'}</button><button onClick={()=>step(cursor-1)} disabled={cursor<=1}>上一步</button><button onClick={()=>step(cursor+1)} disabled={cursor>=events.length}>下一步</button><button onClick={()=>{step(1);previousEdges.current.clear();}}>重新播放</button><span className="ag-progress">{cursor} / {events.length} 条事件</span><button onClick={()=>{void flow.fitView({padding:0.07,maxZoom:1,duration:reduced?0:250});}}>适应画布</button>{live&&<button className={following?'active':''} onClick={()=>{setFollowing(true);setPlaying(false);setCursor(events.length);}}>跟随实时</button>}</div>
  {error&&<p role="alert" className="ag-alert">连接中断，保留已收到的记录：{error}</p>}
  {(projection.gap||conflict)&&<p role="alert" className="ag-alert">图记录不完整或存在冲突；未确认的连接不绘制，缺失事件之后的记录等待补齐。</p>}
  {page&&!page.available&&page.task.finishedAt&&<p className="ag-empty">该任务暂无完整动作图。可返回任务页查看原时间线。</p>}
  <div className={`ag-layout ${current?'has-detail':''}`}>
   <div ref={canvasRef} className="ag-canvas" role="region" aria-label="Agent 动作图"><ReactFlow<FlowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodeClick={(_,node)=>setSelected(node.id)} onPaneClick={()=>setSelected(null)} nodesDraggable={false} nodesConnectable={false} elementsSelectable proOptions={{hideAttribution:false}} minZoom={0.15} maxZoom={1.5} zoomOnDoubleClick={false} autoPanOnNodeFocus fitView={false}><Background gap={24} size={1} color="#dce3dc"/><Controls showInteractive={false}/></ReactFlow>{!projection.nodes.length&&<div className="ag-canvas-empty">{live?'等待动作记录…':'选择录制轨迹开始回放'}</div>}</div>
   {current&&<aside className="ag-detail" aria-label="动作详情"><div className="ag-detail-heading"><span>{current.phase}</span><button onClick={()=>setSelected(null)} aria-label="关闭动作详情">×</button></div><h3>{current.title}</h3><strong>{statusLabels[current.displayStatus]}</strong><dl><dt>动作关联</dt><dd>{current.event.actionId??'任务级事件'}</dd><dt>调用对象</dt><dd>{current.event.serviceId??current.event.targetId??'—'}</dd><dt>首次阶段记录</dt><dd>{new Date(current.firstAt).toLocaleTimeString()}</dd><dt>记录时间</dt><dd>{new Date(current.event.at).toLocaleTimeString()}</dd><dt>实际耗时</dt><dd>{current.event.durationMs!==undefined?`${Math.round(current.event.durationMs)} ms`:'未记录'}</dd><dt>原因码</dt><dd>{current.event.reasonCode??'—'}</dd>{current.event.attemptId&&<><dt>尝试 ID</dt><dd>{current.event.attemptId}</dd></>}{current.event.dataVerdict&&<><dt>数据结论</dt><dd>{current.event.dataVerdict}</dd><dt>签名归属</dt><dd>{current.event.attributionStatus}</dd></>}{current.event.publicationStatus&&<><dt>发布状态</dt><dd>{current.event.publicationStatus}</dd></>}{current.event.evidenceId&&<><dt>证据引用</dt><dd>{current.event.evidenceId}</dd><dt>证据查看</dt><dd>{live?<a href={`#evidence?evidenceId=${current.event.evidenceId}`}>打开本地证据</a>:'录制引用 · 离线回放不访问证据库'}</dd></>}</dl>{current.event.phase==='REVIEW'&&<p className="ag-detail-note">{current.event.reviewerKind==='MODEL'?'模型外审为辅助判断；数据是否通过由验收内核决定。':current.event.reviewerKind==='NOT_ENABLED'?'此动作未调用外审模型。':'由确定性范围规则检查，未调用模型作判断。'}</p>}</aside>}
  </div>
  <div className="ag-legend"><span><i className="active"/>进行中</span><span><i className="good"/>验收通过 / 已采用</span><span><i className="bad"/>拒收 / 拦截</span><span><i className="warn"/>未知 / 中断</span><small>跨行连线表示执行顺序；空缺阶段不会推定为已执行。</small></div>
  <div className="ag-accessible" aria-label="动作节点列表">{projection.nodes.map(n=><button key={n.id} onClick={()=>setSelected(n.id)}>{n.phase} · {toolLabels[n.event.tool??'']??n.title} · {statusLabels[n.displayStatus]}</button>)}</div>
 </div>;
}
export function mountActivityGraph(element:HTMLElement){const root=createRoot(element);root.render(<ReactFlowProvider><ActivityGraph/></ReactFlowProvider>);return()=>root.unmount();}
