// Real public renderer/store/cloud client with a synthetic Supabase server response.
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
 for(const width of [320,375,1440]) {
  const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{
   window.cardCalls=[];window.releaseJobs=null;
   window.fetch=(url,opts={})=>{
    if(String(url).includes('/rest/v1/public_jobs')) return new Promise(resolve=>{window.releaseJobs=()=>resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}))});
    if(String(url).includes('/rest/v1/rpc/lookup_card')){
     const serial=JSON.parse(opts.body).p_serial;window.cardCalls.push(serial);
     const result=serial==='K7M2XQ9T4R'?{ok:true,serial,status:'blank',fullName:'',phone:'',issueDate:null,expiryDate:null,chancesLeft:2,chances:[{no:1,slotStatus:'empty'},{no:2,slotStatus:'empty'}]}:serial==='HRC-BC-000120'?{ok:true,serial,status:'active',fullName:'ع•',phone:'07••',chancesLeft:1,chances:[{no:1,slotStatus:'empty'}]}:{ok:false,error:'لا توجد بطاقة بهذا الباركود'};
     return Promise.resolve(new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}}));
    }
    return Promise.reject(new Error('unexpected fetch'));
   };
  });
  await page.goto(base+'index.html',{waitUntil:'domcontentloaded'}); await page.locator('[data-page-tab=card]').click();
  await page.locator('#cp-serial').fill('k٧m٢xq٩t٤r'); await page.locator('#cp-go').click();
  assert.equal(await page.locator('#cp-go').isDisabled(),true); assert.equal(await page.locator('#cp-err').innerText(),'');
  await page.waitForFunction(()=>window.releaseJobs);await page.evaluate(()=>window.releaseJobs());
  await page.locator('#cp-result').waitFor({state:'visible'});
  assert.deepEqual(await page.evaluate(()=>window.cardCalls),['K7M2XQ9T4R']);
  assert.match(await page.locator('#cp-result').innerText(),/لم يبدأ التقديم بعد/);
  assert.match(await page.locator('#cp-result').innerText(),/تبدأ الصلاحية عند أول تقديم ناجح/);
  assert.equal(await page.locator('#cp-result a').getAttribute('href'),'apply.html?form=K7M2XQ9T4R');
  for (const typed of ['K7M2XQ9T4R','k7m2xq9t4r','K7m2xQ9t4R']) {
   await page.locator('#cp-again').click();await page.locator('#cp-serial').fill(typed);await page.locator('#cp-go').click();
   await page.locator('#cp-result').waitFor({state:'visible'});
   assert.equal((await page.evaluate(()=>window.cardCalls)).at(-1),'K7M2XQ9T4R');
   assert.match(await page.locator('#cp-result').innerText(),/لم يبدأ التقديم بعد/);
  }
  await page.locator('#cp-again').click();await page.locator('#cp-serial').fill('٠٠٠١٢٠');await page.locator('#cp-go').click();
  await page.locator('#cp-result').waitFor({state:'visible'});assert.deepEqual((await page.evaluate(()=>window.cardCalls)).slice(-2),['K7M2XQ9T4R','HRC-BC-000120']);
  await page.locator('#cp-again').click();await page.locator('#cp-serial').fill('A23456789B');await page.locator('#cp-go').click();
  await page.waitForFunction(()=>document.querySelector('#cp-err').textContent.includes('لا توجد بطاقة'));
  await page.locator('#cp-serial').fill('bad');await page.locator('#cp-go').click();assert.match(await page.locator('#cp-err').innerText(),/لا يبدو/);
  assert.equal(await page.evaluate(()=>window.cardCalls.length),6);
  await page.evaluate(()=>{window.HRCQRScan.open=options=>{const text='https://example.com/apply.html?form=K7M2XQ9T4R';if(options.validate(text)) options.onResult(text);return true;};});
  await page.locator('#cp-scan').click();await page.locator('#cp-choice-details').click();
  await page.locator('#cp-result').waitFor({state:'visible'});
  assert.equal((await page.evaluate(()=>window.cardCalls)).at(-1),'K7M2XQ9T4R');
  assert.match(await page.locator('#cp-result').innerText(),/لم يبدأ التقديم بعد/);
  await ctx.close();console.log(`PASS manual blank/active/missing, Arabic digits and delayed cloud ${width}px`);
 }
}finally{await browser.close()}
