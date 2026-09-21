#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار صفحة تشخيص Supabase (supabase-check.html)
 *  ---------------------------------------------------------------------------
 *  لماذا بمحاكاة؟ لأن الساندبوكس لا يستطيع الوصول إلى *.supabase.co
 *  (قائمة نطاقات مسموحة)، فلا يمكن اختبار الصفحة على المشروع الحقيقي.
 *  بدلاً من ترك الصفحة بلا أي تحقق، نحقن عميلاً وهمياً بردود واقعية من
 *  PostgREST/Supabase ونثبت أن:
 *    1. الصفحة تعمل بلا أخطاء JS في كل الحالات
 *    2. تفسيرها للأخطاء صحيح — وهذه أخطر نقطة:
 *       الخطأ «جدول مفقود» يجب ألا يُقرأ كنجاح، والخطأ «محمي بـ RLS» يجب
 *       ألا يُقرأ كفشل (وإلا أعطت الصفحة تشخيصاً مضلّلاً للمالك).
 *
 *  التشغيل:  node tests/supabase-check.mjs
 * =========================================================================== */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const { JSDOM, VirtualConsole } = require('jsdom');

const PORT = Number(process.env.BRC_TEST_PORT || 4327);
const BASE = 'http://localhost:' + PORT;

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/supabase-check.html'); if (r.ok) return; } catch { /* not up */ }
    await wait(150);
  }
  throw new Error('لم يُقلع خادم المعاينة');
}

/* ---------------------------------------------------------------------------
 *  محاكي Supabase: يحاكي سلوك PostgREST الحقيقي لكل سيناريو
 *  scenario.tableState(name) -> 'ok' | 'rls' | 'missing' | 'schema'
 * ------------------------------------------------------------------------- */
function makeFakeSupabase(scenario) {
  const errFor = (state, table) => {
    if (state === 'missing') return { code: 'PGRST205', message: `Could not find the table 'brc.${table}' in the schema cache`, details: null, hint: null };
    if (state === 'schema') return { code: 'PGRST106', message: 'The schema must be one of the following: public, graphql_public', details: null, hint: null };
    if (state === 'rls') return { code: '42501', message: 'permission denied for table ' + table, details: null, hint: null };
    return null;
  };
  /* ذاكرة جدول بسيطة: تُتيح اختبار «الإدراج ثم القراءة ثم الحذف» كما يحدث فعلاً
     (بدونها يُقرأ الفحص كفاشل لأن القراءة لا ترى ما أُدرج) */
  const mem = {};
  const matches = (row, filters) => filters.every(([c, v]) => String(row[c]) === String(v));

  const builder = (table) => {
    const st = scenario.tableState ? scenario.tableState(table) : 'rls';
    const err = errFor(st, table);
    let op = 'select';
    let filters = [];
    const respond = () => {
      if (scenario.opError) {
        const e = scenario.opError(op, table, filters);
        if (e) return { data: null, error: e, count: null, status: 400, statusText: 'Bad Request' };
      }
      if (op === 'insert') {
        const row = Object.assign({ id: 'row-' + Math.random().toString(36).slice(2, 7) }, scenario.lastInsert || {});
        (mem[table] = mem[table] || []).push(row);
        return { data: [row], error: null, count: null, status: 201, statusText: 'Created' };
      }
      if (op === 'delete') {
        const before = (mem[table] || []).length;
        mem[table] = (mem[table] || []).filter((r) => !matches(r, filters));
        return { data: null, error: null, count: before - mem[table].length, status: 204, statusText: 'No Content' };
      }
      const stored = mem[table] || [];
      const data = stored.length ? stored.filter((r) => matches(r, filters))
                                 : ((scenario.rows && scenario.rows(table)) || []);
      return { data: data, error: err, count: null, status: err ? 400 : 200, statusText: err ? 'Bad Request' : 'OK' };
    };
    const chain = {
      select: () => chain, limit: () => chain, order: () => chain, single: () => p,
      eq: (c, v) => { filters.push([c, v]); return chain; },
      insert: (payload) => { op = 'insert'; scenario.lastInsert = payload; return chain; },
      update: () => { op = 'update'; return chain; },
      delete: () => { op = 'delete'; return chain; }
    };
    const p = Promise.resolve().then(respond);
    chain.then = (a, b) => p.then(a, b);
    chain.catch = (b) => p.catch(b);
    return chain;
  };
  return {
    createClient: () => ({
      from: builder,
      rpc: (name, args) => {
        if (scenario.rpc) {
          const r = scenario.rpc(name, args);
          if (r) return Promise.resolve(r);
        }
        if (scenario.rpcError) {
          const e = scenario.rpcError(name);
          return Promise.resolve({ data: null, error: e, status: 400, statusText: 'Bad Request' });
        }
        return Promise.resolve({ data: { ok: true }, error: null, status: 200, statusText: 'OK' });
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        signInWithPassword: (creds) => Promise.resolve(
          scenario.staffAuth ? scenario.staffAuth(creds)
            : { data: { user: { id: 'auth-1', email: creds.email }, session: {} }, error: null }),
        signOut: () => Promise.resolve({ error: null })
      }
    })
  };
}

/* ملء نموذج فحص الموظف والضغط على الزر — الفحص يجري فعلاً في الصفحة */
async function runStaffCheck(w, doc, user = 'admin', pass = 'correct-pass') {
  doc.getElementById('s-user').value = user;
  doc.getElementById('s-pass').value = pass;
  doc.getElementById('run-staff').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(700);
}
const chipsOf = (doc, id) => [...doc.querySelectorAll('#' + id + ' > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim());

async function loadPage(scenario) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    const m = String(e && (e.detail || e.message || e));
    if (/Not implemented|Could not load|Failed to load resource|NetworkError|ERR_/.test(m)) return;
    errors.push(m.split('\n')[0]);
  });

  const fake = makeFakeSupabase(scenario);

  const dom = await JSDOM.fromURL(BASE + '/supabase-check.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      /* fetch وهمي يرد كما يرد مشروع Supabase الحقيقي */
      window.fetch = (url) => {
        if (/\/auth\/v1\/health/.test(String(url))) {
          if (scenario.reachable === false) return Promise.reject(new Error('NetworkError: failed to fetch'));
          return Promise.resolve({ status: scenario.authStatus || 200, text: () => Promise.resolve('{"date":"2026-09-15"}') });
        }
        return Promise.resolve({ status: 404, text: () => Promise.resolve('{}') });
      };
      /* نعترض تعيين window.supabase: مكتبة supabase.js الحقيقية تُسند عبر
         "var supabase = ..." فيسقط الإسناد في الـ setter الفارغ، ويبقى
         window.supabase دائماً هو المحاكي. بدون هذا يبدأ الفحص التلقائي
         عند الإقلاع بالعميل الحقيقي (لا يصل في الساندبوكس) فتتعلّق كل
         الفحوص 12 ثانية ثم تُضاف نتائجها بعد نتائج المحاكاة فتتشوّش. */
      Object.defineProperty(window, 'supabase', {
        configurable: true,
        get: () => fake,
        set: () => { /* نتجاهل المكتبة الحقيقية */ }
      });
    }
  });
  await new Promise((r) => { dom.window.addEventListener('load', r); setTimeout(r, 8000); });
  await wait(900);   // الفحص يبدأ تلقائياً عند التحميل — ننتظر انتهاءه
  return { w: dom.window, doc: dom.window.document, errors };
}

const rowsOf = (doc) => [...doc.querySelectorAll('#rows tr')].map((tr) => {
  const c = [...tr.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
  return { name: c[0] || '', state: c[1] || '', detail: c[2] || '' };
});
const count = (doc, id) => Number(doc.getElementById(id).textContent);

console.log('\n' + '═'.repeat(74));
console.log('  BRC — اختبار صفحة تشخيص Supabase (بمحاكاة PostgREST)');
console.log('═'.repeat(74));

try {
  await waitForServer();

  /* ---------- 0) تناسق الإعداد بين الملفات ---------- */
  console.log('\n▌ الحالة 0 — تناسق إعداد المشروع بين الملفات');
  {
    const cfgJs = readFileSync(join(ROOT, 'assets', 'js', 'supabase-config.js'), 'utf8');
    const tomlTxt = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');
    const url = (cfgJs.match(/url:\s*'([^']+)'/) || [])[1] || '';
    const key = (cfgJs.match(/publishableKey:\s*'([^']+)'/) || [])[1] || '';
    const schema = (cfgJs.match(/schema:\s*'([^']+)'/) || [])[1] || '';
    const ref = url.replace(/^https:\/\//, '').replace(/\.supabase\.co.*$/, '');
    const pid = (tomlTxt.match(/project_id\s*=\s*"([^"]+)"/) || [])[1] || '';

    check('رابط المشروع بصيغة صحيحة', /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url), url);
    check('معرّف المشروع في supabase/config.toml يطابق الرابط (خطأ كتابي شائع)',
      !!pid && pid === ref, `config.toml="${pid}" مقابل الرابط="${ref}"`);
    check('المفتاح العام بصيغة Publishable (لا Secret)',
      /^sb_publishable_/.test(key), key.slice(0, 18) + '…');
    /* نجرّد تعليقات JS أولاً: الملف يحذّر من sb_secret_ داخل تعليق (مقصود).
       الفحص يستهدف سرّاً **فعلياً** في كود يُنفَّذ. */
    const cfgBare = cfgJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check('لا مفتاح سرّي مكتوب في كود الواجهة',
      !/sb_secret_[A-Za-z0-9]/.test(cfgBare) && !/service_role["']?\s*[:=]/i.test(cfgBare));
    check('السكيما المضبوطة هي brc', schema === 'brc', schema);
  }

  /* ---------- 1) الإعداد سليم تماماً ---------- */
  console.log('\n▌ الحالة 1 — كل شيء مضبوط (الجداول موجودة ومحمية بـ RLS)');
  {
    const { doc, errors } = await loadPage({ reachable: true, authStatus: 200, tableState: () => 'rls' });
    const rows = rowsOf(doc);
    check('الصفحة عملت بلا أخطاء JS', errors.length === 0, errors.join(' | '));
    check('فحص الوصول للمشروع نجح', rows.some((r) => /الوصول لمشروع/.test(r.name) && r.state === 'ناجح'),
      JSON.stringify(rows.find((r) => /الوصول/.test(r.name))));
    check('كشف السكيما brc ناجح', rows.some((r) => /كشف السكيما/.test(r.name) && r.state === 'ناجح'));
    const tbl = rows.filter((r) => /^جدول/.test(r.name));
    check('الجداول الستة كلها تُقرأ كموجودة (RLS محمي = سليم)', tbl.length === 6 && tbl.every((r) => r.state === 'ناجح'),
      tbl.map((r) => r.name + ':' + r.state).join(' | '));
    check('رسالة «محمي بـ RLS» مميّزة عن الفشل', tbl.every((r) => /محمي بـ RLS/.test(r.detail)));
    check('لا فحوص فاشلة في هذه الحالة', count(doc, 'n-bad') === 0, 'فاشل=' + count(doc, 'n-bad'));
    check('الحكم النهائي يقول الإعداد سليم', /الإعداد سليم/.test(doc.getElementById('verdict').textContent));
  }

  /* ---------- 2) السكيما brc غير مكشوفة ---------- */
  console.log('\n▌ الحالة 2 — السكيما brc غير مضافة في Exposed schemas');
  {
    const { doc, errors } = await loadPage({ reachable: true, authStatus: 200, tableState: () => 'schema' });
    const rows = rowsOf(doc);
    check('الصفحة عملت بلا أخطاء JS', errors.length === 0, errors.join(' | '));
    const sk = rows.find((r) => /كشف السكيما/.test(r.name));
    check('الصفحة كشفت مشكلة السكيما', !!sk && sk.state === 'فاشل');
    check('الرسالة توجّه للمكان الصحيح (Exposed schemas)', !!sk && /Exposed schemas/.test(sk.detail), sk && sk.detail);
    check('الحكم النهائي يذكر سبباً صحيحاً', /Exposed schemas|schema\.sql/.test(doc.getElementById('verdict').textContent));
  }

  /* ---------- 3) المخطط لم يُنفَّذ (جداول مفقودة) ---------- */
  console.log('\n▌ الحالة 3 — docs/schema.sql لم يُنفَّذ بعد');
  {
    const { doc, errors } = await loadPage({ reachable: true, authStatus: 200, tableState: () => 'missing' });
    const rows = rowsOf(doc);
    check('الصفحة عملت بلا أخطاء JS', errors.length === 0, errors.join(' | '));
    const tbl = rows.filter((r) => /^جدول/.test(r.name));
    check('الجداول الستة تُقرأ كفاشلة (لا كنجاح زائف)', tbl.length === 6 && tbl.every((r) => r.state === 'فاشل'),
      tbl.map((r) => r.name + ':' + r.state).join(' | '));
    check('التفصيل يحمل رمز PGRST205', tbl.every((r) => /PGRST205/.test(r.detail)));
    check('الحكم النهائي ينصح بتنفيذ schema.sql', /schema\.sql/.test(doc.getElementById('verdict').textContent));
    check('عدد الفاشلة > 0', count(doc, 'n-bad') > 0, count(doc, 'n-bad') + '');
  }

  /* ---------- 4) المشروع غير قابل للوصول (شبكة) ---------- */
  console.log('\n▌ الحالة 4 — الشبكة تحجب *.supabase.co');
  {
    const { doc, errors } = await loadPage({ reachable: false, tableState: () => 'rls' });
    const rows = rowsOf(doc);
    check('الصفحة عملت بلا أخطاء JS', errors.length === 0, errors.join(' | '));
    const reach = rows.find((r) => /الوصول لمشروع/.test(r.name));
    check('الصفحة أبلغت عن تعذّر الوصول', !!reach && reach.state === 'فاشل', reach && reach.detail);
    check('لم تتوقف الصفحة بلا نهاية (توقّف مبكر)', rows.some((r) => /بقية الفحوص/.test(r.name) && r.state === 'تنبيه'));
    check('لم تُنفَّذ فحوص الجداول (توفيراً للوقت)', !rows.some((r) => /^جدول/.test(r.name)));
  }

  /* ---------- 5) مفتاح غير مقبول ---------- */
  console.log('\n▌ الحالة 5 — المفتاح غير مقبول (401)');
  {
    const { doc, errors } = await loadPage({ reachable: true, authStatus: 401, tableState: () => 'rls' });
    const rows = rowsOf(doc);
    check('الصفحة عملت بلا أخطاء JS', errors.length === 0, errors.join(' | '));
    const reach = rows.find((r) => /الوصول لمشروع/.test(r.name));
    check('الصفحة كشفت أن المفتاح مرفوض', !!reach && reach.state === 'فاشل');
    check('التفصيل يوضّح Publishable مقابل Secret', !!reach && /Publishable|Secret/.test(reach.detail), reach && reach.detail);
  }

  /* ---------- 6) سرّ البصمة غير مضبوط ---------- */
  console.log('\n▌ الحالة 6 — app.brc_secret غير مضبوط (رسالة خطأ من الدالة)');
  {
    const { doc, errors } = await loadPage({
      reachable: true, authStatus: 200, tableState: () => 'rls',
      rpcError: (n) => (n === 'verify_form'
        ? { code: '22023', message: 'app.brc_secret غير مضبوط أو أقصر من 16 حرفاً — راجع تعليمات ضبط المفتاح أعلى الدالة في docs/schema.sql', details: null, hint: null }
        : { code: '42501', message: 'permission denied for function ' + n, details: null, hint: null })
    });
    const rows = rowsOf(doc);
    check('الصفحة عملت بلا أخطاء JS', errors.length === 0, errors.join(' | '));
    const sec = rows.find((r) => /سرّ البصمة/.test(r.name));
    check('الصفحة كشفت أن سرّ البصمة غير مضبوط', !!sec && sec.state === 'فاشل', sec && sec.detail);
    check('التفصيل يذكر app.brc_secret', !!sec && /brc_secret/.test(sec.detail));
    const fns = rows.filter((r) => /^دالة /.test(r.name));
    check('دوال RPC المحمية تُقرأ كموجودة لا مفقودة', fns.length === 3 && fns.every((r) => r.state === 'ناجح'),
      fns.map((r) => r.name + ':' + r.state).join(' | '));
  }

  /* ---------- 7) المحتوى الثابت ---------- */
  console.log('\n▌ الحالة 7 — سلامة الملف نفسه');
  {
    const { doc, errors } = await loadPage({ reachable: true, authStatus: 200, tableState: () => 'rls' });
    check('لا أخطاء JS', errors.length === 0, errors.join(' | '));
    check('المكتبة تُعرض كمحمّلة محلياً (لا CDN)', /محلياً/.test(doc.getElementById('c-lib').textContent),
      doc.getElementById('c-lib').textContent);
    check('لا مرجع CDN في الصفحة', !/https?:\/\/(cdn|unpkg|esm\.sh|jsdelivr)/i.test(doc.documentElement.outerHTML));
  }

/* ===========================================================================
 *  فحص الجاهزية للتسليم — السيناريوهات الأربعة الحاسمة
 * =========================================================================== */
console.log('\n▌ فحص الجاهزية — مشروع مُعدّ بالكامل وحساب موظف يعمل');
{
  const { w, doc, errors } = await loadPage({
    reachable: true,
    /* حساب موظف مُعدّ بالكامل: كل شيء يُقرأ (لا RLS مانعة) */
    tableState: () => 'ok',
    rows: (t) => (t === 'public_jobs' ? [{ code: 'HRC-1042' }] : (t === 'staff' ? [{ id: 's1', username: 'admin', role: 'admin' }] : [])),
    rpc: (name) => (name === 'verify_form'
      ? { data: { ok: false, error: 'لا توجد استمارة بهذا الرقم' }, error: null }
      : (name === 'request_form' ? { data: { ok: false, error: 'الاسم غير صالح' }, error: null } : null))
  });
  check('لا أخطاء JS', errors.length === 0, errors.join(' | '));
  const pub = chipsOf(doc, 'ready-public').join(' | ');
  check('المسار العام: الوظائف المعلنة تُقرأ', /يقرأ الوظائف المعلنة/.test(pub) && /✓/.test(pub), pub.slice(0, 120));
  check('المسار العام: دالة التحقق تُرجع «لا توجد استمارة» لا خطأً', /verify_form|دالة التحقق/.test(pub) && !/✗/.test(pub.split('|')[1] || ''), pub.slice(0, 200));
  check('المسار العام: دالة الطلب ترفض المدخل الفارغ (تحققت من المدخلات)', /request_form|الطلب الإلكتروني/.test(pub), pub.slice(0, 240));
  check('المسار العام: خلاصة «مسار الزائر جاهز»', /مسار الزائر جاهز/.test(pub), pub.slice(-160));

  await runStaffCheck(w, doc);
  const stf = chipsOf(doc, 'ready-staff').join(' | ');
  check('حساب الموظف: الدخول نجح', /الدخول بحساب الموظف/.test(stf), stf.slice(0, 120));
  check('حساب الموظف: البريد المُشتق صحيح', /admin@brc-babil\.com/.test(stf), stf.slice(0, 160));
  check('حساب الموظف: السطر في brc.staff موجود والدور مقروء', /مرتبط بسطر في brc\.staff/.test(stf) && /admin/.test(stf), stf.slice(0, 200));
  check('حساب الموظف: الإدراج نجح', /الكتابة: إدراج وظيفة/.test(stf) && !/إدراج وظيفة[^|]*✗/.test(stf), stf.slice(0, 260));
  check('حساب الموظف: الحذف نجح (لا يبقى أثر للفحص)', /حذف الوظيفة الاختبارية/.test(stf) && /حُذفت/.test(stf), stf.slice(0, 320));
  check('الخلاصة تقول: جاهز للتسليم', /جاهز للتسليم ✓/.test(stf), stf.slice(-200));
  check('الحكم النهائي أعلى الصفحة يقول جاهز للتسليم', /جاهز للتسليم/.test(doc.getElementById('verdict').textContent) &&
    !/الإعداد سليم/.test(doc.getElementById('verdict').textContent),
    doc.getElementById('verdict').textContent.replace(/\s+/g, ' ').slice(0, 140));
  check('الحكم يذكّر بإغلاق الباب الخلفي (enforceAuth)', /enforceAuth/.test(doc.getElementById('verdict').textContent));
  check('لا فحص من المسار العام فشل', !/✗/.test(chipsOf(doc, 'ready-public').join(' ')), chipsOf(doc, 'ready-public').join(' | ').slice(0, 200));
}

console.log('\n▌ فحص الجاهزية — حساب موجود لكن غير مرتبط بـ brc.staff');
{
  const { w, doc } = await loadPage({
    reachable: true,
    tableState: () => 'ok',
    rows: (t) => (t === 'public_jobs' ? [{ code: 'HRC-1042' }] : []),
    rpc: (name) => ({ data: { ok: false }, error: null })
  });
  await runStaffCheck(w, doc);
  const stf = chipsOf(doc, 'ready-staff').join(' | ');
  check('يُبلَّغ أن الحساب غير مرتبط بموظف', /لا سطر لهذا الحساب/.test(stf), stf.slice(0, 200));
  check('الرسالة تدلّ على مكان الحل (brc.staff / §6)', /brc\.staff|supabase-setup/.test(stf));
  check('لا يُقال «جاهز للتسليم»', !/جاهز للتسليم ✓/.test(stf) && !/جاهز للتسليم/.test(doc.getElementById('verdict').textContent));
}

console.log('\n▌ فحص الجاهزية — الكتابة مرفوضة (نقص منح/سياسة: 42501)');
{
  const { w, doc } = await loadPage({
    reachable: true,
    tableState: () => 'ok',
    rows: (t) => (t === 'public_jobs' ? [] : (t === 'staff' ? [{ id: 's1', username: 'admin', role: 'admin' }] : [])),
    rpc: (name) => ({ data: { ok: false }, error: null }),
    opError: (op) => (op === 'insert'
      ? { code: '42501', message: 'permission denied for table jobs', details: null, hint: null } : null)
  });
  await runStaffCheck(w, doc);
  const stf = chipsOf(doc, 'ready-staff').join(' | ');
  check('يُبلَّغ أن الإدراج فشل', /إدراج وظيفة/.test(stf) && /permission denied/.test(stf), stf.slice(0, 220));
  check('رمز الخطأ ظاهر للمسؤول (42501)', /42501/.test(stf));
  check('التوجيه إلى منح §9 وسياسات §8', /schema\.sql/.test(stf));
  check('الخلاصة تقول: غير جاهز للتسليم', /غير جاهز للتسليم/.test(stf), stf.slice(-160));
  check('لا يُعلن الجاهزية في الحكم النهائي', !/جاهز للتسليم\./.test(doc.getElementById('verdict').textContent));
}

console.log('\n▌ فحص الجاهزية — كلمة مرور خاطئة');
{
  const { w, doc } = await loadPage({
    reachable: true,
    tableState: () => 'ok',
    rows: () => [],
    staffAuth: () => ({ data: null, error: { message: 'Invalid login credentials' } }),
    rpc: (name) => ({ data: { ok: false }, error: null })
  });
  await runStaffCheck(w, doc, 'admin', 'wrong');
  const stf = chipsOf(doc, 'ready-staff').join(' | ');
  check('الرسالة عربية ومفهومة (لا نص سوبابيس الإنجليزي)', /غير صحيحة/.test(stf) && !/Invalid login/.test(stf), stf.slice(0, 160));
  check('لا يكمل فحوص الكتابة بعد فشل الدخول', !/إدراج وظيفة/.test(stf));
}

console.log('\n▌ فحص الجاهزية — المسار العام معطّل (دالة التحقق غير مُمنوحة)');
{
  const { doc } = await loadPage({
    reachable: true,
    tableState: () => 'rls',
    rows: () => [],
    rpcError: (name) => (name === 'verify_form'
      ? { code: '42501', message: 'permission denied for function verify_form', details: null, hint: null } : null)
  });
  const pub = chipsOf(doc, 'ready-public').join(' | ');
  check('الكشف أن دالة التحقق محجوبة (الزوار لن يتحققوا)', /permission denied/.test(pub), pub.slice(0, 200));
  check('الخلاصة تقول إن المسار العام لا يعمل', /المسار العام لا يعمل/.test(pub), pub.slice(-180));
}

} catch (e) {
  bad('خطأ غير متوقع في الاختبار', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
} finally {
  server.kill('SIGTERM');
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
