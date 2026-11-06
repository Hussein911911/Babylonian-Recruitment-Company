// Real Service Worker and isolated synthetic HTTP servers; never contacts production.
// npm install --no-save --package-lock=false playwright-core @sparticuz/chromium
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==','base64');
const counts=new Map();
const remote=createServer((req,res)=>{counts.set(req.url,(counts.get(req.url)||0)+1);res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control',req.url.includes('no-store')?'no-store':'public, max-age=60');res.end(png)});
await new Promise(r=>remote.listen(0,'127.0.0.1',r));
const other=`http://127.0.0.1:${remote.address().port}`;
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8').replace('https://vqsvztudvfukyuerzcgx.supabase.co',other);
/* اسم الكاش يُقرأ من sw.js نفسه، فرفع جيله لا يكسر هذا الفحص */
const CACHE=(sw.match(/const CACHE_NAME = '([^']+)'/)||[])[1];
const server=createServer((req,res)=>{
 if(req.url==='/sw.js'){res.setHeader('Content-Type','application/javascript');return res.end(sw)}
 if(req.url.startsWith('/assets/img/jobs/')){counts.set(req.url,(counts.get(req.url)||0)+1);res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','public, max-age=60');return res.end(png)}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>isolated test</title>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'allow'}), page=await context.newPage();
 await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.register('/sw.js'));
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
 await page.waitForFunction(()=>navigator.serviceWorker.controller);
 const load=async url=>page.evaluate(url=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src=url;document.body.appendChild(img)}),url);
 assert.equal(await page.evaluate(async(name)=>{const c=await caches.open(name);return !!(await c.match('/dashboard.html') || await c.match('/apply.html'))},CACHE),false,'public visitors should not download the staff shell');
 const local=origin+'/assets/img/jobs/demo.png',pub=other+'/storage/v1/object/public/jobs/demo.png';
 assert.equal(await load(local),true);assert.equal(await load(pub),true);
 let keys=await page.evaluate(async()=>{const c=await caches.open('hrc-public-job-images-v1');return (await c.keys()).map(x=>x.url)});
 assert.ok(keys.includes(local));assert.ok(keys.includes(pub));
 const expiry=await page.evaluate(async u=>Number(await (await (await caches.open('hrc-public-job-image-meta-v1')).match(u)).text()),local);
 assert.ok(expiry>Date.now() && expiry<=Date.now()+61000,'honours shorter server max-age');
 assert.equal(await load(other+'/storage/v1/object/public/jobs/no-store.png'),true);
 assert.equal(await load(other+'/storage/v1/object/public/jobs/signed.png?token=private'),true);
 assert.equal(await load(other+'/storage/v1/object/sign/private/foo.png'),true);
 assert.equal(await load(origin+'/assets/img/jobs/demo.png?token=private'),true);
 keys=await page.evaluate(async()=>{const c=await caches.open('hrc-public-job-images-v1');return (await c.keys()).map(x=>x.url)});
 assert.equal(keys.length,2,JSON.stringify(keys));
 await context.setOffline(true);
 // Remove displayed elements; subsequent image elements must work offline.
 await page.evaluate(()=>document.body.replaceChildren());
 assert.equal(await load(local),true);assert.equal(await load(pub),true);
 await context.setOffline(false);
 // Expired cache + offline network still returns the previously saved public image.
 await page.evaluate(async u=>{const m=await caches.open('hrc-public-job-image-meta-v1');await m.put(u,new Response('1'))},local);
 await context.setOffline(true);assert.equal(await load(local),true);await context.setOffline(false);
 for(let i=0;i<70;i++) assert.equal(await load(origin+'/assets/img/jobs/item'+i+'.png'),true);
 const sizes=await page.evaluate(async()=>({images:(await (await caches.open('hrc-public-job-images-v1')).keys()).length,meta:(await (await caches.open('hrc-public-job-image-meta-v1')).keys()).length}));
 assert.ok(sizes.images<=64 && sizes.meta<=64,JSON.stringify(sizes));
 await page.goto(origin+'/dashboard.html');await page.waitForFunction(()=>navigator.serviceWorker.controller);
 await page.evaluate(()=>navigator.serviceWorker.controller.postMessage({type:'WARM_STAFF_SHELL'}));
 await page.waitForFunction(async(name)=>{const c=await caches.open(name);return !!await c.match('/apply.html')},CACHE);
 console.log('PASS real Service Worker: public local and CORS storage images cached/offline, no-store and signed/private/query URLs excluded, stale offline fallback, bounded storage and staff-only warmup.');
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));await new Promise(r=>remote.close(r))}
