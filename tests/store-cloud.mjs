#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار الربط الفعلي: store.js ↔ Supabase
 *  ---------------------------------------------------------------------------
 *  هذا الملف يجيب على السؤال الوحيد المهم: **هل الواجهة تتكلم فعلاً مع القاعدة؟**
 *  نُحمّل store.js في سياق Node مع localStorage وهمي، ونُعطيه عميل سوبابيس وهمياً
 *  يسجّل كل نداء — ثم نتحقق من السلوك الحقيقي لا من وجود الشيفرة:
 *
 *    • الإقلاع: هل تُتبنّى بيانات القاعدة (لا البيانات التجريبية) في الذاكرة؟
 *    • الدفع: هل كل حفظ يُنتج كتابة فعلية بالحقول الصحيحة (snake_case)؟
 *    • الجلسة: هل الدور يأتي من brc.staff، وهل يُرفض الدخول المحلي في الوضع السحابي؟
 *    • الزائر: هل يمرّ الطلب والتحقق عبر الدوال (RPC) لا عبر الجداول المحجوبة؟
 *    • الحرّاس: هل تُرفض العمليات التدميرية (إعادة الضبط/الاستيراد) في السحابة؟
 *    • Realtime: هل تغيير موظف آخر لا يُنتج إدراجاً مكرراً في الدفعة التالية؟
 *
 *  التشغيل:  node tests/store-cloud.mjs
 * =========================================================================== */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===========================================================================
 *  عميل سوبابيس وهمي — يحاكي PostgREST وAuth وRealtime
 * =========================================================================== */
function makeMock(opts = {}) {
  const calls = [];
  let signedOut = false;      // signOut يُلغي الجلسة فعلاً (كما يفعل الخادم)
  const state = Object.assign({
    jobs: [], applicants: [], job_attempts: [], audit_log: [], settings: [], staff: [], public_jobs: []
  }, opts.rows || {});
  let seq = 1;

  function query(table) {
    const q = { table, _op: null, _payload: null, _filters: [] };
    const api = {
      select() { if (!q._op) q._op = 'select'; return api; },
      insert(p) { q._op = 'insert'; q._payload = p; return api; },
      update(p) { q._op = 'update'; q._payload = p; return api; },
      delete() { q._op = 'delete'; return api; },
      eq(c, v) { q._filters.push([c, v]); return api; },
      order() { return api; }, limit() { return api; }, single() { return api; },
      then(res, rej) {
        const rec = { table, op: q._op, payload: q._payload, filters: q._filters };
        calls.push(rec);
        if (opts.onCall) {
          const forced = opts.onCall(rec);
          if (forced) return Promise.resolve(forced).then(res, rej);
        }
        if (opts.failTables && opts.failTables[table]) {
          return Promise.resolve({ data: null, error: opts.failTables[table] }).then(res, rej);
        }
        if (opts.failAll) {
          return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for table ' + table } }).then(res, rej);
        }
        if (q._op === 'insert') {
          const row = Object.assign({ id: 'uuid-' + (seq++) }, q._payload);
          if (table === 'audit_log' && row.id == null) row.id = seq++;
          (state[table] = state[table] || []).push(row);
          return Promise.resolve({ data: [row], error: null }).then(res, rej);
        }
        if (q._op === 'update') {
          const hit = (state[table] || []).filter((r) => q._filters.every(([c, v]) => String(r[c]) === String(v)));
          hit.forEach((r) => Object.assign(r, q._payload));
          return Promise.resolve({ data: hit, error: null }).then(res, rej);
        }
        if (q._op === 'delete') {
          state[table] = (state[table] || []).filter((r) => !q._filters.every(([c, v]) => String(r[c]) === String(v)));
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        const rows = (state[table] || []).filter((r) => q._filters.every(([c, v]) => String(r[c]) === String(v)));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      }
    };
    return api;
  }

  const client = {
    __calls: calls, __state: state,
    from: query,
    rpc(name, args) {
      calls.push({ rpc: name, args });
      /* PostgREST يُرجع قيمة الدالة في data مباشرةً */
      if (opts.rpc && opts.rpc[name]) return Promise.resolve({ data: opts.rpc[name](args), error: null });
      return Promise.resolve({ data: null, error: { message: 'unknown rpc ' + name } });
    },
    channel() {
      const ch = { __all: [],
        on(evt, filter, cb) { ch.__cb = cb; ch.__filter = filter; ch.__all.push({ filter, cb }); return ch; },
        subscribe(cb) { ch.__sub = cb; if (cb) cb('SUBSCRIBED'); return ch; },
        /* مُستدعي الجدول المطلوب — كل جدول له مستدعٍ مستقل */
        fire(table, payload) {
          const hit = ch.__all.filter((x) => x.filter.table === table);
          hit.forEach((x) => x.cb(payload));
          return hit.length;
        } };
      client.__channel = ch;
      return ch;
    },
    removeChannel() { },
    auth: {
      signInWithPassword({ email, password }) {
        calls.push({ auth: 'signIn', email, password });
        if (opts.auth) return Promise.resolve(opts.auth(email, password));
        return Promise.resolve({ data: { user: { id: 'auth-1', email }, session: { access_token: 'tk' } }, error: null });
      },
      getSession() {
        calls.push({ auth: 'getSession' });
        if (signedOut) return Promise.resolve({ data: { session: null }, error: null });
        /* الافتراضي: جلسة موظف مسجَّل (كي تُقرأ جداول brc). مرّر session: null
           لتمثيل زائر بلا حساب. */
        const sess = opts.session === undefined ? { user: { id: 'auth-1' }, access_token: 'tk' } : opts.session;
        return Promise.resolve({ data: { session: sess }, error: null });
      },
      signOut() { calls.push({ auth: 'signOut' }); signedOut = true; return Promise.resolve({ error: null }); },
      updateUser(p) { calls.push({ auth: 'updateUser', payload: p }); return Promise.resolve({ error: null }); }
    }
  };
  return client;
}

/* ===========================================================================
 *  تحميل store.js في سياق معزول + تجهيز عميل وهمي
 * =========================================================================== */
function bootStore(mock, extra = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  const stores = { local: {}, session: {} };
  const mk = (bag) => ({
    getItem: (k) => (k in bag ? bag[k] : null),
    setItem: (k, v) => { bag[k] = String(v); },
    removeItem: (k) => { delete bag[k]; },
    clear: () => Object.keys(bag).forEach((k) => delete bag[k])
  });
  sandbox.localStorage = mk(stores.local);
  sandbox.sessionStorage = mk(stores.session);
  sandbox.navigator = { onLine: true };
  sandbox.console = console;
  sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = () => 0; sandbox.clearInterval = () => { };
  sandbox.location = { origin: 'http://localhost', protocol: 'http:' };
  sandbox.BRCSupabaseConfig = {
    url: 'https://x.supabase.co', publishableKey: 'sb_publishable_test', schema: 'brc',
    enabled: true, enforceAuth: extra.enforceAuth === true
  };
  sandbox.fetch = function () { };                       // المتصفح الحقيقي يوفّره
  if (extra.noFetch) delete sandbox.fetch;
  if (extra.noVendor) { /* بلا مكتبة سوبابيس */ } else {
    sandbox.supabase = { createClient: () => mock };
  }
  const load = (f) => new Function('window', readFileSync(join(ROOT, 'assets/js/' + f), 'utf8'))(sandbox);
  load('config.js');
  load('cloud.js');
  load('cloud-auth.js');
  load('cloud-sync.js');
  load('store.js');
  return { sandbox, Store: sandbox.BRCStore, localStorage: stores.local };
}

/* إنزال القاعدة الوهمية ببيانات «سحابية» مختلفة تماماً عن البيانات التجريبية:
   لو ظهرت البيانات التجريبية في الواجهة فالإقلاع لم يتبنَّ القاعدة فعلاً. */
/* التواريخ تُحسب من الآن: تاريخ ثابت («2026-02-01») يصبح ماضياً مع مرور الزمن
   فتُوسمه الصيانة «منتهية الصلاحية» وتُنشئ عمليات دفع حقيقية — فيفشل الاختبار
   لسبب لا علاقة له بالربط (وهذا ما حدث فعلاً عند كتابة هذا الملف). */
function cloudRows() {
  const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
  return {
    jobs: [{
      id: 'job-uuid-1', code: 'BRC-5001', title: 'وظيفة من القاعدة', category: 'صناعة', region: 'بابل',
      salary_min: 700000, salary_max: 900000, shift: 'صباحي', gender: 'لا فرق', vacancies: 3,
      requirements: ['خبرة'], description: 'وصف', status: 'available', notes: '', image_url: '',
      employer_name: 'معمل', employer_phone: '07700000000', employer_address: 'الحلة',
      interview_location: 'المعمل', reserved_by: null, hold_expires_at: null, closed_at: null,
      created_at: '2026-01-01T00:00:00.000Z'
    }],
    applicants: [{
      id: 'app-uuid-1', serial: 'BRC-NO-900001', full_name: 'باحث من القاعدة', phone: '07711111111',
      address: 'الحلة', dob: '1990-01-01', gender: 'ذكر', nationality: 'عراقي', status: 'active',
      issue_date: iso(-1), expiry_date: iso(29),
      attempt_limit: 5, fee_amount: 10000, fee_paid: false, printed_count: 0, notes: '',
      requested_code: null, reject_reason: '', created_at: '2026-01-01T00:00:00.000Z'
    }],
    job_attempts: [{
      id: 'att-uuid-1', serial: 'BRC-NO-900001', attempt_no: 1, job_id: 'job-uuid-1', job_code: 'BRC-5001',
      slot_status: 'empty', selected_at: null, hold_expires_at: null, closed_at: null,
      outcome_note: '', staff_id: null
    }],
    settings: [{ key: 'rules', value: { attempt_limit: 7, validity_days: 45, hold_hours: 12, form_fee: 15000, auto_release: true } }],
    staff: [{ id: 'staff-uuid-1', auth_id: 'auth-1', username: 'hussein', full_name: 'حسين', role: 'admin', job_title: 'مدير عام', phone: '0770', active: true }],
    audit_log: []
  };
}

console.log('\n' + '═'.repeat(74));
console.log('  BRC — الربط الفعلي (store.js ↔ Supabase)');
console.log('═'.repeat(74));

/* ===========================================================================
 *  1) الإقلاع: تبنّي بيانات القاعدة
 * =========================================================================== */
step(1, 'الإقلاع — الواجهة تتبنّى ما في القاعدة لا البيانات التجريبية');
{
  const mock = makeMock({ rows: cloudRows() });
  const { Store, sandbox } = bootStore(mock);
  Store.init();
  const dbAfterLoad = Store.db();

  check('قبل انتهاء الإقلاع: الوضع (connecting/on) لا صامت', ['connecting', 'on'].includes(Store.cloudStatus().state),
    Store.cloudStatus().state);
  await sleep(120);
  const st = Store.cloudStatus();
  check('الإقلاع اكتمل والوضع سحابي', st.state === 'on', JSON.stringify(st));
  check('الدور: موظف (لا زائر)', st.role === 'staff', st.role);
  const db = Store.db();
  check('كائن db لم يُستبدل — نفس المرجع (وإلا انكسرت مراجع الواجهة)', db === dbAfterLoad);
  check('الوظائف جاءت من القاعدة', db.jobs.length === 1 && db.jobs[0].code === 'BRC-5001',
    JSON.stringify(db.jobs.map((j) => j.code)));
  check('لا أثر لوظائف البيانات التجريبية (BRC-1042)', !db.jobs.some((j) => j.code === 'BRC-1042'));
  check('الاستمارة من القاعدة', db.applicants.length === 1 && db.applicants[0].serial === 'BRC-NO-900001');
  check('المحاولات مرتبطة بالوظيفة (بيانات مُسطّحة مشتقّة)',
    db.attempts.length === 1 && db.attempts[0].jobCode === 'BRC-5001',
    JSON.stringify(db.attempts));
  check('قواعد العمل من صف الإعدادات في القاعدة', db.settings.attemptLimit === 7 && db.settings.holdHours === 12,
    JSON.stringify({ a: db.settings.attemptLimit, h: db.settings.holdHours }));
  check('عدّاد أكواد الوظائف مبنيّ على بيانات القاعدة', db.counters.jobCode >= 5001, String(db.counters.jobCode));
  check('الموظفون جُلبوا (brc.staff)', db.staff && db.staff.length === 1 && db.staff[0].username === 'hussein');
  check('لا كلمات مرور محلّية في الوضع السحابي (لا db.settings.users)',
    !db.settings.users || db.settings.users.length === 0, JSON.stringify(db.settings.users));
}

/* ===========================================================================
 *  2) الدفع: كل حفظ يُنتج كتابة فعلية بالحقول الصحيحة
 * =========================================================================== */
step(2, 'الدفع — الحفظ يصل إلى القاعدة بحقول snake_case صحيحة');
{
  const mock = makeMock({ rows: cloudRows() });
  const { Store } = bootStore(mock);
  Store.init();
  await sleep(120);

  Store.createJob({
    title: 'وظيفة جديدة', category: 'خدمات', region: 'كربلاء', salaryMin: 1, salaryMax: 2,
    shift: 'مسائي', gender: 'لا فرق', vacancies: 2, requirements: [], description: '',
    employer: { name: 'شركة', phone: '0780', address: 'كربلاء' }, interviewLocation: 'المكتب'
  });
  check('الإدراج المحلي تم فوراً (الواجهة لا تنتظر الشبكة)', Store.listJobs({}).length === 2);
  check('لم يُرسل أي شيء قبل انتهاء التأجيل (دفعة واحدة لا رحلة لكل حفظ)',
    !mock.__calls.some((c) => c.op === 'insert' && c.table === 'jobs'));
  await sleep(950);
  const ins = mock.__calls.filter((c) => c.op === 'insert' && c.table === 'jobs');
  check('الحفظ وصل إلى القاعدة بعد التأجيل', ins.length === 1, JSON.stringify(mock.__calls.map((c) => c.table + ':' + c.op)));
  check('الصف المُرسل بأعمدة القاعدة', ins[0] && ins[0].payload.employer_name === 'شركة' &&
    ins[0].payload.interview_location === 'المكتب' && ins[0].payload.code && ins[0].payload.notes === undefined
    || ins[0].payload.status === 'available', JSON.stringify(ins[0] && ins[0].payload));
  check('لا مفاتيح camelCase في الصف المُرسل', ins[0] && !('employerName' in ins[0].payload) && !('salaryMin' in ins[0].payload));

  /* تعديل ثم حذف: نفس المسار */
  const code = Store.listJobs({})[0].code;
  Store.updateJob(code, { title: 'عنوان معدّل' });
  await sleep(950);
  check('التعديل يُرسل update بمرشّح code', mock.__calls.some((c) => c.op === 'update' && c.table === 'jobs' && c.filters.some(([k, v]) => k === 'code' && v === code)),
    JSON.stringify(mock.__calls.filter((c) => c.op === 'update')));
  Store.deleteJob(code);
  await sleep(950);
  check('الحذف يُرسل delete بمرشّح code (لا يتوقف بصمت)',
    mock.__calls.some((c) => c.op === 'delete' && c.table === 'jobs' && c.filters.some(([k, v]) => k === 'code' && v === code)),
    JSON.stringify(mock.__calls.filter((c) => c.op === 'delete')));
  check('المحفوظ محلياً يُنشر إلى القاعدة فقط — لا حذف جماعي',
    mock.__calls.filter((c) => c.op === 'delete').length === 1);
}

/* ===========================================================================
 *  3) الجلسة: الدخول عبر Supabase Auth والدور من brc.staff
 * =========================================================================== */
step(3, 'الجلسة — الدخول من القاعدة لا من config.js');
{
  const mock = makeMock({
    rows: cloudRows(),
    auth: (email, password) => (password === 'correct-password'
      ? { data: { user: { id: 'auth-1', email }, session: { access_token: 'tk' } }, error: null }
      : { data: null, error: { message: 'Invalid login credentials' } })
  });
  const { Store } = bootStore(mock, { enforceAuth: true });
  Store.init();
  await sleep(120);

  const refused = Store.login('admin', 'admin123');
  check('كلمة مرور config.js المحلية مرفوضة في الوضع النهائي', refused === null, JSON.stringify(refused));
  check('الوضع النهائي مُعلن في الحالة', Store.cloudStatus().enforceAuth === true);
  check('المحاولة المرفوضة سُجّلت محلياً للتدقيق',
    Store.listAudit({}).some((l) => /دخول محلي/.test(l.action)), JSON.stringify(Store.listAudit({}).slice(0, 2)));

  const r = await Store.signIn('hussein', 'correct-password');
  check('الدخول ناجح عبر Supabase Auth', r.ok, JSON.stringify(r));
  check('البريد المُشتق من اسم المستخدم (لا كشف لبريد الموظف)',
    mock.__calls.some((c) => c.auth === 'signIn' && c.email === 'hussein@brc-babil.com'),
    JSON.stringify(mock.__calls.filter((c) => c.auth === 'signIn')));
  const s = Store.currentUser();
  check('الدور والاسم من brc.staff لا من الواجهة', s && s.role === 'admin' && s.name === 'حسين', JSON.stringify(s));
  check('isAdmin صحيح بعد الدخول', Store.isAdmin() === true);
  check('الجلسة موسومة بالسحابة (تُنهى فعلاً عند الخروج)', s && s.cloud === true);
  check('سطر الدخول في سجل التدقيق', Store.listAudit({}).some((l) => l.action === 'تسجيل دخول'));

  const bad = await Store.signIn('hussein', 'wrong-password');
  check('كلمة مرور خاطئة تُرفض برسالة عربية', bad && bad.ok === false && bad.code === 'bad_credentials' && /غير صحيحة/.test(bad.error),
    JSON.stringify(bad));
}

step('3أ', 'الوضع الانتقالي — allow محلي معلَن، وبلا أي كتابة في القاعدة');
{
  /* enforceAuth=false هو الوضع الافتراضي الحالي (المسؤول لم يُنشئ الحسابات بعدُ).
     في هذا الوضع: الدخول المحلي مسموح صراحةً، لكن **لا شيء يصل للقاعدة** لأن
     الكتابة تحتاج جلسة موظف — فلا يظنّ أحد أن بياناته مشتركة. */
  /* (أ) زائر/موظف بلا جلسة سحابية: الوضع الانتقالي المعتاد */
  const mock = makeMock({ rows: cloudRows(), session: null });
  const { Store } = bootStore(mock, { enforceAuth: false });
  Store.init();
  await sleep(120);
  check('الوضع الانتقالي مُعلن في الحالة', Store.cloudStatus().enforceAuth === false);
  check('بلا جلسة: الوضع عام (لا صلاحية كتابة)', Store.cloudStatus().role === 'public');
  const s = Store.login('admin', 'admin123');
  check('الدخول المحلي مسموح في الوضع الانتقالي (المنظومة لا تتوقف)', !!s && s.role === 'admin', JSON.stringify(s));
  const before = mock.__calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op)).length;
  Store.createJob({ title: 'وظيفة محلية', category: 'خدمات', region: 'بابل', salaryMin: 1, salaryMax: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0', address: '' }, interviewLocation: '' });
  await sleep(950);
  const after = mock.__calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op)).length;
  check('لا كتابة تصل للقاعدة بجلسة محلية (البيانات غير مشتركة)', after === before,
    `before=${before} after=${after}`);

  /* (ب) جلسة سحابية لموظف آخر قائمة في المتصفح + دخول محلي:
     أخطر حالة — لولا الفصل لصارت الكتابات باسم صاحب الجلسة. */
  const mock2 = makeMock({ rows: cloudRows() });
  const b = bootStore(mock2, { enforceAuth: false });
  b.Store.init();
  await sleep(120);
  check('قبل الدخول المحلي: جلسة سحابية لموظف (صلاحية كتابة)', b.Store.cloudStatus().role === 'staff');
  b.Store.login('admin', 'admin123');
  await sleep(400);
  check('الدخول المحلي يفصل الجلسة السحابية (لا كتابة باسم غيرك)', b.Store.cloudStatus().role !== 'staff',
    JSON.stringify(b.Store.cloudStatus()));
  const b0 = mock2.__calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op)).length;
  b.Store.createJob({ title: 'وظيفة', category: 'خدمات', region: 'بابل', salaryMin: 1, salaryMax: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [], description: '', employer: { name: 'ج', phone: '0', address: '' }, interviewLocation: '' });
  await sleep(950);
  const b1 = mock2.__calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op)).length;
  check('بعد الفصل: لا كتابة في القاعدة إطلاقاً', b1 === b0, `before=${b0} after=${b1}`);
}

step('3ب', 'الجلسة — حالات الحدود (حساب بلا سطر موظف · حساب موقوف)');
{
  const noRow = makeMock({ rows: cloudRows(), auth: () => ({ data: { user: { id: 'auth-9' }, session: {} }, error: null }) });
  noRow.__state.staff = [];
  const a = bootStore(noRow); a.Store.init(); await sleep(120);
  const r1 = await a.Store.signIn('ghost', 'x');
  check('حساب Auth بلا سطر في brc.staff يُرفض', r1.ok === false && r1.code === 'no_staff_row', JSON.stringify(r1));

  const inactive = makeMock({
    rows: cloudRows(),
    auth: () => ({ data: { user: { id: 'auth-1' }, session: {} }, error: null })
  });
  inactive.__state.staff[0].active = false;
  const b = bootStore(inactive); b.Store.init(); await sleep(120);
  const r2 = await b.Store.signIn('hussein', 'x');
  check('حساب موقوف يُرفض', r2.ok === false && r2.code === 'inactive', JSON.stringify(r2));

  /* بلا مكتبة سوبابيس محمّلة: وضع محلي مع تنبيه صريح، والدخول المحلي متاح */
  const c = bootStore(makeMock({ rows: cloudRows() }), { noVendor: true });
  c.Store.init();
  await sleep(30);
  const st = c.Store.cloudStatus();
  check('بلا مكتبة سوبابيس: الوضع محلي مع سبب مذكور', st.state === 'degraded' && !!st.error && !!st.detail,
    JSON.stringify(st));
  const local = c.Store.login('admin', 'admin123');
  check('في الوضع المحلي المؤقّت يعمل الدخول المحلي (حتى لا يتوقف العمل)', !!local && local.role === 'admin');
}

/* ===========================================================================
 *  4) الحرّاس: لا عمليات تدميرية على القاعدة
 * =========================================================================== */
step(4, 'الحرّاس — إعادة الضبط والاستيراد ممنوعان في الوضع السحابي');
{
  const mock = makeMock({ rows: cloudRows() });
  const { Store } = bootStore(mock);
  Store.init();
  await sleep(120);
  check('إعادة الضبط مرفوضة وتُرجع false', Store.resetDemo() === false);
  let threw = null;
  try { Store.importJson(Store.exportJson()); } catch (e) { threw = e; }
  check('الاستيراد مرفوض برسالة واضحة', !!threw && /سحاب/.test(threw.message), threw && threw.message);
  await sleep(300);
  check('لم يُرسل أي حذف أو إدراج جماعي إلى القاعدة',
    !mock.__calls.some((c) => c.op === 'delete') && mock.__calls.filter((c) => c.op === 'insert').length === 0,
    JSON.stringify(mock.__calls.map((c) => c.table + ':' + c.op)));
}

/* ===========================================================================
 *  5) الزائر: الطلب والتحقق عبر دوال القاعدة لا الجداول المحجوبة
 * =========================================================================== */
step(5, 'الزائر — RPC للطلب والتحقق (الجدول محجوب على anon)');
{
  const denied = { code: '42501', message: 'permission denied for table jobs' };
  const mock = makeMock({
    rows: cloudRows(),
    session: null,                       // زائر بلا حساب
    auth: () => ({ data: null, error: { message: 'Invalid login credentials' } }),
    failTables: { jobs: denied, applicants: denied, job_attempts: denied, settings: denied, staff: denied },
    rpc: {
      verify_form: (args) => ({
        ok: true, serial: args.p_serial, fullName: 'ب•••••', phone: '0771••••11', masked: args.p_token == null,
        issueDate: '2026-01-01T00:00:00.000Z', expiryDate: '2026-02-01T00:00:00.000Z',
        status: 'active', daysLeft: 12, attemptLimit: 5, attemptsUsed: 1, attemptsLeft: 4,
        requestedCode: null, rejectReason: '', createdAt: '2026-01-01T00:00:00.000Z',
        attempts: [{ no: 1, jobCode: 'BRC-5001', jobTitle: 'وظيفة', location: 'بابل', slotStatus: 'reserved',
          selectedAt: null, holdExpiresAt: null, closedAt: null, note: '' }]
      }),
      request_form: (args) => ({ ok: true, serial: 'BRC-NO-900999', status: 'pending' })
    }
  });
  mock.__state.public_jobs = [{
    code: 'BRC-5001', title: 'وظيفة عامة', category: 'صناعة', region: 'بابل', salary_min: 1, salary_max: 2,
    shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [], status: 'available',
    is_reserved: false, hold_expires_at: null, created_at: '2026-01-01T00:00:00.000Z',
    description: 'وصف', image_url: ''
  }];

  const { Store } = bootStore(mock);
  Store.init();
  await sleep(150);
  const st = Store.cloudStatus();
  check('الزائر (anon): الجداول محجوبة فانتقل للواجهة العامة', st.state === 'on' && st.role === 'public', JSON.stringify(st));
  check('واجهة القراءة العامة هي public_jobs (لا جدول jobs المحجوب)',
    mock.__calls.some((c) => c.table === 'public_jobs' && c.op === 'select'));
  check('الزائر يرى الوظائف المعلنة', Store.listJobs({}).length === 1 && Store.listJobs({})[0].code === 'BRC-5001');
  check('لا صلاحية كتابة للزائر (readOnly)', st.readOnly === true);
  check('الصيانة لا تعمل للزائر (لا كتابة مرفوضة)', Store.runMaintenance().length === 0);
  check('pushCloud لا يُرسل شيئاً للزائر', (await Store.pushCloud()).skipped === true ||
    !mock.__calls.some((c) => c.op && ['insert', 'update', 'delete'].includes(c.op)));

  const req = await Store.submitPublicRequest({ fullName: 'علي حسن', phone: '07701234567', address: 'الحلة', gender: 'ذكر' });
  check('الطلب الإلكتروني يمرّ عبر brc.request_form', mock.__calls.some((c) => c.rpc === 'request_form'), JSON.stringify(mock.__calls.filter((c) => c.rpc)));
  check('الطلب نجح وأعاد الرقم التسلسلي', req.ok && req.serial === 'BRC-NO-900999', JSON.stringify(req));
  check('لا إدراج مباشر في جدول الاستمارات (محجوب على anon)',
    !mock.__calls.some((c) => c.table === 'applicants' && c.op === 'insert'));
  check('الطلب ظاهر محلياً للمتابعة', Store.getApplicant('BRC-NO-900999') !== null);

  const vr = await Store.verifyCloud('BRC-NO-900001', null);
  check('التحقق يمرّ عبر brc.verify_form', mock.__calls.some((c) => c.rpc === 'verify_form'));
  check('بلا بصمة: الرد مقنّع', vr.ok && vr.form.masked === true && /•/.test(vr.form.fullName), JSON.stringify(vr.form && vr.form.fullName));
  check('بالبصمة: الرد كامل', (await Store.verifyCloud('BRC-NO-900001', 'abc12345')).form.masked === false);
  check('لا قراءة مباشرة لجدول الاستمارات من الزائر',
    !mock.__calls.some((c) => c.table === 'applicants' && c.op === 'select'));

  const localReq = Store.submitPublicRequest ? await (async () => {
    const local = bootStore(makeMock({ rows: cloudRows() }), { noVendor: true });
    local.Store.init(); await sleep(30);
    return local.Store.submitPublicRequest({ fullName: 'سالم', phone: '07701111111', address: 'بابل', gender: 'ذكر' });
  })() : null;
  check('في الوضع المحلي: الطلب يُسجّل محلياً كما كان', localReq && localReq.ok && localReq.mode === 'local' && !!localReq.serial,
    JSON.stringify(localReq));
}

/* ===========================================================================
 *  6) Realtime: تغيير موظف آخر لا يُنتج إدراجاً مكرراً
 * =========================================================================== */
step(6, 'Realtime — تغيير الآخرين لا يتضاعف في الدفعة التالية');
{
  const mock = makeMock({ rows: cloudRows() });
  const { Store, sandbox } = bootStore(mock);
  Store.init();
  await sleep(120);

  check('الاشتراك اللحظي أُقيم على الجداول', !!mock.__channel, 'لا قناة اشتراك');
  const ch = mock.__channel;
  check('الاشتراك على سكيما brc', ch && ch.__filter && ch.__filter.schema === 'brc', JSON.stringify(ch && ch.__filter));

  /* موظف آخر أدرج وظيفة: نصلها من القاعدة */
  const row = {
    id: 'job-uuid-2', code: 'BRC-5002', title: 'وظيفة موظف آخر', category: 'خدمات', region: 'بابل',
    salary_min: 1, salary_max: 2, shift: 'صباحي', gender: 'لا فرق', vacancies: 1, requirements: [],
    description: '', employer_name: 'ج', employer_phone: '0', employer_address: '', interview_location: '',
    status: 'available', notes: '', image_url: '', reserved_by: null, hold_expires_at: null,
    closed_at: null, created_at: '2026-01-02T00:00:00.000Z'
  };
  check('كل جدول له مستدعٍ مستقل في الاشتراك', ch.__all.length === 6, String(ch.__all.length));
  ch.fire('jobs', { eventType: 'INSERT', schema: 'brc', table: 'jobs', new: row });
  check('الوظيفة ظهرت فوراً في الواجهة', Store.getJob('BRC-5002') !== null);

  const res = await Store.pushCloud();
  const ins = mock.__calls.filter((c) => c.op === 'insert' && c.table === 'jobs' &&
    c.payload && c.payload.code === 'BRC-5002');
  check('لا إدراج مكرر للوظيفة القادمة من موظف آخر (تصادم مفتاح كان سيولّد نسخة ثانية)',
    ins.length === 0 && (!res || res.ops === 0),
    JSON.stringify({ ins: ins.length, res, pending: Store.diffCloud().map((o) => o.table + ':' + o.op + ':' + o.key) }));

  /* حذف من موظف آخر: لا نُرسل حذفاً لسطر محذوف أصلاً */
  ch.fire('jobs', { eventType: 'DELETE', schema: 'brc', table: 'jobs', old: { id: 'job-uuid-2', code: 'BRC-5002' } });
  check('السطر المحذوف اختفى من الواجهة', Store.getJob('BRC-5002') === null);
  const res2 = await Store.pushCloud();
  check('لا حذف مكرر لسطر حُذف مسبقاً', (!res2 || res2.ops === 0), JSON.stringify(res2));

  /* إعدادات تغيّرت من مدير آخر */
  ch.fire('settings', { eventType: 'UPDATE', schema: 'brc', table: 'settings', new: { key: 'rules', value: { attempt_limit: 9, validity_days: 60, hold_hours: 24, form_fee: 10000, auto_release: true } } });
  check('قواعد العمل تغيّرت فوراً من تغيير الآخرين', Store.settings().attemptLimit === 9, String(Store.settings().attemptLimit));
  const res3 = await Store.pushCloud();
  check('لا دفع معاكس للقاعدة بعد تغيير الآخرين', (!res3 || res3.ops === 0), JSON.stringify(res3));

  /* المسار الآخر المهم: ما تُنتجه الصيانة التلقائية يجب أن يُدفع أيضاً.
     (استمارة انتهت صلاحيتها فعلاً: تُوسم «منتهية» ويُكتب سطر تدقيق.) */
  const app = Store.getApplicant('BRC-NO-900001');
  app.expiryDate = new Date(Date.now() - 86400000).toISOString();
  const actions = Store.runMaintenance();
  check('الصيانة وسَمت الاستمارة المنتهية', actions.some((a) => a.type === 'formExpired') && app.status === 'expired',
    JSON.stringify(actions));
  const res4 = await Store.pushCloud();
  check('الصيانة تُدفع للقاعدة (تعديل الاستمارة + سطر التدقيق)', res4 && res4.ops === 2 && res4.failed === 0,
    JSON.stringify({ res4, pending: Store.diffCloud().map((o) => o.table + ':' + o.op) }));
  /* الترتيب مقصود: الإدراج قبل التعديل والحذف — لأن الحذف قد يفشل بسبب قيود
     المفاتيح الأجنبية لو حُذف الأب قبل الأبناء. */
  const idxIns = mock.__calls.findIndex((c) => c.table === 'audit_log' && c.op === 'insert');
  const idxUpd = mock.__calls.findIndex((c) => c.table === 'applicants' && c.op === 'update');
  check('كل الإدراجات تُرسل قبل التعديلات في الدفعة', idxIns >= 0 && idxUpd > idxIns,
    `insert=${idxIns} update=${idxUpd}`);
}

/* ===========================================================================
 *  النتيجة
 * =========================================================================== */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
console.log('═'.repeat(74) + '\n');
if (problems.length) { console.log('  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); console.log(); }
process.exit(fail ? 1 : 0);
