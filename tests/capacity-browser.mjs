// Isolated readability review: real view/modal renderers, synthetic sessions/data.
// UI triggers open/cancel only; no saves, issuance, deletion or live backend calls.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const base='http://127.0.0.1:4173/',out=new URL('./.tmp/capacity-browser/',import.meta.url);mkdirSync(out,{recursive:true});
const libs=new URL('libraries/',out),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
import {dataset} from './fixtures/capacity-data.mjs';
const reports=[];
try {
 for(const cards of [500,1000,3000,6000]) {
  const workers=await Promise.all(['admin','staff','staff'].map(async(role,index)=>{
   const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(60000);const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(({seed,role,index})=>{window.__HRC_TEST_SEED__=seed;sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:role,name:'اختبار '+index,role,cloud:true}));},{seed:DEMO_SEED,role,index});
   await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('/assets/js/supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
   await page.goto(base+'dashboard.html');await page.locator('#ov-stats .ov-stat').first().waitFor();
   const result=await page.evaluate(({data,role})=>{
    const db=HRCCloud.buildDb(data),target=HRCStore.db();
    for(const key of ['jobs','applicants','attempts'])target[key]=db[key];
    const started=performance.now();HRCRefresh();const overviewMs=performance.now()-started;
    let storage=true,storageError=null;const serialized=JSON.stringify(target);
    try{localStorage.setItem('hrc-capacity-probe',serialized);}catch(e){storage=false;storageError=e.name;}finally{localStorage.removeItem('hrc-capacity-probe');}
    const t=performance.now();document.querySelector('[data-view="'+(role==='admin'?'applicants':'jobs')+'"]').click();
    const renderMs=performance.now()-t;
    return {role,overviewMs:Math.round(overviewMs),renderMs:Math.round(renderMs),storage,storageError,jsonBytes:new TextEncoder().encode(serialized).length,utf16Bytes:serialized.length*2,cards:target.applicants.length,chances:target.attempts.length,rows:document.querySelectorAll(role==='admin'?'#apps-table-body tr':'#jobs-table-body tr').length,missingIcons:[...document.querySelectorAll('#cards-stats use')].map(n=>n.getAttribute('href')).filter(id=>!document.querySelector(id))};
   },{data:dataset(cards),role});
   assert.equal(result.cards,cards);assert.equal(result.chances,cards*2);
   /* جدول الباحثين مُرقَّم منذ 2026-11: 50 بطاقة للصفحة (والبحث يعبر السجل
      الكامل). توقُّع «كل الصفوف مرة واحدة» كان يفحص أداءً لم يبقَ قائماً،
      ويُفشل الفحص على بيانات صحيحة. الترقيم نفسه مغطّى بالكامل في
      tests/card-retention-browser.mjs (50/50/23 + إعادة التصفير). */
   assert.equal(result.rows,role==='admin'?Math.min(cards,50):Math.min(cards,1000));
   assert.deepEqual(result.missingIcons,[]);assert.deepEqual(errors,[]);
   // Real filtering on manager view, not only row generation.
   if(role==='admin'){
    const filter=page.locator('#aq');
    assert.equal(await filter.count(),1);await filter.fill('HRC-BC-'+String(cards-1).padStart(6,'0'));await filter.dispatchEvent('input');await page.waitForFunction(()=>document.querySelectorAll('#apps-table-body tr').length===1);result.filteredRows=await page.locator('#apps-table-body tr').count();
   }
   await context.close();return result;
  }));
  reports.push({cards,employees:workers});console.log(JSON.stringify(reports.at(-1)));
 }
 writeFileSync(new URL('review.json',out),JSON.stringify(reports,null,2));
 console.log('PASS 3 concurrent isolated browser contexts at each size. Storage failures are measured limits, NOT hidden or treated as capacity success.');
}finally{await browser.close();}
