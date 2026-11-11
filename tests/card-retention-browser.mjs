// Card retention browser: pagination, on-demand read-only archive search.
// Synthetic sessions/records; all external/backend writes are blocked.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const base='http://127.0.0.1:4173/',out=new URL('./.tmp/card-retention/',import.meta.url);mkdirSync(out,{recursive:true});
const libs=new URL('libraries/',out),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
let checks=0;function check(value,name){assert.ok(value,name);checks++;}
try{
 for(const width of [375,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(seed=>{window.__HRC_TEST_SEED__=seed;sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'admin',role:'admin',name:'اختبار',cloud:true}));},DEMO_SEED);
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
  await page.goto(base+'dashboard.html');await page.locator('#ov-stats .ov-stat').first().waitFor();
  await page.evaluate(()=>{
   const db=HRCStore.db();db.applicants=[];db.attempts=[];db.meta.workspace=true;db.meta.partialTables=['jobs','applicants','job_attempts'];
   for(let n=1;n<=123;n++){const serial='F-'+String(n).padStart(3,'0');db.applicants.push({serial,status:'active',fullName:'بطاقة عمل '+n,phone:'07700000000',createdAt:new Date(2026,0,n).toISOString(),issueDate:new Date().toISOString(),expiryDate:new Date(Date.now()+86400000).toISOString()});for(let no=1;no<=2;no++)db.attempts.push({serial,no,slotStatus:'empty'});}
   HRCStore.cardReport=async(from,to)=>{const data={stats:{forms:999,hires:321,totalJobs:999,available:5,reserved:1,blankForms:1,activeForms:12},rows:[{user:'system',name:'الإجمالي الشامل',forms:999,printed:1000,expected:999000,collected:900000,hires:321,holds:1,paid:900,unpaid:99,partial:0}]};if(!from&&!to)db.meta.serverReport=data;return data;};
   window.__historyCalls__=[];HRCStore.searchCardHistory=async(q,p)=>{window.__historyCalls__.push({q,p});await new Promise(r=>setTimeout(r,20));return {hasMore:p===0,cards:Array.from({length:p===0?50:4},(_,i)=>({serial:'ARCH-'+p+'-'+i,fullName:i===0?'<img src=x onerror=alert(1)>':'بطاقة محفوظة للمراجعة',phone:'07700000000',archivedAt:'2026-10-01',status:'exhausted',attempts:[{no:2,vacancyNo:3,jobCode:'ONE-AD',jobTitle:'نفس الإعلان',slotStatus:'succeeded'}]}))};};
   HRCRefresh();document.querySelector('[data-view="applicants"]').click();
  });
  check(await page.locator('#apps-table-body tr').count()===50,'only 50 working cards rendered');
  await page.locator('[data-page-next]').click();check(await page.locator('#apps-table-body tr').count()===50,'second working page');
  await page.locator('[data-page-next]').click();check(await page.locator('#apps-table-body tr').count()===23,'last working page');
  await page.locator('#aq').fill('F-123');await page.waitForFunction(()=>document.querySelectorAll('#apps-table-body tr').length===1);check(await page.locator('[data-page-prev]').isDisabled(),'filter resets pagination');
  await page.evaluate(()=>document.querySelector('[data-view="finance"]').click());await page.waitForFunction(()=>document.getElementById('fin-stats').textContent.includes('999'));
  check((await page.locator('#fin-stats').textContent()).includes('321'),'finance uses lifetime report, not loaded card count');
  check(await page.locator('.fin-collected').first().isDisabled(),'lifetime totals cannot bulk-edit archived card fees');
  check((await page.locator('#finance-scope').textContent()).includes('المؤرشف'),'financial scope explicitly includes archive');
  await page.evaluate(()=>document.querySelector('[data-view="applicants"]').click());
  await page.evaluate(()=>{window.__serialChecks__=[];HRCStore.serialWasIssued=async serial=>{window.__serialChecks__.push(serial);return true;};});
  await page.locator('#btn-new-card').click();await page.locator('#c-code').fill('7KQ4M9TR2X');await page.locator('#c-save').click();await page.waitForFunction(()=>/مؤرشفة|صدر وطُبع/.test(document.getElementById('c-err').textContent));
  check(await page.evaluate(()=>!HRCStore.getApplicant('7KQ4M9TR2X')),'manual issuance cannot recreate an archived or deleted printed identifier');
  check(await page.evaluate(()=>window.__serialChecks__[0]==='7KQ4M9TR2X'),'existing uniqueness validation queries server registry without loading history');
  await page.locator('.modal-backdrop').last().locator('[data-close]').first().click();
  const before=await page.evaluate(()=>JSON.stringify([HRCStore.db().applicants,HRCStore.db().attempts,HRCStore.db().jobs]));
  await page.locator('#btn-card-history').click();await page.locator('[data-history-card]').first().waitFor();
  check(await page.locator('[data-history-card]').count()===50,'historical results bounded');
  check(await page.locator('#history-results img').count()===0,'history escaped, no stored markup');
  await page.locator('#history-next').click();await page.waitForFunction(()=>document.querySelectorAll('[data-history-card]').length===4);check(await page.locator('#history-next').isDisabled(),'next disabled at end');
  await page.locator('#history-query').fill('ARCH');await page.locator('#history-form button').click();await page.waitForFunction(()=>document.querySelectorAll('[data-history-card]').length===50);
  check(await page.evaluate(()=>window.__historyCalls__.at(-1).p===0),'search resets historical page');
  await page.locator('[data-history-card]').first().click();const text=await page.locator('.modal-backdrop').last().textContent();check(text.includes('فرصة البطاقة')&&text.includes('شاغر الوظيفة')&&text.includes('ONE-AD'),'exact opportunity and vacancy shown independently');
  check(await page.locator('#o-save,#h-release,[data-win]').count()===0,'archive details read-only');
  const after=await page.evaluate(()=>JSON.stringify([HRCStore.db().applicants,HRCStore.db().attempts,HRCStore.db().jobs]));check(before===after,'history never enters writable sync state');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page horizontal overflow');
  await page.screenshot({path:new URL('archive-'+width+'.png',out).pathname});check(errors.length===0,'no runtime errors');await page.close();
 }
 console.log('PASS '+checks+' real browser retention/pagination checks. No production requests.');
}finally{await browser.close();}
