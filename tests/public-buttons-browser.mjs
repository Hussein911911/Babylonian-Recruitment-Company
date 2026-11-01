// Public button workflows, isolated data and no external/production requests.
import assert from 'node:assert/strict';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
const base='http://127.0.0.1:4173/';
const root=new URL('./.tmp/horizontal/libraries/',import.meta.url), packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',root))){mkdirSync(root,{recursive:true}); const tar=new URL('libs.tar',root); writeFileSync(tar,brotliDecompressSync(readFileSync(packed))); execFileSync('tar',['xf',tar.pathname,'-C',root.pathname]);}
const libs=new URL('lib/',root).pathname;
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[libs,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
try {
 for(const width of [375,1440]) {
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(seed=>{window.__HRC_TEST_SEED__=seed;}, DEMO_SEED);
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
  await page.goto(base+'index.html'); await page.locator('#jobs-grid .job-card').first().waitFor();
  await page.locator('#cats-toggle').click(); assert.equal(await page.locator('#cats-toggle').getAttribute('aria-expanded'),'true');
  const category=page.locator('#cat-rail [data-cat]:not([data-cat="all"])').first(); const cat=await category.getAttribute('data-cat'); await category.click();
  assert.equal(await page.locator('#cats-hint').innerText(),'مُصفّى: '+cat);
  await page.locator('#filter-reset').click(); assert.equal(await page.locator('#cats-hint').innerText(),'كل التخصصات');
  await page.locator('#cats-toggle').click(); assert.equal(await page.locator('#cats-toggle').getAttribute('aria-expanded'),'false');
  const card=page.locator('#jobs-grid .job-card').first(); const code=await card.locator('[data-fav]').getAttribute('data-fav');
  await card.locator('[data-fav]').click(); assert.equal(await card.locator('[data-fav]').getAttribute('aria-pressed'),'true'); assert.ok(await card.locator('[data-fav]').evaluate(el=>el.classList.contains('is-on'))); await page.locator('[data-page-tab=favorites]').click();
  assert.equal(await page.locator('#fav-grid [data-fav]').count(),1);
  await page.locator('#fav-clear').click();assert.equal(await page.locator('#fav-grid [data-fav]').count(),0);
  await page.locator('[data-page-tab=jobs]').click(); assert.equal(await page.locator('#jobs-grid [data-fav]').first().getAttribute('aria-pressed'),'false');
  await page.locator('#filter-q').fill(code); await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card').length===1);
  assert.equal(await page.locator('#jobs-grid .job-card').count(),1); await page.locator('#filter-reset').click();
  await page.locator('#jobs-grid [data-action=job-details][role=button]').first().focus(); await page.keyboard.press('Enter'); assert.ok(await page.locator('.modal-backdrop').last().isVisible());
  await page.locator('.modal-backdrop').last().locator('[data-close]').first().click();
  await page.locator('#jobs-grid [data-action=open-booking]').first().click();assert.ok(await page.locator('#bk-wrap').isVisible());
  await page.locator('.modal-backdrop').last().locator('[data-close]').first().click();
  await page.locator('[data-page-tab=card]').click();await page.locator('#cp-go').click();assert.ok((await page.locator('#cp-err').innerText()).length>0);
  await page.locator('[data-page-tab=contact]').click();assert.ok(await page.locator('#contact').isVisible());
  await page.locator('#pb-home').click();assert.ok(await page.locator('.hero').isVisible());
  assert.deepEqual(errors,[]); await page.close(); console.log(`PASS public button workflows ${width}px`);
 }
} finally {await browser.close();}
