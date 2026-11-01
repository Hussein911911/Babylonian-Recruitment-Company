// Start tools/serve.mjs on port 4173. Test home while the hero and public JS are delayed.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const base='http://127.0.0.1:4173/';
try {
 for (const width of [320,375,768,1440]) {
  const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.goto(base+'index.html', {waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
   const S=window.HRCStore, serial='K7M2XQ9T4R';
   window.testCalls=[]; window.printCount=0; window.print=()=>{window.printCount++}; window.open=()=>{throw Error('Unexpected preview window');};
   S.cardLookup=async()=>({ok:true,card:{serial,fullName:'أ⚫',phone:'07⚫',status:'active',chancesLeft:0,chances:[
    {no:1,slotStatus:'reserved',jobCode:'JOB-1',jobTitle:'الوظيفة الأولى',selectedAt:'2026-10-30T09:00:00Z'},
    {no:2,slotStatus:'reserved',jobCode:'JOB-2',jobTitle:'الوظيفة الثانية',selectedAt:'2026-10-30T10:00:00Z'}]}});
   S.customerApplication=async (s,n)=>{window.testCalls.push([s,n]); return {ok:true,app:{serial:s,fullName:'زبون الاختبار',phone:'07700000000',address:'عنوان الزبون',status:'active'},attempt:{no:n,slotStatus:'reserved',jobCode:'JOB-'+n,jobTitle:'وظيفة '+n,selectedAt:'2026-10-30T09:00:00Z',employerName:'جهة '+n,employerPhone:'0771111111'+n,employerAddress:'عنوان جهة '+n,interviewLocation:'مكان مقابلة '+n,shift:'صباحي',salaryMin:500,salaryMax:700}};};
   window.HRCQRScan.open=(o)=>{o.onResult(serial);return true;};
  });
  await page.locator('[data-page-tab=card]').click(); await page.locator('#cp-scan').click();
  await page.locator('#cp-choice-details').click();await page.locator('#cp-result .cp-employer').first().waitFor();
  const cards=page.locator('#cp-result .cp-chance');assert.equal(await cards.count(),2);
  assert.match(await cards.nth(0).innerText(),/جهة 1/);assert.doesNotMatch(await cards.nth(0).innerText(),/جهة 2/);
  assert.match(await cards.nth(1).innerText(),/جهة 2/);assert.doesNotMatch(await cards.nth(1).innerText(),/جهة 1/);
  assert.deepEqual(await page.evaluate(()=>window.testCalls),[['K7M2XQ9T4R',1],['K7M2XQ9T4R',2]]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const n of [1,2]) {
   await page.locator(`[data-cp-print="${n}"]`).click();
   const html=await page.locator('#print-root').innerText();
   assert.doesNotMatch(html,/توقيع الزبون|توقيع نقطة البيع|ختم الشركة|خدمات الشركة تنحصر/);
   assert.match(html,new RegExp('جهة '+n));assert.doesNotMatch(html,new RegExp('جهة '+(n===1?2:1)));
   assert.match(html,new RegExp('مكان مقابلة '+n));assert.match(html,/زبون الاختبار/);
   assert.equal(await page.locator('#print-root .hrc-card').count(),0);
   await page.waitForFunction(n=>window.printCount>=n,n);
   await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
   assert.equal(await page.locator('#print-root .hrc-form').count(),1,'early afterprint must not erase the application');
   if(width===375){const pdf=await page.pdf({format:'A4',printBackground:true});const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;const contents=(await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');assert.ok(contents.includes('K7M2XQ9T4R')&&contents.includes('JOB-'+n),'PDF contains this opportunity, not a blank page');}

  }
  assert.equal(await page.locator('#bk-print').count(),0);
  await page.locator('#cp-again').click();assert.equal(await page.locator('#print-root .hrc-form').count(),0,'closing card removes the hidden print copy');
  await page.evaluate(()=>{
   window.testCalls=[];
   window.HRCStore.cardLookup=async()=>({ok:true,card:{serial:'K7M2XQ9T4R',status:'active',chancesLeft:1,chances:[{no:1,slotStatus:'reserved',jobCode:'JOB-1',jobTitle:'وظيفة',selectedAt:'2026-10-30T09:00:00Z'},{no:2,slotStatus:'empty'}]}});
   window.HRCStore.customerApplication=async(s,n)=>{window.testCalls.push([s,n]);return {ok:false,error:'تعذّر الاتصال'};};
  });
  await page.locator('#cp-serial').fill('K7M2XQ9T4R');await page.locator('#cp-go').click();
  await page.locator('#cp-result').waitFor({state:'visible'});
  assert.match(await page.locator('#cp-result').innerText(),/غير متاحة حالياً/);
  assert.equal(await page.locator('[data-cp-print]').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.testCalls),[['K7M2XQ9T4R',1]]);
  await ctx.close();console.log('PASS two chances, matching employer and A4-only printing',width);
 }
 for(const total of [1,3,5]){
  const ctx=await browser.newContext({viewport:{width:375,height:850},serviceWorkers:'block'}),page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.goto(base+'index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(total=>{
   const S=window.HRCStore,serial='K7M2XQ9T4R';window.print=()=>{};
   S.cardLookup=async()=>({ok:true,card:{serial,status:'active',chancesLeft:total-1,chances:Array.from({length:total},(_,i)=>({no:i+1,slotStatus:i?'empty':'reserved',jobCode:i?null:'JOB-1',selectedAt:i?null:'2026-10-30T09:00:00Z'}))}});
   S.customerApplication=async()=>({ok:true,app:{serial,fullName:'زبون اختبار'},attempt:{no:1,slotStatus:'reserved',jobCode:'JOB-1',employerName:'جهة اختبار'}});
   window.HRCQRScan.open=o=>{o.onResult(serial);return true;};
  },total);
  await page.locator('[data-page-tab=card]').click();await page.locator('#cp-scan').click();await page.locator('#cp-choice-details').click();await page.locator('#cp-result .cp-employer').first().waitFor();
  assert.match(await page.locator('#cp-result').innerText(),new RegExp((total-1)+' من '+total));
  assert.equal(await page.locator('#cp-result .cp-chance').count(),total);
  await page.locator('[data-cp-print="1"]').click();const form=await page.locator('#print-root').innerText();assert.doesNotMatch(form,/توقيع الزبون|توقيع نقطة البيع|ختم الشركة|خدمات الشركة تنحصر/);assert.match(form,/جهة اختبار/);
  await ctx.close();console.log('PASS card page uses actual opportunity count',total);
 }
} finally {await browser.close();}
