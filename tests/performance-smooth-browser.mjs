// Synthetic data; isolated local preview. Reports frame timing, not real-device FPS.
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
 for(const width of [375,1440]) {
  const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await context.newPage();
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.addInitScript(()=>{
   window.__favReads=0; const get=Storage.prototype.getItem;
   Storage.prototype.getItem=function(k){if(k==='hrc_fav_jobs_v1')window.__favReads++;return get.call(this,k)};
   window.fetch=url=>String(url).includes('/rest/v1/public_jobs')?Promise.resolve(new Response(JSON.stringify(Array.from({length:120},(_,i)=>({code:'HRC-'+(9001+i),title:'وظيفة '+(i+1),category:i%2?'تقني':'خدمات',region:'الحلة',shift:'صباحي',salary_min:700000,status:'available',vacancies:1,requirements:[]}))),{status:200,headers:{'Content-Type':'application/json'}})):Promise.reject(new Error('blocked'));
  });
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.goto(base+'index.html');
  /* العرض التدريجي: 10 بطاقات أولاً، ثم «عرض المزيد» يُظهر الـ120 في قياس الأداء */
  await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length===10);
  assert.equal((await page.locator('#jobs-more').innerText()).trim(),'عرض المزيد');
  await page.locator('#jobs-more').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length===120);
  assert.equal((await page.locator('#jobs-more').innerText()).trim(),'عرض أقل');
  const initialReads=await page.evaluate(()=>window.__favReads);
  await page.evaluate(()=>{window.__favReads=0});await page.locator('#filter-reset').click();
  const reads=await page.evaluate(()=>window.__favReads);
  const frames=await page.evaluate(async()=>{let last=performance.now(), intervals=[];for(let i=0;i<90;i++)await new Promise(resolve=>requestAnimationFrame(now=>{intervals.push(now-last);last=now;scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*i/89);resolve()}));return {slow:intervals.filter(x=>x>34).length,max:Math.max(...intervals).toFixed(1)};});
  console.log(`${width}px: favorites reads initial=${initialReads}, reset=${reads}; simulated scroll frames >34ms=${frames.slow}/90, max=${frames.max}ms`);
  if(!process.env.BASELINE) assert.ok(reads<=4,`filter reset should not read favorites once per card: ${reads}`);
  await context.close();
 }
}finally{await browser.close()}
