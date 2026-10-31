// Local/demo path: select a real opportunity, delete the job, and print the saved form.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const dom=new JSDOM('<!doctype html><div id="print-root"></div>',{url:'https://example.test/',runScripts:'outside-only'});
try {
 const w=dom.window;w.__HRC_TEST_SEED__=JSON.parse(JSON.stringify(DEMO_SEED));
 w.eval(read('assets/js/config.js'));w.HRC_CONFIG.users=[{username:'admin',password:'admin123',name:'اختبار',role:'admin'}];
 w.eval(read('assets/js/store.js'));const S=w.HRCStore;S.init();S.login('admin','admin123');
 const app=S.createCardWithSerial('9TRX2KQ4M7','اختبار').card;
 assert.equal(S.activateCard(app.serial,{fullName:'زبون اختبار',phone:'07712345678'}).ok,true);
 const job=S.listJobs().find(j=>j.status==='available');const code=job.code, name=job.employer.name, phone=job.employer.phone;
 assert.equal(S.selectAttempt(app.serial,code).ok,true);
 const before=await S.customerApplication(app.serial,1);assert.equal(before.ok,true);assert.equal(before.attempt.employerName,name);
 assert.equal(S.deleteJob(code),true);
 const after=await S.customerApplication(app.serial,1);assert.equal(after.ok,true);assert.equal(after.attempt.employerName,name);assert.equal(after.attempt.employerPhone,phone);assert.equal(after.attempt.jobCode,code);
 assert.equal(after.attempt.slotStatus,'expired');assert.equal(S.attemptsLeft(app.serial),1);
 assert.equal((await S.customerApplication(app.serial,2)).ok,false);
 // A different job with the same code may never replace the saved employer.
 S.db().jobs.push({...job,id:'fake-reused',employer:{name:'جهة خاطئة',phone:'000',address:'خاطئ'}});
 assert.equal((await S.customerApplication(app.serial,1)).attempt.employerName,name);
 w.HRCUI={esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),toast:()=>{},ic:()=>''};
 w.eval(read('assets/js/voucher.js'));
 const html=w.HRCVoucher.formHtml({...after.app,__customerApplication:true},after.attempt,S.getAttempts(app.serial));
 assert.ok(html.includes(name));assert.ok(html.includes(code));assert.ok(!html.includes('جهة خاطئة'));
 console.log('PASS local select → delete → original opportunity and employer retained, no reopening, no reused-code leak, form preserved.');
}finally{dom.window.close()}
