// Mobile application landing after QR + preselected job, with synthetic API data.
// Run with the local preview server; no production requests or real cards.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
const base='http://127.0.0.1:4173/';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const source=readFileSync(new URL('../apply.html',import.meta.url),'utf8');
let checks=0;
function check(v,msg){assert.ok(v,msg);checks++;}
try{
 for(const config of [
  {name:'small-phone',width:320,height:800,screen:320,touch:true,wide:false},
  {name:'phone',width:393,height:873,screen:393,touch:true,wide:false},
  {name:'phone-wide-viewport',width:393,height:873,screen:393,touch:true,wide:true},
  {name:'desktop-mode-ignores-viewport',width:980,height:1740,screen:393,touch:true,wide:true,fallback:true},
  {name:'desktop',width:1440,height:900,screen:1440,touch:false,wide:false}
 ]){
  const ctx=await browser.newContext({viewport:{width:config.width,height:config.height},screen:{width:config.screen,height:config.touch?873:900},isMobile:config.touch,hasTouch:config.touch,deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{
   const u=r.request().url();
   if(u.startsWith(base+'apply.html'))return r.fulfill({contentType:'text/html',body:config.wide?source.replace('width=device-width, initial-scale=1','width=980, initial-scale=1'):source});
   if(u.includes('/rest/v1/rpc/self_service_card'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card:{serial:'TESTCARD01',status:'blank',chancesLeft:2,profile:{},chances:[{no:1,slotStatus:'empty'},{no:2,slotStatus:'empty'}]}})});
   if(u.includes('/rest/v1/public_jobs'))return r.fulfill({contentType:'application/json',body:JSON.stringify([{id:'job-fixture',code:'HRC-1003',title:'وظيفة تجريبية',status:'available',governorate:'بابل',vacancies:1,image_url:'https://example.invalid/missing.jpg'}])});
   return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();
  });
  await page.goto(base+'apply.html?form=TESTCARD01&job=HRC-1003');
  await page.waitForFunction(()=>document.querySelector('#welcome-status').textContent.includes('HRC-1003'));
  if(config.fallback) await page.waitForFunction(()=>document.documentElement.classList.contains('phone-viewport-fallback'));
  const metrics=await page.evaluate(()=>({viewport:innerWidth,screen:screen.width,scale:visualViewport.scale,zoom:getComputedStyle(document.querySelector('.app')).zoom,body:document.documentElement.scrollWidth,screenBox:document.querySelector('.mk-screen').getBoundingClientRect().toJSON(),cols:getComputedStyle(document.querySelector('.mk-feats')).gridTemplateColumns.split(' ').length,meta:document.querySelector('meta[name=viewport]').content}));
  if(config.touch){
   if(config.fallback) check(Number(metrics.zoom)>2,config.name+' enlarges phone layout when metadata is ignored: '+JSON.stringify(metrics));
   else check(metrics.viewport<=config.screen+2,config.name+' viewport follows phone width: '+JSON.stringify(metrics));
   check(metrics.screenBox.width>=metrics.viewport-2,config.name+' landing uses the screen width');
   check(metrics.cols===2,config.name+' feature tiles use two columns');
   check(metrics.body<=metrics.viewport+1,config.name+' no horizontal overflow');
  }else{
   check(metrics.viewport===1440 && metrics.screenBox.width<=641,'desktop keeps its centered design');
  }
  check(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/i.test(metrics.meta),'pinch zoom remains available');
  await page.locator('#btn-start').click();
  await page.waitForFunction(()=>document.querySelector('#pg-name.active'));
  check(await page.evaluate(()=>G.preJobCode==='HRC-1003'),'preselected job remains intact');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),config.name+' profile step fits without horizontal overflow');
  if(config.touch) check(await page.locator('#pg-name .profile-card').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length===1),config.name+' profile uses a readable single column');
  await page.waitForTimeout(500);
  await page.evaluate(()=>G.go(6));
  await page.waitForFunction(()=>document.querySelector('#pg-jobs.active'));
  check(await page.evaluate(()=>G.pickedIndex('HRC-1003')===0),config.name+' selected job stays selected after barcode scan');
  check(await page.locator('#pg-jobs #jobs-count').count()===0,config.name+' result count badge is removed');
  check(await page.locator('#jf-query').isVisible(),config.name+' job search remains available');
  await page.waitForFunction(()=>{const m=document.querySelector('#jobs-list .job-media');return m&&!m.classList.contains('has-img')&&!m.querySelector('.job-thumb')});
  check(await page.locator('#jobs-list .job-media').count()>0,config.name+' broken image falls back without hiding the job');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),config.name+' job step fits without horizontal overflow');
  check(errors.length===0,config.name+' no JS errors: '+errors.join(','));
  await ctx.close();
 }
 console.log(`PASS ${checks} phone/desktop viewport and preselected-job checks (synthetic data).`);
}finally{await browser.close();}
