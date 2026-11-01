#!/usr/bin/env node
/* ===========================================================================
 *  HRC — إدارة الموظفين من الإعدادات (صفحة حقيقية + قاعدة وهمية)
 *  ---------------------------------------------------------------------------
 *  يشغّل dashboard.html الفعلية بكل سكربتاتها، ويضغط الأزرار كما يضغطها المدير:
 *
 *    1. يدخل المدير بحساب Supabase Auth ويذهب إلى «الإعدادات والنسخ».
 *    2. يضغط «إضافة موظف» ← يملأ النموذج ← «إنشاء الحساب».
 *    3. يُصبح الحساب في قاعدة الشركة (Auth + brc.staff) ويظهر في الجدول معلَّماً
 *       «القاعدة» — أي أن الموظف يدخل من أي جهاز.
 *    4. «تعطيل» يُوقف الدخول فعلاً في القاعدة (لا الشاشة وحدها).
 *    5. «تعديل» يحدّث سطر القاعدة، و«حذف» يحذف السطر ومستخدم الدخول.
 *
 *  لماذا هذا الملف؟ لأن الطبقات المنفصلة كانت تعمل بينما الطريق الذي يسلكه
 *  المدير فعلاً (زر ← نموذج ← قاعدة) فيه العلّتان المكتشفتان 2026-10-13:
 *  إدراج brc.staff مرفوض بـ 42501 في الوضع الانتقالي، وتعديل موظف القاعدة يفشل
 *  بـ«المستخدم غير موجود محلياً».
 *
 *  التشغيل:  node tests/dashboard-users.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const URL_BASE = 'https://x.supabase.co';
const SERVICE_KEY = 'sb_secret_test_service_role_key';
const ADMIN_PASS = 'CloudAdmin@Test123';

/* ===========================================================================
 *  عميل سوبابيس وهمي داخل الصفحة (بديل vendor/supabase.js)
 * =========================================================================== */
const MOCK_SRC = `
window.__brcMock = (function () {
  var st = window.__state;
  function q(table) {
    table=table.replace(/^working_/, '');
    var api = {
      select: function () { return api; }, insert: function () { return api; }, update: function () { return api; },
      upsert: function () { return api; }, delete: function () { return api; }, eq: function () { return api; },
      order: function () { return api; }, limit: function () { return api; }, single: function () { return api; },
      then: function (res, rej) { return Promise.resolve({ data: (st[table] || []).slice(), error: null }).then(res, rej); }
    };
    return api;
  }
  var ch = { on: function () { return ch; }, subscribe: function (cb) { if (cb) cb('SUBSCRIBED'); return ch; } };
  return {
    supabaseUrl: '${URL_BASE}',
    from: q,
    /* الدالة السحابية hrc-staff-admin: الافتراضي «غير منشورة» (404) كما في
       مشروع لم تُنشر فيه بعد — فتمرّ الاختبارات بمسار مفتاح الخدمة. وتُشغَّل
       بمحاكاة كاملة عند ضبط __state.fnOn (انظر القسم 8). */
    functions: {
      invoke: function (name, o) {
        var body = (o && o.body) || {};
        window.__state.fnCalls = (window.__state.fnCalls || []).concat([{ name: name, body: body }]);
        /* انقطاع الشبكة: نفس ما تنتجه المكتبة الحقيقية عند فشل النقل — خطأ بلا
           context (FunctionsFetchError) برسالة إنجليزية. نُحاكيه لنثبت أن المستخدم
           يرى عربية وأن المسار الاحتياطي (مفتاح الخدمة) يُجرَّب. */
        if (window.__state.fnOn === 'network') {
          return Promise.resolve({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } });
        }
        if (window.__state.fnOn === 'noSession') {
          return Promise.resolve({ data: { ok: false, code: 'no_token', error: 'الجلسة مطلوبة — سجّل الدخول كمدير' }, error: null });
        }
        if (window.__state.fnOn === 'oldFn') {
          return Promise.resolve({ data: { ok: false, code: 'bad_action', error: 'إجراء غير معروف: whoami' }, error: null });
        }
        if (window.__state.fnOn === 'notAdmin') {
          return Promise.resolve({ data: { ok: false, code: 'not_admin', error: 'هذه الصلاحية للمدير العام فقط' }, error: null });
        }
        if (!window.__state.fnOn) {
          return Promise.resolve({ data: null, error: { message: 'Edge Function returned a non-2xx status code',
            context: { status: 404, json: function () { return Promise.resolve({ code: 'NOT_FOUND', message: 'Requested function was not found' }); } } } });
        }
        var st = window.__state;
        if (body.action === 'create') {
          var email = body.username + '@' + (body.domain || 'hrc-babil.com');
          var u = { id: 'auth-fn-' + (st.authUsers.length + 1), email: email, password: body.password };
          st.authUsers.push(u);
          var row = { id: 'staff-fn-' + (st.staff.length + 1), auth_id: u.id, username: body.username,
            full_name: body.name, role: body.role || 'staff', job_title: body.title || '', phone: body.phone || '', active: true };
          st.staff.push(row);
          return Promise.resolve({ data: { ok: true, authId: u.id, email: email, staff: row }, error: null });
        }
        if (body.action === 'update') {
          var t = st.staff.filter(function (x) { return x.id === body.id; })[0];
          if (t) { t.full_name = body.name; t.role = body.role; t.job_title = body.title; t.active = body.active !== false; }
          return Promise.resolve({ data: { ok: true, staff: t }, error: null });
        }
        if (body.action === 'delete') {
          st.staff = st.staff.filter(function (x) { return x.id !== body.id; });
          return Promise.resolve({ data: { ok: true, rowDeleted: true, authDeleted: true }, error: null });
        }
        if (body.action === 'set-password') {
          var au = st.authUsers.filter(function (x) { return x.id === body.authId; })[0];
          if (au) au.password = body.password;
          return Promise.resolve({ data: { ok: true }, error: null });
        }
        /* إجراء تشخيصي: يُستعمل من «فحص القناة» في اللوحة — لا يعدّل شيئاً */
        if (body.action === 'whoami') {
          return Promise.resolve({ data: { ok: true, staff: st.staff[0] }, error: null });
        }
        return Promise.resolve({ data: { ok: false, code: 'bad_action', error: 'إجراء غير معروف' }, error: null });
      }
    },
    rpc: function (name,args) {if(name==='staff_issuance_registry'&&st.cloudSession&&st.staff.some(function(s){return s.active!==false;}))return Promise.resolve({data:args.p_serial==null?{version:1,bitmap:btoa(String.fromCharCode(0).repeat(595125))}:{used:false},error:null});return Promise.resolve({ data: null, error: { message: 'no rpc in mock' } }); },
    channel: function () { return ch; }, removeChannel: function () { },
    auth: {
      signInWithPassword: function (credentials) {
        if (credentials.email !== 'admin@hrc-babil.com' || credentials.password !== '${ADMIN_PASS}') {
          return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
        }
        return Promise.resolve({ data: { user: { id: 'auth-admin', email: credentials.email }, session: { access_token: 'admin-test-token' } }, error: null });
      },
      getSession: function () { return Promise.resolve({ data: { session: window.__state.cloudSession || null }, error: null }); },
      signOut: function () { return Promise.resolve({ error: null }); },
      updateUser: function () { return Promise.resolve({ error: null }); }
    }
  };
})();
window.supabase = { createClient: function () { return window.__brcMock; } };
`;

/* موارد الصفحة تُقرأ من القرص عبر أصل حقيقي (http://hrc.test) — لأن localStorage
   (وفيه مفتاح الخدمة) لا يعمل على أصل ملفات file:// المعتم. */
const ORIGIN = 'http://hrc.test';
class Loader extends ResourceLoader {
  fetch(url, options) {
    if (url.includes('/vendor/supabase.js')) return Promise.resolve(Buffer.from(MOCK_SRC, 'utf8'));
    if (url.startsWith(ORIGIN + '/')) {
      const rel = decodeURIComponent(url.slice(ORIGIN.length + 1).split('?')[0].split('#')[0]);
      return Promise.resolve(readFileSync(resolve(ROOT, rel)));
    }
    return super.fetch(url, options);
  }
}

/* ===========================================================================
 *  fetch الوهمي: GoTrue Admin + PostgREST بمفتاح الخدمة (ويتجاوز RLS)
 * =========================================================================== */
function makeState() {
  return {
    calls: [],
    staff: [{ id: 'staff-admin', auth_id: 'auth-admin', username: 'admin', full_name: 'مدير اختبار', role: 'admin', job_title: 'مدير عام', phone: '', active: true }],
    authUsers: [],
    jobs: [{
      id: 'job-test-7777', code: 'HRC-7777', title: 'وظيفة معلنة', category: 'خدمات', region: 'بابل', salary_min: 500000,
      salary_max: 700000, shift: 'صباحي', gender: 'لا فرق', vacancies: 2, requirements: [], status: 'available',
      hold_expires_at: null, created_at: '2026-01-01T00:00:00.000Z', description: 'وصف', image_url: ''
    }]
  };
}

function makeFetch(state) {
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    text: () => Promise.resolve(body == null ? '' : JSON.stringify(body))
  });
  return function (url, init) {
    init = init || {};
    const headers = init.headers || {};
    const method = (init.method || 'GET').toUpperCase();
    const svc = headers.apikey === SERVICE_KEY || headers.Authorization === 'Bearer ' + SERVICE_KEY;
    state.calls.push({ url, method, svc, body: init.body ? JSON.parse(init.body) : null });

    if (/\/auth\/v1\/admin\/users/.test(url) && method === 'POST') {
      if (!svc) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const body = JSON.parse(init.body);
      if (state.authUsers.some((u) => u.email === body.email)) {
        return Promise.resolve(reply(422, { code: 422, msg: 'A user with this email address has already been registered' }));
      }
      const u = { id: 'auth-' + (state.authUsers.length + 1), email: body.email, password: body.password };
      state.authUsers.push(u);
      return Promise.resolve(reply(200, { id: u.id, email: u.email }));
    }
    if (/\/auth\/v1\/admin\/users/.test(url) && method === 'GET') {
      if (!svc) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      return Promise.resolve(reply(200, { users: state.authUsers.slice() }));
    }
    if (/\/auth\/v1\/admin\/users\//.test(url) && method === 'PUT') {
      if (!svc) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const id = url.split('/').pop().split('?')[0];
      const u = state.authUsers.filter((x) => x.id === id)[0];
      if (u) u.password = JSON.parse(init.body).password;
      return Promise.resolve(reply(200, u || {}));
    }
    if (/\/auth\/v1\/admin\/users\//.test(url) && method === 'DELETE') {
      if (!svc) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const id = url.split('/').pop().split('?')[0];
      state.authUsers = state.authUsers.filter((x) => x.id !== id);
      return Promise.resolve(reply(200, {}));
    }
    if (/\/rest\/v1\/staff/.test(url)) {
      if (!svc) return Promise.resolve(reply(401, { message: 'permission denied for table staff' }));
      const list = state.staff;
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
      if (method === 'DELETE') {
        const m = /[?&](id|username)=eq\.([^&]+)/.exec(url);
        const hit = m ? list.filter((r) => String(r[m[1]] ?? '') === decodeURIComponent(m[2])) : [];
        state.staff = list.filter((r) => hit.indexOf(r) < 0);
        return Promise.resolve(reply(200, hit));
      }
      const row = init.body ? JSON.parse(init.body) : {};
      if (method === 'PATCH') {
        const m = /[?&]id=eq\.([^&]+)/.exec(url);
        const hit = m ? list.filter((r) => String(r.id) === decodeURIComponent(m[1])) : [];
        hit.forEach((r) => Object.assign(r, row));
        return Promise.resolve(reply(200, hit));
      }
      const dup = list.filter((s) => s.username === row.username || (row.auth_id && s.auth_id === row.auth_id))[0];
      if (dup) { Object.assign(dup, row); return Promise.resolve(reply(200, [dup])); }
      const created = Object.assign({ id: 'staff-' + (list.length + 1), active: true }, row);
      list.push(created);
      return Promise.resolve(reply(201, [created]));
    }
    return Promise.resolve(reply(404, { message: 'not found' }));
  };
}

/* ===========================================================================
 *  فتح الصفحة الحقيقية
 * =========================================================================== */
async function open(state) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => { if (!/Could not load|Not implemented/.test(String(e.message))) errors.push(String(e.message)); });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

  const bridge = makeFetch(state);
  const dom = await JSDOM.fromFile(resolve(ROOT, 'dashboard.html'), {
    url: ORIGIN + '/dashboard.html',
    runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.__state = state;
      window.__fetchImpl = bridge;
      window.fetch = function (url, init) { return window.__fetchImpl(url, init); };
    }
  });
  await sleep(300);
  return { dom, window: dom.window, doc: dom.window.document, errors };
}

function login(window, doc, user, pass) {
  doc.getElementById('login-user').value = user;
  doc.getElementById('login-pass').value = pass;
  doc.getElementById('login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
const shellsShown = (doc) => !doc.getElementById('app-shell').classList.contains('hidden');
const userRowEl = (doc, username) =>
  [...doc.querySelectorAll('#users-table-body tr')].filter((tr) => tr.getAttribute('data-user') === username || tr.textContent.includes(username))[0] || null;

console.log('\n' + '═'.repeat(74));
console.log('  HRC — إدارة الموظفين من الإعدادات (صفحة حقيقية + قاعدة وهمية)');
console.log('═'.repeat(74));

const state = makeState();
const app = await open(state);

/* ===========================================================================
 *  1) الدخول والوصول إلى الإعدادات
 * =========================================================================== */
step(1, 'المدير يدخل ويصل إلى «إدارة الموظفين والصلاحيات»');
check('لا أخطاء JavaScript في الصفحة', app.errors.length === 0 || app.errors.join(' | '));
login(app.window, app.doc, 'admin', ADMIN_PASS);
await sleep(300);
check('الدخول نجح واللوحة ظاهرة', shellsShown(app.doc));

const settingsBtn = app.doc.querySelector('#side-nav button[data-view="settings"]');
check('زر الإعدادات موجود للمدير', !!settingsBtn);
settingsBtn.click();
await sleep(120);
check('قسم الإعدادات ظاهر', !app.doc.getElementById('view-settings').classList.contains('hidden'));
check('زر «إضافة موظف» موجود', !!app.doc.getElementById('btn-add-user'));

/* المدير يحفظ مفتاح الخدمة مرة واحدة (كما يفعل من «ربط السحابة») */
app.window.localStorage.setItem('hrc-service-key', SERVICE_KEY);

/* ===========================================================================
 *  2) إنشاء موظف: الزر ← النموذج ← «إنشاء الحساب»
 * =========================================================================== */
step(2, 'إنشاء حساب موظف من النموذج — يجب أن ينتهي في قاعدة الشركة');
app.doc.getElementById('btn-add-user').click();
await sleep(80);
check('نافذة «إضافة موظف جديد» فُتحت', !!app.doc.getElementById('user-form'));

app.doc.getElementById('uf-name').value = 'أحمد محمد';
app.doc.getElementById('uf-user').value = 'ahmed';
app.doc.getElementById('uf-pass').value = 'Ahmed@1234';
app.doc.getElementById('uf-title').value = 'موظف توظيف';
app.doc.getElementById('uf-save').click();
await sleep(300);

const staffRow = state.staff.filter((s) => s.username === 'ahmed')[0];
check('سطر الموظف أُنشئ في brc.staff (شرط الدخول من أي جهاز)', !!staffRow,
  JSON.stringify(state.staff.map((s) => s.username)));
check('سطر الموظف مرتبط بمستخدم Auth', !!staffRow && !!staffRow.auth_id, JSON.stringify(staffRow));
check('مستخدم Auth أُنشئ بالبريد المشتقّ', state.authUsers.some((u) => u.email === 'ahmed@hrc-babil.com'),
  JSON.stringify(state.authUsers.map((u) => u.email)));
const errBox = app.doc.getElementById('user-form-err');
check('لا رسالة فشل معروضة في النموذج (النافذة أُغلقت بعد النجاح)', !errBox || errBox.classList.contains('hidden'),
  errBox && errBox.textContent);
check('النافذة أُغلقت بعد النجاح (لا نموذج مفتوح على حساب أُنشئ)', !app.doc.getElementById('user-form'));
check('نجاح ظاهر للمدير برسالة صريحة',
  [...app.doc.querySelectorAll('#toast-root .toast')].some((x) => /تم إنشاء الحساب/.test(x.textContent)),
  JSON.stringify([...app.doc.querySelectorAll('#toast-root .toast')].map((x) => x.textContent.slice(0, 50))));

const rowNow = userRowEl(app.doc, 'ahmed');
check('الموظف ظهر في جدول الموظفين', !!rowNow, 'لم يظهر');
check('الجدول يُعلّم أنه حساب قاعدة (لا محلي)', !!rowNow && /القاعدة/.test(rowNow.textContent), rowNow && rowNow.textContent);
check('الوظائف المعلنة لم تتأثر بإنشاء الحساب', app.window.HRCStore.listJobs({}).some((j) => j.code === 'HRC-7777'));

/* ===========================================================================
 *  3) التعطيل — يوقف الدخول فعلاً في القاعدة
 * =========================================================================== */
step(3, '«تعطيل» يوقف الدخول في قاعدة الشركة لا في الشاشة فقط');
[
  ...app.doc.querySelectorAll('#users-table-body [data-user-toggle]')
].filter((b) => b.getAttribute('data-user-toggle') === 'ahmed')[0].click();
await sleep(300);

const patched = state.staff.filter((s) => s.username === 'ahmed')[0];
check('سطر القاعدة صار معطّلاً (المنع الحقيقي)', patched && patched.active === false, JSON.stringify(patched));
const toggleBtn = [...app.doc.querySelectorAll('#users-table-body [data-user-toggle]')]
  .filter((b) => b.getAttribute('data-user-toggle') === 'ahmed')[0];
check('الزر انقلب إلى «تنشيط» بعد التعطيل', !!toggleBtn && /تنشيط/.test(toggleBtn.textContent), toggleBtn && toggleBtn.textContent);

/* ===========================================================================
 *  4) التعديل — يحدّث سطر القاعدة
 * =========================================================================== */
step(4, '«تعديل» يحفظ في القاعدة (كان يفشل بـ«المستخدم غير موجود محلياً»)');
[...app.doc.querySelectorAll('#users-table-body [data-user-edit]')]
  .filter((b) => b.getAttribute('data-user-edit') === 'ahmed')[0].click();
await sleep(80);
check('نافذة التعديل فُتحت باسم الموظف', !!app.doc.getElementById('user-form') &&
  /أحمد محمد/.test((app.doc.querySelector('.modal-head h3') || {}).textContent || ''));
app.doc.getElementById('uf-title').value = 'مشرف توظيف';
app.doc.getElementById('uf-active').checked = true;
app.doc.getElementById('uf-save').click();
await sleep(300);

const edited = state.staff.filter((s) => s.username === 'ahmed')[0];
check('سطر القاعدة تحدّث بالمسمى الجديد', edited && edited.job_title === 'مشرف توظيف', JSON.stringify(edited));
check('سطر القاعدة رجع نشطاً', edited && edited.active !== false, JSON.stringify(edited));

/* ===========================================================================
 *  5) كلمة المرور — تُغيَّر في Auth لا في المتصفح
 * =========================================================================== */
step(5, 'تغيير كلمة المرور يصل إلى مستخدم الدخول في القاعدة');
[...app.doc.querySelectorAll('#users-table-body [data-user-edit]')]
  .filter((b) => b.getAttribute('data-user-edit') === 'ahmed')[0].click();
await sleep(80);
app.doc.getElementById('uf-pass').value = 'Ahmed@9999';
app.doc.getElementById('uf-save').click();
await sleep(300);
const au = state.authUsers.filter((u) => u.email === 'ahmed@hrc-babil.com')[0];
check('كلمة المرور تغيّرت في Auth', au && au.password === 'Ahmed@9999', JSON.stringify(au));

/* ===========================================================================
 *  6) الحذف — السطر ومستخدم الدخول معاً
 * =========================================================================== */
step(6, '«حذف» يُزيل سطر الموظف ومستخدم الدخول من القاعدة');
[...app.doc.querySelectorAll('#users-table-body [data-user-del]')]
  .filter((b) => b.getAttribute('data-user-del') === 'ahmed')[0].click();
await sleep(80);
check('نافذة التأكيد ظهرت', !!app.doc.querySelector('#modal-root [data-ok]'));
app.doc.querySelector('#modal-root [data-ok]').click();
await sleep(350);

check('سطر الموظف حُذف من brc.staff', !state.staff.some((s) => s.username === 'ahmed'));
check('مستخدم الدخول حُذف من Auth', !state.authUsers.some((u) => u.email === 'ahmed@hrc-babil.com'),
  JSON.stringify(state.authUsers.map((u) => u.email)));
check('الموظف اختفى من الجدول', !userRowEl(app.doc, 'ahmed'));
check('سطر المدير نفسه لم يُمسّ', state.staff.some((s) => s.username === 'admin'));

/* ===========================================================================
 *  7) الفشل يُعلَن ولا يُوهم بنجاح
 * =========================================================================== */
step(7, 'مفتاح خدمة خاطئ: لا حساب وهمي في الجدول');
const state2 = makeState();
const app2 = await open(state2);
login(app2.window, app2.doc, 'admin', ADMIN_PASS);
await sleep(250);
app2.doc.querySelector('#side-nav button[data-view="settings"]').click();
await sleep(100);
app2.window.localStorage.setItem('hrc-service-key', 'sb_secret_WRONG');
app2.doc.getElementById('btn-add-user').click();
await sleep(80);
app2.doc.getElementById('uf-name').value = 'ليلى حسين';
app2.doc.getElementById('uf-user').value = 'layla';
app2.doc.getElementById('uf-pass').value = 'Layla@1234';
app2.doc.getElementById('uf-save').click();
await sleep(300);

check('لا سطر وهمي في القاعدة', !state2.staff.some((s) => s.username === 'layla'),
  JSON.stringify(state2.staff.map((s) => s.username)));
check('لا حساب محلي يُوهم المدير', !app2.window.HRCStore.listUsers().some((u) => u.username === 'layla'));
const errBox2 = app2.doc.getElementById('user-form-err');
check('الخطأ ظاهر داخل النموذج (لا يُغلق النافذة بصمت)', !!errBox2 && !errBox2.classList.contains('hidden'),
  errBox2 && errBox2.textContent.slice(0, 90));
check('النافذة بقيت مفتوحة ليصحّح المدير المدخل', !!app2.doc.getElementById('user-form'));

/* ===========================================================================
 *  8) الدالة السحابية منشورة: إنشاء موظف **بلا أي مفتاح في المتصفح**
 *     — هذا هو الوضع الموصى به: أي مدير، بأي متصفح، بلا لصق أي سرّ.
 * =========================================================================== */
step(8, 'بلا أي مفتاح في المتصفح: الإدارة تعمل عبر الدالة السحابية');
const state3 = makeState();
state3.fnOn = true;                       // الدالة منشورة ومتاحة
const app3 = await open(state3);
login(app3.window, app3.doc, 'admin', ADMIN_PASS);
await sleep(250);
app3.doc.querySelector('#side-nav button[data-view="settings"]').click();
await sleep(100);

check('لا مفتاح خدمة محفوظ في هذا المتصفح', !app3.window.localStorage.getItem('hrc-service-key'));

app3.doc.getElementById('btn-add-user').click();
await sleep(80);
app3.doc.getElementById('uf-name').value = 'رند علي';
app3.doc.getElementById('uf-user').value = 'rand';
app3.doc.getElementById('uf-pass').value = 'Rand@1234';
app3.doc.getElementById('uf-title').value = 'موظفة توظيف';
app3.doc.getElementById('uf-save').click();
await sleep(300);

check('الحساب أُنشئ في القاعدة عبر الدالة', state3.staff.some((s) => s.username === 'rand'),
  JSON.stringify(state3.staff.map((s) => s.username)));
check('مستخدم Auth أُنشئ بالبريد المشتقّ', state3.authUsers.some((u) => u.email === 'rand@hrc-babil.com'),
  JSON.stringify(state3.authUsers.map((u) => u.email)));
check('النداء ذهب إلى الدالة hrc-staff-admin',
  (state3.fnCalls || []).some((c) => c.name === 'hrc-staff-admin' && c.body.action === 'create'),
  JSON.stringify((state3.fnCalls || []).map((c) => c.body.action)));
check('الموظف ظهر في الجدول معلَّماً «القاعدة»',
  /القاعدة/.test((userRowEl(app3.doc, 'rand') || {}).textContent || ''),
  (userRowEl(app3.doc, 'rand') || {}).textContent);
check('ما زال بلا أي مفتاح بعد الإنشاء (لم يُطلب أبداً)',
  !app3.window.localStorage.getItem('hrc-service-key'));

/* التعديل والحذف من نفس المتصفح بلا مفاتيح */
[...app3.doc.querySelectorAll('#users-table-body [data-user-edit]')]
  .filter((b) => b.getAttribute('data-user-edit') === 'rand')[0].click();
await sleep(80);
app3.doc.getElementById('uf-title').value = 'مشرفة';
app3.doc.getElementById('uf-save').click();
await sleep(300);
check('التعديل وصل القاعدة عبر الدالة',
  (state3.staff.filter((s) => s.username === 'rand')[0] || {}).job_title === 'مشرفة',
  JSON.stringify(state3.staff.filter((s) => s.username === 'rand')[0]));

[...app3.doc.querySelectorAll('#users-table-body [data-user-del]')]
  .filter((b) => b.getAttribute('data-user-del') === 'rand')[0].click();
await sleep(80);
app3.doc.querySelector('#modal-root [data-ok]').click();
await sleep(350);
check('الحذف وصل القاعدة عبر الدالة', !state3.staff.some((s) => s.username === 'rand'));
check('الموظف اختفى من الجدول', !userRowEl(app3.doc, 'rand'));

app3.dom.window.close && app3.dom.window.close();

/* ===========================================================================
 *  9) الدالة منشورة والمتصفح داخل محلياً: رسالة تقود للخطوة، ولا حساب وهمي
 *     (أكثر ما يصطدم به المدير فعلاً في الوضع الانتقالي)
 * =========================================================================== */
step(9, 'دخول محلي + دالة منشورة: يُقال للمدير ما يفعل — بلا حساب وهمي');
const state4 = makeState();
state4.fnOn = 'noSession';               // الدالة منشورة لكن لا جلسة سحابية لهذا المتصفح
const app4 = await open(state4);
login(app4.window, app4.doc, 'admin', ADMIN_PASS);
await sleep(250);
check('الدخول المحلي نجح (الوضع الانتقالي)', shellsShown(app4.doc));
app4.doc.querySelector('#side-nav button[data-view="settings"]').click();
await sleep(100);

app4.doc.getElementById('btn-add-user').click();
await sleep(80);
app4.doc.getElementById('uf-name').value = 'مروان';
app4.doc.getElementById('uf-user').value = 'marwan';
app4.doc.getElementById('uf-pass').value = 'Marwan@1234';
app4.doc.getElementById('uf-save').click();
await sleep(350);

const errBox3 = app4.doc.getElementById('user-form-err');
const errText = errBox3 ? errBox3.textContent : '';
check('الخطأ ظاهر في النموذج', !!errBox3 && !errBox3.classList.contains('hidden'));
check('الرسالة تقود للخطوة الصحيحة (الدخول بحسابك الرسمي)', /حسابك الرسمي|جلسة قاعدة/.test(errText), errText.slice(0, 120));
check('لم يُنشأ سطر موظف في القاعدة', !state4.staff.some((s) => s.username === 'marwan'));
check('لم يُنشأ حساب محلي يوهم المدير', !app4.window.HRCStore.listUsers().some((u) => u.username === 'marwan'));
check('لم يُنشأ أي مستخدم Auth', !state4.authUsers.some((u) => u.email === 'marwan@hrc-babil.com'));

app4.dom.window.close && app4.dom.window.close();

/* ===========================================================================
 *  10) لا دالة ولا مفتاح: المدير يُوجَّه إلى القناة — لا حساب محلي صامت
 *      (كان النظام يُنشئ حساباً محلياً ويُخبر المدير بعدها؛ فيظن أن الموظف أُضيف
 *       وهو لا يدخل من أي جهاز. الصواب: الخطوة المطلوبة تُعرض قبل الإنشاء)
 * =========================================================================== */
step(10, 'لا دالة ولا مفتاح: الخطوة المطلوبة تُعرض بدل حساب محلي صامت');
const state5 = makeState();            // fnOn غير مفعّل = الدالة غير منشورة
const app5 = await open(state5);
login(app5.window, app5.doc, 'admin', ADMIN_PASS);
await sleep(250);
app5.doc.querySelector('#side-nav button[data-view="settings"]').click();
await sleep(120);

check('أدوات القناة محذوفة من الإعدادات',
  !app5.doc.getElementById('users-channel') && !app5.doc.getElementById('btn-cloud-key') && !app5.doc.getElementById('settings-connection'));

app5.doc.getElementById('btn-add-user').click();
await sleep(80);
app5.doc.getElementById('uf-name').value = 'علي حسن';
app5.doc.getElementById('uf-user').value = 'ali';
app5.doc.getElementById('uf-pass').value = 'Ali@12345';
app5.doc.getElementById('uf-save').click();
await sleep(350);

/* آخر نافذة في الـDOM = نافذة القناة (نموذج الموظف يبقى مفتوحاً خلفها عمداً
   ليجد المدير بياناته كما كتبها لو أضاف المفتاح وأعاد المحاولة) */
const modals5 = [...app5.doc.querySelectorAll('#modal-root .modal')];
const helpModal = modals5[modals5.length - 1];
const helpText = helpModal ? helpModal.textContent : '';
check('نافذة «لا قناة لإنشاء الحسابات» ظهرت', modals5.length === 2 && /لا قناة لإنشاء الحسابات/.test(helpText),
  'عدد النوافذ: ' + modals5.length + ' | ' + helpText.slice(0, 120));
check('تعرض خطوة الدالة السحابية (الموصى بها)', /الدالة السحابية/.test(helpText) && /hrc-staff-admin/.test(helpText));
check('تعرض خطوة مفتاح الخدمة فوراً', /إضافة مفتاح الخدمة الآن/.test(helpText));
check('تعرض الخيار المحلي صراحةً بتحذيره', /لا يُنصح/.test(helpText) && /إنشاء محلياً/.test(helpText));
check('لم يُنشأ حساب محلي بصمت', !app5.window.HRCStore.listUsers().some((u) => u.username === 'ali'),
  JSON.stringify(app5.window.HRCStore.listUsers().map((u) => u.username)));
check('لم يُنشأ أي مستخدم Auth', !state5.authUsers.some((u) => u.email === 'ali@hrc-babil.com'));

/* زر الدالة داخل النافذة يفتح نافذة المفتاح مباشرةً */
helpModal.querySelector('[data-chan="key"]').click();
await sleep(120);
check('زر «إضافة مفتاح الخدمة الآن» يفتح نافذة المفتاح', !!app5.doc.getElementById('svc-key'));

// Diagnostics remain testable at the service layer, not as a settings panel.
const probe5 = await app5.window.HRCStore.staffAdmin('whoami', {});
check('الدالة غير المنشورة تُرفض دون إنشاء حساب', !probe5.ok && !state5.authUsers.length);

app5.dom.window.close && app5.dom.window.close();

/* ===========================================================================
 *  11) انقطاع الشبكة: لا نص إنجليزي للمدير — ويُجرَّب المفتاح المحفوظ
 * =========================================================================== */
step(11, 'انقطاع الشبكة: رسالة عربية، والمسار الاحتياطي (المفتاح) يعمل');
const state6 = makeState();
state6.fnOn = 'network';               // كل نداء للدالة يفشل في النقل
const app6 = await open(state6);
login(app6.window, app6.doc, 'admin', ADMIN_PASS);
await sleep(250);
app6.doc.querySelector('#side-nav button[data-view="settings"]').click();
await sleep(120);
app6.window.localStorage.setItem('hrc-service-key', SERVICE_KEY);

app6.doc.getElementById('btn-add-user').click();
await sleep(80);
app6.doc.getElementById('uf-name').value = 'سارة جواد';
app6.doc.getElementById('uf-user').value = 'sara';
app6.doc.getElementById('uf-pass').value = 'Sara@12345';
app6.doc.getElementById('uf-save').click();
await sleep(400);

check('انقطاع الشبكة لا يمنع الإنشاء عبر المفتاح المحفوظ',
  state6.staff.some((s) => s.username === 'sara'),
  JSON.stringify(state6.staff.map((s) => s.username)));
check('مستخدم Auth أُنشئ بالبريد المشتقّ', state6.authUsers.some((u) => u.email === 'sara@hrc-babil.com'));
const errBox6 = app6.doc.getElementById('user-form-err');
const shown6 = errBox6 && !errBox6.classList.contains('hidden') ? errBox6.textContent : '';
check('لا نص إنجليزي ظاهر للمدير في أي رسالة', !/Failed|fetch|Function/i.test(shown6), shown6.slice(0, 120));

app6.dom.window.close && app6.dom.window.close();

/* ===========================================================================
 *  12) جلسة مدير سحابية: الفحص التلقائي يعلن الجاهزية — وكل رفض يُشرح بخطوته
 *      (كانت الفشول تظهر بـ«لا قناة بعد: انشر الدالة» وهي منشورة — نص مضلِّل
 *       لا يُصلح شيئاً. الآن: كل رفض له سببه المحدَّد وخطوته داخل الشريط.)
 * =========================================================================== */
step(12, 'جلسة مدير سحابية: اتصال الدالة مستمر دون واجهة تشخيص');
const state7 = makeState();
state7.fnOn = true;
state7.cloudSession = {
  user: { id: 'auth-admin', aud: 'authenticated', email: 'admin@hrc-babil.com' },
  access_token: 'AT-admin-1', token_type: 'bearer', expires_in: 3600
};
const app7 = await open(state7);
await sleep(350);
check('الجلسة السحابية دخلت تلقائياً بلا شاشة دخول', shellsShown(app7.doc));
const s7 = app7.window.HRCStore.currentUser();
check('الجلسة بالمدير الرسمي وعلامتها سحابية', !!s7 && s7.role === 'admin' && s7.cloud === true, JSON.stringify(s7));

app7.doc.querySelector('#side-nav button[data-view="settings"]').click();
await sleep(150);
check('الإعدادات خالية من قسم الاتصال حتى مع جلسة المدير السحابية',
  !app7.doc.getElementById('users-channel') && !app7.doc.getElementById('settings-connection'));
check('فتح الإعدادات لا يشغّل فحص قناة تلقائياً',
  !(state7.fnCalls || []).some((c) => c.body.action === 'whoami'));
const who7 = await app7.window.HRCStore.staffAdmin('whoami', {});
check('الدالة السحابية ما زالت تعمل بجلسة المدير', who7 && who7.ok);
// Keep service-level error coverage after removing the diagnostic UI.
for (const [mode, code] of [['oldFn', 'bad_action'], ['noSession', 'no_token'], ['notAdmin', 'not_admin']]) {
  state7.fnOn = mode;
  const result = await app7.window.HRCStore.staffAdmin('whoami', {});
  check('رفض الدالة محفوظ في طبقة الخدمة: ' + mode, result && !result.ok && result.code === code, JSON.stringify(result));
}

app7.dom.window.close && app7.dom.window.close();

app.dom.window.close && app.dom.window.close();
app2.dom.window.close && app2.dom.window.close();

/* ---------------------------------- الخلاصة ---------------------------------- */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
