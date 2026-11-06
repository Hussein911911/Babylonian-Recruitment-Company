// Synthetic card/jobs only; no production writes. Run with tools/serve.mjs on 4173.
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
try {for(const width of [320,375,720]) {
 const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await ctx.newPage(),errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=r.request().url();
  if(u.includes('/rest/v1/rpc/self_service_card')) return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card:{serial:'K7M2XQ9T4R',status:'active',profileLocked:true,profile:{fullName:'زبون اختبار'},chancesLeft:1,chances:[{no:1,slotStatus:'reserved',jobCode:'JOB-OLD',jobTitle:'وظيفة سابقة'},{no:2,slotStatus:'reserved',jobCode:'JOB-OLD2',jobTitle:'وظيفة ثانية'},{no:3,slotStatus:'reserved',jobCode:'JOB-OLD3',jobTitle:'وظيفة ثالثة'},{no:4,slotStatus:'empty'}]}})});
  if(u.includes('/rest/v1/public_jobs'))return r.fulfill({contentType:'application/json',body:JSON.stringify([{code:'JOB-NEW',title:'وظيفة جديدة',status:'available',requirements:[],vacancies:1}])});
  return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();
 });
 await page.goto(base+'apply.html?form=K7M2XQ9T4R');await page.waitForFunction(()=>document.querySelector('#btn-card-details')?.getAttribute('aria-label')?.includes('K7M2XQ9T4R'));await page.waitForFunction(()=>window.G.currentJobs().length===1);
 await page.evaluate(()=>G.start());await page.waitForFunction(()=>document.body.dataset.step==='6');
 assert.match(await page.locator('#chances-bar').innerText(),/فرصة واحدة فقط/);assert.equal(await page.locator('.chance-segment').count(),4);assert.equal(await page.locator('.chance-segment.is-used').count(),3);
 await page.locator('#chosen-jobs summary').click();assert.match(await page.locator('#chosen-jobs-list').innerText(),/JOB-OLD/);
 await page.evaluate(()=>G.pickJob('JOB-NEW'));assert.match(await page.locator('#chosen-jobs-list').innerText(),/مختارة للمراجعة/);assert.match(await page.locator('#chances-bar').innerText(),/١ متبقية من ٤/);
 await page.locator('.chosen-remove').click();assert.doesNotMatch(await page.locator('#chosen-jobs-list').innerText(),/JOB-NEW/);assert.match(await page.locator('#chosen-jobs-list').innerText(),/JOB-OLD/);
 await page.locator('#chosen-jobs summary').click();await page.locator('#chances-bar').scrollIntoViewIfNeeded();if(width===375)await page.screenshot({path:'/tmp/makseb-chances.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await ctx.close();console.log('PASS chances and chosen jobs',width);
}} finally {await browser.close();}
