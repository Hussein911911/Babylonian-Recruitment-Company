import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');let checks=0;
function check(name,v){assert.ok(v,name);checks++;console.log('✓ '+name);}
const root={localStorage:{getItem:()=>null,setItem(){},removeItem(){}}};for(const file of ['cloud','cloud-sync'])new Function('window',read('assets/js/'+file+'.js'))(root);
const C=root.HRCCloud,S=root.HRCSync,db={meta:{workspace:true,partialTables:['jobs','applicants','job_attempts']},settings:{},jobs:[{code:'J',id:'j',status:'closed'}],applicants:[{serial:'OLD'}],attempts:[{serial:'OLD',no:1,slotStatus:'succeeded'}],audit:[]};
const snap=S.snapshotOf(db);db.jobs=[];db.applicants=[];db.attempts=[];
check('unloaded/evicted rows never generate SQL deletions',S.diff(snap,db).every(op=>op.op!=='delete'));
db.meta.explicitDeletes={jobs:['J']};const explicit=S.diff(snap,db).filter(op=>op.op==='delete');check('explicit ad deletion still works and cannot cascade to omitted cards',explicit.length===1&&explicit[0].table==='jobs');
const mapped=C.applicantFromDb({serial:'OLD',archived_at:'2026-01-01'});check('archive date is mapped but never written by clients',mapped.archivedAt==='2026-01-01'&&!('archived_at' in C.applicantToDb(mapped)));
const eventDb={meta:{workspace:true},applicants:[{serial:'OLD'},{serial:'CURRENT'}],attempts:[{serial:'OLD'},{serial:'CURRENT'}]};C.applyChange(eventDb,'applicants',{eventType:'UPDATE',new:{serial:'OLD',archived_at:'2026-01-01'}});check('realtime archive evicts only the retired card and its slots',eventDb.applicants.length===1&&eventDb.attempts.length===1&&eventDb.applicants[0].serial==='CURRENT');
const bitmap=Buffer.alloc(595125);bitmap[0]=1;bitmap[595124]=128;const registry={version:1,bitmap:bitmap.toString('base64')};
const calls=[];const client={rpc:async()=>({data:registry,error:null}),from(table){calls.push(table);return{select(){return this;},order(){return this;},limit(){return this;},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};}};
const working=await C.fetchAll(client,{workspace:true});check('workspace reads only staff working views for historical tables',calls.includes('working_applicants')&&calls.includes('working_job_attempts')&&calls.includes('working_jobs')&&!calls.includes('applicants')&&!calls.includes('job_attempts'));
const aggregated=await C.fetchAll({...client,rpc:async(name)=>({data:name==='staff_issuance_registry'?registry:{stats:{forms:6000,hires:12},rows:[]},error:null})},{workspace:true});check('secret registry is never serialized into the work-cache metadata',!JSON.stringify(aggregated).includes('bitmap'));
check('lifetime aggregates travel separately from card records',aggregated.meta.serverReport.stats.forms===6000&&aggregated.applicants.length===0);
check('compact registry prevents reissuing first and last historical chance codes',C.chanceUsed('1000-AA')&&C.chanceUsed('9999-ZZ')&&!C.chanceUsed('1000-AB'));C.rememberChance('1000-AB');check('new printed codes immediately enter the in-memory registry',C.chanceUsed('1000-AB'));C.clearChanceRegistry();check('logout can clear secret registry without touching server history',!C.chanceUsed('1000-AA'));
check('partial scope carried into sync metadata',working.meta.workspace&&working.meta.partialTables.length===3&&working.meta.failedTables.length===0);
const broken=await C.fetchAll({from(){return{select(){return this;},order(){return this;},limit(){return this;},then(resolve,reject){return Promise.resolve({data:null,error:{code:'42P01',message:'missing workspace migration'}}).then(resolve,reject);}};}},{workspace:true});check('missing migration fails closed; no full-history fallback',broken.meta.failedTables.includes('applicants'));
// Search UI uses real modal/escaping, RPC responses only; never reads sync DB.
const dom=new JSDOM('<div id="modal-root"></div><div id="toast-root"></div>',{url:'https://fixture.test',runScripts:'outside-only'}),w=dom.window,d=w.document;
const tick=()=>new Promise(r=>setTimeout(r,20));let owner={username:'staff',role:'staff'},requests=[],finish;
const card={serial:'CARD-ARCHIVE',fullName:'<img src=x onerror=alert(1)>',archivedAt:'2026-01-01',status:'exhausted',attempts:[{no:2,vacancyNo:3,jobCode:'SAME-AD',jobTitle:'وظيفة',slotStatus:'succeeded',closedAt:'2025-11-01'}]};
const store={currentUser:()=>owner,db(){throw Error('history must not import/read the working DB');},searchCardHistory:async(q,page)=>{requests.push({q,page});return {cards:[card],hasMore:page===0};}};
try{
 await C.fetchAll(client,{workspace:true});w.HRCCloud=C;w.eval(read('assets/js/config.js'));w.eval(read('assets/js/store.js'));w.HRCStore.init({cloud:false});w.sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'admin',role:'admin',cloud:true}));const originalRandom=w.Math.random;w.Math.random=()=>0;const issued=w.HRCStore.createCardWithSerial('7KQ4M9TR2X','');w.Math.random=originalRandom;const codes=w.HRCStore.getAttempts('7KQ4M9TR2X').map(t=>t.code);check('direct issuance creates two slots with no chance codes (retired 2026-10-25)',issued.ok&&codes.length===2&&codes.every(c=>!c));w.HRCStore.db().meta.workspace=true;w.HRCStore.db().meta.partialTables=['applicants'];assert.throws(()=>w.HRCStore.exportJson(),/بيانات العمل/);check('partial work cache cannot be exported as a full recovery copy',true);assert.throws(()=>w.HRCStore.previewBackup(JSON.stringify(w.HRCStore.db())),/جزئية/);check('partial work cache cannot be restored as a full database',true);w.eval(read('assets/js/ui.js'));w.eval(read('assets/js/card-archive.js'));w.HRCArchive.open(store,w.HRCUI);await tick();
 check('historical search starts with one bounded server request',requests.length===1&&requests[0].page===0);
 check('stored names escaped, no HTML injection',!d.querySelector('#history-results img')&&d.querySelector('#history-results').textContent.includes(card.fullName));
 d.querySelector('[data-history-card]').click();check('details distinguish card opportunity from job vacancy',d.querySelector('#modal-root').textContent.includes('فرصة البطاقة')&&d.querySelector('#modal-root').textContent.includes('شاغر الوظيفة')&&d.querySelector('#modal-root').textContent.includes('SAME-AD'));
 check('historical details contain no mutation buttons',!d.querySelector('#o-save,#h-release,[data-win],[data-assign-job]'));
 d.querySelectorAll('.modal-backdrop')[1].querySelector('[data-close]').click();d.getElementById('history-next').click();await tick();check('next page requested on demand',requests.at(-1).page===1);
 d.getElementById('history-query').value='CARD';d.getElementById('history-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();check('new search resets pagination',requests.at(-1).q==='CARD'&&requests.at(-1).page===0);
 d.querySelector('.modal-backdrop [data-close]').click();
 store.searchCardHistory=()=>new Promise(resolve=>{finish=resolve;});w.HRCArchive.open(store,w.HRCUI);owner=null;finish({cards:[card],hasMore:false});await tick();check('response after logout never renders private results',!d.getElementById('history-results').textContent.includes('CARD-ARCHIVE'));
 console.log('PASS '+checks+' retention/sync/search UI checks. No production requests.');
}finally{dom.window.close();}
