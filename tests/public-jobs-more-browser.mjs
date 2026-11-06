// Incremental rendering with synthetic public data; no production requests.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const base='http://127.0.0.1:4173/';
try {for(const width of [320,375,1440]) {
 const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 await page.addInitScript(()=>{window.__fetches=0;window.fetch=url=>{if(!String(url).includes('/rest/v1/public_jobs'))return Promise.reject(Error('unexpected fetch'));window.__fetches++;return Promise.resolve(new Response(JSON.stringify(Array.from({length:101},(_,i)=>({code:'HRC-'+(9001+i),title:'وظيفة رقم '+(i+1),category:i<22?'تقني':'صناعي',governorate:'بغداد',shift:'صباحي',salary_min:700000,status:'available',vacancies:1,requirements:[]}))),{status:200,headers:{'Content-Type':'application/json'}}));};});
 await page.goto(base+'index.html');await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length===20);
 const cards=page.locator('#jobs-grid .job-card'),more=page.locator('#jobs-more');assert.equal(await more.isVisible(),true);assert.equal(await page.locator('#jobs-count').count(),0);
 await cards.first().evaluate(e=>{window.__firstCard=e;});const before=await page.evaluate(()=>window.__fetches);
 await more.click();assert.equal(await cards.count(),40);assert.equal(await page.evaluate(()=>document.querySelector('#jobs-grid .job-card')===window.__firstCard),true,'append preserves existing card DOM');
 assert.equal(await page.evaluate(()=>window.__fetches),before,'no extra network request on show more');
 await cards.nth(35).locator('[data-fav]').click();assert.equal(await cards.nth(35).locator('[data-fav]').getAttribute('aria-pressed'),'true');
 for (const expected of [60,80,100]) { await more.click(); assert.equal(await cards.count(),expected); }
 await more.click();assert.equal(await cards.count(),101);assert.equal(await more.isVisible(),false);
 const codes=await cards.locator('[data-fav]').evaluateAll(els=>els.map(e=>e.getAttribute('data-fav')));assert.equal(new Set(codes).size,101);
 await page.locator('#filter-q').fill('HRC-9101');await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card').length===1);assert.match(await cards.first().innerText(),/HRC-9101/);assert.equal(await more.isVisible(),false);
 await page.locator('#filter-reset').click();assert.equal(await cards.count(),20);assert.equal(await more.isVisible(),true);
 await page.locator('#cats-toggle').click();await page.locator('#cat-rail [data-cat="تقني"]').click();assert.equal(await cards.count(),20);assert.equal(await more.isVisible(),true);await more.click();assert.equal(await cards.count(),22);assert.equal(await more.isVisible(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await ctx.close();console.log('PASS jobs batches and filtering',width);
}}finally{await browser.close();}
