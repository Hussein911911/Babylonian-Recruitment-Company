// Isolated readability review: real view/modal renderers, synthetic sessions/data.
// UI triggers open/cancel only; no saves, issuance, deletion or live backend calls.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const out=new URL('./.tmp/offline-images/',import.meta.url);mkdirSync(out,{recursive:true});
const libs=new URL('libraries/',out),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
// A real file:// document in an offline browser, not a cached HTTP page.
let checks=0;
try {
 for(const variant of ['hrc-standalone.html','hrc-light.html']) {
  for(const width of [375,1440]) {
   const context=await browser.newContext({viewport:{width,height:900},offline:true,serviceWorkers:'block'});
   const page=await context.newPage(),external=[],errors=[];
   page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(new URL('../'+variant,import.meta.url).href,{waitUntil:'load'});
   const images=page.locator('#jobs-grid .job-card img');
   await images.first().waitFor();
   assert.equal(await images.count(),8);checks++;
   for(const image of await images.all()) {
    // Some demo cards are intentionally hidden on mobile; explicitly decode
    // their embedded images without changing the site's layout.
    await image.evaluate(img=>{img.loading='eager'; return img.decode()});
    assert.equal(await image.evaluate(img=>img.complete&&img.naturalWidth>0&&/^data:image\/(?:webp|svg\+xml);base64,/.test(img.src)),true);checks++;
   }
   for(const image of await page.locator('#about .lion-frame img,#verify .lion-frame img').all()){
    await image.evaluate(img=>{img.loading='eager';return img.decode()});
    assert.equal(await image.evaluate(img=>img.complete&&img.naturalWidth>0&&img.src.startsWith('data:image/')),true,'recruitment image embedded and decodable offline');checks++;
   }
   assert.deepEqual(external,[],'Offline demo must not attempt HTTP(S) requests');checks++;
   assert.deepEqual(errors,[],'No runtime errors');checks++;
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);checks++;
   await page.screenshot({path:new URL(variant+'-'+width+'.png',out).pathname,fullPage:true});
   await context.close();
  }
 }
 console.log('PASS '+checks+' real-file offline image checks; 8 images in each variant at mobile/desktop widths. No HTTP requests.');
} finally {await browser.close();}
