const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const info = JSON.parse(execFileSync('docker', ['inspect', 'cli-proxy-api']))[0];
  const secret = info.Config.Env.find((e) => e.startsWith('MANAGEMENT_PASSWORD='))
    .split('=')
    .slice(1)
    .join('=');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let holdRead = false,
      heldRead,
      cleared = false,
      deleteCalls = 0;
    if (process.env.PROBE_PANEL_HTML)
      await page.route('**/management.html', (r) =>
        r.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fs.readFileSync(process.env.PROBE_PANEL_HTML, 'utf8'),
        })
      );
    await page.route('**/v0/management/logs**', async (r) => {
      if (r.request().method() === 'DELETE') {
        deleteCalls++;
        cleared = true;
        return r.fulfill({ json: { status: 'ok' } });
      }
      if (holdRead) {
        heldRead = r;
        return;
      }
      return r.fulfill({
        json: {
          lines: cleared
            ? []
            : [
                '[2026-09-13 21:00:00] [abcdefgh] [info] [gin_logger.go:90] 200 | 1ms | 127.0.0.1 | POST "/v1/responses" model=fixture-model',
              ],
          'next-cursor': 'fixture',
        },
      });
    });
    await page.route('**/request-error-logs', (r) =>
      r.fulfill({ json: { files: [{ name: 'fixture-error.log', size: 12 }] } })
    );
    await page.route('**/request-error-logs/*', (r) =>
      r.fulfill({ body: 'fixture error details', contentType: 'text/plain' })
    );
    await page.goto('http://127.0.0.1:8317/management.html');
    await page.waitForTimeout(600);
    const pw = page.locator('input[type=password]');
    if (await pw.count()) {
      await pw.fill(secret);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await pw.waitFor({ state: 'hidden' });
    }
    await page.goto('http://127.0.0.1:8317/management.html#/logs');
    await page.waitForTimeout(1500);
    await page.getByText('fixture-model', { exact: true }).waitFor();
    const shell = page.locator('.app-shell');
    const before = await shell.getAttribute('class');
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(200);
    assert.notEqual(await shell.getAttribute('class'), before, 'sidebar shortcut did not toggle');
    await page.keyboard.press('Control+b');
    holdRead = true;
    await page.getByRole('button', { name: 'Refresh Logs', exact: true }).click();
    await page.waitForTimeout(150);
    assert.ok(heldRead, 'pending read fixture not reached');
    await page.getByRole('button', { name: 'Clear Logs', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(deleteCalls, 1);
    holdRead = false;
    await heldRead.fulfill({ json: { lines: ['STALE_BEFORE_CLEAR'], 'next-cursor': 'obsolete' } });
    await page.waitForTimeout(200);
    assert.doesNotMatch(await page.locator('body').innerText(), /STALE_BEFORE_CLEAR|fixture-model/);
    await page.getByRole('button', { name: 'Error Request Logs', exact: true }).click();
    await page.getByText('fixture-error.log', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByText('fixture error details', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '请求日志', exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(errors.length, 0, errors.join('\n'));
    if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT });
    console.log(
      'PASS: logs clear/read race, error viewer, fork request-log tab, sidebar shortcut, no page errors'
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
