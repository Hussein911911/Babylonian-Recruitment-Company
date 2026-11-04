// Synthetic public jobs, exercising the real renderer and the two-column job grid.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const base='http://127.0.0.1:4173/';
try {
 for(const width of [320,375,768,1440]) {
  const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}), page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{window.fetch=url=>String(url).includes('/rest/v1/public_jobs')?Promise.resolve(new Response(JSON.stringify(Array.from({length:7},(_,i)=>({code:'HRC-'+(9001+i),title:i===0?'مهندس تشغيل وصيانة الأجهزة والمعدات الكهربائية': 'وظيفة '+(i+1),category:'تقني',region:'الحلة',shift:'صباحي',salary_min:700000,status:'available',vacancies:1,requirements:[]}))),{status:200,headers:{'Content-Type':'application/json'}})):Promise.reject(new Error('unexpected fetch'))});
  await page.goto(base+'index.html');
  await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length===7);
  const cards=page.locator('#jobs-grid .job-card');
  assert.equal(await cards.count(),7); assert.equal((await page.locator('#jobs-count').innerText()).trim(),'7');
  assert.deepEqual(await cards.locator('.ac-sequence').allTextContents(), ['#1','#2','#3','#4','#5','#6','#7']);
  assert.equal(await cards.first().locator('.ac-sequence').getAttribute('aria-label'),'ترتيب الوظيفة 1');
  for(let i=0;i<7;i++) assert.ok(await cards.nth(i).isVisible(),`card ${i+1} hidden at ${width}`);
  const geometry=await cards.evaluateAll(els=>{
   const rects=els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}});
   const grid=els[0].parentElement;
   const overflows=els.flatMap(card=>[...card.querySelectorAll('.job-title,.ac-row span,.ac-row b,.ac-foot button')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent));
   return {rects,overflow:document.documentElement.scrollWidth>innerWidth,gridOverflow:grid.scrollWidth>grid.clientWidth+1,overflows};
  });
  assert.equal(geometry.overflow,false,JSON.stringify(geometry));
  assert.equal(geometry.gridOverflow,false,JSON.stringify(geometry));
  assert.deepEqual(geometry.overflows,[],JSON.stringify(geometry));
  for(let i=0;i<6;i+=2){
   assert.ok(Math.abs(geometry.rects[i].top-geometry.rects[i+1].top)<1,`pair ${i/2+1} on same row`);
   assert.ok(geometry.rects[i].left>geometry.rects[i+1].left,'RTL row ordering');
   if(i)assert.ok(geometry.rects[i].top>=geometry.rects[i-2].bottom,'next pair below');
  }
  assert.ok(geometry.rects[6].top>=geometry.rects[4].bottom,'odd job remains on next row');
  await cards.last().scrollIntoViewIfNeeded();
  assert.ok(await cards.last().isVisible(),'last job remains reachable');
  await page.locator('#filter-q').fill('HRC-9007');
  await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length===1);
  assert.ok((await cards.first().innerText()).includes('HRC-9007'));
  assert.equal(await cards.first().locator('.ac-sequence').textContent(),'#1');
  await ctx.close();console.log(`PASS seven jobs reachable and searchable at ${width}px`);
 }
}finally{await browser.close()}
