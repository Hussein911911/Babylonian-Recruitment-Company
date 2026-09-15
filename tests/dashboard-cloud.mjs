#!/usr/bin/env node
/* ===========================================================================
 *  BRC — لوحة التحكم في الوضع السحابي (صفحة حقيقية + عميل وهمي)
 *  ---------------------------------------------------------------------------
 *  الاختبارات الأخرى تفحص الطبقات منفصلة. هذا الملف يشغّل **dashboard.html
 *  الفعلية** بكل سكربتاتها (بما فيها store.js وdashboard.js)، مع استبدال ملف
 *  سوبابيس المُصدَّر بعميل وهمي — فنتحقق من السلوك من منظور الموظف:
 *
 *    • هل تظهر حالة الاتصال بوضوح (وضع انتقالي / غير مسجَّل)؟
 *    • هل الدخول في الوضع الانتقالي (enforceAuth=false) يعمل محلياً بتنبيه؟
 *    • وهل يُرفض تماماً متى فُعِّل enforceAuth (لا باب خلفي)؟
 *
 *  التشغيل:  node tests/dashboard-cloud.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

/* عميل سوبابيس وهمي: anon (لا جلسة) + جداول الموظفين محجوبة + حساب واحد صالح */
const MOCK_SRC = `
window.__brcMock = (function () {
  var calls = [];
  var denied = { code: '42501', message: 'permission denied' };
  var rows = {
    public_jobs: [{ code: 'BRC-7777', title: 'وظيفة معلنة', category: 'خدمات', region: 'بابل',
      salary_min: 500000, salary_max: 700000, shift: 'صباحي', gender: 'لا فرق', vacancies: 2,
      requirements: [], status: 'available', hold_expires_at: null, created_at: '2026-01-01T00:00:00.000Z',
      description: 'وصف', image_url: '' }]
  };
  function q(table) {
    var st = { op: null, payload: null, filters: [] };
    var api = {
      select: function () { if (!st.op) st.op = 'select'; return api; },
      insert: function (p) { st.op = 'insert'; st.payload = p; return api; },
      update: function (p) { st.op = 'update'; st.payload = p; return api; },
      delete: function () { st.op = 'delete'; return api; },
      eq: function (c, v) { st.filters.push([c, v]); return api; },
      order: function () { return api; }, limit: function () { return api; }, single: function () { return api; },
      then: function (res, rej) {
        calls.push({ table: table, op: st.op, payload: st.payload });
        if (table === 'public_jobs') return Promise.resolve({ data: rows.public_jobs, error: null }).then(res, rej);
        if (st.op === 'select') return Promise.resolve({ data: null, error: denied }).then(res, rej);
        return Promise.resolve({ data: null, error: denied }).then(res, rej);
      }
    };
    return api;
  }
  var ch = { on: function () { return ch; }, subscribe: function (cb) { if (cb) cb('SUBSCRIBED'); return ch; } };
  return {
    __calls: calls,
    from: q, channel: function () { return ch; }, removeChannel: function () { },
    rpc: function () { return Promise.resolve({ data: null, error: denied }); },
    auth: {
      signInWithPassword: function (p) {
        calls.push({ auth: 'signIn', email: p.email });
        /* حساب واحد فقط موجود — وليس له سطر في brc.staff بعد */
        if (p.email === 'hussein@brc-babil.com' && p.password === 'right-pass') {
          return Promise.resolve({ data: { user: { id: 'auth-1', email: p.email }, session: {} }, error: null });
        }
        return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
      },
      getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
      signOut: function () { return Promise.resolve({ error: null }); },
      updateUser: function () { return Promise.resolve({ error: null }); }
    }
  };
})();
/* store.js يبحث عن window.supabase (نفس ما تضعه المكتبة الحقيقية) */
window.supabase = { createClient: function () { return window.__brcMock; } };
window.fetch = function () {};
`;

class Loader extends ResourceLoader {
  fetch(url, options) {
    /* نستبدل مكتبة سوبابيس وحدها — بقية الملفات تُخدم حقيقية */
    if (url.includes('/vendor/supabase.js')) {
      return Promise.resolve(Buffer.from(MOCK_SRC, 'utf8'));
    }
    return super.fetch(url, options);
  }
}

async function open(opts = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    if (/Could not load|Error: Not implemented/.test(String(e.message))) return;
    errors.push(String(e.message));
  });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = await JSDOM.fromFile(resolve(ROOT, 'dashboard.html'), {
    url: pathToFileURL(resolve(ROOT, 'dashboard.html')).href,
    runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: vc
  });
  await new Promise((r) => setTimeout(r, 260));
  /* الإعداد يُقرأ لحظياً عند كل فحص (cloudStatus) — فيمكن قلبه بعد التحميل
     لتمثيل «المسؤول أكمل إنشاء الحسابات ثم فعّل التحوّل». */
  if (opts.enforceAuth) dom.window.BRCSupabaseConfig.enforceAuth = true;
  return { dom, window: dom.window, doc: dom.window.document, errors };
}

function login(window, doc, user, pass) {
  doc.getElementById('login-user').value = user;
  doc.getElementById('login-pass').value = pass;
  doc.getElementById('login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
const shellHidden = (doc) => doc.getElementById('app-shell').classList.contains('hidden');

console.log('\n' + '═'.repeat(74));
console.log('  BRC — لوحة التحكم في الوضع السحابي');
console.log('═'.repeat(74));

/* ===========================================================================
 *  1) الوضع الانتقالي (enforceAuth=false)
 * =========================================================================== */
step(1, 'الوضع الانتقالي — القاعدة متصلة والكتابة غير ممكنة');
const t1 = await open();
check('لا أخطاء JavaScript في الصفحة', t1.errors.length === 0 || t1.errors.join(' | '));
const st = t1.window.BRCStore.cloudStatus();
check('الإقلاع: متصل بالقاعدة (وضع عام بلا جلسة)', st.state === 'on' && st.role === 'public', JSON.stringify(st));
check('مفتاح enforceAuth يُقرأ من الإعداد', st.enforceAuth === false);
check('الوظيفة المعلنة وصلت من الواجهة العامة', t1.window.BRCStore.listJobs({}).some((j) => j.code === 'BRC-7777'),
  JSON.stringify(t1.window.BRCStore.listJobs({}).map((j) => j.code)));

const note = t1.doc.getElementById('brc-cloud-note');
const banner = t1.doc.getElementById('brc-cloud-banner');
check('شاشة الدخول تُعلن الحالة (ملاحظة ظاهرة)', !!note && /متصل|انتقالي|محلي/.test(note.textContent), note && note.textContent.slice(0, 60));
check('بانر الحالة ظاهر في أعلى الصفحة', !!banner, 'لا بانر');
check('البانر يشرح الوضع الانتقالي وخطوة إكمال التحوّل',
  !!banner && /انتقالي|محلي/.test(banner.textContent) && /enforceAuth|حساب/.test(banner.textContent),
  banner && banner.textContent.slice(0, 120));

step('1ب', 'الدخول في الوضع الانتقالي: محلي بتنبيه صريح');
login(t1.window, t1.doc, 'staff', 'staff123');
await new Promise((r) => setTimeout(r, 250));
check('الدخول نجح محلياً (حتى لا تتوقف المنظومة)', !shellHidden(t1.doc), 'اللوحة ما زالت مخفية');
check('تنبيه واضح بأن البيانات غير مشتركة',
  [...t1.doc.querySelectorAll('#toast-root .toast')].some((x) => /محلي|غير مشتركة|موظف/.test(x.textContent)),
  JSON.stringify([...t1.doc.querySelectorAll('#toast-root .toast')].map((x) => x.textContent.slice(0, 40))));
check('الجلسة محلية (لا جلسة سحابية)', t1.window.BRCStore.currentUser() && !t1.window.BRCStore.currentUser().cloud);
check('لا شيء يُدفع للقاعدة في الوضع الانتقالي (لا صلاحية كتابة)',
  !t1.window.__brcMock.__calls.some((c) => ['insert', 'update', 'delete'].includes(c.op)));

/* ===========================================================================
 *  2) الوضع النهائي (enforceAuth=true): لا باب خلفي
 * =========================================================================== */
step(2, 'الوضع النهائي — enforceAuth=true يمنع الدخول المحلي تماماً');
const t2 = await open({ enforceAuth: true });
t2.window.BRCStore.logout();
await new Promise((r) => setTimeout(r, 120));
check('مفتاح enforceAuth مفعّل كما ضبطه المسؤول', t2.window.BRCStore.cloudStatus().enforceAuth === true);
login(t2.window, t2.doc, 'admin', 'admin123');
await new Promise((r) => setTimeout(r, 300));
check('كلمة مرور config.js لم تُدخل أحداً', shellHidden(t2.doc), 'دخل بالباب الخلفي!');
check('لا جلسة بعد المحاولة المرفوضة', !t2.window.BRCStore.currentUser());
check('رسالة الفشل واضحة', [...t2.doc.querySelectorAll('#toast-root .toast')].some((x) => /فشل الدخول|غير صحيحة/.test(x.textContent)),
  JSON.stringify([...t2.doc.querySelectorAll('#toast-root .toast')].map((x) => x.textContent.slice(0, 40))));
check('حتى الدالة نفسها ترفض (حماية مزدوجة في طبقة البيانات)',
  t2.window.BRCStore.login('admin', 'admin123') === null);

/* ===========================================================================
 *  3) موظف بحساب رسمي لكن بلا سطر في brc.staff
 * =========================================================================== */
step(3, 'حساب Auth بلا سطر في brc.staff — يُرفض برسالة مفهومة');
login(t2.window, t2.doc, 'hussein', 'right-pass');
await new Promise((r) => setTimeout(r, 300));
check('لم يُدخَل (الحساب غير مربوط بأي سطر موظف)', shellHidden(t2.doc) || !t2.window.BRCStore.currentUser(), 'دخل بلا صلاحية');
/* في enforceAuth=true الرسالة الصريحة تظهر؛ ولا يوجد أي مسار يمنحه صلاحية */

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
console.log('═'.repeat(74) + '\n');
if (problems.length) { console.log('  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); console.log(); }
process.exit(fail ? 1 : 0);
