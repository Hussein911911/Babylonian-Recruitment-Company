// Start tools/serve.mjs on port 4173. Test home while the hero and public JS are delayed.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const base='http://127.0.0.1:4173/';
try {
 for(const path of ['', 'index.html']) {
  const ctx=await browser.newContext({viewport:{width:375,height:812},serviceWorkers:'block'}),page=await ctx.newPage();
  let releaseJS,releaseImage;const jsGate=new Promise(r=>releaseJS=r), imageGate=new Promise(r=>releaseImage=r);
  await page.route('**/*',async r=>{const url=r.request().url();if(!url.startsWith(base))return r.abort();if(url.includes('/assets/js/public.js'))await jsGate;if(url.includes('/assets/img/hero-skyline.webp'))await imageGate;return r.continue().catch(()=>{});});
  const navigation=page.goto(base+path,{waitUntil:'domcontentloaded'});
  await page.locator('.hero').waitFor({state:'visible'});
  assert.equal(await page.locator('#card').isVisible(),false,'card must not flash before JS runs');
  assert.equal(await page.locator('#page-bar').isVisible(),false);
  assert.equal(await page.locator('link[rel=preload][as=image][fetchpriority=high]').getAttribute('href'),'assets/img/hero-skyline.webp');
  assert.ok(await page.locator('.hero h1').isVisible(),'home content visible even if image and JS are slow');
  releaseImage();releaseJS();await navigation;
  await page.locator('[data-page-tab=card]').click();
  await page.locator('#card').waitFor({state:'visible'});
  assert.equal(await page.locator('.hero').isVisible(),false);
  await page.locator('[data-page-tab=home]').click();
  assert.equal(await page.locator('#card').isVisible(),false);
  assert.equal(await page.locator('.hero').isVisible(),true);
  await page.goto(base+path+'#!/card');
  await page.locator('#card').waitFor({state:'visible'});
  assert.equal(await page.locator('.hero').isVisible(),false,'direct card route must remain functional');
  await ctx.close();
  console.log('PASS delayed startup and card navigation:',path||'/');
 }
 for(const path of ['index.html','hrc-light.html','hrc-standalone.html']) {
  for(const javascriptEnabled of [false,true]) {
   const ctx=await browser.newContext({viewport:{width:375,height:812},serviceWorkers:'block',javascriptEnabled}),page=await ctx.newPage();
   await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
   await page.goto(base+path,{waitUntil:'domcontentloaded'});
   assert.equal(await page.locator('#card').isVisible(),false,`${path}: card hidden on home`);
   assert.ok(await page.locator('.hero').isVisible(),`${path}: home remains visible`);
   assert.equal(await page.locator('[data-action="open-employer"], #employer-gate').count(), 0, `${path}: no employer portal`);
   if(javascriptEnabled){
    await page.locator('[data-page-tab=card]').click();await page.locator('#card').waitFor({state:'visible'});
    await page.locator('[data-page-tab=home]').click();assert.equal(await page.locator('#card').isVisible(),false);
    await page.goto(base+path+'#!/card');await page.locator('#card').waitFor({state:'visible'});
   }
   await ctx.close();console.log(`PASS ${path} JS ${javascriptEnabled?'on':'off'}`);
  }
 }
 // The decorative logo rays must not cover the mark, move layout, or intercept touch.
 for (const width of [320,375,768,1440]) for (const motion of ['no-preference','reduce']) {
  const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block',reducedMotion:motion}),page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.goto(base+'index.html',{waitUntil:'domcontentloaded'});
  const glow=await page.locator('.app-emblem').evaluate(el=>{
   const r=el.getBoundingClientRect(), rays=getComputedStyle(el,'::before'), tile=getComputedStyle(el,'::after');
   const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
   return {background:rays.backgroundImage,hit:!!hit&&el.contains(hit),pointer:rays.pointerEvents,animation:rays.animationName,cover:tile.backgroundColor,svg:!!el.querySelector('svg use[href="#i-mkseb"]'),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.match(glow.background,/conic-gradient/);assert.equal(glow.pointer,'none');assert.equal(glow.animation,'none');
  assert.equal(glow.cover,'rgb(1, 47, 62)');assert.ok(glow.svg && glow.hit && !glow.overflow,JSON.stringify(glow));
  await ctx.close();console.log(`PASS hero logo glow ${width}px ${motion}`);
 }
 // Old printed QR links, including retired roles, must open the current application.
 for (const role of ['', 'pos', 'employer']) {
  const ctx=await browser.newContext({viewport:{width:375,height:812},serviceWorkers:'block'}),page=await ctx.newPage();
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  const serial='HRC-BC-000120';
  await page.goto(base+'index.html'+(role?'?role='+role:'')+'#card='+serial,{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForURL(url=>url.pathname.endsWith('/apply.html')&&url.searchParams.get('form')===serial);
  assert.equal(new URL(page.url()).searchParams.get('form'),serial);
  await ctx.close();console.log('PASS old QR link redirects to apply:',role||'no role');
 }
} finally {await browser.close();}
