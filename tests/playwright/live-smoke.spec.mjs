import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baseURL = process.env.SHOPPING_HISAB_URL || 'https://shopping-hisab-native.hasimabd13.workers.dev';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const resultsDir = 'test-results';
fs.mkdirSync(resultsDir, { recursive: true });

try {
  const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert(response, 'Navigation should return a response');
  assert(response.status() < 500, `App returned HTTP ${response.status()}`);

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const title = await page.title();
  const bodyText = (await page.locator('body').innerText()).trim();

  assert(bodyText.length > 0, 'Page body should not be empty');
  assert(!/internal server error|application error/i.test(bodyText), 'App should not show a server error');

  // Authentication-aware smoke: validate either a logged-in app surface or login UI.
  const loginVisible = /log in|login|continue with google|email|password|create one/i.test(bodyText);
  const appVisible = /shopping|my shopping|shopping trip|summary|purchase/i.test(bodyText);
  assert(loginVisible || appVisible, 'Expected recognizable login or app content');

  if (loginVisible) {
    const formControls = await page.locator('input').count();
    assert(formControls > 0 || /continue with google/i.test(bodyText), 'Login page should expose an input or Google login action');
  }

  await page.screenshot({ path: `${resultsDir}/live-smoke.png`, fullPage: true });
  console.log(JSON.stringify({ status: 'PASS', httpStatus: response.status(), title, loginVisible, appVisible, url: page.url() }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${resultsDir}/live-smoke-failure.png`, fullPage: true }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
