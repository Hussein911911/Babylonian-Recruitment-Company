// Isolated readability review: real view/modal renderers, synthetic sessions/data.
// UI triggers open/cancel only; no saves, issuance, deletion or live backend calls.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const base='http://127.0.0.1:4173/',out=new URL('./.tmp/horizontal/',import.meta.url);mkdirSync(out,{recursive:true});
const libs=new URL('libraries/',out),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
let checks=0,scenes=0,wordCount=0;const failures=[],coverage=[];
function check(label,v,details=''){checks++;if(!v)failures.push(label+': '+details);}
async function review(page,label){
 const r=await page.evaluate(()=>{
  const bad=[],orientation=[],fragments=[],overlaps=[],activeModal=document.querySelector('.modal-backdrop:last-child .modal'),segmenter=new Intl.Segmenter('ar',{granularity:'word'}),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let t,words=0;
  while(t=walker.nextNode()){
   const e=t.parentElement;if(!e||e.closest('script,style,svg,#print-root,.hrc-card,.hrc-form,.form-sheet'))continue;
   if(!/[\u0600-\u06ffA-Za-z0-9]/.test(t.data))continue;
   const range=document.createRange();range.selectNodeContents(t);if(![...range.getClientRects()].some(r=>r.width>1&&r.height>1))continue;
   if(getComputedStyle(e).writingMode!=='horizontal-tb')orientation.push(e.className);
   for(const s of segmenter.segment(t.data)){
    if(!s.isWordLike||s.segment.length<4||!/[\u0621-\u064aA-Za-z0-9]/.test(s.segment))continue;words++;
    range.setStart(t,s.index);range.setEnd(t,s.index+s.segment.length);
    const tops=[];for(const r of range.getClientRects())if(r.width>1&&r.height>1){
     if(!tops.some(y=>Math.abs(y-r.top)<2))tops.push(r.top);
     if(activeModal&&!activeModal.contains(e))continue;
     // Clamp each word to viewport and its clipping/scrolling ancestors.
     let l=Math.max(0,r.left),rr=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
     for(let p=e;p&&p!==document.body;p=p.parentElement){const st=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(st.overflowX)){l=Math.max(l,b.left);rr=Math.min(rr,b.right);}if(/hidden|clip|auto|scroll/.test(st.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
     if(rr-l>3&&bottom-top>4)fragments.push({l,r:rr,top,bottom,word:s.segment,el:e});
    }
    if(tops.length>1)bad.push({word:s.segment,lines:tops.length,parent:e.className||e.tagName,width:Math.round(e.getBoundingClientRect().width)});
   }
  }
  fragments.sort((a,b)=>a.top-b.top);
  for(let i=0;i<fragments.length;i++)for(let j=i+1;j<fragments.length&&fragments[j].top<fragments[i].bottom-3;j++){
   const a=fragments[i],b=fragments[j];
   if(a.el===b.el||a.el.contains(b.el)||b.el.contains(a.el))continue;
   // The opaque fixed bottom bar intentionally covers scrolling page content.
   if(Boolean(a.el.closest('.tabbar'))!==Boolean(b.el.closest('.tabbar')))continue;
   if(Math.min(a.r,b.r)-Math.max(a.l,b.l)>3&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>4)overlaps.push({a:a.word,b:b.word,parents:[String(a.el.className),String(b.el.className)]});
  }
  const m=activeModal,mr=m?.getBoundingClientRect();let foot=m?.querySelector('.modal-foot')?.getBoundingClientRect();
  if(foot&&(foot.top<0||foot.bottom>innerHeight+1)&&m.scrollHeight>m.clientHeight){const saved=m.scrollTop;m.scrollTop=m.scrollHeight;foot=m.querySelector('.modal-foot').getBoundingClientRect();m.scrollTop=saved;}
  return {words,bad:bad.slice(0,16),overlaps:overlaps.slice(0,12),orientation,overflow:document.documentElement.scrollWidth>innerWidth+1,modalRect:mr?.toJSON(),modalSideOverflow:!!m&&m.querySelector('.modal-body').scrollWidth>m.querySelector('.modal-body').clientWidth+1,modalFits:!mr||(mr.left>=-1&&mr.right<=innerWidth+1&&mr.top>=-1&&mr.bottom<=innerHeight+1),footerFits:!foot||(foot.top>=0&&foot.bottom<=innerHeight+1)};
 });
 scenes++;wordCount+=r.words;coverage.push(label);
 check(label+' word integrity',r.bad.length===0,JSON.stringify(r.bad));check(label+' visible text overlap',r.overlaps.length===0,JSON.stringify(r.overlaps));check(label+' horizontal writing',r.orientation.length===0);check(label+' page width',!r.overflow);check(label+' dialog bounds',r.modalFits,JSON.stringify(r.modalRect));check(label+' dialog body width',!r.modalSideOverflow);check(label+' dialog footer reachable',r.footerFits);
}
async function nested(page,serial,action,label){
 await page.locator('[data-app-attempts="'+serial+'"]').evaluate(b=>b.click());
 await page.locator('.modal-backdrop').last().locator(action).first().evaluate(b=>b.click());
 await review(page,label);
 while(await page.locator('.modal-backdrop').count())await page.locator('.modal-backdrop').last().locator('[data-close]').first().click();
}
async function open(page,selector,label){
 const trigger=page.locator(selector).first();assert.ok(await trigger.count(),'Missing fixture trigger '+label);
 await trigger.evaluate(b=>b.click());const modal=page.locator('.modal-backdrop').last();await modal.waitFor();await review(page,label);
 if(label.includes('verify')){const link=modal.locator('.card-link-row .v');check(label+' URL has one horizontal line',await link.evaluate(e=>getComputedStyle(e).whiteSpace==='nowrap'&&e.tabIndex===0));}
 if(label.includes('verify'))check(label+' verification values stay horizontal and focusable',await modal.locator('.card-verification .data-item:not(.card-link-row) .v').evaluateAll(xs=>xs.length===3&&xs.every(x=>x.tabIndex===0&&getComputedStyle(x).whiteSpace==='nowrap')));
 const details=modal.locator('.staff-details-scroll');
 for(const area of await details.all()){
  const data=await area.evaluate(e=>({tab:e.tabIndex,scroll:e.scrollWidth>e.clientWidth,rows:[...e.querySelectorAll('.data-item')].map(row=>{const k=row.querySelector('.k'),v=row.querySelector('.v');return {label:k.textContent,value:v.textContent,horizontal:getComputedStyle(k).whiteSpace==='nowrap'&&getComputedStyle(v).whiteSpace==='nowrap'&&Math.abs(k.getBoundingClientRect().top-v.getBoundingClientRect().top)<7}})}));
  check(label+' details in horizontal label/value rows',data.tab===0&&data.rows.length>0&&data.rows.every(x=>x.horizontal),JSON.stringify(data));
  if(data.scroll)check(label+' details scroll to far end',await area.evaluate(e=>{e.scrollLeft=-e.scrollWidth;const moved=Math.abs(e.scrollLeft)>1;e.scrollLeft=0;return moved}));
 }
 if(label.includes('attempts')){const area=modal.locator('.attempts-stack');const info=await area.evaluate(e=>({tab:e.tabIndex,scroll:e.scrollWidth>e.clientWidth,slots:[...e.querySelectorAll('.attempt-slot')].every(x=>getComputedStyle(x).gridTemplateColumns.split(' ').length===4&&getComputedStyle(x.querySelector('.job')).whiteSpace==='nowrap')}));check(label+' opportunities in horizontal rows',info.tab===0&&info.slots,JSON.stringify(info));if(info.scroll)check(label+' opportunities scroll to actions',await area.evaluate(e=>{e.scrollLeft=-e.scrollWidth;let moved=Math.abs(e.scrollLeft)>1;e.scrollLeft=0;return moved}));}

 if(label.includes('verify')||label.includes('attempts'))await modal.screenshot({path:new URL(label.replace(/[^\w-]/g,'_')+'.png',out).pathname});
 await modal.locator('[data-close]').first().click();await modal.waitFor({state:'detached'});
}
try{
 for(const [width,height]of [[320,900],[375,900],[768,1000],[1440,1000],[375,420]])for(const role of ['admin','staff']){
  const ctx=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({seed,role})=>{window.__HRC_TEST_SEED__=seed;sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:role,name:'حساب اختبار القراءة الأفقية',role,cloud:true}));},{seed:DEMO_SEED,role});
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('/assets/js/supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'});if(u.includes('/rest/v1/rpc/self_service_card'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card:{serial:'HRC-BC-000120',status:'blank',chancesLeft:2,profile:{},chances:[{no:1,slotStatus:'empty'},{no:2,slotStatus:'empty'}]}})});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
  await page.goto(base+'dashboard.html');await page.locator('#ov-stats .ov-stat').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{const s=HRCStore;for(const j of s.db().jobs){j.title+=' — مسؤول تنظيم ومتابعة شؤون الموظفين والمراجعين';j.employer.name+=' لخدمات التوظيف والمتابعة الإدارية';j.employer.address+=' العنوانالتفصيليالطويلللاختباربدونفواصللاختبارالتمريروعدمتقطيعالحروف';}for(const a of s.db().applicants)if(a.fullName){a.fullName+=' موظف اختبار الأسماء الطويلة';a.address+=' — عنوان تفصيلي طويل لمراجعة وضوح البيانات';}const held=s.db().jobs.find(j=>j.code==='HRC-1044');held.status='hiring';held.holdExpiresAt=null;
   const hiring=s.db().attempts.find(t=>t.jobCode===held.code);hiring.slotStatus='hiring';hiring.employerDecision='hire';
   const critical=s.db().jobs.find(j=>j.code==='HRC-1047'),slot=s.db().attempts.find(t=>t.serial==='HRC-BC-000117'&&t.no===1);
   critical.status='reserved';critical.reservedBy=slot.serial;critical.critical=true;critical.holdExpiresAt=null;
   Object.assign(slot,{slotStatus:'critical',jobCode:critical.code,jobId:critical.id,jobTitle:critical.title,employerDecision:'reject',reason:'سبب رفض طويل لاختبار وضوح النص وقراءة الموظف لكامل التفاصيل بدون تقطيع الحروف'});
   for(const t of s.db().attempts)if(t.jobCode)t.jobTitle+=' ومتابعة معاملات الموظفين وتنظيم المراجعات';
   const sample=s.db().applicants.find(a=>a.fullName);if(sample)s.db().applicants.push({...sample,serial:'HRC-BC-987654',status:'pending',requestedCode:'HRC-1042',fullName:'باحث اختبار اسم طويل بدون حفظ',address:'عنوان طويل جداً لطلب اختبار القراءة الأفقية'});
   HRCRefresh();});
  const before=await page.evaluate(()=>JSON.stringify([HRCStore.db().jobs,HRCStore.db().applicants,HRCStore.db().attempts]));
  const key=role+'-'+width+'x'+height;
  for(const view of role==='admin'?['overview','jobs','applicants','holds','audit','finance','settings']:['overview','jobs','holds']){
   await page.locator('#side-nav [data-view="'+view+'"]').evaluate(b=>b.click());await review(page,key+'-'+view);
   for(const scroller of await page.locator('#view-'+view+' .table-scroll').all()){
    const info=await scroller.evaluate(e=>{const t=e.querySelector('table.data');return {tab:e.tabIndex,scroll:e.scrollWidth>e.clientWidth,cells:!!t&&[...t.querySelectorAll('th,td')].every(c=>getComputedStyle(c).whiteSpace==='nowrap'&&getComputedStyle(c).writingMode==='horizontal-tb'),actions:!!t&&[...t.querySelectorAll('.cell-actions')].every(a=>getComputedStyle(a).flexWrap==='nowrap')}});
    check(key+'-'+view+' table cells remain horizontal',info.tab===0&&info.cells&&info.actions,JSON.stringify(info));
    if(info.scroll)check(key+'-'+view+' table scrolls to far columns',await scroller.evaluate(e=>{e.scrollLeft=-e.scrollWidth;let moved=Math.abs(e.scrollLeft)>1;e.scrollLeft=0;return moved}));
   }
   if(view==='holds'){
    const holds=page.locator('#holds-list'),info=await holds.evaluate(e=>({tab:e.tabIndex,scroll:e.scrollWidth>e.clientWidth,rows:[...e.querySelectorAll('.attempt-slot')].every(r=>getComputedStyle(r).gridTemplateColumns.split(' ').length===3&&getComputedStyle(r.querySelector('.job')).whiteSpace==='nowrap')}));
    check(key+' holds remain in horizontal rows',info.tab===0&&info.rows,JSON.stringify(info));
    if(info.scroll)check(key+' holds scroll to decisions',await holds.evaluate(e=>{e.scrollLeft=-e.scrollWidth;let moved=Math.abs(e.scrollLeft)>1;e.scrollLeft=0;return moved}));
   }
   if(view==='overview')for(const id of ['ov-actions','ov-holds','ov-recent'])check(key+' '+id+' is keyboard scrollable',await page.locator('#'+id).getAttribute('tabindex')==='0');

   if(view==='jobs'){
    const table=page.locator('#view-jobs .table-scroll').first();check(key+' keyboard-accessible table',await table.getAttribute('tabindex')==='0');
    const tableInfo=await table.evaluate(e=>{const t=e.querySelector('table');return {scroll:e.scrollWidth>e.clientWidth,cells:[...t.querySelectorAll('tbody td')].every(c=>getComputedStyle(c).whiteSpace==='nowrap'&&getComputedStyle(c).writingMode==='horizontal-tb'),breaks:t.querySelectorAll('tbody td br').length,actions:[...t.querySelectorAll('.cell-actions')].every(a=>getComputedStyle(a).flexWrap==='nowrap')}});
    check(key+' job rows horizontal without forced breaks',tableInfo.cells&&tableInfo.breaks===0&&tableInfo.actions,JSON.stringify(tableInfo));
    check(key+' job table scrolls inside viewport',tableInfo.scroll,JSON.stringify(tableInfo));
    check(key+' job table can be scrolled to its far columns',await table.evaluate(e=>{e.scrollLeft=-e.scrollWidth;const moved=Math.abs(e.scrollLeft)>1;e.scrollLeft=0;return moved}));
    for(const [selector,name]of [['#btn-new-job','new-job'],['[data-job-edit]','edit-job'],['[data-job-assign]','nominate']])await open(page,selector,key+'-'+name);
    await page.locator('#quick-code').fill('HRC-1042');await page.locator('#quick-code-form').evaluate(f=>f.requestSubmit());const q=page.locator('.modal-backdrop').last();await q.waitFor();await review(page,key+'-quick-job');
    const detail=await q.locator('.job-details-scroll').evaluate(e=>({tab:e.tabIndex,scroll:e.scrollWidth>e.clientWidth,fits:e.scrollWidth<=e.clientWidth+1,rows:[...e.querySelectorAll('.data-item')].map(row=>{const k=row.querySelector('.k'),v=row.querySelector('.v');return {label:k.textContent,value:v.textContent,nowrap:getComputedStyle(k).whiteSpace==='nowrap'&&getComputedStyle(v).whiteSpace==='nowrap',line:Math.abs(k.getBoundingClientRect().top-v.getBoundingClientRect().top)<7}})}));
    check(key+' detail labels and values horizontal',detail.rows.length===8&&detail.rows.every(r=>r.nowrap&&r.line),JSON.stringify(detail));
    check(key+' long details are reachable by horizontal scroll',detail.tab===0&&(detail.scroll||detail.fits)&&detail.rows.some(r=>r.value.includes('العنوانالتفصيلي')),JSON.stringify(detail));
    if(detail.scroll)check(key+' long details scroll to end',await q.locator('.job-details-scroll').evaluate(e=>{e.scrollLeft=-e.scrollWidth;const moved=Math.abs(e.scrollLeft)>1;e.scrollLeft=0;return moved}));
    check(key+' title scroll keeps full accessible text',await q.locator('.modal-head h3').evaluate(e=>e.tabIndex===0&&getComputedStyle(e).whiteSpace==='nowrap'&&e.textContent.includes('HRC-1042')));
    await q.locator('[data-close]').first().click();
   }
   if(view==='applicants'){check(key+' removed sale controls',await page.locator('#btn-new-app, [data-app-fill]').count()===0);check(key+' phone numbers stay on one line',await page.locator('#apps-table-body td.mono.tiny').first().evaluate(e=>getComputedStyle(e).whiteSpace==='nowrap' && e.scrollHeight<=e.clientHeight+1));for(const [selector,name]of [['#btn-new-card','new-card'],['#btn-new-batch','new-batch'],['[data-app-attempts]','attempts'],['[data-app-verify]','verify-card'],['[data-app-fee]','payment'],['[data-app-reject="HRC-BC-987654"]','pending-review']])await open(page,selector,key+'-'+name);
    for(const [serial,action,name]of [['HRC-BC-000120','[data-assign]','job-picker'],['HRC-BC-000119','[data-reject]','reject-reason'],['HRC-BC-000119','[data-win]','hire-confirm'],['HRC-BC-000119','[data-release]','release-confirm']])await nested(page,serial,action,key+'-'+name);
   }
   if(view==='holds'){
    await open(page,'[data-hold-manage]',key+'-hold-decision');await open(page,'[data-hold-app]',key+'-held-card-attempts');await open(page,'[data-hold-manage="HRC-1047"]',key+'-critical-decision');
   }
   if(view==='settings'){check(key+' verification URL scrolls horizontally',await page.locator('#set-verify-base').evaluate(e=>getComputedStyle(e).whiteSpace==='nowrap'&&e.tabIndex===0));await open(page,'#btn-add-user',key+'-new-user');}
  }
  if(role==='staff')check(key+' admin navigation stays hidden',await page.locator('#side-nav [data-view="settings"]').isHidden());
  check(key+' opening/canceling does not change business records',before===await page.evaluate(()=>JSON.stringify([HRCStore.db().jobs,HRCStore.db().applicants,HRCStore.db().attempts])));
  check(key+' runtime errors',errors.length===0,errors.join(';'));
  await ctx.close();
 }
 // Public screens and their common modal use the same natural word-flow check.
 const ctx=await browser.newContext({viewport:{width:320,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),page=await ctx.newPage();
 await page.addInitScript(seed=>window.__HRC_TEST_SEED__=seed,DEMO_SEED);
 await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('/assets/js/supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'});if(u.includes('/rest/v1/rpc/self_service_card'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card:{serial:'HRC-BC-000120',status:'blank',chancesLeft:2,profile:{},chances:[{no:1,slotStatus:'empty'},{no:2,slotStatus:'empty'}]}})});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
 for(const path of ['index.html','verify.html','employer.html','apply.html?form=HRC-BC-000120','404.html','hrc-light.html']){
  await page.goto(base+path);await page.evaluate(()=>document.fonts.ready);await review(page,'public-'+path);
  if(path==='index.html'){
   await page.evaluate(()=>HRCBooking.open());await review(page,'public-card-entry');await page.locator('.modal [data-close]').first().click();
   await page.evaluate(()=>HRCUI.modal({title:'نافذة توضيح بيانات الوظيفة ومعلومات التواصل',body:'<div class="data-grid"><div class="data-item"><div class="k">عنوان صاحب العمل</div><div class="v">عنوان طويل لاختبار القراءة الأفقية المريحة بدون تقطيع الكلمات</div></div></div>',footer:'<button class="btn btn-outline" data-close>إغلاق النافذة</button>'}));await review(page,'public-common-modal');await page.locator('.modal [data-close]').first().click();
  }
 }
 await ctx.close();
 for(const variant of ['hrc-standalone.html','hrc-light.html']){
  const c=await browser.newContext({viewport:{width:375,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),p=await c.newPage();
  await p.addInitScript(seed=>{window.__HRC_TEST_SEED__=seed;Object.defineProperty(window,'HRCSupabaseConfig',{configurable:true,get:()=>({enabled:false,enforceAuth:false}),set(){}});sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'admin',role:'admin',name:'اختبار النسخة المستقلة',cloud:true}));},DEMO_SEED);
  await p.route('**/*',r=>r.request().url().startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort());
  await p.goto(base+variant+'#!dashboard');await p.locator('#ov-stats .ov-stat').first().waitFor();await p.evaluate(()=>document.fonts.ready);await review(p,variant+'-overview');
  await p.locator('#side-nav [data-view="jobs"]').evaluate(b=>b.click());await open(p,'[data-job-edit]',variant+'-edit-job');
  await p.locator('#side-nav [data-view="applicants"]').evaluate(b=>b.click());await open(p,'[data-app-verify]',variant+'-verify-card');await c.close();
 }
 writeFileSync(new URL('review.json',out),JSON.stringify({checks,scenes,wordCount,coverage,failures},null,2));
 if(failures.length)console.error(failures.join('\n'));
 console.log(`${checks} checks / ${scenes} scenes / ${wordCount} Arabic/Latin word and number observations / ${failures.length} failures`);
 assert.equal(failures.length,0,'Horizontal readability failures; see tests/.tmp/horizontal/review.json');
}finally{await browser.close();}
