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
 /* 2026-11-15: قرار المدير — USB فقط، Google Drive خارج النطاق.
   الاختبار يضمن أن الواجهة تقول ذلك صراحةً بدل ادّعاء ربط غير موجود. */
 {const t=d.getElementById('recovery-tools').textContent;
  check('storage scope stated',t.includes('داخل نفس مشروع القاعدة'));
  check('external copy points to USB, not Google Drive',t.includes('USB')&&!t.includes('Drive غير مربوط'));}
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
 /* ── سلوك المزامنة العالقة (2026-11-12) ──────────────────────────────────
  * المدير بلّغ: ضغط «إنشاء نسخة» فظهر «توجد تغييرات لم تكتمل مزامنتها»
  * بلا أي تفسير ولا مخرج. الفحص يضمن أن الرسالة صارت تشخيصية وأن
  * للإصلاح زرّين مرتّبين: المحاولة أولاً، ثم التجاهل الصريح.
  * ──────────────────────────────────────────────────────────────────────── */
 let stuckDiff=3, pushedSucceed=false;
 fake.diffCloud=()=>new Array(stuckDiff).fill({table:'jobs'});
 fake.pushCloud=async()=>{calls.push({action:'flush'});if(pushedSucceed){stuckDiff=0;return {failed:0};}return {failed:stuckDiff};};
 badFlush=false;
 click('recovery-create');click('recovery-save');await tick();
 const stuckText=d.querySelector('[data-recovery-status]').textContent;
 check('stuck-sync message names the exact count, not a vague sentence',/\d+\s*تغيير/.test(stuckText),'النص: '+stuckText);
 check('offers an explicit retry button instead of a dead end',!!d.getElementById('recovery-retry'));
 d.getElementById('recovery-retry').click();await tick();
 check('a failing retry explains why and offers the discard path',!!d.getElementById('recovery-discard')&&d.querySelector('.recovery-stuck-actions'));
 pushedSucceed=true;d.getElementById('recovery-retry').click();await tick();
 check('a successful retry clears the error state',!d.querySelector('[data-recovery-status].recovery-error'));
 /* التجاهل: لا يمسّ شيئاً قبل موافقة صريحة، وبالرفض لا يُحذف الطابور */
 w.localStorage.setItem('hrc-cloud-queue','[{"table":"jobs"}]');
 let asked=0;w.confirm=()=>{asked++;return false;};
 const disc=d.getElementById('recovery-discard');
 if(disc){disc.click();}
 check('discard asks for confirmation before touching storage',asked===1);
 check('refused confirmation leaves the local queue untouched',
   w.localStorage.getItem('hrc-cloud-queue')==='[{"table":"jobs"}]');


 /* ── الحفظ المباشر على USB (2026-11-15) ────────────────────────────────────
  * طلب المدير: «مسار مباشر بضغطة زر» إلى الفلاش.
  * نختبره في DOM مستقل: مسار الحفظ لا علاقة له بحالة الاسترجاع أعلاه،
  * وخلطهما يجعل الاختبار يعتمد على ترتيب التنفيذ لا على السلوك.
  * ──────────────────────────────────────────────────────────────────────── */
 async function usbSuite(){
  const dom2=new JSDOM('<main id="recovery-tools"></main><div id="modal-root"></div><div id="toast-root"></div>',
    {url:'https://fixture.test',runScripts:'outside-only'}),w2=dom2.window,d2=w2.document;
  const payload={applicants:400,audit:7};
  w2.HRCStore={isAdmin:()=>true,cloudStatus:()=>({enforceAuth:true,state:'on',role:'staff'}),
    fmtDateTime:x=>new Date(x).toISOString(),diffCloud:()=>[],cloudQueueLength:()=>0,
    pushCloud:async()=>({failed:0}),recoveryRPC:async(a)=>a==='list'?{ok:true,copies:[]}:{ok:true},
    recoveryExportFull:async()=>payload,db:()=>{throw new Error('no browser db');},exportJson:()=>{throw new Error('no json');}};
  const win_timer=w2.setTimeout.bind(w2);w2.setTimeout=(fn,ms)=>ms===1500?0:win_timer(fn,ms);
  w2.eval(read('assets/js/ui.js'));w2.eval(read('assets/js/recovery.js'));
  await new Promise(r=>setTimeout(r,60));
  /* نُثبّت وحدة التشفير: jsdom بلا Web Crypto حقيقي، والغرض اختبار مسار
     الحفظ لا التشفير (للتشفير اختباراته المستقلّة في tests/portable-*). */
  w2.HRCPortableBackup={MIN_PASSWORD:10,
    seal:async()=>({format:'HRC-PORTABLE-v1',cipher:'AES-GCM',counts:payload}),
    suggestName:()=>'hrc-backup-2026-11-15-0900.hrcbak'};
  let downloaded=0;const realDownload=w2.HRCUI.download;
  w2.HRCUI.download=function(){downloaded++;};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const open=async()=>{d2.getElementById('portable-download').click();
    for(let i=0;i<80&&!d2.getElementById('pb-pass');i++)await wait(10);
    if(!d2.getElementById('pb-pass'))throw new Error('نافذة التنزيل لم تُفتح');};
  const pass=()=>{d2.getElementById('pb-pass').value='correct horse battery staple';
    d2.getElementById('pb-pass2').value='correct horse battery staple';};
  const closeModal=()=>{const b=d2.querySelector('#modal-root [data-close]');if(b)b.click();};

  /* (ج) متصفح بلا File System Access → تنزيل عادي، لا فشل */
  await open();
  check('USB checkbox hidden when the browser cannot write directly',!d2.getElementById('pb-usb'));
  pass();d2.getElementById('pb-go').click();await wait(90);
  check('no File System Access support → normal download, never a failure',downloaded===1);
  check('fallback reports the Downloads folder, never claims the USB',/مجلد التنزيلات/.test(d2.querySelector('[data-portable-status]').textContent));
  closeModal();

  /* (أ) دعم كامل: يُكتب على الـUSB ويُتحقق */
  let wrote='',picked=0;
  const readBlob=b=>new Promise(res=>{const fr=new w2.FileReader();
    fr.onload=()=>res(String(fr.result));fr.readAsText(b);});
  w2.isSecureContext=true;
  w2.showSaveFilePicker=async()=>{picked++;return {
    name:'hrc-backup.hrcbak',
    createWritable:async()=>({write:async b=>{wrote=await readBlob(b);},close:async()=>{}}),
    getFile:async()=>({size:new TextEncoder().encode(wrote).length,
      arrayBuffer:async()=>new TextEncoder().encode(wrote).buffer})};};
  await open();
  check('USB option is offered in Chrome/Edge, and ticked by default',
    !!d2.getElementById('pb-usb')&&d2.getElementById('pb-usb').checked);
  pass();d2.getElementById('pb-go').click();
  for(let i=0;i<120&&!wrote;i++)await wait(10);
  await wait(120);
  check('writes the encrypted archive to the chosen USB folder',picked===1&&wrote.length>0&&JSON.parse(wrote).format==='HRC-PORTABLE-v1');
  check('successful USB write does not also dump a copy into Downloads',downloaded===1);
  const st=d2.querySelector('[data-portable-status]').textContent;
  check('reports the USB write and that the file was re-read and verified',/الـUSB/.test(st)&&/تحقّقت/.test(st));
  closeModal();

  /* (ب) المستخدم يُلغي النافذة → لا ادّعاء نجاح ولا تنزيل صامت */
  w2.showSaveFilePicker=async()=>{const e=new Error('cancelled');e.name='AbortError';throw e;};
  await open();pass();d2.getElementById('pb-go').click();await wait(120);
  const errEl=d2.getElementById('pb-err');
  check('cancelled picker never claims success and never silently downloads',
    downloaded===1&&!!errEl&&/لم تُحفظ/.test(errEl.textContent));
  w2.HRCUI.download=realDownload;
  dom2.window.close();
 }
 await usbSuite();
 console.log(`Managed recovery UI: ${checks} checks passed.`);
}finally{dom.window.close();}
