#!/usr/bin/env node
/* ===========================================================================
 *  HRC — دورة حياة حساب الموظف: يُنشأ من اللوحة ثم **يدخل فعلاً** من جهاز آخر
 *  ---------------------------------------------------------------------------
 *  لماذا هذا الملف؟ كل الفحوص السابقة توقفت عند لحظة «أُنشئ الحساب في القاعدة»
 *  — ولا واحد منها يثبت أن الموظف **يستطيع الدخول** فعلاً من جهاز آخر. والفرق
 *  جوهري: لو اختلف البريد المشتقّ عند الإنشاء عن البريد المشتقّ عند الدخول، أو
 *  لو لم يُقرأ سطر brc.staff، لكان الحساب «موجوداً» والموظف لا يدخل أبداً —
 *  وهو بالضبط ما يعنيه المالك بـ«أريد إنشاء الحسابات فعّالاً».
 *
 *  هنا نُشغّل **صفحة dashboard.html الحقيقية** مع **مكتبة سوبابيس المدمجة
 *  الحقيقية** (assets/vendor/supabase.js) فوق خادم وهمي كامل يحاكي القاعدة:
 *  GoTrue (Auth) + PostgREST، مع RLS حقيقية السلوك (anon ممنوع من جداول
 *  الموظفين، والجلسة تسمح).
 *
 *    متصفح «المدير»: يدخل محلياً (الوضع الانتقالي المُعلَن) ← يضيف مفتاح الخدمة
 *                    ← يُنشئ حساب موظف من النموذج.
 *    متصفح «آخر»  : ذاكرة نظيفة تماماً (لا localStorage) — يحاول الدخول بحساب
 *                    الموظف الذي أُنشئ للتو → يجب أن يدخل ويرى صلاحيته.
 *
 *  التشغيل:  node tests/staff-lifecycle.mjs
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

const SERVICE_KEY = 'sb_secret_test_service_role_key';
const DOMAIN = 'hrc-babil.com';

/* ===========================================================================
 *  القاعدة الوهمية الواحدة — كل «متصفح» يكلّمها (وجلساته منفصلة)
 * =========================================================================== */
function makeServer() {
  return {
    calls: [],
    tokens: {},                      // access_token → auth user id
    staff: [{ id: 'staff-mgr', auth_id: 'auth-mgr', username: 'admin', full_name: 'المدير العام',
      role: 'admin', job_title: 'مدير عام', phone: '', active: true }],
    authUsers: [{ id: 'auth-mgr', email: 'admin@' + DOMAIN, password: 'Admin@12345' }],
    jobs: [{ id: 'j1', code: 'HRC-1042', title: 'عامل خط إنتاج', region: 'الحلة', governorate: 'بابل',
      salary_min: 500000, salary_max: 700000, shift: 'صباحي', gender: 'لا فرق', vacancies: 2,
      requirements: [], status: 'available', hold_expires_at: null, created_at: '2026-01-01T00:00:00.000Z' }],
    applicants: [], job_attempts: [], audit_log: [], settings: [],
    public_jobs: [{ code: 'HRC-1042', title: 'عامل خط إنتاج', region: 'بابل', salary_min: 500000,
      salary_max: 700000, shift: 'صباحي', status: 'available', vacancies: 2, requirements: [], image_url: '' }]
  };
}

/* fetch لكل متصفح: الجلسة تخصّ هذا المتصفح وحده (كما في الواقع) */
function makeFetch(server, browser) {
  /* رد شبكي بالشكل الذي تتوقّعه مكتبة سوبابيس: text() و json() وheaders.
     ⚠️ بلا json() تنتج المكتبة خطأً داخلياً («s.json is not a function») يظهر
     للمستخدم كرسالة فشل دخول — ولهذا الحد الأدنى هنا لا بد أن يكون كاملاً. */
  const reply = (status, body) => {
    const raw = body == null ? '' : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300, status, statusText: String(status),
      text: () => Promise.resolve(raw),
      json: () => Promise.resolve(body == null ? {} : body),
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) }
    };
  };
  /* ⚠️ المكتبة الحقيقية ترسل الترويسات ككائن Headers (يُقرأ بـ .get)، وبعض
     المسارات ترسل كائناً عادياً. القراءة اليدوية الموحّدة أدناه ضرورية: بلاها
     يبدو كل طلب بلا توكن فتُرفض قراءة brc.staff ويظهر «الحساب غير مرتبط بموظف»
     — أي أن الخطأ في المحاكي لا في التطبيق، وهو أسوأ من عدم وجود اختبار. */
  const hget = (h, k) => {
    if (!h) return null;
    if (typeof h.get === 'function') return h.get(k);
    const lk = k.toLowerCase();
    for (const key of Object.keys(h)) if (key.toLowerCase() === lk) return h[key];
    return null;
  };
  return function (url, init) {
    init = init || {};
    const headers = init.headers;
    const method = (init.method || 'GET').toUpperCase();
    const auth = String(hget(headers, 'Authorization') || '');
    const token = auth.replace(/^Bearer\s+/i, '');
    const sessionUserId = server.tokens[token] || null;
    const isService = token === SERVICE_KEY || hget(headers, 'apikey') === SERVICE_KEY;
    server.calls.push({ url, method, svc: isService, session: sessionUserId, browser: browser.name });

    /* ───────────── GoTrue ───────────── */
    if (/\/auth\/v1\/token\?grant_type=password/.test(url)) {
      const body = JSON.parse(init.body || '{}');
      const u = server.authUsers.filter((x) => x.email === body.email)[0];
      /* كلمة المرور تُقارن هنا — وهذا ما يجعل «الإيميل المشتقّ» يُختبر فعلاً */
      if (!u || u.password !== body.password) {
        return Promise.resolve(reply(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }));
      }
      const at = 'AT-' + u.id + '-' + (++browser.seq);
      server.tokens[at] = u.id;
      return Promise.resolve(reply(200, {
        access_token: at, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'RT-' + u.id, user: { id: u.id, aud: 'authenticated', email: u.email, user_metadata: {} }
      }));
    }
    if (/\/auth\/v1\/user/.test(url)) {
      const u = server.authUsers.filter((x) => x.id === sessionUserId)[0];
      if (!u) return Promise.resolve(reply(401, { message: 'invalid claim: missing sub claim' }));
      return Promise.resolve(reply(200, { id: u.id, aud: 'authenticated', email: u.email, user_metadata: {} }));
    }
    if (/\/auth\/v1\/logout/.test(url)) return Promise.resolve(reply(204, null));
    if (/\/auth\/v1\/admin\/users/.test(url) && method === 'POST') {
      if (!isService) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const body = JSON.parse(init.body);
      if (server.authUsers.some((u) => u.email === body.email)) {
        return Promise.resolve(reply(422, { code: 422, msg: 'A user with this email address has already been registered' }));
      }
      const u = { id: 'auth-' + (server.authUsers.length + 1), email: body.email, password: body.password };
      server.authUsers.push(u);
      return Promise.resolve(reply(200, { id: u.id, email: u.email }));
    }
    if (/\/auth\/v1\/admin\/users/.test(url) && method === 'GET') {
      if (!isService) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      return Promise.resolve(reply(200, { users: server.authUsers.slice() }));
    }
    if (/\/auth\/v1\/admin\/users\//.test(url) && method === 'PUT') {
      if (!isService) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const id = url.split('/').pop().split('?')[0];
      const u = server.authUsers.filter((x) => x.id === id)[0];
      if (u) u.password = JSON.parse(init.body).password;
      return Promise.resolve(reply(200, u || {}));
    }
    if (/\/auth\/v1\/admin\/users\//.test(url) && method === 'DELETE') {
      if (!isService) return Promise.resolve(reply(401, { msg: 'invalid api key' }));
      const id = url.split('/').pop().split('?')[0];
      server.authUsers = server.authUsers.filter((x) => x.id !== id);
      return Promise.resolve(reply(200, {}));
    }

    /* ───────────── PostgREST ───────────── */
    const rest = /\/rest\/v1\/([a-z_]+)/.exec(url);
    if (rest) {
      const table = rest[1].replace(/^working_/, '');
      /* ⚠️ RLS حقيقية السلوك: بلا جلسة موظف ولا مفتاح خدمة — لا قراءة لجداول
         الموظفين. هذا ما يجعل اختبار «الزائر لا يقرأ» واختبار «الدخول يفتح
         البيانات» ذا معنى (لو سمحنا للجميع لصار كل شيء أخضر بلا فائدة). */
      const allowed = isService || !!sessionUserId;
      if (!allowed && table !== 'public_jobs') {
        return Promise.resolve(reply(401, { code: '42501', message: 'permission denied for table ' + table }));
      }
      if(table==='rpc'&&url.includes('/staff_issuance_registry')&&server.staff.some(s=>s.auth_id===sessionUserId&&s.active!==false)){const args=JSON.parse(init.body||'{}');return Promise.resolve(reply(200,args.p_serial==null?{version:1,bitmap:Buffer.alloc(595125).toString('base64')}:{used:false}));}
      if (table === 'staff' && sessionUserId && !isService) {
        /* الموظف يقرأ سطره هو — كما في سياسة staff_self_read */
        let rows = server.staff.filter((r) => r.auth_id === sessionUserId);
        const m = /[?&]auth_id=eq\.([^&]+)/.exec(url);
        if (m) rows = server.staff.filter((r) => String(r.auth_id) === decodeURIComponent(m[1]));
        return Promise.resolve(reply(200, rows));
      }
      let rows = server[table] || [];
      const m = /[?&](id|username|auth_id|code)=eq\.([^&]+)/.exec(url);
      if (m) rows = rows.filter((r) => String(r[m[1]] ?? '') === decodeURIComponent(m[2]));
      if (method === 'GET') return Promise.resolve(reply(200, rows));
      if (method === 'PATCH') {
        const body = JSON.parse(init.body || '{}');
        rows.forEach((r) => Object.assign(r, body));
        return Promise.resolve(reply(200, rows));
      }
      if (method === 'DELETE') {
        server[table] = (server[table] || []).filter((r) => rows.indexOf(r) < 0);
        return Promise.resolve(reply(200, rows));
      }
      /* إدراج */
      const body = JSON.parse(init.body || '{}');
      const created = Object.assign({ id: table + '-' + ((server[table] || []).length + 1), active: true }, body);
      server[table] = (server[table] || []).concat([created]);
      server.calls.push({ inserted: table, row: created });
      return Promise.resolve(reply(201, [created]));
    }

    return Promise.resolve(reply(404, { message: 'not found: ' + url }));
  };
}

/* ===========================================================================
 *  فتح «متصفح»: jsdom بصفحة dashboard.html الحقيقية ومكتبة سوبابيس الحقيقية
 *  ---------------------------------------------------------------------------
 *  كل متصفح له تخزينه الخاص (localStorage منفصل) — وهذا هو معنى «جهاز آخر»
 *  في هذا الاختبار. الموارد تُقرأ من القرص، والموارد المشتركة (القاعدة) واحدة.
 * =========================================================================== */
const ORIGIN = (name) => 'http://' + name + '.hrc.test';

/* الموارد تُقرأ من القرص — **ولا شبكة حقيقية إطلاقاً**: أي طلب خارج أصل
   «المتصفح» يُرفض، فتبقى القاعدة الوهمية هي المصدر الوحيد للبيانات. */
class LocalLoader extends ResourceLoader {
  fetch(url, options) {
    let u;
    try { u = new URL(url); } catch (e) { return Promise.reject(new Error('bad url')); }
    if (!u.hostname.endsWith('.hrc.test')) return Promise.reject(new Error('blocked: ' + url));
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
    try { return Promise.resolve(readFileSync(resolve(ROOT, rel))); }
    catch (e) { return Promise.reject(new Error('not found: ' + rel)); }
  }
}

async function openBrowser(server, name) {
  const browser = { name, seq: 0 };
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => { if (!/Could not load|Not implemented|resource loading/i.test(String(e.message))) errors.push(String(e.message)); });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

  const origin = ORIGIN(name);
  const dom = await JSDOM.fromFile(resolve(ROOT, 'dashboard.html'), {
    url: origin + '/dashboard.html',
    runScripts: 'dangerously',
    resources: new LocalLoader(),      // المكتبة الحقيقية تُحمَّل من القرص
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = makeFetch(server, browser);   // الشبكة فقط هي الوهمية
      window.__browserName = name;
    }
  });
  await sleep(500);
  return { dom, window: dom.window, doc: dom.window.document, errors, browser };
}

function submitLogin(w, doc, user, pass) {
  doc.getElementById('login-user').value = user;
  doc.getElementById('login-pass').value = pass;
  doc.getElementById('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}
const shellShown = (doc) => !doc.getElementById('app-shell').classList.contains('hidden');
const loginErrText = (doc) => {
  const el = doc.getElementById('login-error');
  return el && !el.classList.contains('hidden') ? el.textContent : '';
};

console.log('\n' + '═'.repeat(74));
console.log('  HRC — دورة حياة حساب الموظف: إنشاء من اللوحة ثم دخول من جهاز آخر');
console.log('═'.repeat(74));

const server = makeServer();

/* ===========================================================================
 *  1) متصفح المدير: يدخل بحساب Supabase Auth الرسمي ويصل إلى إدارة الموظفين
 * =========================================================================== */
step(1, 'متصفح المدير: دخول + الوصول إلى «إدارة الموظفين والصلاحيات»');
const mgr = await openBrowser(server, 'manager');
check('لا أخطاء JavaScript في الصفحة (بالمكتبة الحقيقية)', mgr.errors.length === 0 || mgr.errors.join(' | '));
check('المكتبة الحقيقية محمّلة (window.supabase)', !!(mgr.window.supabase && mgr.window.leader === undefined));
check('عميل الدوال متاح (functions.invoke) — شرط قناة الدالة السحابية',
  !!(mgr.window.HRCStore && mgr.window.HRCStore.cloudStatus().configured));

submitLogin(mgr.window, mgr.doc, 'admin', 'admin123');
await sleep(300);
check('الحساب المحلي القديم مرفوض', !shellShown(mgr.doc) && !mgr.window.HRCStore.currentUser());
submitLogin(mgr.window, mgr.doc, 'admin', 'Admin@12345'); // Supabase Auth fixture
await sleep(400);
check('الدخول نجح واللوحة ظاهرة', shellShown(mgr.doc), loginErrText(mgr.doc));

mgr.doc.querySelector('#side-nav button[data-view="settings"]').click();
await sleep(150);
check('قسم الإعدادات ظاهر', !mgr.doc.getElementById('view-settings').classList.contains('hidden'));
check('لا قسم قناة أو ربط سحابة في الإعدادات',
  !mgr.doc.getElementById('settings-connection') && !mgr.doc.getElementById('users-channel') && !mgr.doc.getElementById('btn-cloud-key'));

/* ===========================================================================
 *  2) المدير يُنشئ حساب موظف من النموذج (عبر مفتاح الخدمة المفحوص)
 * =========================================================================== */
step(2, 'إنشاء حساب الموظف من النموذج: يُفحص المفتاح ثم يُنشأ في القاعدة');
mgr.window.localStorage.setItem('hrc-service-key', SERVICE_KEY);

mgr.doc.getElementById('btn-add-user').click();
await sleep(100);
mgr.doc.getElementById('uf-name').value = 'رند علي';
mgr.doc.getElementById('uf-user').value = 'rand';
mgr.doc.getElementById('uf-pass').value = 'Rand@1234';
mgr.doc.getElementById('uf-title').value = 'موظفة توظيف';
mgr.doc.getElementById('uf-role').value = 'staff';
mgr.doc.getElementById('uf-save').click();
await sleep(500);

const randRow = server.staff.filter((s) => s.username === 'rand')[0];
const randAuth = server.authUsers.filter((u) => u.email === 'rand@' + DOMAIN)[0];
check('مستخدم Auth أُنشئ بالبريد المشتقّ من اسم المستخدم', !!randAuth, JSON.stringify(server.authUsers.map((u) => u.email)));
check('سطر brc.staff أُنشئ ودوره staff', !!randRow && randRow.role === 'staff', JSON.stringify(randRow));
check('السطر مرتبط بمستخدم Auth نفسه', !!randRow && randRow.auth_id === randAuth.id, JSON.stringify({ row: randRow && randRow.auth_id, auth: randAuth && randAuth.id }));
check('لا رسالة فشل في النموذج (النافذة أُغلقت)', !mgr.doc.getElementById('user-form'));
check('الموظف ظهر في الجدول معلَّماً «القاعدة»',
  /القاعدة/.test(([...mgr.doc.querySelectorAll('#users-table-body tr')]
    .filter((tr) => tr.textContent.includes('rand'))[0] || {}).textContent || ''));

/* ===========================================================================
 *  3) جهاز آخر تماماً: الموظفة تدخل بحسابها الجديد
 *     (ذاكرة نظيفة — لا localStorage، لا جلسة، لا شيء)
 * =========================================================================== */
step(3, 'جهاز آخر (ذاكرة نظيفة): الموظفة تدخل بحسابها الذي أُنشئ للتو');
const emp = await openBrowser(server, 'employee');
check('الجهاز الجديد لا يحمل أي جلسة', !emp.window.localStorage.getItem('hrc-service-key'));
check('شاشة الدخول ظاهرة (لا دخول تلقائي)', !shellShown(emp.doc));

submitLogin(emp.window, emp.doc, 'rand', 'Rand@1234');
await sleep(900);

check('الموظفة دخلت فعلاً من الجهاز الآخر', shellShown(emp.doc), loginErrText(emp.doc) || 'لم تظهر اللوحة');
const session = emp.window.HRCStore.currentUser();
check('الجلسة باسم الموظفة ودورها staff', !!session && session.username === 'rand' && session.role === 'staff',
  JSON.stringify(session));
check('الجلسة معلَّمة بأنها سحابية (cloud: true)', !!session && session.cloud === true, JSON.stringify(session));
check('حالة الاتصال: دور staff والقاعدة متصلة',
  emp.window.HRCStore.cloudStatus().role === 'staff' && emp.window.HRCStore.cloudStatus().state === 'on',
  JSON.stringify({ role: emp.window.HRCStore.cloudStatus().role, state: emp.window.HRCStore.cloudStatus().state }));
check('كلمة المرور لم تُخزَّن في متصفح الموظفة', !JSON.stringify(emp.window.localStorage).includes('Rand@1234'));

/* دور staff: اللوحة المالية وأدوات الإدارة محجوبة عنه */
{
  /* الأدوات الإدارية تُخفى بصنف hidden عبر applyRole() — نفس ما يراه الموظف */
  const finBtn = emp.doc.querySelector('#side-nav button[data-view="finance"]');
  const adminOnly = [...emp.doc.querySelectorAll('[data-admin-only="true"]')];
  const visibleAdminOnly = adminOnly.filter((b) => !b.classList.contains('hidden'));
  check('موظفة (staff) لا ترى اللوحة المالية',
    !finBtn || finBtn.classList.contains('hidden'), finBtn ? finBtn.className : 'غير موجود');
  check('كل أدوات الإدارة مخفية عنها (ولا واحدة ظاهرة)',
    visibleAdminOnly.length === 0, visibleAdminOnly.length + ' ظاهرة من ' + adminOnly.length);
  check('صلاحيتها staff لا admin', emp.window.HRCStore.isAdmin() === false, String(emp.window.HRCStore.isAdmin()));
}

/* ===========================================================================
 *  4) كلمة مرور خاطئة من جهاز ثالث: رفض برسالة عربية
 * =========================================================================== */
step(4, 'كلمة مرور خاطئة: رفض واضح بالعربي (لا دخول ولا نص إنجليزي)');
const wrongPass = await openBrowser(server, 'wrongpass');
submitLogin(wrongPass.window, wrongPass.doc, 'rand', 'Wrong@9999');
await sleep(700);
check('لم تدخل اللوحة', !shellShown(wrongPass.doc));
check('رسالة الرفض بالعربية ومفهومة', /غير صحيحة|كلمة المرور|اسم المستخدم/.test(loginErrText(wrongPass.doc)), loginErrText(wrongPass.doc));
check('لا نص إنجليزي من سوبابيس في الشاشة', !/Invalid login|credentials/i.test(loginErrText(wrongPass.doc)), loginErrText(wrongPass.doc));

/* ===========================================================================
 *  5) تعطيل الموظفة من اللوحة ⇒ يُقفل دخولها من أي جهاز
 * =========================================================================== */
step(5, 'تعطيل الحساب من اللوحة: يُقفل الدخول فعلاً من أي جهاز');
const toggle = [...mgr.doc.querySelectorAll('#users-table-body [data-user-toggle]')]
  .filter((b) => b.getAttribute('data-user-toggle') === 'rand')[0];
check('زر التعطيل موجود أمام الموظفة', !!toggle);
if (toggle) {
  toggle.click();
  await sleep(600);
  check('سطر القاعدة صار معطّلاً (المنع الحقيقي لا في الشاشة)',
    (server.staff.filter((s) => s.username === 'rand')[0] || {}).active === false,
    JSON.stringify(server.staff.filter((s) => s.username === 'rand')[0]));
}

const emp2 = await openBrowser(server, 'employee2');
submitLogin(emp2.window, emp2.doc, 'rand', 'Rand@1234');
await sleep(800);
check('الموظفة المعطَّلة لم تدخل من الجهاز الجديد', !shellShown(emp2.doc));
check('الرسالة تقول إن الحساب موقوف (لا «بيانات خاطئة»)', /موقوف|معطّل|راجع/.test(loginErrText(emp2.doc)), loginErrText(emp2.doc));

/* ===========================================================================
 *  6) تشغيلها مجدداً ⇒ تعود تدخل (لا قفل دائم)
 * =========================================================================== */
step(6, 'تنشيط الحساب من اللوحة: يعود الدخول فوراً');
const toggle2 = [...mgr.doc.querySelectorAll('#users-table-body [data-user-toggle]')]
  .filter((b) => b.getAttribute('data-user-toggle') === 'rand')[0];
if (toggle2) { toggle2.click(); await sleep(600); }
check('سطر القاعدة رجع نشطاً', (server.staff.filter((s) => s.username === 'rand')[0] || {}).active === true,
  JSON.stringify(server.staff.filter((s) => s.username === 'rand')[0]));

const emp3 = await openBrowser(server, 'employee3');
submitLogin(emp3.window, emp3.doc, 'rand', 'Rand@1234');
await sleep(800);
check('الموظفة دخلت من جديد بعد التنشيط', shellShown(emp3.doc), loginErrText(emp3.doc));

/* ===========================================================================
 *  7) التعديل من اللوحة يصل، وتغيير كلمة المرور يعمل من الجهاز الآخر
 * =========================================================================== */
step(7, 'تعديل الموظفة + تغيير كلمة مرورها من اللوحة: الدخول بالجديدة فقط');
const editBtn = [...mgr.doc.querySelectorAll('#users-table-body [data-user-edit]')]
  .filter((b) => b.getAttribute('data-user-edit') === 'rand')[0];
check('زر التعديل موجود', !!editBtn);
if (editBtn) {
  editBtn.click();
  await sleep(120);
  mgr.doc.getElementById('uf-title').value = 'مشرفة توظيف';
  mgr.doc.getElementById('uf-pass').value = 'Rand@5678';
  mgr.doc.getElementById('uf-save').click();
  await sleep(700);
}
check('المسمى الجديد وصل القاعدة',
  (server.staff.filter((s) => s.username === 'rand')[0] || {}).job_title === 'مشرفة توظيف',
  JSON.stringify((server.staff.filter((s) => s.username === 'rand')[0] || {}).job_title));
check('كلمة المرور الجديدة وصلت مستخدم Auth',
  (server.authUsers.filter((u) => u.email === 'rand@' + DOMAIN)[0] || {}).password === 'Rand@5678');

const emp4 = await openBrowser(server, 'employee4');
submitLogin(emp4.window, emp4.doc, 'rand', 'Rand@5678');
await sleep(800);
check('الدخول بكلمة المرور الجديدة من جهاز جديد يعمل', shellShown(emp4.doc), loginErrText(emp4.doc));

const emp5 = await openBrowser(server, 'employee5');
submitLogin(emp5.window, emp5.doc, 'rand', 'Rand@1234');
await sleep(700);
check('وكلمة المرور القديمة لم تعد تعمل', !shellShown(emp5.doc));

/* ===========================================================================
 *  8) حذف الحساب من اللوحة ⇒ لا دخول ولا سطر
 * =========================================================================== */
step(8, 'حذف الموظفة من اللوحة: يُمحى السطر ومستخدم الدخول معاً');
const delBtn = [...mgr.doc.querySelectorAll('#users-table-body [data-user-del]')]
  .filter((b) => b.getAttribute('data-user-del') === 'rand')[0];
check('زر الحذف موجود', !!delBtn);
if (delBtn) {
  delBtn.click();
  await sleep(150);
  const okBtn = mgr.doc.querySelector('#modal-root [data-ok]');
  if (okBtn) okBtn.click();
  await sleep(700);
}
check('سطر brc.staff حُذف', !server.staff.some((s) => s.username === 'rand'), JSON.stringify(server.staff.map((s) => s.username)));
check('مستخدم Auth حُذف أيضاً', !server.authUsers.some((u) => u.email === 'rand@' + DOMAIN),
  JSON.stringify(server.authUsers.map((u) => u.email)));
check('سطر المدير نفسه لم يُمسّ', server.staff.some((s) => s.username === 'admin'));

/* تشخيص عند الطلب: DBG=1 node tests/staff-lifecycle.mjs */
if (process.env.DBG) {
  console.log('\n—— نداءات متصفح الموظفة ——');
  server.calls.filter((c) => c.browser === 'employee').forEach((c) => {
    if (c.inserted) return console.log('  INSERT', c.inserted, JSON.stringify(c.row));
    console.log('  ' + c.method + ' ' + c.url.replace('https://vqsvztudvfukyuerzcgx.supabase.co', '') +
      (c.session ? '  [جلسة ' + c.session + ']' : (c.svc ? '  [مفتاح خدمة]' : '  [بلا جلسة]')));
  });
}

/* ---------------------------------- الخلاصة ---------------------------------- */
[mgr, emp, wrongPass, emp2, emp3, emp4, emp5].forEach((b) => { try { b.dom.window.close(); } catch (e) {} });
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
