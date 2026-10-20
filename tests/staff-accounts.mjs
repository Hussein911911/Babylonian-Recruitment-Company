#!/usr/bin/env node
/* ===========================================================================
 *  HRC — إنشاء حسابات الموظفين من الإعدادات (المدير)
 *  ---------------------------------------------------------------------------
 *  هذا الملف يحاكي السيناريو الحقيقي الذي يشتكي منه المستخدم:
 *
 *    «المدير ينشئ حساباً لموظفه من الإعدادات، ثم الموظف يحاول الدخول فلا يفتح.»
 *
 *  لماذا يفشل؟ لأن Supabase يُنشئ مستخدم Auth بمفتاح الخدمة (يعمل دائماً)، ثم
 *  يُدرج سطر brc.staff **بجلسة المدير** عبر PostgREST. وسياسة RLS على brc.staff
 *  (staff_admin_write) تشترط brc.is_admin() — أي جلسة موظّف مُصادَقة بصف مدير.
 *  فمتى كان المدير داخلاً بالوضع المحلي (enforceAuth=false، كلمة المرور في
 *  config.js) لا توجد جلسة سحابية إطلاقاً → يُرفض الإدراج بـ 42501 → يُنشأ
 *  حساب Auth بلا سطر في brc.staff → عند الدخول: «الحساب موجود لكن غير مرتبط
 *  بموظف» ولا يدخل.
 *
 *  الاختبار يفرض نفس قواعد القاعدة الحقيقية على العميل الوهمي:
 *    • POST /auth/v1/admin/users  بمفتاح الخدمة        → يعمل دائماً (يمثل GoTrue)
 *    • عميل anon بلا جلسة يكتب brc.staff               → 42501 permission denied
 *    • عميل anon بجلسة مدير مُصادَق يكتب brc.staff     → يعمل
 *    • /rest/v1/staff بمفتاح الخدمة                    → يعمل (يتجاوز RLS)
 *
 *  التشغيل:  node tests/staff-accounts.mjs
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

const URL_BASE = 'https://x.supabase.co';
const SERVICE_KEY = 'sb_secret_test_service_role_key';

/* ===========================================================================
 *  العميل الوهمي — يحاكي GoTrue (Auth) وPostgREST (RLS) معاً
 * =========================================================================== */
function makeMock(opts = {}) {
  const calls = [];
  const state = Object.assign({
    staff: [], jobs: [], applicants: [], job_attempts: [], audit_log: [], settings: [],
    public_jobs: []
  }, opts.rows || {});
  let session = opts.session === undefined ? null : opts.session;   // { user: { id } }
  let seq = 1;
  const deny = () => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for table staff' } });

  /* من هو الموظف صاحب الجلسة؟ (brc.is_admin) */
  function sessionStaff() {
    if (!session || !session.user) return null;
    return state.staff.filter((s) => s.auth_id === session.user.id && s.active !== false)[0] || null;
  }

  function query(table) {
    table=table.replace(/^working_/, '');
    const q = { table, _op: null, _payload: null, _filters: [] };
    const api = {
      select() { if (!q._op) q._op = 'select'; return api; },
      insert(p) { q._op = 'insert'; q._payload = p; return api; },
      upsert(p) { q._op = 'upsert'; q._payload = p; return api; },
      update(p) { q._op = 'update'; q._payload = p; return api; },
      delete() { q._op = 'delete'; return api; },
      eq(c, v) { q._filters.push([c, v]); return api; },
      order() { return api; }, limit() { return api; }, single() { return api; },
      then(res, rej) {
        const rec = { table, op: q._op, payload: q._payload, filters: q._filters };
        calls.push(rec);
        const who = sessionStaff();

        /* ---- RLS على brc.staff (نفس سياسة staff_admin_write) ---- */
        if (table === 'staff') {
          if (q._op === 'insert' || q._op === 'upsert') {
            if (!(who && who.role === 'admin')) return deny().then(res, rej);
            const row = Object.assign({ id: 'staff-' + (seq++), active: true }, q._payload);
            const dup = state.staff.filter((s) => s.username === row.username || (row.auth_id && s.auth_id === row.auth_id))[0];
            if (dup) {
              if (q._op === 'insert') {
                return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "staff_username_key"' } }).then(res, rej);
              }
              Object.assign(dup, row);
              return Promise.resolve({ data: [dup], error: null }).then(res, rej);
            }
            state.staff.push(row);
            return Promise.resolve({ data: [row], error: null }).then(res, rej);
          }
          if (q._op === 'update') {
            if (!(who && who.role === 'admin')) return deny().then(res, rej);
            const hit = state.staff.filter((r) => q._filters.every(([c, v]) => String(r[c]) === String(v)));
            hit.forEach((r) => Object.assign(r, q._payload));
            return Promise.resolve({ data: hit, error: null }).then(res, rej);
          }
          /* select: سياسة staff_self_read — سطري أنا، أو الكل للمدير */
          const all = (who && who.role === 'admin')
            ? state.staff.slice()
            : state.staff.filter((s) => who && s.auth_id === who.auth_id);
          const rows = all.filter((r) => q._filters.every(([c, v]) => String(r[c]) === String(v)));
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        }

        if (q._op === 'insert') {
          const row = Object.assign({ id: 'uuid-' + (seq++) }, q._payload);
          (state[table] = state[table] || []).push(row);
          return Promise.resolve({ data: [row], error: null }).then(res, rej);
        }
        const rows = (state[table] || []).filter((r) => q._filters.every(([c, v]) => String(r[c]) === String(v)));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      }
    };
    return api;
  }

  const ch = {
    on() { return ch; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; }
  };

  const client = {
    __calls: calls, __state: state,
    supabaseUrl: URL_BASE,
    from: query,
    /* الدالة السحابية hrc-staff-admin: المكتبة الحقيقية تُوفّر functions دائماً.
       الافتراضي هنا «غير منشورة» (404) ليمرّ الاختبار بمسار مفتاح الخدمة،
       وتمرّر الاختبارات التي تريدها اختيارياً adminFn لتحاكي الدالة المنشورة. */
    functions: {
      invoke(name, o) {
        const body = (o && o.body) || {};
        calls.push({ fn: name, body });
        if (opts.adminFn) return Promise.resolve(opts.adminFn(body, { state, session: () => session }));
        return Promise.resolve({
          data: null,
          error: { message: 'Edge Function returned a non-2xx status code',
            context: { status: 404, json: () => Promise.resolve({ code: 'NOT_FOUND', message: 'Requested function was not found' }) } }
        });
      }
    },
    rpc(name, args) { calls.push({ rpc: name, args }); if(name==='staff_issuance_registry'&&sessionStaff())return Promise.resolve({data:args.p_serial==null?{version:1,bitmap:Buffer.alloc(595125).toString('base64')}:{used:false},error:null});return Promise.resolve({ data: null, error: { message: 'unknown rpc ' + name } }); },
    channel() { return ch; },
    removeChannel() { },
    auth: {
      signInWithPassword({ email, password }) {
        calls.push({ auth: 'signIn', email });
        const u = (opts.authUsers || []).filter((x) => x.email === email && x.password === password)[0];
        if (!u) return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
        session = { user: { id: u.id, email: u.email } };
        return Promise.resolve({ data: { user: session.user, session: { access_token: 'tk' } }, error: null });
      },
      getSession() {
        calls.push({ auth: 'getSession' });
        return Promise.resolve({ data: { session: session ? { user: session.user, access_token: 'tk' } : null }, error: null });
      },
      signOut() { session = null; return Promise.resolve({ error: null }); },
      updateUser() { return Promise.resolve({ error: null }); }
    },
    /* جلسة المدير تُفتح يدوياً في الاختبار (محاكاة دخول ناجح سابق) */
    __setSession(s) { session = s; },
    __session() { return session; }
  };
  return client;
}

/* ===========================================================================
 *  fetch وهمي: مسارات GoTrue Admin وPostgREST بمفتاح الخدمة
 * =========================================================================== */
function makeFetch(mock, opts = {}) {
  const seen = [];
  /* رد HTTP كامل الشكل: text() و json() كما في fetch الحقيقي */
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body == null ? '' : JSON.stringify(body)),
    json: () => Promise.resolve(body)
  });
  const fn = function (url, init) {
    init = init || {};
    const headers = init.headers || {};
    seen.push({ url, method: init.method || 'GET', headers, body: init.body ? JSON.parse(init.body) : null });
    const svc = headers.apikey === SERVICE_KEY || (headers.Authorization || '') === 'Bearer ' + SERVICE_KEY;

    /* ---- GoTrue Admin: إنشاء مستخدم ---- */
    if (/\/auth\/v1\/admin\/users/.test(url) && (init.method || 'GET').toUpperCase() === 'POST') {
      if (!svc) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const body = JSON.parse(init.body);
      const users = mock.__state.__authUsers || (mock.__state.__authUsers = []);
      const dup = users.filter((u) => u.email === body.email)[0];
      if (dup) {
        return Promise.resolve(reply(422, { code: 422, msg: 'A user with this email address has already been registered' }));
      }
      const u = { id: 'auth-' + (users.length + 1), email: body.email, password: body.password };
      users.push(u);
      return Promise.resolve(reply(200, { id: u.id, email: u.email }));
    }

    /* ---- GoTrue Admin: قراءة/بحث المستخدمين ---- */
    if (/\/auth\/v1\/admin\/users/.test(url) && (init.method || 'GET').toUpperCase() === 'GET') {
      if (!svc) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const users = mock.__state.__authUsers || [];
      const m = /email=([^&]+)/.exec(url);
      const want = m ? decodeURIComponent(m[1]) : null;
      const list = want ? users.filter((u) => u.email === want) : users;
      return Promise.resolve(reply(200, { users: list }));
    }

    /* ---- PostgREST بمفتاح الخدمة: يتجاوز RLS ---- */
    if (/\/rest\/v1\/staff/.test(url)) {
      if (!svc) return Promise.resolve(reply(401, { message: 'permission denied' }));
      const list = mock.__state.staff;
      const method = (init.method || 'GET').toUpperCase();

      /* GET: قراءة بمرشّحات PostgREST البسيطة (auth_id=eq.X / username=eq.Y / id=eq.Z) */
      if (method === 'GET') {
        let rows = list.slice();
        const m = /[?&](auth_id|username|id)=eq\.([^&]+)/.exec(url);
        if (m) rows = rows.filter((r) => String(r[m[1]] ?? '') === decodeURIComponent(m[2]));
        const sel = /select=([^&]+)/.exec(url);
        if (sel) {
          const cols = decodeURIComponent(sel[1]).split(',');
          rows = rows.map((r) => { const o = {}; cols.forEach((c) => { o[c] = r[c]; }); return o; });
        }
        return Promise.resolve(reply(200, rows));
      }
      /* DELETE */
      if (method === 'DELETE') {
        const m = /[?&](id|username)=eq\.([^&]+)/.exec(url);
        const hit = m ? list.filter((r) => String(r[m[1]] ?? '') === decodeURIComponent(m[2])) : [];
        mock.__state.staff = list.filter((r) => hit.indexOf(r) < 0);
        return Promise.resolve(reply(200, hit));
      }
      /* POST / PATCH: كتابة (upsert بـ auth_id أو username كما يفعل المُدرِج) */
      const row = init.body ? JSON.parse(init.body) : {};
      if (method === 'PATCH') {
        const m = /[?&]id=eq\.([^&]+)/.exec(url);
        const hit = m ? list.filter((r) => String(r.id) === decodeURIComponent(m[1])) : [];
        hit.forEach((r) => Object.assign(r, row));
        return Promise.resolve(reply(200, hit));
      }
      const dup = list.filter((s) => s.username === row.username || (row.auth_id && s.auth_id === row.auth_id))[0];
      if (dup) {
        Object.assign(dup, row);
        return Promise.resolve(reply(200, [dup]));
      }
      const created = Object.assign({ id: 'staff-' + (list.length + 1), active: true }, row);
      list.push(created);
      return Promise.resolve(reply(201, [created]));
    }

    return Promise.resolve(reply(404, { message: 'not found' }));
  };
  fn.__seen = seen;
  return fn;
}

/* ===========================================================================
 *  تحميل الطبقات في سياق معزول
 * =========================================================================== */
function boot(mock, extra = {}) {
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
  sandbox.console = { log: () => { }, warn: () => { }, error: () => { } };
  sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = () => 0; sandbox.clearInterval = () => { };
  sandbox.location = { origin: 'http://localhost', protocol: 'http:' };
  sandbox.HRCSupabaseConfig = {
    url: URL_BASE, publishableKey: 'sb_publishable_test', schema: 'brc',
    enabled: true, enforceAuth: extra.enforceAuth === true
  };
  sandbox.fetch = extra.fetch || makeFetch(mock);
  sandbox.supabase = { createClient: () => mock };
  /* fetch يُمرَّر كوسيط: بعض الملفات تنادي fetch مباشرةً (بلا window.) */
  const load = (f) => new Function('window', 'fetch', readFileSync(join(ROOT, 'assets/js/' + f), 'utf8'))(sandbox, sandbox.fetch);
  load('config.js');
  load('cloud.js');
  load('cloud-auth.js');
  load('cloud-sync.js');
  load('store.js');
  return { sandbox, Store: sandbox.HRCStore, Auth: sandbox.HRCCloudAuth, localStorage: stores.local };
}

/* حساب المدير الموجود مسبقاً في القاعدة (يُنشأ يدوياً مرة واحدة عند التهيئة) */
const ADMIN_STAFF = {
  id: 'staff-admin', auth_id: 'auth-admin', username: 'hussein', full_name: 'حسين المدير',
  role: 'admin', job_title: 'مدير عام', phone: '0770', active: true
};

console.log('\n' + '═'.repeat(74));
console.log('  HRC — إنشاء حسابات الموظفين من الإعدادات (المدير)');
console.log('═'.repeat(74));

/* ===========================================================================
 *  1) المدير داخل محلياً (الوضع الانتقالي) — أهمّ سيناريو واقعي
 * =========================================================================== */
step(1, 'المدير داخل محلياً (لا جلسة سحابية) ينشئ حساباً لموظفه');
let createdUsername = null;
{
  const mock = makeMock({
    rows: { staff: [Object.assign({}, ADMIN_STAFF)] }
  });
  const { Store } = boot(mock);          // لا جلسة سحابية — دخول محلي فقط
  Store.init();
  await sleep(120);

  const r = await Store.createCloudAccount(SERVICE_KEY, {
    username: 'ahmed', password: 'Ahmed@1234', name: 'أحمد محمد', role: 'staff', title: 'موظف توظيف'
  });
  createdUsername = 'ahmed';

  check('إنشاء الحساب نجح من منظور المدير', r && r.ok === true, JSON.stringify(r));

  const row = mock.__state.staff.filter((s) => s.username === 'ahmed')[0];
  check('سطر الموظف أُنشئ فعلاً في brc.staff (وهذا شرط الدخول)', !!row, JSON.stringify(mock.__state.staff.map((s) => s.username)));
  if (row) {
    check('السطر مرتبط بمستخدم Auth (auth_id) — بلا هذا لا يدخل الموظف', !!row.auth_id, JSON.stringify(row));
    check('الدور والمسمى والاسم كما أُدخلا', row.role === 'staff' && row.full_name === 'أحمد محمد' && row.job_title === 'موظف توظيف', JSON.stringify(row));
    check('الحساب نشط افتراضياً', row.active !== false);
  }
  const authUsers = mock.__state.__authUsers || [];
  check('مستخدم Auth أُنشئ بالبريد المشتقّ من اسم المستخدم',
    authUsers.some((u) => u.email === 'ahmed@hrc-babil.com'), JSON.stringify(authUsers.map((u) => u.email)));
}

/* ===========================================================================
 *  2) الموظف الجديد يدخل فعلاً ويصل إلى ملفه كاملاً
 * =========================================================================== */
step(2, 'الموظف الجديد يدخل ويصل إلى ملفه كاملاً (بلا أخطاء)');
{
  const mock = makeMock({
    rows: { staff: [
      Object.assign({}, ADMIN_STAFF),
      { id: 'staff-2', auth_id: 'auth-2', username: 'ahmed', full_name: 'أحمد محمد', role: 'staff', job_title: 'موظف توظيف', phone: '', active: true }
    ] },
    authUsers: [{ id: 'auth-2', email: 'ahmed@hrc-babil.com', password: 'Ahmed@1234' }]
  });
  const { Store } = boot(mock, { enforceAuth: true });
  Store.init();
  await sleep(120);

  const res = await Store.signIn('ahmed', 'Ahmed@1234');
  check('الدخول نجح', res && res.ok === true, JSON.stringify(res));
  if (res && res.ok) {
    check('الاسم والدور والمسمى وصلوا من brc.staff',
      res.profile.name === 'أحمد محمد' && res.profile.role === 'staff' && res.profile.title === 'موظف توظيف',
      JSON.stringify(res.profile));
    const s = Store.currentUser();
    check('الجلسة تحمل الدور الصحيح', s && s.role === 'staff' && s.cloud === true, JSON.stringify(s));
    check('الموظف ليس مديراً (لا صلاحيات إدارة)', Store.isAdmin() === false);
  }
}

/* ===========================================================================
 *  3) المحاولة الثانية بعد فشل جزئي (حساب Auth موجود بلا سطر staff)
 *     هذا ما يحدث فعلاً اليوم: يُنشأ Auth ثم يفشل الإدراج → الحساب معطوب للأبد
 * =========================================================================== */
step(3, 'إعادة المحاولة بعد فشل جزئي تُصلح الحساب (لا تعليق أبدي)');
{
  const mock = makeMock({ rows: { staff: [Object.assign({}, ADMIN_STAFF)] } });
  /* الحالة المعطوبة: مستخدم Auth موجود من محاولة سابقة، ولا سطر له في brc.staff */
  mock.__state.__authUsers = [{ id: 'auth-9', email: 'sara@hrc-babil.com', password: 'Sara@1234' }];

  const { Store } = boot(mock);
  Store.init();
  await sleep(120);

  const r = await Store.createCloudAccount(SERVICE_KEY, {
    username: 'sara', password: 'Sara@1234', name: 'سارة علي', role: 'staff', title: 'موظفة'
  });
  check('إعادة الإنشاء نجحت بدل «البريد مسجّل مسبقاً»', r && r.ok === true, JSON.stringify(r));
  const row = mock.__state.staff.filter((s) => s.username === 'sara')[0];
  check('سطر الموظف أُنشئ وربط بمستخدم Auth القديم نفسه',
    !!row && row.auth_id === 'auth-9', JSON.stringify(row));
  check('لم يُنشأ مستخدم Auth مكرر', (mock.__state.__authUsers || []).length === 1,
    JSON.stringify((mock.__state.__authUsers || []).map((u) => u.email)));
}

/* ===========================================================================
 *  4) التحقق من المدخلات قبل الشبكة — كل خطأ برسالة عربية مفهومة
 * =========================================================================== */
step(4, 'التحقق من المدخلات: لا نُنشئ حساباً لا يستطيع صاحبه الدخول');
{
  const mock = makeMock({ rows: { staff: [Object.assign({}, ADMIN_STAFF)] } });
  const fetchImpl = makeFetch(mock);
  const { Store } = boot(mock, { fetch: fetchImpl });
  Store.init();
  await sleep(120);
  const before = (mock.__state.__authUsers || []).length;

  const cases = [
    ['اسم مستخدم عربي لا يُشتقّ منه بريد صالح', { username: 'أحمد', password: 'Pass@1234', name: 'أحمد' }],
    ['اسم مستخدم فيه مسافة', { username: 'a b', password: 'Pass@1234', name: 'أحمد' }],
    ['اسم مستخدم قصير جداً', { username: 'a', password: 'Pass@1234', name: 'أحمد' }],
    ['كلمة مرور أقصر من 6 (يرفضها Auth)', { username: 'valid1', password: '123', name: 'أحمد' }],
    ['اسم كامل مفقود', { username: 'valid2', password: 'Pass@1234', name: '' }]
  ];
  for (const [title, data] of cases) {
    const r = await Store.createCloudAccount(SERVICE_KEY, data);
    check('مرفوض: ' + title, r && r.ok === false && !!r.error, JSON.stringify(r));
    check('الرفض برسالة عربية مفهومة: ' + title, r && r.error && /[\u0600-\u06FF]/.test(r.error), JSON.stringify(r));
  }
  check('لا طلب شبكي لأي مدخل مرفوض (لا حسابات معطوبة في Auth)',
    (mock.__state.__authUsers || []).length === before && fetchImpl.__seen.length === 0,
    JSON.stringify(fetchImpl.__seen.map((s) => s.url)));
}

/* ===========================================================================
 *  5) بلا مفتاح خدمة: رسالة توجّه المدير لخطوة الإصلاح
 * =========================================================================== */
step(5, 'بلا Service Role Key: رسالة واضحة لا خطأ غامض');
{
  const mock = makeMock({ rows: { staff: [Object.assign({}, ADMIN_STAFF)] } });
  const { Store } = boot(mock);
  Store.init();
  await sleep(120);

  const r = await Store.createCloudAccount('', { username: 'omar', password: 'Omar@1234', name: 'عمر' });
  check('مرفوض بوضوح', r && r.ok === false, JSON.stringify(r));
  check('الرسالة تُرشد إلى الإعدادات', /مفتاح|الإعدادات/.test(r.error || ''), r && r.error);
  check('لم يُنشأ أي مستخدم في Auth', (mock.__state.__authUsers || []).length === 0);
}

/* ===========================================================================
 *  6) المفتاح المرفوض من الخادم لا يُعلن نجاحاً
 * =========================================================================== */
step(6, 'مفتاح خدمة خاطئ: يُبلَّغ عن الفشل ولا يوعد الموظف بحساب غير موجود');
{
  const mock = makeMock({ rows: { staff: [Object.assign({}, ADMIN_STAFF)] } });
  const { Store } = boot(mock);
  Store.init();
  await sleep(120);

  const r = await Store.createCloudAccount('sb_secret_WRONG', {
    username: 'layla', password: 'Layla@1234', name: 'ليلى'
  });
  check('فشل مُعلَن', r && r.ok === false, JSON.stringify(r));
  check('لا سطر موظف وهمي في brc.staff', !mock.__state.staff.some((s) => s.username === 'layla'));
}

/* ===========================================================================
 *  7) الدالة السحابية hrc-staff-admin — إنشاء بلا أي مفتاح في المتصفح
 *     (هذا هو المسار الموصى به: المفتاح يبقى في خوادم Supabase وحدها)
 * =========================================================================== */
step(7, 'الدالة السحابية: المدير ينشئ حساباً بلا أي مفتاح في المتصفح');
{
  /* محاكاة الدالة: تتحقق من الجلسة ومن أن صاحبها مدير نشط — كما يفعل الملف الفعلي
     (سلوك الملف نفسه مُختبَر في tests/staff-admin-function.mjs) */
  const fnState = { staff: [Object.assign({}, ADMIN_STAFF)] };
  const mock = makeMock({
    rows: { staff: fnState.staff },
    adminFn: (body, ctx) => {
      const sess = ctx.session();
      const who = sess && (ctx.state.staff || []).filter((s) => s.auth_id === sess.user.id && s.active !== false)[0];
      if (!sess) return { data: { ok: false, code: 'no_token', error: 'الجلسة مطلوبة' }, error: null };
      if (!who || who.role !== 'admin') return { data: { ok: false, code: 'not_admin', error: 'هذه الصلاحية للمدير العام فقط' }, error: null };
      if (body.action !== 'create') return { data: { ok: true }, error: null };
      const email = body.username + '@' + (body.domain || 'hrc-babil.com');
      const u = { id: 'auth-fn-' + (ctx.state.staff.length + 1), email, password: body.password };
      (ctx.state.__authUsers = ctx.state.__authUsers || []).push(u);
      const row = { id: 'staff-fn-' + (ctx.state.staff.length + 1), auth_id: u.id, username: body.username,
        full_name: body.name, role: body.role || 'staff', job_title: body.title || '', phone: body.phone || '', active: true };
      ctx.state.staff.push(row);
      return { data: { ok: true, authId: u.id, email, staff: row }, error: null };
    }
  });
  /* جلسة مدير سحابية — في الإنتاج الدخول عبر Supabase Auth يعطيها تلقائياً */
  mock.__setSession({ user: { id: 'auth-admin' } });
  const { Store } = boot(mock);
  Store.init();
  await sleep(150);

  const r = await Store.staffAdmin('create', { username: 'rand', password: 'Rand@1234', name: 'رند علي', role: 'staff', title: 'موظفة' });
  check('الإنشاء عبر الدالة نجح بلا أي مفتاح', r && r.ok === true, JSON.stringify(r));

  const row = fnState.staff.filter((s) => s.username === 'rand')[0];
  check('سطر الموظف أُنشئ في القاعدة (يدخل من أي جهاز)', !!row, JSON.stringify(fnState.staff.map((s) => s.username)));
  check('السطر ظهر في الذاكرة المحلية فوراً (بلا إعادة تحميل)',
    Store.listUsers().some((u) => u.username === 'rand' && u.source === 'cloud'),
    JSON.stringify(Store.listUsers().map((u) => u.username + ':' + u.source)));
  const sent = mock.__calls.filter((c) => c.fn).pop();
  check('النداء ذهب إلى الدالة باسمها الصحيح', !!sent && sent.fn === 'hrc-staff-admin', JSON.stringify(sent && sent.fn));
  check('الطلب يحمل الإجراء والبريد المشتقّ (domain)', sent && sent.body.action === 'create' && !!sent.body.domain,
    JSON.stringify(sent && sent.body));
  check('لم يُستعمل أي مفتاح خدمة في هذا المسار', !mock.__calls.some((c) => c.fn === 'authAdminBypass'));
}

/* ===========================================================================
 *  8) موظف عادي: الدالة ترفضه (الصلاحية في القاعدة لا في الواجهة)
 * =========================================================================== */
step(8, 'موظف غير مدير: الدالة ترفض ولا يُنشأ شيء');
{
  const fnState = { staff: [
    Object.assign({}, ADMIN_STAFF),
    { id: 'staff-e', auth_id: 'auth-e', username: 'ali', full_name: 'علي', role: 'staff', job_title: '', phone: '', active: true }
  ] };
  const mock = makeMock({
    rows: { staff: fnState.staff },
    adminFn: (body, ctx) => {
      const sess = ctx.session();
      const who = sess && (ctx.state.staff || []).filter((s) => s.auth_id === sess.user.id && s.active !== false)[0];
      if (!who || who.role !== 'admin') return { data: { ok: false, code: 'not_admin', error: 'هذه الصلاحية للمدير العام فقط' }, error: null };
      return { data: { ok: true }, error: null };
    }
  });
  mock.__setSession({ user: { id: 'auth-e' } });
  const { Store } = boot(mock);
  Store.init();
  await sleep(150);

  const r = await Store.staffAdmin('create', { username: 'ghost', password: 'Ghost@123', name: 'متسلل' });
  check('مرفوض برسالة المدير العام', r && r.ok === false && r.code === 'not_admin', JSON.stringify(r));
  check('لم يُنشأ أي سطر موظف', !fnState.staff.some((s) => s.username === 'ghost'));
}

/* ===========================================================================
 *  9) الدالة غير منشورة → not_deployed (ليتفرّع المتصفح للمسار الاحتياطي)
 * =========================================================================== */
step(9, 'الدالة غير منشورة: رمز صريح يسمح بالمسار الاحتياطي');
{
  const mock = makeMock({ rows: { staff: [Object.assign({}, ADMIN_STAFF)] } });
  mock.__setSession({ user: { id: 'auth-admin' } });
  const { Store } = boot(mock);
  Store.init();
  await sleep(150);

  const r = await Store.staffAdmin('create', { username: 'x', password: 'Pass@1234', name: 'اسم' });
  check('الرمز not_deployed (لا فشل غامض)', r && r.ok === false && r.code === 'not_deployed', JSON.stringify(r));
  check('الرسالة مفهومة بالعربية', /[؀-ۿ]/.test(r.error || ''), r && r.error);
}

/* ===========================================================================
 *  الخلاصة
 * =========================================================================== */
console.log('\n' + '─'.repeat(74));
console.log((fail ? '  ❌ ' : '  ✅ ') + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log(); problems.forEach((p) => console.log('     • ' + p)); }
console.log('─'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
