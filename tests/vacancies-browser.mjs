// Independent-vacancy workflow through real renderers and Store.
// Synthetic sessions/records; all external/backend writes are blocked.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const base='http://127.0.0.1:4173/',out=new URL('./.tmp/vacancies/',import.meta.url);mkdirSync(out,{recursive:true});
const libs=new URL('libraries/',out),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
let checks=0;function check(v,label){assert.ok(v,label);checks++;}

/* تسجيل قرار صاحب العمل — حُذف مسار صاحب العمل من الويب (2026-10-25)، فصار
   الموظف يسجّل القرار من اللوحة. هذا تجهيز اختبار فقط: نكتب الحقول نفسها
   التي كانت تكتبها دالة القرار ثم نطلق تحديث المتجر. */
async function recordEmployerDecision(page, serial, decision, reason) {
  return page.evaluate(([serial, decision, reason]) => {
    const S = HRCStore, db = S.db();
    const t = db.attempts.filter((x) => x.serial === serial &&
      ['reserved', 'critical', 'hiring'].includes(x.slotStatus))[0];
    if (!t) return { ok: false, error: 'لا تقديم قيد القرار' };
    t.employerDecision = decision;
    t.decisionAt = new Date().toISOString();
    t.holdExpiresAt = null;
    if (decision === 'hire') { t.slotStatus = 'hiring'; t.reason = ''; t.note = 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة'; }
    else { t.slotStatus = 'critical'; t.reason = reason; t.note = 'رفض صاحب العمل — السبب: ' + reason; }
    const j = db.jobs.filter((x) => x.id === t.jobId)[0];
    if (j) { j.status = decision === 'hire' ? 'hiring' : 'reserved'; j.critical = decision !== 'hire'; j.holdExpiresAt = null; }
    db.audit.unshift({ id: 'log-fx-' + serial + '-' + t.no, ts: t.decisionAt, user: 'staff', role: 'staff', ip: '127.0.0.1',
      name: 'موظف توظيف', action: decision === 'hire' ? 'طلب توظيف من صاحب العمل' : 'رفض من صاحب العمل مع السبب',
      entity: 'applicant', entityId: serial, details: (reason || '') });
    S.emit();
    return { ok: true };
  }, [serial, decision, reason]);
}
try{
 for(const width of [375,1440]){
  const p=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(seed=>{window.__HRC_TEST_SEED__=seed;sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'admin',role:'admin',name:'اختبار',cloud:true}));},DEMO_SEED);
  await p.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
  await p.goto(base+'dashboard.html');await p.locator('#ov-stats .ov-stat').first().waitFor();
  const initial=await p.evaluate(()=>{
   const S=HRCStore,db=S.db(),job=JSON.parse(JSON.stringify(db.jobs.find(j=>j.status==='available')));
   Object.assign(job,{id:'multi-job',code:'MULTI-1',title:'وظيفة واحدة بثلاثة شواغر مستقلة',vacancies:3,manualClosed:false,status:'available'});db.jobs=[job];db.applicants=[];db.attempts=[];db.audit=[];
   for(const serial of ['A','B','C','D']){db.applicants.push({serial,status:'active',fullName:'عميل تجريبي '+serial,phone:'07700000000',issueDate:new Date().toISOString(),expiryDate:new Date(Date.now()+30*86400000).toISOString(),attemptLimit:2});for(let no=1;no<=2;no++)db.attempts.push({serial,no,id:serial+no,code:'FIXTURE-'+serial+no,slotStatus:'empty'});}
   HRCRefresh();return ['A','B','C'].map(serial=>S.selectAttempt(serial,'MULTI-1'));
  });check(initial.every(r=>r.ok),'three reservations');check(initial.map(r=>r.attempt.vacancyNo).join(',')==='1,2,3','distinct vacancy IDs');
  check(await p.evaluate(()=>{HRCStore.setJobStatus('MULTI-1','closed');return HRCNotifications.build(HRCStore.db(),HRCStore.currentUser()).filter(n=>n.kind==='booking').length===3;}),'manual closure does not hide pending candidates');
  check(await p.evaluate(()=>HRCStore.setJobStatus('MULTI-1','available').status==='reserved'),'reopen never invents a free occupied seat');
  check(!(await p.evaluate(()=>HRCStore.selectAttempt('D','MULTI-1'))).ok,'fourth denied');
  await p.evaluate(async()=>{await HRCNotifications.refresh();});await p.locator('#notification-toggle').click();await p.locator('#notification-read-all').click();await p.keyboard.press('Escape');
  check((await recordEmployerDecision(p,'A','hire')).ok,'employer request accepted');
  await p.waitForFunction(()=>document.querySelector('#notification-count').textContent==='1');
  await p.locator('#notification-toggle').click();await p.locator('[data-filter="decision"]').click();
  await p.locator('.notice-item').filter({hasText:'طلب توظيف'}).locator('[data-notice-open]').click();
  check((await p.locator('.modal-backdrop').last().textContent()).includes('الشاغر 1'),'notice opens exact seat/card');
  await p.locator('.modal-backdrop').last().locator('#h-win').click();await p.locator('#o-save').click();
  await p.waitForFunction(()=>document.querySelectorAll('.modal-backdrop').length===1 && !document.getElementById('o-save'));
  await p.locator('.modal-backdrop').last().locator('[data-close]').first().click();
  check(await p.evaluate(()=>HRCNotifications.build(HRCStore.db(),HRCStore.currentUser()).every(n=>n.serial!=='A')),'resolved old alerts gone');
  check(await p.evaluate(()=>HRCStore.db().attempts.filter(t=>t.slotStatus==='reserved').length===2),'other two reservations untouched');
  check((await p.evaluate(()=>HRCStore.releaseHold('B',1))).ok,'release B');
  const replacement=await p.evaluate(()=>HRCStore.selectAttempt('D','MULTI-1'));check(replacement.ok&&replacement.attempt.vacancyNo===2,'freed seat reused, not card chance');
  check(await p.evaluate(()=>HRCStore.getAttempts('B')[0].slotStatus==='expired'&&HRCStore.attemptsLeft('B')===1),'consumed opportunity never returned');
  await p.evaluate(()=>document.querySelector('[data-view="holds"]').click());
  await p.locator('[data-hold-manage][data-hold-serial="C"]').click();
  await recordEmployerDecision(p,'C','reject','سبب رفض حقيقي من صاحب العمل');
  await p.waitForFunction(()=>[...document.querySelectorAll('.modal-backdrop')].some(m=>m.textContent.includes('سبب رفض حقيقي')));
  check((await p.locator('.modal-backdrop').last().textContent()).includes('الشاغر 3'),'live details remain scoped to C seat3');
  check(await p.locator('#h-del').count()===0,'no whole-ad deletion from one-seat decision');
  await p.locator('#h-release').click();
  check(await p.evaluate(()=>HRCNotifications.build(HRCStore.db(),HRCStore.currentUser()).every(n=>!['A','B','C'].includes(n.serial))),'all settled cases retired without mark-all');
  check(!(await p.evaluate(()=>HRCStore.setOutcome('C',1,'succeeded'))).ok,'stale decision refused');
  check(await p.evaluate(()=>HRCStore.vacancySummary(HRCStore.getJob('MULTI-1')).filled===1),'one confirmed placement only');
  check(await p.evaluate(()=>HRCStore.pendingActions().holds.length===1),'only replacement pending');
  await p.locator('#notification-toggle').click();await p.locator('[data-filter="all"]').click();await p.screenshot({path:new URL('notifications-'+width+'.png',out).pathname});
  assert.deepEqual(errors,[]);checks++;await p.close();
 }
 console.log('PASS '+checks+' real browser vacancy/notification workflow checks. Synthetic sessions; no production requests.');
}finally{await browser.close();}
