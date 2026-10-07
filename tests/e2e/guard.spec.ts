import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('Guard monitor refreshes real decisions; the outbox downloads a signed report and imports it for replay', async ({ page, request }) => {
  const base='http://127.0.0.1:3101';
  const meta=await (await request.get(base+'/api/meta')).json();
  await page.goto('/#monitor');
  await expect(page.locator('#view-monitor')).toBeVisible();
  // The actor transport proposes all three candidates; this explicit caller scope
  // allows only one. Real Guard must block before any delivery is attempted.
  const created=await request.post(base+'/api/agent/runs',{data:{
    clientRequestId:crypto.randomUUID(),prompt:'只使用调用者给定候选，不扩大范围。',
    constraints:{contextId:meta.contexts[0].contextId,account:meta.capabilities[0].accounts[0],
      blockHash:meta.contexts[0].trustedBlock.blockHash,fields:['balance','nonce','codeHash','storageRoot'],
      candidateIds:['demo-wrong-value'],useHistoricalEvidence:false,
      budget:{maxAttempts:3,timeoutMs:30000,maxCostWei:'0'}},
  }});
  expect(created.status()).toBe(202);
  const {agentId}=await created.json();
  await expect.poll(async()=> (await (await request.get(base+`/api/agent/runs/${agentId}`)).json()).error).toBe('GUARD_STOPPED');
  await page.locator('#refresh-monitor').click();
  const timeline=page.locator(`[data-monitor-detail="${agentId}"]`);
  await expect(timeline).toBeVisible();await timeline.click();
  await expect(page.locator('#monitor-detail')).toContainText('硬规则拦截');
  await expect(page.locator('#monitor-detail')).toContainText('SCOPE_candidates');
  const exported=await request.get(base+`/api/guard/tasks/${agentId}/decisions/1/export`);
  expect(exported.status()).toBe(200);const packet=await exported.json();
  await page.getByRole('button',{name:'威胁账本'}).click();
  const exportButton=page.locator(`[data-threat-detail="${packet.digest}"][data-exported="true"]`);
  await expect(exportButton).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await exportButton.click();
  const download=await downloadPromise;
  expect(JSON.parse(readFileSync((await download.path())!,'utf8'))).toEqual(packet);
  await page.locator('#threat-import').fill(JSON.stringify(packet));
  await page.locator('#threat-import-submit').click();
  await expect(page.locator('#threat-import-result')).toContainText('REPRODUCED');
  await expect(page.locator('#threat-detail')).toContainText('REPRODUCED');
  await page.locator('#threat-candidate').click();
  await expect(page.locator('#threat-detail-result')).toContainText('CANDIDATE');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  for (const name of ['外审监控台','Agent 活动','钱包审查']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
});
