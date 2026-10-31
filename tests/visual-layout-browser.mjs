/* Optional, isolated Chromium layout checks (no production credentials/data).
 * npm install --no-save --package-lock=false playwright-core @sparticuz/chromium
 * Start `node tools/serve.mjs 4173` separately; then:
 * node tests/visual-layout-browser.mjs
 * Screenshots/libraries stay under ignored tests/.tmp/layout-review/.
 * All non-local requests are blocked; service workers are disabled. The staff
 * session is a synthetic DOM fixture, NOT an authentication/security test.
 */
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';

const base = 'http://127.0.0.1:4173/';
const output = fileURLToPath(new URL('./.tmp/layout-review/', import.meta.url));
mkdirSync(output, { recursive: true });
// Supply Chromium's packaged Linux libraries in minimal preview containers.
const libs = join(output, 'libraries');
const archive = new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url);
if (process.platform === 'linux' && existsSync(archive) && !existsSync(join(libs, 'lib'))) {
  mkdirSync(libs, { recursive: true });
  const tar = join(libs, 'libraries.tar');
  writeFileSync(tar, brotliDecompressSync(readFileSync(archive)));
  execFileSync('tar', ['xf', tar, '-C', libs]);
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(s => !['--single-process', '--in-process-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),
  env: { ...process.env, LD_LIBRARY_PATH: [join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  headless: true
});
let cases = 0;
async function noOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(sizes.content <= sizes.viewport + 1, `${label}: ${JSON.stringify(sizes)}`);
  cases++;
}
try {
  for (const width of [320, 375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    await page.addInitScript(seed => {
      window.__HRC_TEST_SEED__ = seed;
      // Same synthetic session convention as the existing jsdom smoke suite.
      sessionStorage.setItem('hrc_session_v2', JSON.stringify({
        username: 'visual-fixture', name: 'موظف اختبار التنسيق', role: 'admin', cloud: true
      }));
    }, DEMO_SEED);
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base) && url.includes('/assets/js/supabase-config.js')) {
        return route.fulfill({ contentType: 'application/javascript', body: 'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};' });
      }
      // The standalone application page has its own client: fulfill only its
      // read-only fixture RPC, never send a request to the real backend.
      if (url.includes('/rest/v1/rpc/self_service_card')) {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, card: {
          serial: 'HRC-BC-000120', status: 'blank', chancesLeft: 2, profile: {},
          chances: [{ no: 1, slotStatus: 'empty' }, { no: 2, slotStatus: 'empty' }]
        } }) });
      }
      if (!url.startsWith(base) || route.request().method() !== 'GET') return route.abort();
      return route.continue();
    });
    for (const path of ['index.html', 'verify.html', 'dashboard.html', 'apply.html?form=HRC-BC-000120']) {
      await page.goto(base + path);
      await page.waitForTimeout(800);
      if (path === 'dashboard.html') {
        // Do not mistake the login screen for a reviewed dashboard.
        await page.locator('#ov-stats .ov-stat').first().waitFor({ state: 'visible' });
      }
      await page.evaluate(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible')));
      await noOverflow(page, `${width} ${path}`);
      if ([375, 1440].includes(width)) {
        await page.screenshot({ path: join(output, `${width}-${path.split('?')[0]}.png`) });
      }
      if (path === 'index.html') {
        assert.equal(await page.locator('.hero').count(), 1, 'No duplicated hero');
        assert.equal(await page.locator('#jobs-grid').count(), 1, 'No duplicated jobs grid');
        const aligned = await page.locator('.contact-card').first().evaluate(card => {
          const icon = card.querySelector('.ic').getBoundingClientRect();
          const title = card.querySelector('h3').getBoundingClientRect();
          return icon.left >= title.right - 1 && icon.top < title.bottom && title.top < icon.bottom;
        });
        assert.ok(aligned, 'Contact title and icon share a horizontal row');
        cases++;
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('.contact-inline > *').first().evaluate(el => getComputedStyle(el).display), 'block');
        await page.emulateMedia({ media: 'screen' });
        cases++;
        if ([375, 1440].includes(width)) {
          for (const section of ['contact', 'how']) {
            await page.locator('#' + section).screenshot({ path: join(output, `${section}-${width}.png`) });
          }
        }
      }
      if (path === 'dashboard.html') {
        for (const view of ['jobs', 'applicants', 'settings']) {
          const nav = page.locator(`[data-view="${view}"]`).first();
          // Exercise the view state, independently of the closed mobile drawer.
          await nav.evaluate(el => el.click());
          await page.waitForTimeout(150);
          await noOverflow(page, `${width} dashboard ${view}`);
        }
      }
      if (path.startsWith('apply.html')) {
        // A style-only probe using the real A4 template classes. The new screen
        // layout must not leak into printing; no form is submitted or printed.
        await page.evaluate(() => {
          const probe = document.createElement('div');
          probe.id = 'visual-print-probe';
          probe.className = 'form-sheet';
          probe.innerHTML = '<div class="fs-section"><div class="fs-td"><span class="k">العنوان</span><span class="v">قيمة اختبار</span></div></div>';
          document.body.append(probe);
        });
        const cell = page.locator('#visual-print-probe .fs-td');
        assert.equal(await cell.evaluate(el => getComputedStyle(el).display), 'flex');
        await page.emulateMedia({ media: 'print' });
        assert.equal(await cell.evaluate(el => getComputedStyle(el).display), 'block');
        await page.emulateMedia({ media: 'screen' });
        cases++;
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base + 'index.html');
    assert.equal(await page.locator('.hero-app').evaluate(el => getComputedStyle(el).animationName), 'none');
    cases++;
    await page.close();
  }
  console.log(`PASS ${cases} local layout/reduced-motion/print checks. External network blocked; no live data accessed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
