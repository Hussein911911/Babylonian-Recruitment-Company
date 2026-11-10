// Isolated native-browser typography/clock/print checks. Fake data and date;
// all external requests blocked. NOT a live Auth or server-clock-sync test.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const base='http://127.0.0.1:4173/',out=new URL('./.tmp/iraq-font/',import.meta.url);mkdirSync(out,{recursive:true});
const libs=new URL('libraries/',out),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
let n=0;const check=(label,value)=>{assert.ok(value,label);n++;console.log('✓ '+label);};
try{
 const loginContext=await browser.newContext({viewport:{width:375,height:900},reducedMotion:'reduce',serviceWorkers:'block'}),loginPage=await loginContext.newPage();
 await loginPage.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('/assets/js/supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:true};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
 await loginPage.goto(base+'dashboard.html');await loginPage.locator('#login-wrap').waitFor({state:'visible'});
 await loginPage.evaluate(async()=>{await Promise.all([400,600,700].map(w=>document.fonts.load(w+' 16px "IBM Plex Sans Arabic"','العراق ABC 123')));await document.fonts.ready;});
 check('unauthenticated login has no advertised default account',! /admin123|staff123|الدخول الأول/.test(await loginPage.locator('#login-wrap').textContent()));
 check('team reminder/checklist is absent from login',await loginPage.locator('#hrc-dev-accounts').count()===0&&!/تذكير للفريق|pre-delivery-checklist/.test(await loginPage.locator('#login-wrap').textContent()));
 check('private dashboard remains hidden before authentication',await loginPage.locator('#app-shell').isHidden()&&await loginPage.evaluate(()=>HRCStore.currentUser()===null));
 check('login uses the new professional font',(await loginPage.locator('body').evaluate(e=>getComputedStyle(e).fontFamily)).split(',')[0].replace(/["']/g,'').trim()==='IBM Plex Sans Arabic');
 check('login inputs and submit remain available',await loginPage.locator('#login-user').isVisible()&&await loginPage.locator('#login-pass').isVisible()&&await loginPage.locator('#login-form button[type="submit"]').isVisible());
 await loginPage.screenshot({path:new URL('login-clean-375.png',out).pathname,fullPage:true});await loginContext.close();
 for(const [zone,width] of [['UTC',320],['America/Los_Angeles',375],['Asia/Tokyo',1440]]){
  const context=await browser.newContext({timezoneId:zone,viewport:{width,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(seed=>{
   window.__HRC_TEST_SEED__=seed;window.__iraqNow=Date.parse('2026-12-31T21:07:08Z');const OriginalDate=Date;
   window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[window.__iraqNow]));}static now(){return window.__iraqNow;}};
   sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'time-fixture',name:'موظف اختبار',role:'admin',cloud:true}));
  },DEMO_SEED);
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base)&&u.includes('/assets/js/supabase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'});return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();});
  await page.goto(base+'index.html');await page.waitForFunction(()=>document.getElementById('year')?.textContent==='2027');
  check('public year follows Baghdad across new year: '+zone,await page.locator('#year').textContent()==='2027');
  const faces=await page.evaluate(async()=>{const result=await Promise.all([400,500,600,700].map(w=>document.fonts.load(w+' 16px "IBM Plex Sans Arabic"' ,'العراق ABC 0123')));return result.every(rows=>rows.length&&rows.every(f=>f.status==='loaded'));});
  check('all four full Arabic/Latin IBM Plex Sans Arabic weights load locally: '+zone,faces);
  check('public body uses new font: '+zone,(await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily)).split(',')[0].replace(/["']/g,'').trim()==='IBM Plex Sans Arabic' );
  await page.goto(base+'dashboard.html');await page.waitForFunction(()=>document.getElementById('ov-clock')?.textContent==='00:07');await page.evaluate(()=>document.fonts.ready);
  check('clock Baghdad, regardless of host/browser zone: '+zone,await page.locator('#ov-clock').textContent()==='00:07');
  check('calendar Baghdad day/year not device day: '+zone,/٢٠٢٧|2027/.test(await page.locator('#ov-date').textContent()));
  check('zone is explicitly labeled: '+zone,(await page.locator('.ov-welcome-time').textContent()).includes('توقيت العراق'));
  check('clock/calendar fit small and large layouts: '+zone,await page.locator('.ov-welcome-time').evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.left>=0&&r.right<=innerWidth+1;}));
  await page.locator('.ov-welcome').screenshot({path:new URL('clock-'+width+'.png',out).pathname});
  await page.evaluate(()=>{__iraqNow+=60000;document.dispatchEvent(new Event('visibilitychange'));});
  check('clock updates immediately after returning to tab: '+zone,await page.locator('#ov-clock').textContent()==='00:08');
  await page.evaluate(()=>{
   window.__printCount=0;window.print=()=>{__printCount++;window.__cairoReady=[400,600,700,900].every(w=>document.fonts.check(w+' 12px Cairo','العراق ABC 123'));};
   HRCVoucher.print(HRCStore.db().applicants[0]);
  });
  await page.waitForFunction(()=>__printCount===1);
  check('printing waits for original Cairo fonts, not new UI face: '+zone,await page.evaluate(()=>__cairoReady));
  await page.emulateMedia({media:'print'});
  const card=page.locator('#print-root .hrc-card').first();
  check('printed card retains Cairo: '+zone,(await card.evaluate(e=>getComputedStyle(e).fontFamily)).startsWith('Cairo'));
  check('printed card dimensions are 70.2x111.8mm: '+zone,await card.evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width-70.2*96/25.4)<1&&Math.abs(r.height-111.8*96/25.4)<1;}));
  await page.emulateMedia({media:'screen'});
  await page.goto(base+'apply.html');await page.waitForFunction(()=>typeof window.G?.printApplication==='function');
  check('independent application page uses local IBM Plex Sans Arabic: '+zone,(await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily)).split(',')[0].replace(/["']/g,'').trim()==='IBM Plex Sans Arabic' );
  check('application calendar year is Baghdad, not host zone: '+zone,await page.locator('#f-yr option').nth(1).textContent()==='2027');
  await page.evaluate(()=>{window.__applyPrints=0;window.print=()=>__applyPrints++;document.querySelector('#result-content').innerHTML='<div class="form-sheet">استمارة اختبار</div>';G.printApplication();});
  await page.waitForFunction(()=>__applyPrints===1);
  check('application preserves all Cairo print weights including 800: '+zone,await page.evaluate(()=>[400,600,700,800,900].every(w=>document.fonts.check(w+' 12px Cairo','العراق ABC 123'))));
  /* صفحة صاحب العمل حُذفت نهائياً (2026-10-25) — لا تحقّق خطوط لها بعد اليوم. */
  check('no runtime errors: '+zone,errors.length===0);await context.close();
 }
 console.log(`PASS ${n} native Iraq clock/font/print checks. No live backend requests.`);
}finally{await browser.close();}
