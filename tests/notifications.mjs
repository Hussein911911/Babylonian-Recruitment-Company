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
test('Reservation and employer decision both appear', () => assert.deepEqual(build(fixture()).map(n => n.kind), ['decision', 'booking']));
test('Rejection contains the exact employer reason', () => assert.equal(build(fixture())[0].reason, 'عدم توافق وقت الدوام'));
test('Rejection explicitly waits for company control', () => assert.match(build(fixture())[0].body, /بانتظار قرار الشركة/));
test('A hire is a request, not an automatic final outcome', () => { const db = fixture(); db.attempts[0].employerDecision = 'hire'; const event = build(db)[0]; assert.match(event.title, /تم التوظيف/); assert.match(event.body, /ليس قراراً نهائياً/); assert.equal(event.reason, ''); });
test('Missing legacy rejection reason is not fabricated', () => { const db = fixture(); db.attempts[0].reason = ''; assert.match(build(db)[0].reason, /لم يُسجّل/); });
test('No PIN/chance secret is projected', () => assert.doesNotMatch(JSON.stringify(build(fixture())), /SECRET/));
test('Projection never mutates original records', () => { const db = fixture(), original = JSON.stringify(db); build(db); assert.equal(JSON.stringify(db), original); });
test('Natural keys survive server ID replacement', () => { const db = fixture(), ids = build(db).map(n => n.id); db.attempts[0].id = 'server-uuid'; assert.deepEqual(build(db).map(n => n.id), ids); });
test('Repeated refresh gives stable IDs and order', () => assert.deepEqual(build(fixture()), build(fixture())));
test('Server audit decision is deduplicated against authoritative attempt', () => { const db = fixture(); db.audit.push({ id: 1, entity: 'applicant', entityId: 'CARD-1', role: 'employer', action: 'قرار صاحب العمل', ts: stamp }); assert.equal(build(db).length, 2); });
test('Decision reason comes from attempt, not hire/reject-only audit text', () => { const db = fixture(); db.audit.push({ id: 1, entity: 'applicant', entityId: 'CARD-1', role: 'employer', action: 'قرار صاحب العمل بعد تحقق الرمز السري', details: 'reject', ts: stamp }); assert.equal(build(db)[0].reason, db.attempts[0].reason); });
test('Reservation audit duplicate is suppressed', () => { const db = fixture(); db.audit.push({ id: 2, entity: 'job', entityId: 'J-1', action: 'حجز مؤقت لوظيفة', ts: db.attempts[0].selectedAt }); assert.equal(build(db).length, 2); });
test('Unrelated audit changes on same job are not suppressed', () => { const db = fixture(); db.audit.push({ id: 3, entity: 'job', entityId: 'J-1', action: 'تعديل وظيفة', ts: stamp }); assert.equal(build(db).length, 3); });
test('Company final hire is distinct from employer request', () => { const db = fixture(); db.attempts[0].slotStatus = 'succeeded'; db.attempts[0].closedAt = '2026-10-18T11:00:00Z'; assert.match(build(db)[0].title, /الشركة: تثبيت/); });
test('Company final rejection is included', () => { const db = fixture(); db.attempts[0].slotStatus = 'rejected'; db.attempts[0].closedAt = '2026-10-18T11:00:00Z'; assert.match(build(db)[0].title, /إغلاق الفرصة/); });
test('Latest server job status is available even without retained audit', () => { const db = fixture(); db.attempts = []; assert.match(build(db)[0].title, /محجوزة/); });
test('Critical state is not presented as available', () => { const db = fixture(); db.attempts[0].decisionAt = '2026-10-18T08:00:00Z'; assert.match(build(db)[0].title, /حرجة/); });
test('Critical/expiry audit updates are included', () => { const db = fixture(); db.audit.push({ id: 4, entity: 'job', entityId: 'J-1', action: 'حالة حرجة (انتهاء 24 ساعة)', ts: '2026-10-18T12:00:00Z' }); assert.equal(build(db)[0].kind, 'alert'); });
test('Staff sees operational job updates from colleagues', () => { const db = fixture(); db.audit.push({ id: 5, entity: 'job', entityId: 'J-1', user: 'other', role: 'staff', action: 'تعديل وظيفة', ts: stamp }); assert.ok(build(db).some(n => n.id === 'audit:5')); });
test('Staff does not acquire colleague-only applicant audit access', () => { const db = fixture(); db.audit.push({ id: 6, entity: 'applicant', entityId: 'CARD-2', user: 'other', role: 'staff', action: 'طباعة بطاقة', ts: stamp }); assert.ok(!build(db).some(n => n.id === 'audit:6')); });
test('Staff sees own applicant operations', () => { const db = fixture(); db.audit.push({ id: 7, entity: 'applicant', entityId: 'CARD-2', user: 'staff-a', role: 'staff', action: 'طباعة بطاقة', ts: stamp }); assert.ok(build(db).some(n => n.id === 'audit:7')); });
test('Admin-only account/settings/backup activity stays admin-only', () => { const db = fixture(); for (const entity of ['user', 'settings', 'backup']) db.audit.push({ id: entity, entity, entityId: 'x', action: 'تحديث بيانات', ts: stamp }); assert.equal(build(db).length, 2); assert.equal(build(db, { role: 'admin' }).length, 5); });
test('Staff cannot use a generic audit event to link into settings', () => { const db = fixture(); db.audit.push({ id: 8, entity: 'system', action: 'نسخة احتياطية', ts: stamp }); assert.ok(!build(db).some(n => n.view === 'settings')); });
test('PIN job-save events show sanitized operational update only', () => { const db = fixture(); db.audit.push({ id: 9, entity: 'job', entityId: 'J-1', action: 'حفظ وظيفة ورمز صاحب العمل', details: 'SECRET-PIN', ts: stamp }); const n = build(db).find(n => n.id === 'audit:9'); assert.equal(n.title, 'تحديث بيانات وظيفة'); assert.doesNotMatch(JSON.stringify(n), /SECRET|رمز/); });
test('Auth/QR/password records never appear', () => { const db = fixture(); db.audit.push({ id: 10, entity: 'user', action: 'تغيير كلمة مرور', details: 'SECRET', ts: stamp }); assert.doesNotMatch(JSON.stringify(build(db, { role: 'admin' })), /SECRET/); });
test('Invalid timestamps are not silently replaced with current time', () => { const db = fixture(); db.attempts = []; db.jobs = []; db.audit.push({ id: 11, entity: 'job', action: 'تحديث', ts: 'invalid' }); assert.deepEqual(build(db), []); });
test('Exact duplicate audit IDs render once', () => { const db = fixture(); const a = { id: 12, entity: 'job', action: 'تعديل وظيفة', ts: stamp }; db.audit.push(a, a); assert.equal(build(db).filter(n => n.id === 'audit:12').length, 1); });
test('Feed is bounded to the newest 100 available updates', () => { const db = { audit: Array.from({ length: 180 }, (_, i) => ({ id: i, entity: 'job', action: 'تحديث', ts: new Date(1760000000000 + i * 1000).toISOString() })) }; const rows = build(db); assert.equal(rows.length, 100); assert.equal(rows[0].id, 'audit:179'); assert.equal(rows[99].id, 'audit:80'); });
test('Model performs no network calls', () => { context.fetch = () => { throw new Error('network forbidden'); }; build(fixture()); });
console.log(`PASS ${passed} notification model checks`);
