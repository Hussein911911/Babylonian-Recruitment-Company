// Production recovery console in a real DOM, RPC fixtures only. Never live restore.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');let checks=0;
const check=(name,v)=>{assert.ok(v,name);checks++;console.log('✓ '+name);};
const dom=new JSDOM('<main id="recovery-tools"></main><div id="modal-root"></div><div id="toast-root"></div>',{url:'https://fixture.test',runScripts:'outside-only'}),w=dom.window,d=w.document;
const calls=[];let copies=[{id:'one',name:'<img src=x onerror=alert(1)>',createdAt:new Date().toISOString(),counts:{jobs:6,applicants:400,attempts:800},safety:false}],badFlush=false,blocked=false,restoreReject=false,finish=null,restoreCount=0;
const tick=()=>new Promise(r=>setTimeout(r,15));const click=id=>d.getElementById(id).click();
const fake={isAdmin:()=>true,cloudStatus:()=>({enforceAuth:true,state:'on',role:'staff'}),fmtDateTime:x=>new Date(x).toISOString(),diffCloud:()=>[],cloudQueueLength:()=>0,pushCloud:async()=>{calls.push({action:'flush'});return {failed:badFlush?1:0};},db:()=>{throw new Error('Browser db must not be used for backups');},exportJson:()=>{throw new Error('No JSON browser export');},recoveryRPC:async(action,id,name,token)=>{
 calls.push({action,id,name,token});
 if(action==='list')return {ok:true,copies};
 if(action==='create'){copies=[{id:'new',name,createdAt:new Date().toISOString(),counts:{jobs:6,applicants:400,attempts:800}},...copies];return {ok:true,id:'new'};}
 if(action==='preview')return {ok:true,token:'fixture-ticket',canRestore:!blocked,current:{jobs:0,applicants:400,attempts:800},target:{jobs:6,applicants:400,attempts:800},risks:{missingJobs:6,spentChanceConflicts:blocked?1:0}};
 if(action==='restore'){restoreCount++;if(restoreReject)throw new Error('Lost network response');return new Promise(resolve=>{finish=resolve;});}
 if(action==='remove'){copies=copies.filter(c=>c.id!==id);return {ok:true};}
 }};
try{
 w.HRCStore=fake;const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>ms===1500?0:timer(fn,ms);w.eval(read('assets/js/ui.js'));w.eval(read('assets/js/recovery.js'));await tick();
 check('reads server-owned copies, not local storage',calls[0].action==='list'&&w.localStorage.length===0);
 check('renders copy names as text, no stored XSS',!d.querySelector('#recovery-tools img')&&d.querySelector('.recovery-copy h4').textContent===copies[0].name);
 check('no legacy browser JSON/import/schedule/reset controls',!d.querySelector('#btn-import,#btn-export,#btn-reset,#btn-schedule-backup'));
 check('storage scope and disconnected Drive explicitly stated',d.getElementById('recovery-tools').textContent.includes('داخل نفس مشروع القاعدة')&&d.getElementById('recovery-tools').textContent.includes('Google Drive غير مربوط'));
 check('does not claim full project/code/Storage recovery',d.getElementById('recovery-tools').textContent.includes('ليست استرداداً لكود الموقع'));
 click('recovery-create');d.getElementById('recovery-copy-name').value='نسخة اليوم';click('recovery-save');await tick();
 check('flushes writes before snapshot RPC',calls.findIndex(c=>c.action==='flush')<calls.findIndex(c=>c.action==='create'));
 check('create names the server snapshot and refreshes its list',calls.some(c=>c.action==='create'&&c.name==='نسخة اليوم')&&d.querySelectorAll('.recovery-copy').length===2);
 check('success never creates a plaintext browser snapshot',w.localStorage.length===0);
 badFlush=true;const prior=calls.filter(c=>c.action==='create').length;click('recovery-create');click('recovery-save');await tick();check('failed cloud flush cannot create a misleading last-version backup',calls.filter(c=>c.action==='create').length===prior);d.querySelector('#modal-root [data-close]').click();badFlush=false;
 d.querySelector('.recovery-copy button').click();await tick();
 check('preview reports deleted jobs and target/current counts',d.querySelector('#modal-root').textContent.includes('وظائف محذوفة ستعود')&&d.querySelector('#modal-root').textContent.includes('6 وظيفة'));
 check('preview alone never calls restore',restoreCount===0);
 const ack=d.getElementById('recovery-ack'),phrase=d.getElementById('recovery-phrase'),button=d.getElementById('recovery-restore');
 check('restore initially disabled',button.disabled);ack.checked=true;ack.dispatchEvent(new w.Event('change'));check('checkbox alone insufficient',button.disabled);
 phrase.value='خطأ';phrase.dispatchEvent(new w.Event('input'));check('wrong confirmation phrase insufficient',button.disabled);
 phrase.value='استرجاع';phrase.dispatchEvent(new w.Event('input'));check('explicit acknowledgement plus exact phrase enables restore',!button.disabled);
 button.click();await tick();check('uses the preview-bound ticket, no browser database payload',calls.find(c=>c.action==='restore').token==='fixture-ticket'&&!calls.find(c=>c.action==='restore').data);
 ack.checked=false;ack.dispatchEvent(new w.Event('change'));ack.checked=true;ack.dispatchEvent(new w.Event('change'));check('cannot re-enable final restore while a request is in flight',button.disabled);
 d.querySelector('#modal-root [data-close]').click();d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));check('cannot close/cancel misleadingly while restore is in flight',!!d.getElementById('recovery-restore'));
 finish({ok:true,requiresLogin:true});await tick();check('successful restore reports required new login',d.querySelector('[data-recovery-status]').textContent.includes('يلزم تسجيل الدخول')&&!d.querySelector('#modal-root .modal'));
 blocked=true;d.querySelector('.recovery-copy button').click();await tick();check('spent-chance conflicts never offer a restore button',!d.getElementById('recovery-restore')&&d.querySelector('#modal-root').textContent.includes('لا تُعاد الفرص'));d.querySelector('#modal-root [data-close]').click();blocked=false;
 restoreReject=true;d.querySelector('.recovery-copy button').click();await tick();d.getElementById('recovery-ack').checked=true;d.getElementById('recovery-ack').dispatchEvent(new w.Event('change'));d.getElementById('recovery-phrase').value='استرجاع';d.getElementById('recovery-phrase').dispatchEvent(new w.Event('input'));click('recovery-restore');await tick();
 check('lost response is ambiguous, never falsely declared rolled back',d.querySelector('[data-recovery-status]').textContent.includes('قد تكون العملية اكتملت'));
 check('no automatic destructive retry after uncertain response',restoreCount===2);
 console.log(`Managed recovery UI: ${checks} checks passed.`);
}finally{dom.window.close();}
