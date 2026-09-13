const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('child_process');
(async () => {
  const info = JSON.parse(execFileSync('docker', ['inspect', 'cli-proxy-api']))[0];
  const secret = info.Config.Env.find((e) => e.startsWith('MANAGEMENT_PASSWORD=')).slice(
    'MANAGEMENT_PASSWORD='.length
  );
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    if (process.env.PROBE_PANEL_HTML)
      await page.route('**/management.html', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fs.readFileSync(process.env.PROBE_PANEL_HTML, 'utf8'),
        })
      );
    await page.goto('http://127.0.0.1:8317/management.html');
    await page.waitForTimeout(600);

    const password = page.locator('input[type=password]');
    if (await password.count()) {
      await password.fill(secret);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await password.waitFor({ state: 'hidden', timeout: 15000 });
    }
    await page.goto('http://127.0.0.1:8317/management.html#/ai-providers', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1300);
    await page.getByText('Codex', { exact: true }).click();
    await page.waitForTimeout(700);
    const row = page.getByRole('row').filter({ has: page.getByText('Any', { exact: true }) });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.waitForTimeout(500);
    const completed = JSON.stringify({
      status_code: 200,
      header: {},
      body: 'data: {"type":"response.completed","response":{"id":"fixture","status":"completed","output":[]}}\n\n',
    });
    const panel = page.getByRole('dialog');
    let held,
      calls = 0,
      failed = 0,
      finished = 0;
    page.on('requestfailed', (r) => {
      if (r.url().endsWith('/provider-connectivity-test')) failed++;
    });
    page.on('requestfinished', (r) => {
      if (r.url().endsWith('/provider-connectivity-test')) finished++;
    });
    let hold = false;
    await page.route('**/provider-connectivity-test', async (route) => {
      calls++;
      const body = route.request().postDataJSON();
      assert.equal(body.codex_config?.['api-key-entries'], undefined);
      if (hold) {
        held = route;
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: completed });
    });
    await panel.getByRole('button', { name: 'Test', exact: true }).first().click();
    await page.waitForTimeout(250);
    assert.match(await panel.innerText(), /Reachable/);
    await panel.getByText('Enable WebSockets', { exact: true }).click();
    await page.waitForTimeout(250);
    assert.doesNotMatch(await panel.innerText(), /Reachable/, 'edited draft retained old success');
    assert.equal(calls, 1, 'editing automatically spent another request');
    hold = true;
    await panel.getByRole('button', { name: 'Test', exact: true }).first().click();
    await page.waitForTimeout(250);
    assert.ok(held, 'probe not sent');
    await panel.getByText('Enable WebSockets', { exact: true }).click();
    await page.waitForTimeout(250);
    await held
      .fulfill({ status: 200, contentType: 'application/json', body: completed })
      .catch(() => {});
    await page.waitForTimeout(250);
    assert.doesNotMatch(await panel.innerText(), /Reachable/, 'late result overwrote edited draft');
    assert.ok(failed >= 1, 'draft change did not cancel old request');
    held = undefined;
    await panel.getByRole('button', { name: 'Test', exact: true }).first().click();
    await page.waitForTimeout(250);
    assert.ok(held, 'next test stayed stuck loading');
    await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(500);
    assert.equal(await panel.isVisible(), false);
    await held
      .fulfill({ status: 200, contentType: 'application/json', body: completed })
      .catch(() => {});
    await page.waitForTimeout(250);
    assert.equal(finished, 1, 'obsolete request completed after edit/close');
    assert.equal(failed, 2, 'edit and close must both abort');
    assert.equal(calls, 3, 'default test must stay single-key');
    console.log(
      'PASS: draft invalidation, late-result isolation, edit/close cancellation, next-run recovery, single-key selection'
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
