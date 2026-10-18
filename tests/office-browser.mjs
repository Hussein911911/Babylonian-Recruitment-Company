// Optional isolated Chromium: two real browser contexts against ONE synthetic
// HTTPS LAN server. No production credentials, DB calls or external requests.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {openState} from '../office/state.mjs';
import {OfficeEngine} from '../office/engine.mjs';
import {makeServer} from '../office/server.mjs';
const output=new URL('./.tmp/office-browser/',import.meta.url);mkdirSync(output,{recursive:true});const dir=mkdtempSync(join(tmpdir(),'hrc-browser-'));let checks=0;
const check=(name,v)=>{assert.ok(v,name);checks++;console.log('✓ '+name);};
const libs=new URL('./libraries/',output),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
let online=true,commits=0;const receipts=new Map(),at=new Date().toISOString();
const snapshot={at,jobs:[1,2].map(n=>({code:'J-'+n,title:'وظيفة تجريبية',status:'available',updated_at:at})),applicants:[{serial:'CARD',full_name:'زبون تجريبي',status:'active',expiry_date:new Date(Date.now()+86400000).toISOString()}],attempts:[1,2].map(n=>({serial:'CARD',attempt_no:n,slot_status:'empty'}))};
const cloud={async login(username,password){if(!online||password!=='fixture-password')throw new Error('no_online_login');return {tokens:{access_token:'synthetic',refresh_token:'synthetic-refresh'},profile:{auth_id:username,username,full_name:'موظف '+username,role:'staff',active:true}};},async snapshot(){if(!online)throw new Error('offline');return structuredClone(snapshot);},async refresh(s){if(!online)throw new Error('offline');return s.profile;},async submit(token,op){if(!online)throw new Error('offline');if(!receipts.has(op.id)){receipts.set(op.id,{ok:true});commits++;}return receipts.get(op.id);}};
const store=openState(join(dir,'state.enc'),randomBytes(32)),engine=new OfficeEngine(store,cloud),hosts=[];
const server=makeServer(engine,{hosts,tls:{key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;hosts.push('127.0.0.1:'+port);const base='https://127.0.0.1:'+port;
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
try{
 const contexts=[];for(const name of ['alice','bob']){const c=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},serviceWorkers:'block'});await c.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>console.log('fixture-browser-error',e.message));p.on('response',async r=>{if(r.url().endsWith('/api/login')&&!r.ok())console.log('fixture-login',r.status(),await r.text());});await p.goto(base);await p.fill('#username',name);await p.fill('#password','fixture-password');await p.click('#login-form button');await p.locator('#workspace').waitFor({state:'visible'});check('official-login flow opens fixture user '+name,await p.locator('#employee').textContent()==='موظف '+name+' · '+name);}
 const [a,b]=contexts.map(c=>c.pages()[0]);const cookies=await contexts[0].cookies();check('HTTPS browser cookie is Secure/HttpOnly/Strict',cookies[0].secure&&cookies[0].httpOnly&&cookies[0].sameSite==='Strict');
 online=false;
 await a.fill('#serial','CARD');await a.selectOption('#job','J-1');await a.click('#operation button');await a.waitForFunction(()=>document.querySelector('#outbox').textContent.includes('بانتظار المزامنة'));check('offline request explicitly pending, not final booking',store.state.outbox[0].status==='pending'&&commits===0);
 await b.fill('#serial','CARD');await b.selectOption('#job','J-1');await b.click('#operation button');await b.waitForFunction(()=>document.querySelector('#message').textContent.includes('معلق'));check('second device sees shared job lock',store.state.outbox.length===1);
 await b.selectOption('#job','J-2');await b.click('#operation button');await b.waitForFunction(()=>document.querySelector('#outbox').textContent.includes('بانتظار المزامنة'));check('second device queues separate existing chance',store.state.outbox.length===2&&store.state.outbox[1].expected.attempt_no===2);
 check('browser exposes neither cloud token nor other employee request',!(await a.locator('#outbox').textContent()).includes('J-2')&&!JSON.stringify(await a.evaluate(()=>({ls:{...localStorage},ss:{...sessionStorage}}))).includes('synthetic-refresh'));
 for(const width of [375,768,1440]){await a.setViewportSize({width,height:1100});check('Arabic office layout fits '+width,await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await a.screenshot({path:new URL('office-'+width+'.png',output).pathname,fullPage:true});}
 online=true;await a.click('#sync');await a.waitForFunction(()=>document.querySelector('#outbox').textContent.includes('معتمد في الموقع'));await b.click('#sync');await b.waitForFunction(()=>document.querySelector('#outbox').textContent.includes('معتمد في الموقع'));check('reconnection synchronizes each operation exactly once',commits===2&&store.state.outbox.every(o=>o.status==='done'));
 await a.click('#logout');await a.locator('#login').waitFor({state:'visible'});check('logout clears private request DOM and card suggestions',(await a.locator('#outbox').textContent())===''&&await a.locator('#cards option').count()===0);
 console.log(`Office HTTPS browser: ${checks} checks passed.`);
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
