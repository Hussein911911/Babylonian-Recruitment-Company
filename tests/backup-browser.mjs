// Isolated Chromium of the NEW production console. Backend RPC fixtures only;
// actual transactional restore is tested separately by recovery-sql.mjs.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const base='http://127.0.0.1:4173/',output=new URL('./.tmp/recovery-browser/',import.meta.url);mkdirSync(output,{recursive:true});
const libs=new URL('libraries/',output),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});let checks=0;
const check=(name,v)=>{assert.ok(v,name);checks++;console.log('✓ '+name);};
try{
 for(const width of [320,375,768,1440]){
  const page=await browser.newPage({viewport:{width,height:1100},serviceWorkers:'block'}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(seed=>{window.__HRC_TEST_SEED__=seed;sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'fixture-admin',role:'admin',cloud:true}));},DEMO_SEED);
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('/assets/js/supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:true};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
  await page.goto(base+'dashboard.html');await page.waitForFunction(()=>window.HRCStore?.currentUser());
  check('recovery module lazy, absent from normal dashboard '+width,!requests.some(u=>u.includes('/recovery.js')));
  await page.evaluate(()=>{
   window.__recoveryCalls=[];window.__blocked=false;
   const copies=[{id:'fixture-one',name:'نسخة قبل حذف الوظائف',createdAt:new Date().toISOString(),counts:{jobs:6,applicants:400,attempts:800}},{id:'fixture-two',name:'<img onerror=alert(1)>',createdAt:new Date().toISOString(),safety:true,counts:{jobs:6,applicants:400,attempts:800}}];
   HRCStore.cloudStatus=()=>({enforceAuth:true,state:'on',role:'staff'});HRCStore.pushCloud=async()=>({failed:0});HRCStore.diffCloud=()=>[];HRCStore.cloudQueueLength=()=>0;
   HRCStore.recoveryRPC=async(action,id,name,token)=>{__recoveryCalls.push({action,id,name,token});if(action==='list')return {ok:true,copies};if(action==='create'){copies.unshift({id:'fixture-new',name,createdAt:new Date().toISOString(),counts:{jobs:6,applicants:400,attempts:800}});return {ok:true};}if(action==='preview')return {ok:true,token:'fixture-ticket',canRestore:!__blocked,current:{jobs:0,applicants:400,attempts:800},target:{jobs:6,applicants:400,attempts:800},risks:{missingJobs:6,spentChanceConflicts:__blocked?1:0}};if(action==='restore')throw new Error('fixture-lost-response');return {ok:true};};
   document.querySelector('#side-nav [data-view="settings"]').click();
  });
  await page.locator('.recovery-copy').first().waitFor();
  check('only new recovery controls in production '+width,await page.locator('#btn-import,#btn-export,#btn-reset,#btn-schedule-backup,#btn-quick-backup').count()===0);
  check('legacy module never requested in production '+width,!requests.some(u=>u.includes('/legacy-backup.js')));
  check('stored copy names cannot inject HTML '+width,await page.locator('#recovery-tools img').count()===0);
  /* ⚠ صُحّح 2026-11-16: كان يطلب نصاً يقول «Google Drive غير مربوط».
     وقد أُلغي مسار Drive بقرار المالك (USB فقط)، فاختفت العبارة من الواجهة —
     والاختبار بقي يطلبها فصار يفشل على شيفرة سليمة.
     الصحيح: نتحقق أن القسم **يشرح حدوده بصدق** — وهو المطلوب أصلاً. */
  check('scope is honest about what the backup excludes '+width,
    /لا تشمل/.test(await page.locator('.recovery-scope').textContent()));
  check('recovery panel fits viewport '+width,await page.locator('#recovery-tools').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1;}));
  await page.locator('#recovery-tools').screenshot({path:new URL('recovery-'+width+'.png',output).pathname});
  await page.locator('.recovery-copy button').first().click();await page.locator('#recovery-restore').waitFor();
  check('restore cannot be triggered by preview alone '+width,await page.locator('#recovery-restore').isDisabled()&&await page.evaluate(()=>__recoveryCalls.filter(c=>c.action==='restore').length)===0);
  await page.locator('#recovery-ack').check();await page.locator('#recovery-phrase').fill('استرجاع');check('explicit phrase and acknowledgment required '+width,await page.locator('#recovery-restore').isEnabled());
  await page.locator('#modal-root .modal').screenshot({path:new URL('recovery-preview-'+width+'.png',output).pathname});
  if(width===1440){
   await page.locator('#recovery-restore').click();await page.waitForFunction(()=>document.querySelector('[data-recovery-status]').textContent.includes('قد تكون العملية اكتملت'));
   check('uncertain response never falsely says restored or rolled back',await page.evaluate(()=>__recoveryCalls.filter(c=>c.action==='restore').length)===1);
   await page.locator('#recovery-create').click();await page.locator('#recovery-copy-name').fill('نسخة جديدة من القاعدة');await page.locator('#recovery-save').click();await page.waitForFunction(()=>document.querySelectorAll('.recovery-copy').length===3);
   check('create operates through server RPC without browser backup storage',await page.evaluate(()=>__recoveryCalls.some(c=>c.action==='create')&&localStorage.getItem('hrc-scheduled-backups')===null));
   await page.evaluate(()=>{__blocked=true;});await page.locator('.recovery-copy button').first().click();await page.locator('#modal-root .modal').waitFor();check('spent chance conflicts do not offer final restore',await page.locator('#recovery-restore').count()===0);
  }
  check('no runtime JS errors '+width,errors.length===0);await page.close();
 }
 console.log(`Managed backup browser: ${checks} checks passed; no production requests.`);
}finally{await browser.close();}
