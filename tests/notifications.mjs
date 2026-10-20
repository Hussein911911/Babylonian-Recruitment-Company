/* Pure, local notification projections: no Supabase/network/browser credentials. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../assets/js/notifications.js', import.meta.url), 'utf8'), context);
const build = (db, user = { username: 'staff-a', role: 'staff' }) => JSON.parse(JSON.stringify(context.HRCNotifications.build(db, user)));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }
const stamp = '2026-10-18T10:00:00.000Z';
const fixture = () => ({
  jobs: [{ code: 'J-1', title: 'موظف مخزن', status: 'reserved', updatedAt: stamp }],
  attempts: [{ id: 'temporary-id', serial: 'CARD-1', no: 1, jobCode: 'J-1', slotStatus: 'critical',
    selectedAt: '2026-10-18T09:00:00.000Z', employerDecision: 'reject', decisionAt: stamp, reason: 'عدم توافق وقت الدوام',
    code: 'SECRET-CHANCE', employerPin: 'SECRET-PIN' }],
  audit: []
});
test('Guests receive no internal events', () => assert.deepEqual(build(fixture(), null), []));
test('Unknown roles receive no internal events', () => assert.deepEqual(build(fixture(), { role: 'public' }), []));
test('Disabled/absent session cannot be replaced with a DB staff row', () => { const db = fixture(); db.staff = [{ role: 'admin', active: true }]; assert.deepEqual(build(db, null), []); });
test('Current decision replaces old booking, not duplicates it',()=>assert.deepEqual(build(fixture()).map(n=>n.kind),['decision']));
test('Rejection includes exact reason',()=>assert.equal(build(fixture())[0].reason,'عدم توافق وقت الدوام'));
test('Employer decision explicitly awaits company',()=>assert.match(build(fixture())[0].body,/بانتظار قرار الشركة/));
test('No PIN or chance secret in feed',()=>assert.doesNotMatch(JSON.stringify(build(fixture())),/SECRET/));
test('Projection does not mutate source',()=>{let db=fixture(),before=JSON.stringify(db);build(db);assert.equal(JSON.stringify(db),before);});
test('Stable natural key survives remote UUID',()=>{let db=fixture(),ids=build(db).map(n=>n.id);db.attempts[0].id='remote';assert.deepEqual(build(db).map(n=>n.id),ids);});
for(const outcome of ['succeeded','rejected','expired'])test('Final '+outcome+' retires all old candidate alerts',()=>{let db=fixture();db.attempts[0].slotStatus=outcome;assert.deepEqual(build(db),[]);});
test('Parent deletion retires alert',()=>{let db=fixture();db.jobs=[];assert.deepEqual(build(db),[]);});
test('Closing the advertisement does not hide an unresolved candidate decision',()=>{let db=fixture();db.jobs[0].status='closed';db.jobs[0].manualClosed=true;assert.equal(build(db).length,1);});
test('Open multivacancy parent retains exact pending decision',()=>{let db=fixture();db.jobs[0].vacancies=3;db.jobs[0].status='available';db.attempts[0].vacancyNo=2;const n=build(db)[0];assert.equal(n.vacancyNo,2);assert.match(n.body,/الشاغر 2 من 3/);});
test('Employer hire is only a request',()=>{let db=fixture();db.attempts[0].employerDecision='hire';db.attempts[0].slotStatus='hiring';assert.match(build(db)[0].body,/ليس قراراً نهائياً/);});
test('Critical deadline without decision is urgent',()=>{let db=fixture();db.attempts[0].employerDecision=null;assert.equal(build(db)[0].section,'alert');});
test('New reservation is a card submission',()=>{let db=fixture();Object.assign(db.attempts[0],{slotStatus:'reserved',employerDecision:null});assert.equal(build(db)[0].kind,'booking');assert.match(build(db)[0].title,/CARD-1/);});
test('Activation without applications is informative',()=>{let db=fixture();db.attempts=[];db.applicants=[{serial:'C2',status:'active',fullName:'عميل',issueDate:stamp}];assert.match(build(db)[0].title,/تفعيل البطاقة C2/);});
test('Application supersedes activation',()=>{let db=fixture();db.applicants=[{serial:'CARD-1',status:'active',fullName:'عميل',issueDate:stamp}];assert.equal(build(db).length,1);});
for(const status of ['blank','pending','rejected','expired','exhausted'])test('No activation notice for '+status,()=>assert.deepEqual(build({applicants:[{serial:'X',status,fullName:'عميل',issueDate:stamp}]}),[]));
test('Issuance/printing/settings/audit changes never create feed noise',()=>{let db={audit:['إصدار بطاقة','طباعة بطاقة','إنشاء وظيفة','حذف وظيفة','تعديل وظيفة','نسخة احتياطية'].map((action,i)=>({id:i,entity:i%2?'applicant':'job',action,ts:stamp}))};assert.deepEqual(build(db,{role:'admin'}),[]);});
test('Refreshing parent title/state does not manufacture a new event ID',()=>{let db=fixture(),id=build(db)[0].id;db.jobs[0].title='عنوان جديد';db.jobs[0].updatedAt='2026-10-20T10:00:00Z';assert.equal(build(db)[0].id,id);});
test('Rejection reason edit does not revive a read case',()=>{let db=fixture(),id=build(db)[0].id;db.attempts[0].reason='تصحيح سبب';assert.equal(build(db)[0].id,id);});
test('Decision phase is a NEW event after read booking',()=>{let db=fixture(),id=build(db)[0].id;db.attempts[0].employerDecision=null;db.attempts[0].slotStatus='reserved';assert.notEqual(build(db)[0].id,id);});
test('Independent seats have independent notices',()=>{let db=fixture();db.jobs[0].vacancies=3;db.attempts.push({...db.attempts[0],serial:'CARD-2',vacancyNo:2});assert.equal(build(db).length,2);db.attempts[0].slotStatus='succeeded';assert.equal(build(db).length,1);assert.equal(build(db)[0].serial,'CARD-2');});
test('Limit preserves critical unresolved cases ahead of routine activity',()=>{let db=fixture();db.attempts[0].employerDecision=null;db.applicants=Array.from({length:150},(_,i)=>({serial:'A'+i,status:'active',fullName:'عميل',issueDate:stamp}));const n=build(db);assert.equal(n.length,100);assert.equal(n[0].kind,'alert');});
test('Invalid timestamps do not become current-time events',()=>{let db=fixture();db.attempts[0].decisionAt='bad';assert.deepEqual(build(db),[]);});
test('All four groups remain distinct and ordered',()=>assert.deepEqual(Object.values(JSON.parse(JSON.stringify(context.HRCNotifications.sections))).map(n=>n.rank),[0,1,2,3]));
test('No network in projection',()=>{context.fetch=()=>{throw Error('network forbidden');};build(fixture());});
console.log(`PASS ${passed} focused notification model checks`);
