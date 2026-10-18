// Optional visual/security UI checks; synthetic admin session, external requests
// blocked. Does NOT replace official Auth/account tests or prove a live backup.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const base='http://127.0.0.1:4173/',output=new URL('./.tmp/office-browser/',import.meta.url);mkdirSync(output,{recursive:true});
const libs=new URL('libraries/lib/',output).pathname;
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[libs,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});let checks=0;
const check=(name,v)=>{assert.ok(v,name);checks++;console.log('✓ '+name);};
try{
 for(const width of [320,375,768,1440]){
  const page=await browser.newPage({viewport:{width,height:1100},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(seed=>{window.__HRC_TEST_SEED__=seed;sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'fixture-admin',role:'admin',cloud:true}));},DEMO_SEED);
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('/assets/js/supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:true};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
  await page.goto(base+'dashboard.html');await page.waitForFunction(()=>window.HRCStore?.currentUser());
  await page.evaluate(()=>{document.querySelector('#side-nav [data-view="settings"]').click();document.getElementById('settings-advanced').open=true;});
  await page.locator('.backup-assurance').waitFor({state:'visible'});
  check('three protection scopes clearly separated '+width,await page.locator('.backup-layers article').count()===3);
  check('unknown cloud backup status never called verified '+width,(await page.locator('#schedule-status').textContent()).includes('غير متحققين'));
  check('backup assurance fits viewport '+width,await page.locator('.backup-assurance').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1;}));
  await page.locator('#settings-backup-tools').screenshot({path:new URL('backup-settings-'+width+'.png',output).pathname});
  const before=await page.evaluate(()=>({db:JSON.stringify(HRCStore.db()),backups:localStorage.getItem('hrc-scheduled-backups')}));
  if(width===1440){
   page.on('dialog',d=>d.accept('fixture-strong-password-2026'));
   const downloaded=page.waitForEvent('download');await page.locator('#btn-quick-backup').click();const file=await downloaded;
   const pkg=JSON.parse(readFileSync(await file.path(),'utf8'));check('production quick action downloads authenticated encrypted file',pkg.format==='HRC-ENCRYPTED-BACKUP-v1'&&pkg.algorithm==='AES-256-GCM');
   check('production quick action creates no plaintext persistent snapshot',await page.evaluate(()=>localStorage.getItem('hrc-scheduled-backups'))===before.backups);
   const json=await page.evaluate(()=>JSON.stringify(HRCStore.db()));await page.locator('#import-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(json)});
   await page.locator('#modal-root .modal').waitFor();check('production import is a read-only preview',(await page.locator('#modal-root').textContent()).includes('معاينة فقط'));
   check('no approve-restore button exists in production preview',await page.locator('#modal-root [data-ok]').count()===0);
   check('production preview cannot mutate db or legacy backup list',await page.evaluate(b=>JSON.stringify(HRCStore.db())===b.db&&localStorage.getItem('hrc-scheduled-backups')===b.backups,before));
  }
  check('no browser JS errors '+width,errors.length===0);await page.close();
 }
 console.log(`Backup browser: ${checks} checks passed.`);
}finally{await browser.close();}
