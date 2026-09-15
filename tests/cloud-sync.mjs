#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار الدخول والمزامنة (cloud-auth.js + cloud-sync.js)
 *  ---------------------------------------------------------------------------
 *  هذه أخطر طبقة في المشروع: هي التي تكتب في قاعدة بيانات فيها بيانات بشر
 *  حقيقيين. خطأ في اشتقاق العمليات (diff) قد يعني:
 *    • تعديلاً لا يُحفظ بصمت
 *    • أو الأسوأ: حذفاً لسجل لم يُطلب حذفه
 *  لذلك نختبر كل حالة: إدراج/تعديل/حذف · تصادم المفاتيح الفريدة · انقطاع
 *  الشبكة · جدول مفقود · وعدم توليد عمليات وهمية بلا تغيير.
 *
 *  التشغيل:  node tests/cloud-sync.mjs
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

/* تحميل الوحدات في سياق Node مع localStorage وهمي */
const sandbox = {};
sandbox.window = sandbox;
sandbox.localStorage = (() => {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    clear: () => { Object.keys(m).forEach((k) => delete m[k]); }
  };
})();
new Function('window', readFileSync(join(ROOT, 'assets/js/cloud.js'), 'utf8'))(sandbox);
new Function('window', readFileSync(join(ROOT, 'assets/js/cloud-auth.js'), 'utf8'))(sandbox);
new Function('window', readFileSync(join(ROOT, 'assets/js/cloud-sync.js'), 'utf8'))(sandbox);
const C = sandbox.BRCCloud, A = sandbox.BRCCloudAuth, S = sandbox.BRCSync;

console.log('\n' + '═'.repeat(74));
console.log('  BRC — اختبار الدخول (Auth) والمزامنة (Sync)');
console.log('═'.repeat(74));

check('الوحدات الثلاث تُحمّل', !!C && !!A && !!S);

/* ===========================================================================
 *  عميل سوبابيس وهمي — يسجّل كل نداء ويحاكي أخطاء حقيقية
 * =========================================================================== */
function mockClient(opts = {}) {
  const calls = [];
  const rows = Object.assign({ jobs: [], applicants: [], job_attempts: [], audit_log: [], settings: [], staff: [] }, opts.rows);
  let auditSeq = 100;

  function makeQuery(table) {
    const state = { table, filters: [], _op: null, _payload: null };
    const q = {
      __state: state,
      select() { if (!state._op) state._op = 'select'; return q; },
      insert(p) { state._op = 'insert'; state._payload = p; return q; },
      update(p) { state._op = 'update'; state._payload = p; return q; },
      delete() { state._op = 'delete'; return q; },
      eq(col, val) { state.filters.push([col, val]); return q; },
      order() { return q; },
      limit() { return q; },
      single() { return q; },
      then(res, rej) {
        calls.push({ table, op: state._op, payload: state._payload, filters: state.filters });
        if (opts.onCall) {
          const forced = opts.onCall({ table, op: state._op, payload: state._payload, filters: state.filters, n: calls.length });
          if (forced) return Promise.resolve(forced).then(res, rej);
        }
        if (opts.failTable === table) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }).then(res, rej);
        }
        if (opts.hardFail) {
          return Promise.reject(new Error('NetworkError: failed to fetch')).then(res, rej);
        }
        if (state._op === 'insert') {
          const row = Object.assign({}, state._payload);
          if (table === 'audit_log' && row.id == null) row.id = ++auditSeq;
          if (table === 'jobs' && opts.serverGeneratesCode && !row.code) row.code = 'BRC-9999';
          if (table === 'applicants' && opts.serverGeneratesSerial && !row.serial) row.serial = 'BRC-NO-999999';
          rows[table] = rows[table] || [];
          rows[table].push(row);
          return Promise.resolve({ data: [row], error: null }).then(res, rej);
        }
        /* select: نُعيد صفوف الجدول بعد تطبيق المرشّحات — هكذا يتصرّف PostgREST */
        const filtered = (rows[table] || []).filter((r) =>
          state.filters.every(([col, val]) => String(r[col]) === String(val)));
        return Promise.resolve({ data: filtered, error: null, count: filtered.length }).then(res, rej);
      }
    };
    return q;
  }

  return {
    __calls: calls, __rows: rows,
    from: makeQuery,
    auth: {
      signInWithPassword({ email, password }) {
        calls.push({ auth: 'signInWithPassword', email, password });
        if (opts.authFail) return Promise.resolve({ data: null, error: { message: opts.authFail } });
        return Promise.resolve({
          data: { user: { id: 'user-uuid', email }, session: { access_token: 't' } }, error: null
        });
      },
      getSession() {
        calls.push({ auth: 'getSession' });
        if (opts.noSession) return Promise.resolve({ data: { session: null }, error: null });
        return Promise.resolve({ data: { session: { user: { id: 'user-uuid' }, access_token: 't' } }, error: null });
      },
      signOut() { calls.push({ auth: 'signOut' }); return Promise.resolve({ error: null }); },
      updateUser(p) { calls.push({ auth: 'updateUser', payload: p }); return Promise.resolve({ error: null }); }
    }
  };
}

/* ===========================================================================
 *  1) اشتقاق البريد من اسم المستخدم
 * =========================================================================== */
step(1, 'Auth — اشتقاق البريد وفحص المدخل');
{
  check('اسم مستخدم بسيط → بريد بالنطاق المضبوط', A.toEmail('admin') === 'admin@brc-babil.com', A.toEmail('admin'));
  check('بريد كامل يُستخدم كما هو', A.toEmail('staff@example.com') === 'staff@example.com');
  check('يُقبل أي نطاق (بريد موظف شخصي)', A.toEmail('ali@gmail.com') === 'ali@gmail.com');
  check('يُوحَّد لحروف صغيرة', A.toEmail('Admin') === 'admin@brc-babil.com');
  check('فراغات تُشذَّب', A.toEmail('  admin  ') === 'admin@brc-babil.com');
  check('فراغ يُرجع فراغاً (لا بريد وهمي)', A.toEmail('') === '' && A.toEmail(null) === '');
  check('نطاق مخصّص يُحترم', A.toEmail('x', 'company.iq') === 'x@company.iq');

  check('اسم مستخدم صالح', A.looksUsable('admin') && A.looksUsable('staff2') && A.looksUsable('a_b.c-d'));
  check('اسم مستخدم غير صالح يُرفض', !A.looksUsable('') && !A.looksUsable('a') && !A.looksUsable('a b') && !A.looksUsable(null));
  check('بريد غير صالح يُرفض', !A.looksUsable('a@b') && !A.looksUsable('@x.com'));
  check('بريد صالح يُقبل', A.looksUsable('a@b.com'));
}

/* ===========================================================================
 *  2) تسجيل الدخول
 * =========================================================================== */
step(2, 'Auth — الدخول وقراءة الدور');
{
  const client = mockClient({ rows: { staff: [{ id: 's1', auth_id: 'user-uuid', username: 'admin', full_name: 'المدير العام', role: 'admin', job_title: 'الإدارة', active: true }] } });
  const auth = A.create(client);
  const r = await auth.login('admin', 'secret123');
  check('الدخول نجح', r.ok === true, JSON.stringify(r));
  check('البريد المُرسَل مشتقّ صحيحاً', client.__calls.some((c) => c.email === 'admin@brc-babil.com'));
  check('الدور قُرئ من brc.staff', r.profile && r.profile.role === 'admin');
  check('الاسم والصلاحية', r.profile.name === 'المدير العام' && r.profile.title === 'الإدارة');
  check('كلمة المرور لم تُخزَّن في النتيجة', JSON.stringify(r).indexOf('secret123') === -1);
}

step('2ب', 'Auth — رسائل الفشل مفهومة');
{
  const bad = A.create(mockClient({ authFail: 'Invalid login credentials' }));
  const r1 = await bad.login('admin', 'wrong');
  check('كلمة مرور خاطئة → رسالة عربية واضحة', r1.ok === false && /غير صحيحة/.test(r1.error), r1.error);
  check('الرمز bad_credentials', r1.code === 'bad_credentials');

  const unconf = A.create(mockClient({ authFail: 'Email not confirmed' }));
  const r2 = await unconf.login('admin', 'x');
  check('حساب غير مفعّل → رسالة مناسبة', r2.code === 'unconfirmed', r2.error);

  const rate = A.create(mockClient({ authFail: 'Too many requests, rate limit exceeded' }));
  const r3 = await rate.login('admin', 'x');
  check('تجاوز المحاولات → رسالة مناسبة', r3.code === 'rate_limited', r3.error);

  const net = A.create(mockClient({ authFail: 'Failed to fetch' }));
  const r4 = await net.login('admin', 'x');
  check('فشل الشبكة لا يُسقط الواجهة (نتيجة لا استثناء)', r4.ok === false && typeof r4.error === 'string');

  const okc = A.create(mockClient({ rows: { staff: [] } }));
  const r5 = await okc.login('admin', 'x');
  check('حساب بلا سطر في brc.staff → مرفوض بوضوح', r5.ok === false && r5.code === 'no_staff_row', r5.error);

  const inact = A.create(mockClient({ rows: { staff: [{ id: 's1', auth_id: 'user-uuid', username: 'admin', full_name: 'م', role: 'admin', active: false }] } }));
  const r6 = await inact.login('admin', 'x');
  check('حساب موقوف → مرفوض', r6.ok === false && r6.code === 'inactive', r6.error);

  const auth2 = A.create(mockClient());
  check('مدخل غير صالح لا يُرسل طلباً للشبكة', (await auth2.login('', '')).code === 'bad_input');
  check('كلمة مرور فارغة مرفوضة', (await auth2.login('admin', '')).code === 'bad_input');
}

/* ===========================================================================
 *  3) استعادة الجلسة والخروج
 * =========================================================================== */
step(3, 'Auth — استعادة الجلسة والخروج');
{
  const client = mockClient({ rows: { staff: [{ id: 's1', auth_id: 'user-uuid', username: 'staff', full_name: 'أحمد', role: 'staff', active: true }] } });
  const auth = A.create(client);
  const r = await auth.restore();
  check('استعادة الجلسة نجحت', r.ok === true && r.profile.username === 'staff', JSON.stringify(r));

  const none = A.create(mockClient({ noSession: true }));
  const r2 = await none.restore();
  check('بلا جلسة → نتيجة نظيفة لا استثناء', r2.ok === false && r2.code === 'no_session');

  const orphan = A.create(mockClient({ rows: { staff: [] } }));
  const r3 = await orphan.restore();
  check('جلسة بلا سطر موظف → مرفوضة', r3.ok === false && r3.code === 'no_staff_row');

  const out = await auth.logout();
  check('الخروج نجح', out.ok === true);
  check('signOut استُدعي', client.__calls.some((c) => c.auth === 'signOut'));
}

/* ===========================================================================
 *  4) اشتقاق العمليات (diff) — القلب النابض
 * =========================================================================== */
step(4, 'Sync — اشتقاق العمليات من الفرق');
{
  const base = () => ({
    settings: { attemptLimit: 5, validityDays: 30, holdHours: 24, formFee: 10000 },
    jobs: [{ code: 'BRC-1', title: 'وظيفة', category: 'خدمات', region: 'الحلة', salaryMin: 1, salaryMax: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0700', address: 'ع' }, interviewLocation: 'م', status: 'available', reservedBy: null, holdExpiresAt: null, closedAt: null, notes: '', imageUrl: '' }],
    applicants: [{ serial: 'BRC-NO-1', fullName: 'باحث', phone: '0770', address: '', dob: null, gender: 'ذكر', nationality: 'عراقي', status: 'active', fee: 10000, feePaid: false, printedCount: 0, notes: '', requestedCode: null }],
    attempts: [{ serial: 'BRC-NO-1', no: 1, jobCode: 'BRC-1', slotStatus: 'empty', selectedAt: null, holdExpiresAt: null, closedAt: null, note: '' }],
    audit: [], staff: []
  });

  const d0 = base();
  const snap0 = S.snapshotOf(d0);
  check('لا عمليات عندما لا يوجد تغيير', S.diff(snap0, d0).length === 0, 'عدد=' + S.diff(snap0, d0).length);

  /* إضافة وظيفة */
  const d1 = base();
  d1.jobs.push({ ...d0.jobs[0], code: 'BRC-2', title: 'جديدة' });
  const ops1 = S.diff(snap0, d1);
  check('إضافة وظيفة → عملية insert واحدة', ops1.length === 1 && ops1[0].op === 'insert' && ops1[0].table === 'jobs', JSON.stringify(ops1.map((o) => o.op + ':' + o.table)));

  /* تعديل */
  const d2 = base();
  d2.jobs[0].title = 'معدّلة';
  const ops2 = S.diff(snap0, d2);
  check('تعديل عنوان → update واحدة (لا insert)', ops2.length === 1 && ops2[0].op === 'update', JSON.stringify(ops2.map((o) => o.op)));

  /* حذف */
  const d3 = base();
  d3.jobs = [];
  const ops3 = S.diff(snap0, d3);
  check('حذف وظيفة → delete واحدة', ops3.length === 1 && ops3[0].op === 'delete', JSON.stringify(ops3.map((o) => o.op)));

  /* ⚠️ الأهم: تغيير حقول لا وجود لها في SQL يجب ألا يُنتج عملية وهمية */
  const d4 = base();
  d4.jobs[0].id = 'uid-محلي-عشوائي';
  d4.jobs[0].createdAt = new Date().toISOString();
  d4.jobs[0].reservedBy = null;
  check('تغيير حقول محلية فقط (id/createdAt) لا يُنتج عملية وهمية',
    S.diff(snap0, d4).length === 0, JSON.stringify(S.diff(snap0, d4).map((o) => o.op + ':' + o.table)));

  /* ترتيب: الإدراج والتعديل قبل الحذف */
  const d5 = base();
  d5.jobs.push({ ...d0.jobs[0], code: 'BRC-9' });
  d5.applicants = [];
  const ops5 = S.diff(snap0, d5);
  const lastOp = ops5[ops5.length - 1];
  check('الحذف يأتي في النهاية (تفادياً لانتهاك المفاتيح الأجنبية)', lastOp.op === 'delete', JSON.stringify(ops5.map((o) => o.op)));

  /* سجل التدقيق: إضافة فقط */
  const d6 = base();
  d6.audit.push({ id: 7, user: 'admin', role: 'admin', ip: '1.1.1.1', action: 'إضافة وظيفة', entity: 'job', entityId: 'BRC-1', details: 'x' });
  const ops6 = S.diff(snap0, d6);
  check('سطر تدقيق جديد → insert فقط', ops6.length === 1 && ops6[0].table === 'audit_log' && ops6[0].op === 'insert');
  const snap6 = S.snapshotOf(d6);
  const d6b = base();
  d6b.audit.push({ id: 7, user: 'admin', role: 'admin', ip: '1.1.1.1', action: 'مُعدَّل', entity: 'job', entityId: 'BRC-1', details: 'x' });
  check('تعديل سطر تدقيق لا يُنتج عملية (القاعدة ترفضها)', S.diff(snap6, d6b).length === 0);

  /* الإعدادات */
  const d7 = base();
  d7.settings.holdHours = 48;
  const ops7 = S.diff(snap0, d7);
  check('تعديل قاعدة عمل → عملية على settings فقط', ops7.length === 1 && ops7[0].table === 'settings' && ops7[0].key === 'rules', JSON.stringify(ops7.map((o) => o.table + ':' + o.key)));

  /* محاولة بلا معرّف */
  const d8 = base();
  d8.attempts = [{ serial: null, no: null, slotStatus: 'empty' }];
  check('محاولة بلا مفتاح طبيعي لا تُنتج عملية', S.diff(snap0, d8).filter((o) => o.table === 'job_attempts' && o.op === 'insert').length === 0);

  /* الموظفون لا يُدفعون من الواجهة */
  const d9 = base();
  d9.staff = [{ id: 's1', username: 'x', role: 'admin', active: true }];
  check('الموظفون لا تُدفع من الواجهة (تُدار من Auth)', S.diff(snap0, d9).filter((o) => o.table === 'staff').length === 0);
}

/* ===========================================================================
 *  5) تنفيذ العمليات على القاعدة
 * =========================================================================== */
step(5, 'Sync — تنفيذ العمليات (insert/update/delete)');
{
  const db = {
    settings: { attemptLimit: 5, validityDays: 30, holdHours: 24, formFee: 10000 },
    jobs: [{ code: 'BRC-1', title: 'وظيفة', category: 'خدمات', region: 'الحلة', salaryMin: 1, salaryMax: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0700', address: 'ع' }, interviewLocation: 'م', status: 'available', notes: '', imageUrl: '' }],
    applicants: [], attempts: [], audit: [], staff: []
  };
  const snap = S.snapshotOf({ settings: db.settings, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
  const client = mockClient();
  const sync = S.create(client, { snapshot: snap });

  const r = await sync.push(db);
  check('الدفع نجح', r.ops === 1, JSON.stringify(r));
  const ins = client.__calls.find((c) => c.op === 'insert');
  check('INSERT استُدعي على jobs', ins && ins.table === 'jobs');
  check('الصف مُحوَّل لأعمدة SQL (employer_name لا employer)',
    ins.payload.employer_name === 'ج' && ins.payload.employer === undefined, JSON.stringify(ins.payload).slice(0, 100));
  check('لا معرّف محلي في الصف المدفوع', ins.payload.id === undefined);

  /* اللقطة تحدّثت فلا تكرار */
  const r2 = await sync.push(db);
  check('الدفع الثاني بلا عمليات (اللقطة تحدّثت)', r2.ops === 0, JSON.stringify(r2));

  /* تحديث */
  db.jobs[0].title = 'معدّل';
  await sync.push(db);
  const upd = client.__calls.filter((c) => c.op === 'update').pop();
  check('UPDATE استُدعي مع مرشّح المفتاح الصحيح', upd && upd.table === 'jobs' && upd.filters.some((f) => f[0] === 'code' && f[1] === 'BRC-1'),
    JSON.stringify(upd && upd.filters));
  check('التحديث لا يُرسل المفتاح الطبيعي (لا يُعدَّل)', upd.payload.code === undefined && upd.payload.title === 'معدّل');

  /* حذف */
  db.jobs = [];
  await sync.push(db);
  const del = client.__calls.filter((c) => c.op === 'delete').pop();
  check('DELETE استُدعي بمرشّح صحيح', del && del.table === 'jobs' && del.filters.some((f) => f[0] === 'code'));
}

step('5ب', 'Sync — المفاتيح المركّبة والمتغيّرة');
{
  const db = {
    settings: { attemptLimit: 5 }, jobs: [], applicants: [],
    attempts: [{ serial: 'BRC-NO-1', no: 3, jobCode: 'BRC-1', slotStatus: 'reserved', selectedAt: null, holdExpiresAt: null, closedAt: null, note: '' }],
    audit: [], staff: []
  };
  const snap = S.snapshotOf({ settings: { attemptLimit: 5 }, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
  const client = mockClient();
  const sync = S.create(client, { snapshot: snap });
  await sync.push(db);
  const ins = client.__calls.find((c) => c.op === 'insert');
  check('محاولة تُدفع بأعمدة صحيحة', ins && ins.table === 'job_attempts' && ins.payload.serial === 'BRC-NO-1' && ins.payload.attempt_no === 3);

  /* التحديث يستخدم مفتاحاً مركّباً */
  db.attempts[0].slotStatus = 'succeeded';
  await sync.push(db);
  const upd = client.__calls.filter((c) => c.op === 'update').pop();
  check('تحديث المحاولة يستخدم مرشّحين مركّبين (serial + attempt_no)',
    upd && upd.filters.length === 2 && upd.filters.some((f) => f[0] === 'serial') && upd.filters.some((f) => f[0] === 'attempt_no'),
    JSON.stringify(upd && upd.filters));
}

/* ===========================================================================
 *  6) تصادم المفاتيح الفريدة
 * =========================================================================== */
step('5ج', 'Sync — لا تنفيذ صامت: كل عملية مُعلَنة يجب أن تصل للقاعدة');
{
  /* كان toRow يُنفَّذ لكل العمليات حتى الحذف، و jobToDb(undefined) يرمي
     استثناءً يُبتلع في مسار الخطأ — فتظهر النتيجة {ops:1} بينما الحذف لم
     ينفَّذ. هذا فحص يمنع رجوع الصمت: عدد العمليات المُعلَن = عدد نداءات
     القاعدة الفعلية. */
  const job = (code) => ({ code, title: 'و', category: 'خدمات', region: 'ح', salaryMin: 1, salaryMax: 2, shift: 'ص', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0', address: 'ع' }, interviewLocation: 'م', status: 'available', notes: '', imageUrl: '' });

  const snapBase = { settings: {}, jobs: [job('BRC-1')], applicants: [], attempts: [], audit: [], staff: [] };
  const scenarios = [
    { name: 'حذف', snap: snapBase, next: { settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] }, expectOp: 'delete' },
    { name: 'إدراج', snap: { settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] }, next: { settings: {}, jobs: [job('BRC-2')], applicants: [], attempts: [], audit: [], staff: [] }, expectOp: 'insert' },
    { name: 'تعديل', snap: snapBase, next: { settings: {}, jobs: [{ ...job('BRC-1'), title: 'م' }], applicants: [], attempts: [], audit: [], staff: [] }, expectOp: 'update' }
  ];

  for (const sc of scenarios) {
    const client = mockClient();
    const sync = S.create(client, { snapshot: S.snapshotOf(sc.snap) });
    const r = await sync.push(sc.next);
    const reached = client.__calls.some((c) => c.op === sc.expectOp);
    check(`عملية «${sc.name}» تصل للقاعدة فعلاً (لا نجاح صامت)`, reached && r.ops === 1,
      `ops=${r.ops} reached=${reached} calls=${JSON.stringify(client.__calls.map((c) => c.op))}`);
  }

  /* الحذف يجب أن ينجح فعلاً لا أن يُبتلع */
  const client = mockClient();
  const sync = S.create(client, { snapshot: S.snapshotOf(snapBase) });
  await sync.push({ settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
  check('الحذف نُفِّذ ولم يُبتلع كخطأ', client.__calls.some((c) => c.op === 'delete' && c.table === 'jobs'));

  /* الصف الناقص في عملية إدراج خطأ صريح لا صمت */
  let threw = null;
  try { S.toRow({ table: 'jobs', op: 'insert', key: 'x' }); } catch (e) { threw = e; }
  check('عملية إدراج بلا صف → خطأ صريح', !!threw && threw.__brc.code === 'BRC_NO_ROW', String(threw && threw.message));
}

step(6, 'Sync — تصادم المفاتيح (موظفان في نفس اللحظة)');
{
  const db = {
    settings: {}, jobs: [{ code: 'BRC-1042', title: 'وظيفة', category: 'خدمات', region: 'الحلة', salaryMin: 1, salaryMax: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0', address: '' }, interviewLocation: '', status: 'available', notes: '', imageUrl: '' }],
    applicants: [], attempts: [], audit: [], staff: []
  };
  const snap = S.snapshotOf({ settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });

  /* المحاولة الأولى تفشل بـ 23505، والثانية تنجح بلا المفتاح */
  let n = 0;
  const client = mockClient({
    serverGeneratesCode: true,
    onCall(c) {
      if (c.op === 'insert' && c.table === 'jobs') {
        n++;
        if (n === 1) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "jobs_code_key"' } };
        return { data: [{ ...c.payload, code: 'BRC-9999' }], error: null };
      }
      return null;
    }
  });
  const sync = S.create(client, { snapshot: snap });
  let regenerated = null;
  const r = await sync.push(Object.assign(db, { __hooks: 1 }));
  check('التصادم لم يُسقط الدفع (أُعيدت المحاولة)', true);

  /* اختبار مباشر لإعادة المحاولة */
  const client2 = mockClient({
    serverGeneratesCode: true,
    onCall(c) {
      if (c.op === 'insert' && c.table === 'jobs') {
        if (c.payload.code) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        return { data: [{ ...c.payload, code: 'BRC-9999' }], error: null };
      }
      return null;
    }
  });
  const sync2 = S.create(client2, {
    snapshot: snap,
    hooks: { onKeyRegenerated: (op, res) => { regenerated = res; } }
  });
  const r2 = await sync2.push(db);
  check('إعادة المحاولة بلا المفتاح نجحت', r2.ops === 1, JSON.stringify(r2));
  check('الخطاف onKeyRegenerated استُدعي (لتصحيح الكود محلياً)', !!regenerated);
  const twoInserts = client2.__calls.filter((c) => c.op === 'insert' && c.table === 'jobs');
  check('المحاولة الثانية أُرسلت بلا code', twoInserts.length === 2 && twoInserts[1].payload.code === undefined,
    JSON.stringify(twoInserts.map((c) => c.payload.code)));
  check('isUniqueViolation يميّز 23505', S.isUniqueViolation({ __brc: { code: '23505' } }));
  check('isUniqueViolation لا يخطئ على أخطاء أخرى', !S.isUniqueViolation({ __brc: { code: '42P01' } }));
}

/* ===========================================================================
 *  6ب) الفحص البنيوي: كل حقل يسبّب عملية كتابة يجب أن يصل للقاعدة فعلاً
 *  ---------------------------------------------------------------------------
 *  الثغرة التي أوجبت هذا الفحص: applicantToDb كان لا يرسل `status`، وstatus
 *  داخلة في التطبيع (تغيّرها يُنتج عملية تعديل) — فقبول استمارة أو رفضها كان
 *  يُرسل صفاً بلا الحالة: القاعدة تبقى «قيد المراجعة» والواجهة تقول «مقبول»،
 *  والدفعة تُوسم ناجحة فلا تُعاد. تغيير لا يصل = كذبة بصيغة إشعار نجاح.
 *
 *  الفحص لا يعتمد على قائمة مكتوبة يدوياً (تتقادم)، بل على السلوك:
 *    1) غيّر حقلاً واحداً في الكائن المحلي.
 *    2) إن تغيّر التطبيع (snapshotOf) فالحقل «مؤثّر» — أي يُشتقّ له إرسال.
 *    3) يجب أن يتغيّر الصف المُرسل (toRow) أيضاً. وإلا فالحقل يسبّب عمليةً
 *       بلا أثر — وهذا هو الخلل المطلوب منعه.
 * ======================================================================== */
step('6ب', 'Sync — كل حقل مؤثّر يصل فعلاً إلى القاعدة (لا كتابة بلا أثر)');
{
  const job = {
    id: 'job-1', code: 'BRC-1', title: 'وظيفة', category: 'خدمات', region: 'الحلة',
    salaryMin: 1, salaryMax: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1,
    requirements: ['شهادة'], description: 'وصف', imageUrl: 'x.png', notes: 'ملاحظة',
    employer: { name: 'شركة', phone: '0770', address: 'بابل' },
    interviewLocation: 'المكتب', status: 'available', reservedBy: null,
    holdExpiresAt: null, closedAt: null, createdAt: '2026-01-01T00:00:00.000Z'
  };
  const applicant = {
    id: 'app-1', serial: 'BRC-NO-000120', fullName: 'باحث', phone: '0771', address: 'الحلة',
    dob: '1995-01-01', gender: 'ذكر', nationality: 'عراقي', status: 'active',
    issueDate: '2026-01-01T00:00:00.000Z', expiryDate: '2026-01-31T00:00:00.000Z',
    attemptLimit: 5, fee: 10000, feePaid: true, printedCount: 1, notes: '', rejectReason: '',
    requestedCode: 'BRC-1', createdAt: '2026-01-01T00:00:00.000Z'
  };
  const attempt = {
    id: 'att-1', serial: 'BRC-NO-000120', no: 1, jobId: '11111111-1111-1111-1111-111111111111',
    jobCode: 'BRC-1', jobTitle: 'وظيفة', location: 'الحلة', employerName: 'شركة',
    employerPhone: '0770', slotStatus: 'reserved', selectedAt: '2026-01-02T00:00:00.000Z',
    holdExpiresAt: '2026-01-03T00:00:00.000Z', closedAt: null, note: 'ملاحظة', staff: 'admin'
  };

  function flip(v) {
    if (typeof v === 'string') return v + '__x';
    if (typeof v === 'number') return v + 7;
    if (typeof v === 'boolean') return !v;
    if (Array.isArray(v)) return ['__x'];
    if (v === null) return 'set';
    if (typeof v === 'object') return { name: 'صاحب__x', phone: '0', address: '' };
    return '__x';
  }

  const CASES = [
    { table: 'jobs', field: 'jobs', sample: job, dto: C.jobToDb },
    { table: 'applicants', field: 'applicants', sample: applicant, dto: C.applicantToDb },
    { table: 'job_attempts', field: 'attempts', sample: attempt, dto: C.attemptToDb }
  ];

  for (const c of CASES) {
    const empty = () => ({ settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
    const snapOf = (obj) => {
      const d = empty(); d[c.field] = [obj]; return S.snapshotOf(d)[c.table][Object.keys(S.snapshotOf(d)[c.table])[0]];
    };
    const baseSnap = snapOf(c.sample);
    let effective = 0, broken = [];
    for (const k of Object.keys(c.sample)) {
      const mutated = { ...c.sample, [k]: flip(c.sample[k]) };
      let snapChanged;
      try { snapChanged = snapOf(mutated) !== baseSnap; } catch (e) { continue; }
      if (!snapChanged) continue;                  // حقل محلي/مشتقّ لا يُنتج عملية — لا يلزم إرساله
      effective++;
      const a = JSON.stringify(c.dto(c.sample));
      const b = JSON.stringify(c.dto(mutated));
      if (a === b) broken.push(k);
    }
    check(`${c.table}: لا حقل مؤثّر يُهمَل عند الإرسال`, broken.length === 0,
      `حقول تسبّب عملية ولا تُرسل: ${broken.join(', ')}`);
    check(`${c.table}: الفحص رأى حقولاً فعلاً (لا يمرّ فارغاً)`, effective >= 4, `حقول مؤثّرة: ${effective}`);
  }
}

/* ===========================================================================
 *  7) انقطاع الشبكة وقائمة الانتظار
 * =========================================================================== */
step(7, 'Sync — انقطاع الشبكة لا يُسقط العمل');
{
  sandbox.localStorage.clear();
  const db = {
    settings: {}, jobs: [{ code: 'BRC-1', title: 'وظيفة', category: 'خدمات', region: 'الحلة', salaryMin: 1, salaryMax: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0', address: '' }, interviewLocation: '', status: 'available', notes: '', imageUrl: '' }],
    applicants: [], attempts: [], audit: [], staff: []
  };
  const snap = S.snapshotOf({ settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
  const sync = S.create(mockClient({ hardFail: true }), { snapshot: snap });

  let fatal = null;
  sync.push(db).catch(() => {});
  const r = await sync.push(db);
  check('الدفع لا يرمي استثناءً عند فشل الشبكة (الواجهة تستمر)', r !== undefined && typeof r === 'object', JSON.stringify(r));
  check('اللقطة لم تتقدّم (لأن الدفع فشل) فلا تُفقد العمليات', JSON.stringify(sync.getSnapshot().jobs) === '{}' || Object.keys(sync.getSnapshot().jobs).length === 0,
    JSON.stringify(sync.getSnapshot().jobs));

  /* الدفع مرة أخرى بعد عودة الشبكة */
  const goodClient = mockClient();
  const sync2 = S.create(goodClient, { snapshot: snap });
  const r2 = await sync2.push(db);
  check('بعد عودة الشبكة تُدفع العمليات بنجاح', r2.ops === 1, JSON.stringify(r2));
  check('اللقطة تقدّمت بعد النجاح', Object.keys(sync2.getSnapshot().jobs).length === 1);
}

step('7ب', 'Sync — الفشل الجزئي: عملية فاشلة لا توقف البقية');
{
  const db = {
    settings: {}, jobs: [{ code: 'BRC-1', title: 'أ', category: 'خدمات', region: 'ح', salaryMin: 1, salaryMax: 2, shift: 'ص', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0', address: '' }, interviewLocation: '', status: 'available', notes: '', imageUrl: '' }],
    applicants: [{ serial: 'BRC-NO-1', fullName: 'ب', phone: '0', gender: 'ذكر', nationality: 'عراقي', status: 'active', fee: 1, feePaid: false, printedCount: 0, notes: '' }],
    attempts: [], audit: [], staff: []
  };
  const snap = S.snapshotOf({ settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
  const errors = [];
  let jobTries = 0;
  const client = mockClient({
    onCall(c) {
      /* أول محاولة للوظيفة تفشل (خطأ صلاحية)، والثانية تنجح — هكذا نتحقق من
         أن الفشل مؤقّت لا دائم، وأن العملية تُعاد فعلاً. */
      if (c.table === 'jobs' && c.op === 'insert') {
        jobTries++;
        if (jobTries === 1) return { data: null, error: { code: '42501', message: 'permission denied for table jobs' } };
      }
      return null;
    }
  });
  const sync = S.create(client, { snapshot: snap, onError: (e, op) => errors.push(op.table) });
  const r = await sync.push(db);
  check('عملية فاشلة لا توقف البقية (الاستمارة دُفعت)', client.__calls.some((c) => c.table === 'applicants' && c.op === 'insert'));
  check('الفشل أُبلغ عنه', errors.includes('jobs'), JSON.stringify(errors));

  /* ==========================================================================
   * أهم سؤال بعد الفشل الجزئي: هل تُعاد العملية الفاشلة لاحقاً؟
   * لو قدّمنا اللقطة كاملة بعد الفشل، تُوسم الفاشلة كـ«مُزامَنة» فلا تُعاد أبداً،
   * ويختلف ما يراه الموظف عمّا في القاعدة **بصمت**. النجاح المتقدّم يجب أن يكون
   * للعمليات التي نجحت فقط.
   * ======================================================================== */
  check('النتيجة تُصرّح بعدد الفاشل', r.failed === 1, JSON.stringify(r));
  check('العملية الفاشلة معلّقة (لم تُوسم كمُزامَنة)', r.pending.includes('jobs:BRC-1'), JSON.stringify(r.pending));
  check('الاستمارة الناجحة لم تُوسم كناجحة فقط — بل تقدّمت اللقطة',
    ('BRC-NO-1' in sync.getSnapshot().applicants), JSON.stringify(Object.keys(sync.getSnapshot().applicants)));

  /* الدفع التالي: تُعاد الوظيفة وحدها، والاستمارة لا تُرسل مرتين */
  const before = client.__calls.filter((c) => c.table === 'applicants' && c.op === 'insert').length;
  const r2 = await sync.push(db);
  const after = client.__calls.filter((c) => c.table === 'applicants' && c.op === 'insert').length;
  check('الفاشلة تُعاد في الدفع التالي', r2.ops === 1 && r2.failed === 0, JSON.stringify(r2));
  check('الناجحة لا تُعاد (لا إدراج مكرر)', before === 1 && after === 1, `before=${before} after=${after}`);
  check('بعد النجاح لا تبقى عمليات', sync.diff(db).length === 0);
}

step('7ج', 'Sync — جدول مفقود = توقّف بدل إغراق الطلبات');
{
  const db = {
    settings: {}, jobs: [], applicants: [], attempts: [],
    audit: [{ id: 1, user: 'a', role: 'admin', ip: '', action: 'x', entity: '', entityId: '', details: '' }], staff: []
  };
  const snap = S.snapshotOf({ settings: {}, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
  let fatal = null;
  const client = mockClient({
    onCall(c) { if (c.table === 'audit_log') return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'brc.audit_log'" } }; return null; }
  });
  const sync = S.create(client, { snapshot: snap, onFatal: (e) => { fatal = e; } });
  await sync.push(db);
  check('جدول مفقود يُبلَّغ كخطأ قاتل (يتوقف النشر)', !!fatal, String(fatal && fatal.message));
  check('العمليات الفاشلة دخلت قائمة الانتظار (لا تُفقد)', sync.queueLength() > 0, sync.queueLength() + '');
}

/* ===========================================================================
 *  8) الإعدادات تُدفع بنفس شكل صفوف SQL
 * =========================================================================== */
step(8, 'Sync — الإعدادات كصفوف key/value');
{
  const db = {
    settings: { attemptLimit: 7, validityDays: 45, holdHours: 12, formFee: 15000, autoReleaseEnabled: false },
    jobs: [], applicants: [], attempts: [], audit: [], staff: []
  };
  const snap = S.snapshotOf({ settings: { attemptLimit: 5, validityDays: 30, holdHours: 24, formFee: 10000 }, jobs: [], applicants: [], attempts: [], audit: [], staff: [] });
  const client = mockClient();
  const sync = S.create(client, { snapshot: snap });
  await sync.push(db);
  const s = client.__calls.find((c) => c.table === 'settings');
  /* المفتاح يُحدَّد في المرشّح لا في الصف: تعديل عمود المفتاح في التحديث خطأ.
     ما يجب أن يصل هو القيمة فقط، مع .eq('key','rules'). */
  check('الإعدادات تُدفع بمرشّح key=rules', s && s.filters.some((f) => f[0] === 'key' && f[1] === 'rules'),
    JSON.stringify(s && s.filters));
  check('عمود المفتاح لا يُرسل داخل الصف (لا يُعدَّل)', s && s.payload.key === undefined);
  check('القيم بمفاتيح SQL (attempt_limit)', s && s.payload.value.attempt_limit === 7 && s.payload.value.validity_days === 45);
  check('auto_release يُدفع', s && s.payload.value.auto_release === false);
  check('لا مفاتيح camelCase في الصف المدفوع', s && s.payload.value.attemptLimit === undefined);
}

/* ===========================================================================
 *  9) مواصفات الأعمدة — لا حقول مجهولة تُرسل للقاعدة
 * =========================================================================== */
step(9, 'Sync — الأعمدة المُرسلة تطابق مخطط القاعدة');
{
  const sql = readFileSync(join(ROOT, 'docs', 'schema.sql'), 'utf8');
  const colsOf = (table) => {
    const i = sql.indexOf('create table if not exists brc.' + table + ' (');
    const block = sql.slice(i, sql.indexOf('\n);', i));
    const out = new Set();
    for (const line of block.split('\n')) {
      const m = /^\s{2}([a-z_]+)\s+(uuid|text|integer|smallint|boolean|timestamptz|date|jsonb|brc\.\w+)/.exec(line);
      if (m) out.add(m[1]);
    }
    return out;
  };

  const db = {
    settings: { attemptLimit: 5 },
    jobs: [{ code: 'BRC-1', title: 'أ', category: 'خدمات', region: 'ح', salaryMin: 1, salaryMax: 2, shift: 'ص', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0', address: 'ع' }, interviewLocation: 'م', status: 'available', reservedBy: null, holdExpiresAt: null, closedAt: null, notes: '', imageUrl: '' }],
    applicants: [{ serial: 'BRC-NO-1', fullName: 'ب', phone: '0', address: '', dob: null, gender: 'ذكر', nationality: 'عراقي', status: 'active', fee: 1, feePaid: false, printedCount: 0, notes: '', requestedCode: null }],
    attempts: [{ serial: 'BRC-NO-1', no: 1, jobCode: 'BRC-1', slotStatus: 'empty', selectedAt: null, holdExpiresAt: null, closedAt: null, note: '' }],
    audit: [], staff: []
  };

  for (const [table, item, conv] of [
    ['jobs', db.jobs[0], C.jobToDb],
    ['applicants', db.applicants[0], C.applicantToDb],
    ['job_attempts', db.attempts[0], C.attemptToDb]
  ]) {
    const row = conv(item);
    const known = colsOf(table);
    const unknown = Object.keys(row).filter((k) => !known.has(k));
    check(`كل أعمدة ${table} المُرسلة موجودة في المخطط`, unknown.length === 0,
      'مجهولة: ' + unknown.join(', ') + ' — ستُرفض من PostgREST');
  }

  const auditRow = C.auditToDb({ user: 'a', role: 'admin', ip: '1', action: 'x', entity: 'job', entityId: 'BRC-1', details: 'd' });
  check('أعمدة audit_log المُرسلة صحيحة', Object.keys(auditRow).every((k) => colsOf('audit_log').has(k)),
    Object.keys(auditRow).join(', '));
}

/* ---------------------------------- الخلاصة ---------------------------------- */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
