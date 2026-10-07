import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const source=JSON.parse(readFileSync('fixtures/graph/fallback.json','utf8'));
async function last(page:import('@playwright/test').Page){for(let i=0;i<80;i++){const next=page.getByRole('button',{name:'下一步',exact:true});if(await next.isDisabled())break;await next.click();}}
async function visibleInCanvas(page:import('@playwright/test').Page,selector:string){
 return page.locator(selector).evaluateAll(nodes=>{const canvas=document.querySelector('.ag-canvas')!.getBoundingClientRect();return nodes.some(node=>{const box=node.getBoundingClientRect();return getComputedStyle(node).visibility==='visible'&&box.width>0&&box.left>=canvas.left&&box.right<=canvas.right&&box.top>=canvas.top&&box.bottom<=canvas.bottom;});});
}
test('Activity replay uses recorded graph, supports stepping/details and makes no execution request',async({page})=>{
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto('/#activity');await expect(page.getByRole('heading',{name:'每一步，都看得见。'})).toBeVisible();
 await expect(page.getByText('录制回放',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'下一步',exact:true}).click();await expect(page.locator('.ag-node[data-phase=PROPOSAL]')).toHaveCount(1);
 await page.getByRole('button',{name:'播放回放',exact:true}).click();await page.waitForTimeout(850);await page.getByRole('button',{name:'暂停回放',exact:true}).click();
 const progress=await page.locator('.ag-progress').textContent();await page.waitForTimeout(800);expect(await page.locator('.ag-progress').textContent()).toEqual(progress);
 await last(page);await expect(page.locator('.ag-node[data-status=ADOPTED]')).toHaveCount(1);await expect(page.locator('.ag-node[data-phase=VERIFICATION][data-status=FAIL]')).toHaveCount(2);
 await page.getByRole('button',{name:'适应画布',exact:true}).click();
 await page.locator('.ag-node[data-status=ADOPTED]').click();await expect(page.getByRole('complementary',{name:'动作详情'})).toBeVisible();await expect(page.getByText('录制引用 · 离线回放不访问证据库')).toBeVisible();
 await page.getByRole('button',{name:'执行前拦截',exact:true}).click();await last(page);await expect(page.locator('.ag-node[data-status=BLOCK]')).toHaveCount(1);await expect(page.locator('.ag-node[data-phase=EXECUTION]')).toHaveCount(0);
 await page.getByRole('button',{name:'重新播放',exact:true}).click();await expect(page.locator('.ag-node[data-phase=PROPOSAL]')).toHaveCount(0);
 await page.getByRole('button',{name:'正常完成',exact:true}).click();await expect.poll(()=>visibleInCanvas(page,'.ag-node[data-phase=TASK]')).toBeTruthy();
 await last(page);await page.getByRole('button',{name:'适应画布',exact:true}).click();await expect.poll(()=>visibleInCanvas(page,'.ag-node[data-status=ADOPTED]')).toBeTruthy();
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>visibleInCanvas(page,'.ag-node[data-phase=TASK]')).toBeTruthy();
 expect(posts).toEqual([]);
});
test('Live graph fetches cursor updates, retries disconnection and refreshes without duplicate nodes',async({page})=>{
 let requests=0,breakNext=true;
 await page.route('**/api/agent/runs/graph-e2e/graph?*',async route=>{
  requests++;const after=Number(new URL(route.request().url()).searchParams.get('after'));
  if(after>0&&breakNext){breakNext=false;await route.abort();return;}
  const partial=requests===1;
  await route.fulfill({json:{...source.page,agentId:'graph-e2e',events:partial?source.page.events.slice(0,4).map((e:any)=>({...e,agentId:'graph-e2e'})):source.page.events.filter((e:any)=>e.sequence>after).map((e:any)=>({...e,agentId:'graph-e2e'})),nextCursor:partial?4:source.page.nextCursor,hasMore:false,task:{...source.page.task,...(partial?{status:'RUNNING',finishedAt:null,adoptedEvidenceId:null}:{})}}});
 });
 await page.goto('/#activity?agent=graph-e2e');await expect(page.locator('.ag-alert')).toContainText('连接中断');
 await expect(page.locator('.ag-node[data-status=ADOPTED]')).toHaveCount(1,{timeout:15000});
 const count=await page.locator('.ag-node').count();await page.reload();await expect(page.locator('.ag-node[data-status=ADOPTED]')).toHaveCount(1);await expect(page.locator('.ag-node')).toHaveCount(count);
 expect(requests).toBeGreaterThanOrEqual(4);
});
test('Mobile reduced-motion graph and hostile labels remain readable and inert',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 const bad=structuredClone(source.page);bad.agentId='hostile';for(const e of bad.events)e.agentId='hostile';for(const e of bad.events)if(e.serviceId)e.serviceId='<img src=x onerror=window.graphInjected=1>';
 await page.route('**/api/agent/runs/hostile/graph?*',route=>route.fulfill({json:bad}));
 await page.goto('/#activity?agent=hostile');await expect(page.locator('.ag-node[data-status=ADOPTED]')).toHaveCount(1);
 await expect.poll(()=>visibleInCanvas(page,'.ag-node[data-phase=TASK]')).toBeTruthy();
 await page.getByRole('button',{name:'适应画布',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();expect(await page.evaluate(()=>(window as any).graphInjected)).toBeUndefined();
 await expect(page.locator('.ag-particle')).toHaveCount(0);
 await page.locator('.ag-node[data-status=ADOPTED]').click();await expect(page.getByRole('complementary',{name:'动作详情'})).toBeVisible();
 const screenshot=await page.screenshot({fullPage:true});expect(screenshot.length).toBeGreaterThan(1000);
});
