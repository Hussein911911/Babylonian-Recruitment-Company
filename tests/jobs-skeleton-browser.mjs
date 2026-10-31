// Synthetic, controlled cloud request; start tools/serve.mjs on port 4173 first.
// Optional dependencies: npm install --no-save --package-lock=false playwright-core @sparticuz/chromium
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
try {
 for(const width of [320,1440]) for(const motion of ['no-preference','reduce']){
  const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:motion});
  const page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{
   window.fetch=(url)=>new Promise((resolve,reject)=>{
    if(!String(url).includes('/rest/v1/public_jobs')) return reject(new Error('unexpected request'));
    window.finishJobs=()=>resolve(new Response(JSON.stringify([{code:'HRC-9001',title:'فني تشغيل',category:'تقني',region:'الحلة',shift:'صباحي',salary_min:700000,salary_max:900000,gender:'لا فرق',vacancies:2,status:'available',requirements:[],created_at:'2026-09-01T00:00:00Z',image_url:''}]),{status:200,headers:{'Content-Type':'application/json'}}));
   });
  });
  await page.goto(base+'index.html');
  await page.waitForFunction(()=>window.finishJobs && document.querySelector('#jobs-grid .skeleton'));
  const before=await page.evaluate(()=>{
   const card=document.querySelector('#jobs-grid .skeleton'),image=card.querySelector('.job-image'),line=card.querySelector('.skel-line');
   const measure=e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height});
   return {card:measure(card),image:measure(image),anim:getComputedStyle(line).animationName,gradient:getComputedStyle(line).backgroundImage,busy:document.querySelector('#jobs-grid').getAttribute('aria-busy'),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(before.busy,'true');assert.equal(before.overflow,false);assert.match(before.gradient,/226, 232, 240/);assert.notEqual(before.anim==='none',motion==='no-preference');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark'});
  assert.match(await page.locator('#jobs-grid .skeleton .skel-line').first().evaluate(e=>getComputedStyle(e).backgroundImage),/48, 55, 65/);
  await page.evaluate(()=>{delete document.documentElement.dataset.theme;window.finishJobs()});
  await page.waitForSelector('#jobs-grid .job-card:not(.skeleton)');
  const after=await page.evaluate(()=>{let c=document.querySelector('#jobs-grid .job-card'),i=c.querySelector('.job-image');return {card:{w:c.getBoundingClientRect().width,h:c.getBoundingClientRect().height},image:{w:i.getBoundingClientRect().width,h:i.getBoundingClientRect().height},busy:document.querySelector('#jobs-grid').getAttribute('aria-busy')}});
  assert.equal(after.busy,'false');assert.ok(Math.abs(before.card.w-after.card.w)<1);assert.ok(Math.abs(before.image.h-after.image.h)<1,JSON.stringify({before,after}));assert.ok(Math.abs(before.card.h-after.card.h)<40,JSON.stringify({before,after}));
  console.log(`PASS ${width}px ${motion}: image ${before.image.h.toFixed(1)}px, card ${before.card.h.toFixed(1)}→${after.card.h.toFixed(1)}px`);
  await ctx.close();
 }
} finally {await browser.close()}
