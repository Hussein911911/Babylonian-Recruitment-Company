// Backup authorization independent of online/degraded state. Synthetic DOM only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {DEMO_SEED} from './fixtures/demo-seed.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const dom=new JSDOM('',{url:'https://fixture.test',runScripts:'outside-only'}),w=dom.window;let count=0;
const check=(name,v)=>{assert.ok(v,name);count++;console.log('✓ '+name);};
try{
 w.__HRC_TEST_SEED__=structuredClone(DEMO_SEED);w.eval(read('assets/js/config.js'));w.HRCSupabaseConfig={enforceAuth:true,enabled:false};w.eval(read('assets/js/store.js'));const s=w.HRCStore;s.init({cloud:false});
 const session=role=>w.sessionStorage.setItem('hrc_session_v2',JSON.stringify({username:'fixture',role,cloud:true}));session('admin');
 const text=JSON.stringify(s.db()),legacy={id:'legacy',name:'لقطة قديمة',data:JSON.parse(text),createdAt:new Date().toISOString()};w.localStorage.setItem('hrc-scheduled-backups',JSON.stringify([legacy]));
 const before=JSON.stringify(s.db()),saved=w.localStorage.getItem('hrc-scheduled-backups');
 check('production demo-reset is blocked even offline',s.resetDemo()===false&&JSON.stringify(s.db())===before);
 check('cloud-configured restore blocked even when network/client absent',s.restoreScheduledBackup('legacy')===false&&JSON.stringify(s.db())===before);
 assert.throws(()=>s.importJson(text),/سحاب/);check('JSON import also blocked independent of cloud state',JSON.stringify(s.db())===before);
 check('production creates no new plaintext browser snapshots',s.saveScheduledBackup('must-not-exist')===null&&w.localStorage.getItem('hrc-scheduled-backups')===saved);
 check('production browser scheduler cannot be enabled',s.saveAutoSchedule([0,1,2],'23:00')===null);
 w.localStorage.setItem('hrc-auto-backup-schedule',JSON.stringify({days:[new Date().getDay()],time:'00:00'}));check('old production browser schedule never runs',s.checkAutoBackup()===null&&w.localStorage.getItem('hrc-scheduled-backups')===saved);
 session('staff');check('staff cannot enumerate or delete legacy backups',s.listBackupMeta().length===0&&!s.deleteScheduledBackup('legacy'));
 assert.throws(()=>s.exportJson(),/مدير/);check('production raw export restricted to admin',true);
 session('admin');const preview=s.previewBackup(text);check('preview reports schema version and record counts without mutation',preview.version===2&&preview.jobs===s.db().jobs.length&&JSON.stringify(s.db())===before);
 const duplicate=JSON.parse(text);duplicate.applicants.push(duplicate.applicants[0]);assert.throws(()=>s.previewBackup(JSON.stringify(duplicate)));check('duplicate card records rejected',true);
 const orphan=JSON.parse(text);orphan.attempts[0].serial='INVENTED';assert.throws(()=>s.previewBackup(JSON.stringify(orphan)));check('dangling chance/card relationships rejected',true);
 const stale=JSON.parse(text);stale.meta.version=999;assert.throws(()=>s.previewBackup(JSON.stringify(stale)));check('unknown schema version rejected',true);
 // Real local/demo restore remains admin-only and requires a successful safety
 // write. Simulate storage quota failure WITHOUT altering production auth tests.
 w.HRCSupabaseConfig.enforceAuth=false;session('staff');assert.throws(()=>s.importJson(text),/مدير/);check('even isolated local import requires admin',true);
 session('admin');const original=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(k,v){if(k==='hrc-scheduled-backups')throw new Error('quota');return original.call(this,k,v);};
 assert.throws(()=>s.importJson(text));check('failed safety snapshot aborts import before replacing db',JSON.stringify(s.db())===before);
 check('failed safety snapshot also aborts scheduled restore',s.restoreScheduledBackup('legacy')===false&&JSON.stringify(s.db())===before);w.Storage.prototype.setItem=original;
 Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});s.audit('fixture','system','x','not operational offline work');check('no new plaintext offline snapshot queue generated',w.localStorage.getItem('hrc-offline-queue')===null);
 w.localStorage.setItem('hrc-offline-queue','[{"synthetic":true}]');s.syncOfflineChanges();check('legacy offline records never silently discarded as successful sync',w.localStorage.getItem('hrc-offline-queue')==='[{"synthetic":true}]');
 console.log(`Backup hardening: ${count} checks passed.`);
}finally{dom.window.close();}
