#!/usr/bin/env node
/* ===========================================================================
 *  Chromium: لا زر هامبرغر ميت على شاشة الدخول (وجوال/سطح مكتب)
 *  يشغّل الصفحات الحقيقية عبر الخادم المحلي: npm start ثم npm run test:header-nav-browser
 *  =========================================================================== */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';

const libs = new URL('./.tmp/horizontal/libraries/', import.meta.url);
const packed = new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url);
if (existsSync(packed) && !existsSync(new URL('lib/', libs))) {
  mkdirSync(libs, { recursive: true });
  const tar = new URL('libs.tar', libs);
  writeFileSync(tar, brotliDecompressSync(readFileSync(packed)));
  execFileSync('tar', ['xf', tar.pathname, '-C', libs.pathname]);
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(s => !['--disable-web-security', '--single-process', '--in-process-gpu',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),
  env: { ...process.env, LD_LIBRARY_PATH: [new URL('lib/', libs).pathname, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  headless: true
});
const base = 'http://127.0.0.1:4173/';
const pages = ['dashboard.html', 'verify.html', '404.html', 'index.html'];
let checks = 0;
try {
  for (const width of [375, 1440]) {
    for (const file of pages) {
      const ctx = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message || e).split('\n')[0]));
      page.on('console', m => {
        const t = m.text().split('\n')[0];
        /* الطلبات الخارجية (خطوط/Supabase) مُلغاة قصداً في هذه المعاينة المحلية */
        if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_BLOCKED/.test(t)) errors.push(t);
      });
      await page.goto(base + file, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(350);

      const state = await page.evaluate(() => {
        const nav = document.getElementById('main-nav');
        const login = document.getElementById('login-wrap');
        return {
          toggleCount: document.querySelectorAll('#nav-toggle, .nav-toggle, .header-actions').length,
          mainNavDisplay: nav ? getComputedStyle(nav).display : null,
          mainNavLinks: nav ? nav.querySelectorAll('a').length : 0,
          brand: !!document.querySelector('.site-header .brand[data-staff-gate]'),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          loginVisible: !!login && !!document.getElementById('login-form') &&
            getComputedStyle(login).display !== 'none' &&
            login.getBoundingClientRect().height > 100,
          workspaceHamburgerExists: !!document.getElementById('hamburger-btn'),
          workspaceHamburgerVisible: !!document.getElementById('hamburger-btn') &&
            document.getElementById('hamburger-btn').getBoundingClientRect().width > 0,
          notfound: !!document.getElementById('notfound')
        };
      });

      const at = `${file} @ ${width}px`;
      assert.deepEqual(errors, [], at + ' — أخطاء console: ' + errors.join(' | ')); checks++;
      assert.equal(state.toggleCount, 0, at + ' — ما زال هناك زر/غلاف هامبرغر'); checks++;
      assert.equal(state.brand, true, at + ' — الترويسة/العلامة مفقودة'); checks++;
      assert.ok(state.mainNavLinks >= 6, at + ' — روابط التنقل ناقصة'); checks++;
      assert.equal(state.mainNavDisplay, width <= 720 ? 'none' : 'flex', at + ' — حالة #main-nav'); checks++;
      assert.equal(state.overflow, false, at + ' — تمرير أفقي'); checks++;
      if (file === 'dashboard.html') {
        assert.equal(state.loginVisible, true, at + ' — شاشة الدخول غير ظاهرة'); checks++;
        assert.equal(state.workspaceHamburgerExists, true, at + ' — زر قائمة اللوحة حُذف بالخطأ'); checks++;
        assert.equal(state.workspaceHamburgerVisible, false, at + ' — زر قائمة اللوحة يظهر قبل الدخول'); checks++;
      }
      if (file === '404.html') { assert.equal(state.notfound, true, at + ' — قسم 404 مفقود'); checks++; }
      await ctx.close();
      console.log(`PASS ${at} (${checks} فحص تراكمي)`);
    }
  }
} finally {
  await browser.close();
}
console.log(`\nالترويسة بلا زر ميت في Chromium: ${checks} فحصاً ناجحاً.`);
