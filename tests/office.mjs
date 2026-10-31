// Shared LAN workflow, durable encrypted outbox, HTTP security. No real cloud.
import assert from 'node:assert/strict';
import {readdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openState,unseal,seal,hash,acquireLock} from '../office/state.mjs';
import {OfficeEngine} from '../office/engine.mjs';
import {makeServer} from '../office/server.mjs';
import {Cloud} from '../office/cloud.mjs';
const dir=mkdtempSync(join(tmpdir(),'hrc-office-')),key=randomBytes(32),path=join(dir,'state.enc');let checks=0;
const check=(name,v)=>{assert.ok(v,name);checks++;console.log('✓ '+name);};
let now=Date.parse('2026-10-19T09:00:00Z'),online=true,disabled=false,dropResponse=false,pause=null,submitted=0;
const snapshot={at:new Date(now).toISOString(),jobs:Array.from({length:8},(_,n)=>({code:'J-'+(n+1),title:'وظيفة تجريبية',status:'available',updated_at:new Date(now).toISOString()})),applicants:[{serial:'CARD',status:'active',expiry_date:new Date(now+86400000).toISOString()},{serial:'BLANK',status:'blank',updated_at:new Date(now).toISOString()}],attempts:[1,2].map(n=>({id:'slot-'+n,serial:'CARD',attempt_no:n,slot_status:'empty'}))};
const receipts=new Map();
const cloud={
 async login(username,password){if(!online)throw new Error('offline');if(password!=='fixture-only')throw new Error('bad_login');if(disabled)throw Object.assign(new Error('inactive'),{status:403});return {tokens:{access_token:'ACCESS-SECRET-'+username,refresh_token:'REFRESH-SECRET-'+username},profile:{auth_id:username,id:username,username,full_name:'موظف '+username,active:true,role:username==='admin'?'admin':'staff'}};},
 async snapshot(){if(!online)throw new Error('offline');return structuredClone(snapshot);},
 async refresh(session,onTokens){if(!online)throw new Error('offline');if(disabled)throw Object.assign(new Error('inactive'),{status:403});await onTokens?.();return session.profile;},
 async submit(token,op){if(pause)await pause;if(!online)throw new Error('offline');if(!receipts.has(op.id)){submitted++;receipts.set(op.id,{ok:op.data.jobCode!=='J-8',message:'job_conflict'});}if(dropResponse){dropResponse=false;throw new Error('lost_response_after_commit');}return receipts.get(op.id);}
};
let store=openState(path,key),engine=new OfficeEngine(store,cloud,{clock:()=>now,archiveDir:join(dir,'archives')});let server;
try{
 await assert.rejects(()=>engine.enqueue('',{kind:'reserve'}));check('unauthenticated draft entry denied',true);
 const a=await engine.login('alice','fixture-only'),b=await engine.login('bob','fixture-only'),admin=await engine.login('admin','fixture-only');
 check('no tokens reach browser state',!/ACCESS-SECRET|REFRESH-SECRET/.test(JSON.stringify(engine.view(a))));
 check('encrypted state contains neither staff name nor tokens',!readFileSync(path).includes(Buffer.from('REFRESH-SECRET'))&&!readFileSync(path).includes(Buffer.from('alice')));
 check('state authenticates on read',unseal(readFileSync(path),key).version===1);
 const damaged=Buffer.from(readFileSync(path));damaged[damaged.length-1]^=1;assert.throws(()=>unseal(damaged,key));assert.throws(()=>unseal(readFileSync(path),randomBytes(32)));check('wrong key and tampered ciphertext rejected',true);
 online=false;
 await assert.rejects(()=>engine.login('new-user','fixture-only'));check('no first login during outage / no local password fallback',true);
 const results=await Promise.allSettled([engine.enqueue(a,{kind:'reserve',jobCode:'J-1',serial:'CARD'}),engine.enqueue(b,{kind:'reserve',jobCode:'J-1',serial:'cArD'})]);
 check('two devices cannot enqueue same job twice',results.filter(r=>r.status==='fulfilled').length===1);
 const second=await engine.enqueue(b,{kind:'reserve',jobCode:'J-2',serial:'card'});
 check('shared card queue reserves distinct existing slots',store.state.outbox.map(o=>o.expected.attempt_no).join(',')==='1,2');
 check('staff sees only own outbox; admin sees shared queue',engine.view(a).outbox.length===1&&engine.view(b).outbox.length===1&&engine.view(admin).outbox.length===2);
 await assert.rejects(()=>engine.enqueue(a,{kind:'reserve',jobCode:'J-3',serial:'cArD'}));check('local queue never invents a third chance',true);
 await engine.sync();check('failed network retains full durable payloads',store.state.outbox.every(o=>o.status==='pending'&&o.data.serial==='CARD'&&o.expected.attempt_no));
 await engine.archive(key);check('office archive labelled separately from DB backup',store.state.backup.type==='encrypted-office-state');
 const archive=join(dir,'archives',readdirSync(join(dir,'archives'))[0]);check('office archives omit all login leases and cloud tokens',Object.keys(unseal(readFileSync(archive),key).sessions).length===0&&Object.keys(store.state.sessions).length===3);
 store=openState(path,key);engine=new OfficeEngine(store,cloud,{clock:()=>now,archiveDir:join(dir,'archives')});
 check('restart recovers both requests and lease',engine.view(admin).outbox.length===2);
 online=true;dropResponse=true;await engine.sync();check('response loss leaves original request pending',store.state.outbox[0].status==='pending');
 await assert.rejects(()=>engine.cancel(a,store.state.outbox[0].id));check('possibly committed request cannot be cancelled blindly',true);
 await engine.sync();check('idempotent retry consumes no extra operation',submitted===2&&store.state.outbox.every(o=>o.status==='done'));
 await assert.rejects(()=>engine.cancel(b,second.id));check('completed request cannot be cancelled',true);
 const conflict=await engine.enqueue(a,{kind:'job_note',jobCode:'J-8',note:'ملاحظة تجريبية'});await engine.sync();check('server conflict preserved for human review',store.state.outbox.find(o=>o.id===conflict.id).status==='conflict');
 const activation=await engine.enqueue(a,{kind:'activate',jobCode:'J-4',serial:'blank',fullName:'زبون تجريبي',phone:'07700000000',posName:'المكتب'});
 check('lowercase activation resolves exact canonical snapshot key',store.state.outbox.find(o=>o.id===activation.id).data.serial==='BLANK');
 let unblock;pause=new Promise(r=>{unblock=r;});const sync=engine.sync();
 // Let the cloud call start, then verify the local write path remains available.
 await new Promise(r=>setTimeout(r,20));
 const local=await Promise.race([engine.enqueue(b,{kind:'job_note',jobCode:'J-5',note:'يستمر العمل رغم بطء الشبكة'}),new Promise((_,no)=>setTimeout(()=>no(new Error('LAN write blocked by cloud')),500))]);
 check('network requests never monopolize LAN write mutex',!!local.id);unblock();pause=null;await sync;
 const saved=await engine.enqueue(a,{kind:'job_note',jobCode:'J-6',note:'تبقى محفوظة بعد الخروج'});await engine.logout(a);await engine.sync();check('logout suspends unsent owner work',store.state.outbox.find(o=>o.id===saved.id).status==='pending');assert.throws(()=>engine.view(a));
 const anew=await engine.login('alice','fixture-only');disabled=true;await engine.sync();check('disabled official account cannot commit and loses local session',store.state.outbox.find(o=>o.id===saved.id).status==='blocked');assert.throws(()=>engine.view(anew));
 disabled=false;const again=await engine.login('alice','fixture-only');await engine.sync();check('fresh official login can reconcile blocked own work',store.state.outbox.find(o=>o.id===saved.id).status==='done');
 now+=9*3600000;assert.throws(()=>engine.view(again));check('offline lease expires after eight hours',true);now-=9*3600000;
 // Disk errors cannot return success or leave a phantom in-memory request.
 const savedBytes=readFileSync(path);rmSync(path);mkdirSync(path);const count=store.state.outbox.length;
 await assert.rejects(()=>engine.enqueue(again,{kind:'job_note',jobCode:'J-7',note:'يجب ألا ينجح'}));check('disk write failure rolls memory back; no false saved state',store.state.outbox.length===count);rmSync(path,{recursive:true});writeFileSync(path,savedBytes);
 // HTTP mode exists only for isolated test injection; CLI requires HTTPS.
 server=makeServer(engine,{hosts:['127.0.0.1:0']});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;server.close();await new Promise(r=>server.once('close',r));
 server=makeServer(engine,{hosts:['127.0.0.1:'+port]});await new Promise(r=>server.listen(port,'127.0.0.1',r));const base='http://127.0.0.1:'+port;
 let r=await fetch(base+'/api/state');check('HTTP API requires local authenticated lease',r.status===401);
 r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'http://evil.test','Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'fixture-only'})});check('cross-origin login/CSRF denied',r.status===403);
 r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'fixture-only'})});const cookie=r.headers.get('set-cookie'),view=await r.json();check('session cookie HttpOnly/Strict and response no-store',r.ok&&cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict')&&r.headers.get('cache-control')==='no-store');
 r=await fetch(base+'/api/sync',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:'{}'});check('state-changing API requires CSRF token',r.status===403);
 r=await fetch(base+'/api/state',{headers:{Cookie:cookie}});check('authenticated same-origin read works without exposing cloud tokens',r.ok&&!JSON.stringify(await r.json()).includes('REFRESH-SECRET'));
 check('HTTP enforces CSP and frame denial',r.headers.get('content-security-policy').includes("frame-ancestors 'none'")&&r.headers.get('x-frame-options')==='DENY');
 const release=acquireLock(join(dir,'test.lock'));assert.throws(()=>acquireLock(join(dir,'test.lock')));release();check('second writer process is refused',true);
 let refreshSaved=false,profileAfterSave=false;const adapter=new Cloud('https://fixture.test','public',async(url)=>{if(String(url).includes('/token'))return new Response(JSON.stringify({access_token:'new',refresh_token:'rotated',expires_at:9999999999}));profileAfterSave=refreshSaved;if(String(url).includes('/auth/v1/user'))return new Response(JSON.stringify({id:'a'}));return new Response(JSON.stringify([{active:true,role:'staff',auth_id:'a'}]));});
 await adapter.refresh({tokens:{access_token:'old',refresh_token:'old'}},()=>{refreshSaved=true;});check('refresh rotation fsynced before profile/network continuation',profileAfterSave);
 console.log(`Office engine/HTTP: ${checks} checks passed.`);
}finally{if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
