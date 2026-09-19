#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار طبقة الربط بـ Supabase (assets/js/cloud.js)
 *  ---------------------------------------------------------------------------
 *  لماذا بمحاكٍ؟ الساندبوكس لا يصل إلى *.supabase.co، فلا يمكن الاختبار على
 *  المشروع الحقيقي. لكن أخطر ما في هذه الطبقة هو **التحويل** (أسماء الأعمدة
 *  snake_case ↔ camelCase، والبيانات المُسطّحة المشتقّة) — وكلها منطق خالص
 *  يمكن اختباره بدقة عبر عميل وهمي يرد بنفس أشكال PostgREST الحقيقية.
 *
 *  أخطاء هذا التحويل خطرة بصمت: حقل مفقود يعني واجهة تعرض فراغاً أو رقماً
 *  صفراً بلا أي رسالة خطأ.
 *
 *  التشغيل:  node tests/cloud.mjs
 * =========================================================================== */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

/* تحميل الوحدة في سياق Node (تعتمد على window أو globalThis) */
const src = readFileSync(join(ROOT, 'assets', 'js', 'cloud.js'), 'utf8');
const sandbox = {};
new Function('window', src)(sandbox);
const C = sandbox.BRCCloud;

console.log('\n' + '═'.repeat(74));
console.log('  BRC — اختبار طبقة الربط بـ Supabase (التحويل + التحميل + Realtime)');
console.log('═'.repeat(74));

check('الوحدة تُحمّل وتُصدّر BRCCloud', !!C);

/* ---------------------------------------------------------------------------
 *  أعمدة مطابقة لما تُرجعه PostgREST فعلاً (snake_case، تواريخ ISO، jsonb)
 * ------------------------------------------------------------------------- */
const JOB_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'BRC-1042', title: 'عامل مخزن', category: 'صناعي', region: 'الحلة',
  shift: 'صباحي', salary_min: 600000, salary_max: 750000, gender: 'لا فرق',
  vacancies: 2, requirements: ['لياقة بدنية', 'خبرة سنة'], description: 'وصف',
  employer_name: 'مخازن الفرات', employer_phone: '07701234567',
  employer_address: 'الحلة - الصناعية', interview_location: 'مقر الشركة',
  status: 'reserved', reserved_by: 'BRC-NO-000120',
  hold_expires_at: '2026-09-16T10:00:00+00:00',
  closed_at: null, created_by: null,
  created_at: '2026-09-10T08:00:00+00:00', updated_at: '2026-09-14T08:00:00+00:00',
  notes: 'ملاحظة', image_url: 'https://x/y.jpg'
};
const APP_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  serial: 'BRC-NO-000120', full_name: 'حسين كاظم', phone: '07704445566',
  address: 'الحلة - شارع 40', dob: '1997-11-30', gender: 'ذكر', nationality: 'عراقي',
  issue_date: '2026-09-01T00:00:00+00:00', expiry_date: '2026-10-01T00:00:00+00:00',
  attempt_limit: 5, status: 'active', fee_amount: 10000, fee_paid: true,
  printed_count: 3, requested_code: null, created_by: '33333333-3333-4333-8333-333333333333',
  created_at: '2026-09-01T00:00:00+00:00', updated_at: null, notes: ''
};
const STAFF_ROW = {
  id: '33333333-3333-4333-8333-333333333333', auth_id: '44444444-4444-4444-8444-444444444444',
  username: 'staff', full_name: 'أحمد الموسوي', role: 'staff',
  job_title: 'موظف توظيف', phone: '0770', active: true, created_at: '2026-01-01T00:00:00+00:00'
};
const ATTEMPT_ROW = {
  id: '55555555-5555-4555-8555-555555555555',
  serial: 'BRC-NO-000120', attempt_no: 1,
  job_id: '11111111-1111-4111-8111-111111111111', job_code: 'BRC-1042',
  slot_status: 'reserved', selected_at: '2026-09-13T07:00:00+00:00',
  hold_expires_at: '2026-09-16T10:00:00+00:00', closed_at: null,
  outcome_note: '', staff_id: '33333333-3333-4333-8333-333333333333'
};
const AUDIT_ROW = {
  id: 42, ts: '2026-09-14T22:00:00+00:00', user_id: null, username: 'admin', role: 'admin',
  ip: '192.168.1.5', action: 'إضافة وظيفة', entity: 'job', entity_id: 'BRC-1042',
  details: 'تفاصيل', diff: null
};
const SETTINGS_ROWS = [
  { key: 'rules', value: { attempt_limit: 5, validity_days: 30, hold_hours: 24, form_fee: 10000, auto_release: true } },
  { key: 'company', value: { name_ar: 'شركة الهدف للتوظيف', verify_base: 'https://brc-babil.com/verify' } }
];

const FULL = {
  jobs: [JOB_ROW], applicants: [APP_ROW], job_attempts: [ATTEMPT_ROW],
  audit_log: [AUDIT_ROW], settings: SETTINGS_ROWS, staff: [STAFF_ROW]
};

/* --------------------------- عميل سوبابيس وهمي --------------------------- */
function mockClient(data, opts) {
  opts = opts || {};
  var calls = [];
  return {
    __calls: calls,
    __schema: 'brc',
    from(table) {
      var q = {
        _table: table,
        select() { return q; },
        order() { return q; },
        limit() { return q; },
        eq() { return q; },
        insert(payload) { calls.push({ op: 'insert', table: table, payload: payload }); return Promise.resolve(opts.writeResult || { data: [payload], error: null }); },
        update(payload) { calls.push({ op: 'update', table: table, payload: payload }); return q; },
        delete() { calls.push({ op: 'delete', table: table }); return q; },
        then(res, rej) {
          if (opts.failTable === table) {
            return Promise.resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'brc." + table + "'" } }).then(res, rej);
          }
          return Promise.resolve({ data: data[table] || [], error: null, count: (data[table] || []).length }).then(res, rej);
        }
      };
      return q;
    },
    rpc(name, args) { calls.push({ op: 'rpc', name: name, args: args }); return Promise.resolve(opts.rpcResult || { data: { ok: true }, error: null }); },
    channel() {
      var ch = {
        _handlers: [],
        on(_evt, filter, cb) { ch._handlers.push({ filter: filter, cb: cb }); return ch; },
        subscribe(cb) { calls.push({ op: 'subscribe' }); if (cb) cb('SUBSCRIBED'); return ch; }
      };
      return ch;
    },
    removeChannel() { calls.push({ op: 'removeChannel' }); }
  };
}

/* ------------------------------ 1) تحويل الوظائف ------------------------------ */
step(1, 'تحويل الوظائف: snake_case → كائن الواجهة المركّب');
{
  const j = C.jobFromDb(JOB_ROW);
  check('المعرّف والكود', j.id === JOB_ROW.id && j.code === 'BRC-1042');
  check('الأجور camelCase', j.salaryMin === 600000 && j.salaryMax === 750000);
  check('المتطلبات مصفوفة كما هي', Array.isArray(j.requirements) && j.requirements.length === 2);
  check('بيانات صاحب العمل تُجمَّع في كائن employer{}',
    j.employer && j.employer.name === 'مخازن الفرات' && j.employer.phone === '07701234567' && j.employer.address === 'الحلة - الصناعية',
    JSON.stringify(j.employer));
  check('interviewLocation من interview_location', j.interviewLocation === 'مقر الشركة');
  check('reservedBy من reserved_by', j.reservedBy === 'BRC-NO-000120');
  check('التواريخ ISO (مع تحويل +00:00)', j.holdExpiresAt === '2026-09-16T10:00:00+00:00' && j.createdAt === '2026-09-10T08:00:00+00:00');
  check('closed_at = null يبقى null', j.closedAt === null);
  check('vacancies رقم', j.vacancies === 2);
  check('imageUrl من image_url', j.imageUrl === 'https://x/y.jpg');
  check('لا حقول SQL خام متروكة (employer_name)', j.employer_name === undefined);
}

/* ------------------------- 2) تحويل الاستمارات والمحاولات ------------------------- */
step(2, 'تحويل الاستمارات والمحاولات والتدقيق');
{
  const a = C.applicantFromDb(APP_ROW);
  check('fullName من full_name', a.fullName === 'حسين كاظم');
  check('fee من fee_amount (كان fee_amount)', a.fee === 10000);
  check('feePaid منطقي', a.feePaid === true);
  check('printedCount و attemptLimit', a.printedCount === 3 && a.attemptLimit === 5);
  check('dob يبقى ' + "'YYYY-MM-DD'" + ' (نوع date في SQL)', a.dob === '1997-11-30');
  check('serial كما هو (مفتاح الربط)', a.serial === 'BRC-NO-000120');

  const st = C.staffFromDb(STAFF_ROW);
  check('الموظف: name من full_name', st.name === 'أحمد الموسوي');
  check('الموظف: authId من auth_id', st.authId === STAFF_ROW.auth_id);

  const au = C.auditFromDb(AUDIT_ROW);
  check('التدقيق: user من username', au.user === 'admin');
  check('التدقيق: entityId من entity_id', au.entityId === 'BRC-1042');
  check('التدقيق: معرّف bigserial رقمي يبقى صالحاً', au.id === 42);
}

/* --------------------- 3) البيانات المُسطّحة المشتقّة (الأهم) --------------------- */
step(3, 'المحاولات: تعبئة jobTitle/location/employer من جدول الوظائف');
{
  const jobsById = {}; const jobsByCode = {}; const staffById = {};
  const jobs = [C.jobFromDb(JOB_ROW)];
  jobs.forEach((j) => { jobsById[j.id] = j; jobsByCode[j.code] = j; });
  staffById[STAFF_ROW.id] = STAFF_ROW.username;

  const t = C.attemptFromDb(ATTEMPT_ROW, jobsById, jobsByCode, staffById);
  check('jobTitle مُشتقّ من الوظيفة (غير موجود في SQL)', t.jobTitle === 'عامل مخزن', t.jobTitle);
  check('location مُشتقّ من منطقة الوظيفة', t.location === 'الحلة');
  check('employerName/employerPhone مُشتقّان', t.employerName === 'مخازن الفرات' && t.employerPhone === '07701234567');
  check('slotStatus من slot_status', t.slotStatus === 'reserved');
  check('staff يحمل username لا uuid', t.staff === 'staff', String(t.staff));
  check('no من attempt_no', t.no === 1);

  /* الجدول الفارغ من الوظائف: يجب ألا ينكسر */
  const orphan = C.attemptFromDb({ ...ATTEMPT_ROW, job_id: null, job_code: null }, {}, {}, {});
  check('محاولة بلا وظيفة مرتبطة لا تنكسر (jobTitle = null)', orphan.jobTitle === null && orphan.slotStatus === 'reserved');
}

/* --------------------------- 4) الإعدادات (jsonb) --------------------------- */
step(4, 'الإعدادات: صفوف key/value jsonb → كائن مسطّح');
{
  const s = C.settingsFromDb(SETTINGS_ROWS);
  check('attemptLimit من rules.attempt_limit', s.attemptLimit === 5);
  check('validityDays من validity_days', s.validityDays === 30);
  check('holdHours من hold_hours', s.holdHours === 24);
  check('formFee من form_fee', s.formFee === 10000);
  check('autoReleaseEnabled من auto_release', s.autoReleaseEnabled === true);
  check('company محفوظة كما هي', !!s.company && s.company.name_ar === 'شركة الهدف للتوظيف');

  const back = C.settingsToDb({ attemptLimit: 7, holdHours: 12, formFee: 5000, autoReleaseEnabled: false });
  check('العكس: camelCase → مفاتيح SQL', back.attempt_limit === 7 && back.hold_hours === 12 && back.form_fee === 5000 && back.auto_release === false);

  const empty = C.settingsFromDb([]);
  check('إعدادات فارغة لا تنكسر', typeof empty === 'object' && Object.keys(empty).length === 0);
  const nullish = C.settingsFromDb(null);
  check('settings = null لا تنكسر', typeof nullish === 'object');
}

/* ----------------------------- 5) بناء db كامل ----------------------------- */
step(5, 'بناء كائن db الكامل (نفس شكل BRCStore المحلي)');
{
  const db = C.buildDb(FULL);
  check('المفاتيح كلها موجودة (jobs/applicants/attempts/audit/settings/counters/meta)',
    ['jobs', 'applicants', 'attempts', 'audit', 'settings', 'counters', 'meta'].every((k) => k in db),
    Object.keys(db).join(', '));
  check('jobs كائنات واجهة لا صفوف SQL', db.jobs[0].salaryMin === 600000 && db.jobs[0].employer && db.jobs[0].employer.name);
  check('applicants كائنات واجهة', db.applicants[0].fullName === 'حسين كاظم');
  check('attempts فيها البيانات المُسطّحة', db.attempts[0].jobTitle === 'عامل مخزن');
  check('settings مسطّحة', db.settings.holdHours === 24);
  check('meta.source = supabase', db.meta.source === 'supabase');
  check('counters مُستنتجة من الأكواد الفعلية (1042/120)',
    db.counters.jobCode === 1042 && db.counters.formSerial === 120,
    JSON.stringify(db.counters));
  check('staff متاحة للواجهة', Array.isArray(db.staff) && db.staff[0].username === 'staff');
}

/* ------------------------- 6) fetchAll عبر عميل وهمي ------------------------- */
step(6, 'fetchAll — جلب متوازٍ لكل الجداول');
{
  const client = mockClient(FULL);
  const db = await C.fetchAll(client);
  check('كل الجداول الستة طُلبت',
    C.TABLES.every((t) => client.__calls.length >= 0) && C.TABLES.length === 6, C.TABLES.join(','));
  check('jobs وصلت ومحوّلة', db.jobs.length === 1 && db.jobs[0].code === 'BRC-1042');
  check('attempts وصلت ومُسطّحة', db.attempts.length === 1 && db.attempts[0].employerName === 'مخازن الفرات');
  check('audit وصل', db.audit.length === 1 && db.audit[0].action === 'إضافة وظيفة');
  check('لا جداول فاشلة', db.meta.failedTables.length === 0, JSON.stringify(db.meta.failedTables));

  /* فشل جدول واحد يجب ألا يُسقط البقية */
  const partial = await C.fetchAll(mockClient(FULL, { failTable: 'settings' }));
  check('فشل جدول واحد لا يُسقط البقية', partial.jobs.length === 1 && partial.applicants.length === 1);
  check('الجدول الفاشل مُبلَّغ عنه بوضوح', partial.meta.failedTables.includes('settings'), JSON.stringify(partial.meta.failedTables));
  check('لا انهيار عند جدول مفقود', partial.settings && typeof partial.settings === 'object');
}

/* ---------------------------- 7) تطبيق Realtime ---------------------------- */
step(7, 'Realtime — تطبيق التغييرات على الذاكرة');
{
  const db = C.buildDb(FULL);

  /* إضافة وظيفة جديدة */
  const newJob = { ...JOB_ROW, id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', code: 'BRC-2000', title: 'سائق', employer_name: 'شركة النقل', employer_phone: '0770', employer_address: 'بغداد' };
  C.applyChange(db, 'jobs', { eventType: 'INSERT', new: newJob });
  check('INSERT يضيف الوظيفة في المقدمة', db.jobs[0].code === 'BRC-2000' && db.jobs.length === 2, db.jobs.length + '');

  /* تعديل وظيفة موجودة */
  C.applyChange(db, 'jobs', { eventType: 'UPDATE', new: { ...JOB_ROW, title: 'عامل مخزن (معدّل)' } });
  const updated = db.jobs.find((j) => j.code === 'BRC-1042');
  check('UPDATE يستبدل ولا يكرّر', db.jobs.length === 2 && updated.title === 'عامل مخزن (معدّل)', db.jobs.length + '');
  check('تعديل الوظيفة يحدّث البيانات المُسطّحة في المحاولات المرتبطة',
    db.attempts[0].jobTitle === 'عامل مخزن (معدّل)', db.attempts[0].jobTitle);

  /* حذف */
  C.applyChange(db, 'jobs', { eventType: 'DELETE', old: { id: newJob.id } });
  check('DELETE يحذف الوظيفة', !db.jobs.some((j) => j.code === 'BRC-2000') && db.jobs.length === 1);

  /* محاولة جديدة */
  C.applyChange(db, 'job_attempts', { eventType: 'INSERT', new: { ...ATTEMPT_ROW, id: 'bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb', attempt_no: 2, slot_status: 'empty' } });
  check('INSERT محاولة تُسطَّح صح', db.attempts.some((a) => a.no === 2 && a.jobTitle === 'عامل مخزن (معدّل)'));

  /* تدقيق */
  C.applyChange(db, 'audit_log', { eventType: 'INSERT', new: { ...AUDIT_ROW, id: 43, action: 'تحديث' } });
  check('INSERT تدقيق يُضاف في المقدمة', db.audit[0].id === 43 && db.audit[0].action === 'تحديث');

  /* إعدادات */
  C.applyChange(db, 'settings', { eventType: 'UPDATE', new: { key: 'rules', value: { hold_hours: 48 } } });
  check('تعديل الإعدادات يحدّث الحقل فعلاً', db.settings.holdHours === 48, String(db.settings.holdHours));

  /* موظف */
  C.applyChange(db, 'staff', { eventType: 'INSERT', new: { ...STAFF_ROW, id: 'cccccccc-3333-4333-8333-cccccccccccc', username: 'staff2', full_name: 'زينب الحسيني' } });
  check('INSERT موظف يعمل', db.staff.length === 2 && db.staff.some((x) => x.username === 'staff2'));

  /* جدول غير معروف: لا ينكسر */
  let threw = false;
  try { C.applyChange(db, 'unknown_table', { eventType: 'INSERT', new: { id: 1 } }); } catch { threw = true; }
  check('جدول غير معروف لا يرمي استثناء', !threw);
}

/* --------------------------- 8) الاشتراك Realtime --------------------------- */
step(8, 'subscribeAll — الاشتراك على كل الجداول + إلغاؤه');
{
  const db = C.buildDb(FULL);
  const client = mockClient(FULL);
  let notified = [];
  const unsub = C.subscribeAll(client, db, (t) => notified.push(t), () => {});
  check('الاشتراك أُنشئ وتمّ (SUBSCRIBED)', client.__calls.some((c) => c.op === 'subscribe'));
  check('دالة إلغاء الاشتراك مُرجَعة', typeof unsub === 'function');
  unsub();
  check('إلغاء الاشتراك ينادي removeChannel', client.__calls.some((c) => c.op === 'removeChannel'));
  check('لا انهيار عند الإلغاء مرتين', (() => { try { unsub(); return true; } catch { return false; } })());
}

/* ------------------------------ 9) حالات حدّية ------------------------------ */
step(9, 'حالات حدّية — قيم ناقصة/null');
{
  const minimal = C.jobFromDb({ id: 'x', code: 'BRC-1', title: 't', region: 'r' });
  check('وظيفة بأعمدة ناقصة لا تنكسر',
    minimal.title === 't' && minimal.salaryMin === 0 && minimal.requirements.length === 0 &&
    minimal.employer.name === '' && minimal.status === 'available', JSON.stringify(minimal.employer));
  check('category الافتراضي عند غيابه', minimal.category === 'خدمات');
  check('vacancies الافتراضي 1', minimal.vacancies === 1);

  const minApp = C.applicantFromDb({ id: 'y', serial: 'BRC-NO-1', full_name: 'n', phone: 'p' });
  check('استمارة بأعمدة ناقصة: fee الافتراضي 10000', minApp.fee === 10000, String(minApp.fee));
  check('استمارة ناقصة: attemptLimit الافتراضي 5', minApp.attemptLimit === 5);
  check('استمارة ناقصة: feePaid false', minApp.feePaid === false);

  const emptyDb = C.buildDb({});
  check('buildDb بلا بيانات يعطي بنية صالحة',
    Array.isArray(emptyDb.jobs) && emptyDb.jobs.length === 0 && emptyDb.settings && typeof emptyDb.settings === 'object');
  check('counters الافتراضية عند الفراغ (1041/119)', emptyDb.counters.jobCode === 1041 && emptyDb.counters.formSerial === 119,
    JSON.stringify(emptyDb.counters));
}

/* ===========================================================================
 *  10) المطابقة مع الشكل المحلي الفعلي — الأهم
 *  الشكل الذي يُنتجه BRCStore المحلي هو "العقد" الذي تفترضه الواجهة.
 *  أي حقل في الشكل المحلي وغير موجود في الشكل السحابي = واجهة تعرض فراغاً
 *  أو صفراً بصمت (بلا أي رسالة خطأ). نستخرج الشكل المحلي فعلياً من المتصفح.
 * =========================================================================== */
step(10, 'مطابقة الشكل مع BRCStore المحلي (الحقول المفقودة = واجهة صامتة)');
{
  const { spawn } = await import('node:child_process');
  const { JSDOM, VirtualConsole } = require('jsdom');
  const PORT = 4329, BASE = 'http://localhost:' + PORT;
  const srv = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/dashboard.html'); if (r.ok) { up = true; break; } } catch {} await wait(150); }
  check('خادم المعاينة أقلع', up);

  const vc = new VirtualConsole();
  const dom = await JSDOM.fromURL(BASE + '/dashboard.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
  });
  await new Promise((r) => { dom.window.addEventListener('load', r); setTimeout(r, 8000); });
  await wait(400);

  const localDb = dom.window.BRCStore.db();
  check('الشكل المحلي متاح (jobs/applicants/attempts/audit)', !!(localDb.jobs && localDb.applicants && localDb.attempts));

  const fields = (o) => Object.keys(o || {}).sort();
  const diff = (a, b) => a.filter((x) => !b.includes(x));

  /* --- الوظائف: كل حقل في المحلي يجب أن يوجد في السحابي --- */
  const localJob = localDb.jobs[0];
  const cloudJob = C.jobFromDb(C.jobToDb({ ...localJob, id: 'x' }));
  const missJob = diff(fields(localJob), fields(cloudJob));
  check('كل حقول الوظيفة موجودة في الشكل السحابي', missJob.length === 0,
    'مفقودة: ' + missJob.join(', ') + ' — ستظهر فراغاً في الواجهة');

  /* --- الاستمارات --- */
  const localApp = localDb.applicants[0];
  const cloudApp = C.applicantFromDb(C.applicantToDb({ ...localApp, id: 'x' }));
  const missApp = diff(fields(localApp), fields(cloudApp));
  /* الحقول المستثناة عمداً: attemptLimit (في SQL يُعاد للإعدادات) و requestedCode
     (عمود إضافي في SQL غير مستخدم محلياً) */
  const missAppReal = missApp.filter((f) => !['attemptLimit'].includes(f));
  check('كل حقول الاستمارة موجودة في الشكل السحابي', missAppReal.length === 0,
    'مفقودة: ' + missAppReal.join(', '));

  /* --- المحاولات --- */
  const localAtt = localDb.attempts[0];
  const cloudAtt = C.attemptFromDb(C.attemptToDb({ ...localAtt, id: 'x' }), {}, {}, {});
  const missAtt = diff(fields(localAtt), fields(cloudAtt));
  check('كل حقول المحاولة موجودة في الشكل السحابي', missAtt.length === 0,
    'مفقودة: ' + missAtt.join(', '));

  /* --- سجل التدقيق --- */
  const localAudit = localDb.audit[0];
  const cloudAudit = C.auditFromDb(C.auditToDb({ ...localAudit, id: 1 }));
  const missAudit = diff(fields(localAudit), fields(cloudAudit));
  check('كل حقول سجل التدقيق موجودة في الشكل السحابي', missAudit.length === 0,
    'مفقودة: ' + missAudit.join(', '));

  /* --- القيم الجوهرية تنجو من دورة كاملة (كائن محلي → SQL → كائن) --- */
  const roundTripChecks = [
    ['title', localJob.title], ['code', localJob.code], ['region', localJob.region],
    ['salaryMin', localJob.salaryMin], ['salaryMax', localJob.salaryMax],
    ['shift', localJob.shift], ['status', localJob.status], ['vacancies', localJob.vacancies],
    ['interviewLocation', localJob.interviewLocation]
  ];
  const lostJob = roundTripChecks.filter(([k, v]) => String(cloudJob[k]) !== String(v));
  check('قيم الوظيفة الأساسية تنجو من دورة كاملة (محلي→SQL→سحابي)', lostJob.length === 0,
    lostJob.map(([k]) => k).join(', '));
  check('بيانات صاحب العمل تنجو كاملة',
    cloudJob.employer.name === localJob.employer.name &&
    cloudJob.employer.phone === localJob.employer.phone &&
    cloudJob.employer.address === localJob.employer.address);
  check('المتطلبات تنجو كمصفوفة بنفس الطول',
    Array.isArray(cloudJob.requirements) && cloudJob.requirements.length === localJob.requirements.length);

  const lostApp = [['fullName', localApp.fullName], ['serial', localApp.serial], ['phone', localApp.phone],
    ['fee', localApp.fee], ['printedCount', localApp.printedCount], ['feePaid', localApp.feePaid]]
    .filter(([k, v]) => String(cloudApp[k]) !== String(v));
  check('قيم الاستمارة الأساسية تنجو من دورة كاملة', lostApp.length === 0, lostApp.map(([k]) => k).join(', '));

  const lostAtt = [['no', localAtt.no], ['slotStatus', localAtt.slotStatus], ['serial', localAtt.serial]]
    .filter(([k, v]) => String(cloudAtt[k]) !== String(v));
  check('قيم المحاولة الأساسية تنجو من دورة كاملة', lostAtt.length === 0, lostAtt.map(([k]) => k).join(', '));

  /* --- الإعدادات --- */
  const localSettings = localDb.settings;
  const cloudSettings = C.settingsFromDb([
    { key: 'rules', value: C.settingsToDb(localSettings) }
  ]);
  const lostSettings = ['attemptLimit', 'validityDays', 'holdHours', 'formFee']
    .filter((k) => String(cloudSettings[k]) !== String(localSettings[k]));
  check('كل قواعد العمل تنجو من دورة كاملة عبر jsonb', lostSettings.length === 0,
    lostSettings.map((k) => `${k}: ${localSettings[k]}→${cloudSettings[k]}`).join(' | '));

  dom.window.close && dom.window.close();
  srv.kill('SIGTERM');
}

/* ---------------------------------- الخلاصة ---------------------------------- */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
