// Public jobs use a controlled mock, including an image that fails after loading starts.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const base='http://127.0.0.1:4173/';
try{
 for(const motion of ['no-preference','reduce']){
  const ctx=await browser.newContext({viewport:{width:375,height:900},serviceWorkers:'block',reducedMotion:motion});
  const p=await ctx.newPage();let release;const gate=new Promise(r=>release=r);
  await p.route('**/*',async r=>{const u=r.request().url();if(u===base+'mock-bad-image.png'){await gate;return r.fulfill({status:404,body:''})}return u.startsWith(base)?r.continue():r.abort()});
  await p.addInitScript(()=>{window.fetch=url=>String(url).includes('/rest/v1/public_jobs')?Promise.resolve(new Response(JSON.stringify([{code:'HRC-9001',title:'فني تشغيل',category:'تقني',region:'الحلة',shift:'صباحي',salary_min:700000,status:'available',vacancies:1,requirements:[],image_url:'http://127.0.0.1:4173/mock-bad-image.png'}]),{status:200,headers:{'Content-Type':'application/json'}})):Promise.reject(new Error('unexpected fetch'))});
  await p.goto(base+'index.html');await p.waitForSelector('#jobs-grid .job-card:not(.skeleton)');
  const img=p.locator('#jobs-grid .job-image');await img.scrollIntoViewIfNeeded();
  const state=await img.evaluate(e=>({bg:getComputedStyle(e,'::before').backgroundImage,animation:getComputedStyle(e).animationName,loaded:e.classList.contains('has-img')}));
  assert.equal(state.bg,'none','blur must not load image before lazy image finishes');assert.equal(state.loaded,false);assert.equal(state.animation,'none','lazy placeholders must not continuously repaint while scrolling');
  release();await p.waitForFunction(()=>document.querySelector('#jobs-grid .job-image.img-failed'));
  assert.equal(await img.getAttribute('aria-label'),'تعذّر تحميل صورة الوظيفة');
  assert.equal(await img.locator('img').count(),0);assert.equal(await img.evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.equal(await p.locator('#jobs-grid .job-card').count(),1);await ctx.close();
 }
 console.log('PASS image loading/failure, lazy blur and reduced motion on public cards (synthetic data).');
}finally{await browser.close()}
