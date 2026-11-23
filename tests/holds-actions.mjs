#!/usr/bin/env node
/* ===========================================================================
 *  HRC — قرارات الحجوزات في اللوحة: لا زرّ بلا نتيجة
 *  ---------------------------------------------------------------------------
 *  بلاغ المالك (2026-11-23): «أدوس توظيف أو إرجاع على حجز برتبة مدير فلا يتغيّر
 *  لون الحجز ولا يظهر سبب». السبب الحقيقي: قرار يرفضه المخزن (حالة تغيّرت من
 *  القاعدة أو نقرة مزدوجة على الجوال) كان يمرّ **صامتاً** — لا رسالة ولا إعادة
 *  رسم. الاختبار يشغّل dashboard.html الفعلية بجلسة مدير ويؤكد القاعدة:
 *
 *    • قرار ناجح ⇒ الحالة تتغيّر والقائمة تُعاد رسمها فوراً.
 *    • قرار مرفوض ⇒ سبب ظاهر (تنبيه + داخل النافذة) وإغلاق وتحديث.
 *    • نقرة مزدوجة ⇒ نجاح واحد بلا رسالة خطأ كاذبة.
 *    • حجز انحسم ⇒ رسالة «تحدثت الحالة» لا نافذة ميتة.
 *    • حذف مرفوض ⇒ لا ندّعي نجاحاً.
 *
 *  التشغيل:  node tests/holds-actions.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole } from 'jsdom';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'
};

/* الوضع المحلي وحده: لا سحابة ولا شبكة — نفحص منطق الواجهة والمخزن */
const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'dashboard.html';
  try {
    if (rel.endsWith('assets/js/supabase-config.js')) {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      return res.end("window.HRCSupabaseConfig = { url: '', publishableKey: '', schema: 'brc', enabled: false, enforceAuth: false };");
    }
    if (rel.endsWith('vendor/supabase.js')) {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      return res.end('window.supabase = undefined;');
    }
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

async function open() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => { if (/Could not load|Not implemented/.test(String(e.message))) return; errors.push(String(e.message)); });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  vc.on('warn', () => {});
  const dom = await JSDOM.fromURL(BASE + '/dashboard.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.sessionStorage.setItem('hrc_session_v2', JSON.stringify({
        username: 'admin', name: 'المدير', role: 'admin', title: 'مدير', at: new Date().toISOString()
      }));
    }
  });
  const wait = (ms = 140) => new Promise((r) => setTimeout(r, ms));
  await wait(500);
  const doc = dom.window.document;
  const Store = dom.window.HRCStore;
  const job = Store.createJob({
    title: 'وظيفة اختبار', region: 'بابل', governorate: 'بابل', salaryMin: 500000, salaryMax: 700000,
    shift: 'صباحي', employerName: 'شركة', employerPhone: '0770', vacancies: 1
  });
  const app = Store.createApplicant({ fullName: 'علي حسن', phone: '0780', address: 'الحلة' });
  Store.selectAttempt(app.serial, job.code);
  doc.querySelector('#side-nav button[data-view="holds"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await wait(180);
  return {
    win: dom.window, doc, Store, job, app, wait,
    host: () => doc.getElementById('holds-list'),
    toasts: () => [...doc.querySelectorAll('#toast-root .toast')].map((t) => t.textContent.replace(/\s+/g, ' ')),
    click: (node) => node.dispatchEvent(new dom.window.Event('click', { bubbles: true })),
    modal: () => doc.querySelector('.modal-backdrop .modal'),
    errors
  };
}
const hasToast = (t, re) => t.toasts().some((x) => re.test(x));

console.log('\n' + '═'.repeat(74));
console.log('  HRC — قرارات الحجوزات: كل زر له نتيجة ظاهرة');
console.log('═'.repeat(74));

/* ========================================================================= */
step(1, 'قرار ناجح — «تم التوظيف» يغيّر الحالة ويُعيد رسم القائمة');
{
  const t = await open();
  check('الحجز ظاهر في قائمة الحجوزات قبل القرار', t.host().textContent.includes(t.job.code));
  t.click(t.host().querySelector('[data-hold-manage]'));
  await t.wait(160);
  check('نافذة القرار فُتحت', !!t.modal() && /إدارة الحجز|قرار/.test(t.modal().querySelector('h3').textContent));
  t.click(t.doc.getElementById('h-win'));
  await t.wait(160);
  check('نافذة تثبيت التوظيف فُتحت', !!t.doc.getElementById('o-save'));
  t.click(t.doc.getElementById('o-save'));
  await t.wait(260);
  const s = t.Store.getAttempts(t.app.serial).map((a) => a.slotStatus);
  check('المخزن: الفرصة صارت succeeded', s[0] === 'succeeded', JSON.stringify(s));
  check('الوظيفة أُغلقت بعد ملء شاغرها', t.Store.getJob(t.job.code).status === 'closed', t.Store.getJob(t.job.code).status);
  check('القائمة أُعيد رسمها فوراً (اختفى الصف)', !t.host().textContent.includes(t.job.code),
    t.host().textContent.replace(/\s+/g, ' ').slice(0, 90));
  check('العدّاد صفر', /^0\b/.test(t.doc.getElementById('holds-count-label').textContent.trim()),
    t.doc.getElementById('holds-count-label').textContent);
  check('تنبيه نجاح واحد على الأقل', hasToast(t, /تم تثبيت التوظيف/));
  check('لا أخطاء JavaScript', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
}

/* ========================================================================= */
step(2, 'قرار مرفوض — سبب ظاهر لا زرّ صامت (عطل البلاغ)');
{
  const t = await open();
  t.click(t.host().querySelector('[data-hold-manage]'));
  await t.wait(160);
  /* الحالة تغيّرت خارج النافذة (موظف آخر/القاعدة) قبل الضغط */
  const att = t.Store.db().attempts.filter((a) => a.no === 1)[0];
  att.slotStatus = 'succeeded';
  t.click(t.doc.getElementById('h-release'));
  await t.wait(220);
  check('ظهر سبب الرفض كتنبيه', hasToast(t, /لم يُنفَّذ/),
    JSON.stringify(t.toasts().slice(-3)));
  check('التنبيه يذكر العملية والسبب', hasToast(t, /إرجاع الوظيفة/) && hasToast(t, /انحسمت|تغيرت/),
    JSON.stringify(t.toasts().slice(-3)));
  check('النافذة أُغلقت فلا يبقى زرّ ميت', !t.doc.querySelector('.modal-backdrop'));
  check('لم تُغيَّر الحالة بالخطأ', t.Store.getAttempts(t.app.serial)[0].slotStatus === 'succeeded',
    t.Store.getAttempts(t.app.serial)[0].slotStatus);
  check('لا أخطاء JavaScript', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
}

/* ========================================================================= */
step(3, 'نقرة مزدوجة — نجاح واحد بلا رسالة خطأ كاذبة');
{
  const t = await open();
  t.click(t.host().querySelector('[data-hold-manage]'));
  await t.wait(160);
  t.click(t.doc.getElementById('h-win'));
  await t.wait(160);
  const save = t.doc.getElementById('o-save');
  t.click(save);
  await t.wait(60);
  /* النقرة الثانية على الزر نفسه (سلوك شائع على الجوال) */
  const second = t.Store.setOutcome(t.app.serial, 1, 'succeeded', '');
  check('النقرة الثانية ترجع نجاحاً (already) لا خطأ', second && second.ok === true && second.already === true,
    JSON.stringify(second));
  await t.wait(220);
  check('لا تنبيه فشل كاذب', !hasToast(t, /لم يُنفَّذ/), JSON.stringify(t.toasts().slice(-3)));
  check('الحالة النهائية succeeded مرة واحدة',
    t.Store.getAttempts(t.app.serial).filter((a) => a.slotStatus === 'succeeded').length === 1);
  /* إرجاع بعد توظيف مثبّت: رفض واضح — لا يجوز التراجع عن توظيف بضغطة إرجاع */
  const rel = t.Store.releaseHold(t.app.serial, 1, 'تكرار');
  check('إرجاع بعد توظيف مثبّت = رفض صريح بسببه', rel && rel.ok === false && /انحسمت/.test(rel.error || ''),
    JSON.stringify(rel));
  /* إرجاع مكرّر لنفس الفرصة المستهلكة بالإرجاع: نجاح بلا خطأ */
  t.Store.db().attempts.filter((a) => a.no === 1)[0].slotStatus = 'expired';
  const rel2 = t.Store.releaseHold(t.app.serial, 1, 'تكرار الإرجاع');
  check('إرجاع مكرّر (الفرصة expired) = نجاح already بلا رسالة خطأ', rel2 && rel2.ok === true && rel2.already === true,
    JSON.stringify(rel2));
}

/* ========================================================================= */
step(4, 'حجز انحسم قبل الضغط — رسالة «تحدثت الحالة» لا نافذة ميتة');
{
  const t = await open();
  const btn = t.host().querySelector('[data-hold-manage]');
  /* حُسم الحجز من مكان آخر ثم ضغط المدير زرّاً قديماً */
  const att = t.Store.db().attempts.filter((a) => a.no === 1)[0];
  att.slotStatus = 'succeeded';
  t.click(btn);
  await t.wait(200);
  check('لا نافذة فارغة', !t.doc.querySelector('.modal-backdrop'));
  check('رسالة «تحدثت الحالة» ظاهرة', hasToast(t, /تحدثت الحالة/), JSON.stringify(t.toasts().slice(-2)));
  check('القائمة أُعيد رسمها بلا الصف المحسوم', !t.host().textContent.includes(t.job.code));
}

/* ========================================================================= */
step(5, 'حذف مرفوض — لا ندّعي نجاحاً');
{
  const t = await open();
  t.click(t.host().querySelector('[data-hold-manage]'));
  await t.wait(160);
  const del = t.doc.getElementById('h-del');
  check('زر الحذف ظاهر لشاغر واحد', !!del);
  t.Store.deleteJob = () => false;            /* محاكاة رفض الصلاحية/الشبكة */
  t.click(del);
  await t.wait(160);
  const confirmOk = t.doc.querySelector('.modal-backdrop [data-ok]');
  check('نافذة تأكيد الحذف ظهرت', !!confirmOk);
  if (confirmOk) t.click(confirmOk);
  await t.wait(220);
  check('ظهر سبب عدم الحذف', hasToast(t, /لم يُنفَّذ|تعذّر الحذف/), JSON.stringify(t.toasts().slice(-2)));
  check('لا تنبيه «حُذفت الوظيفة» الكاذب', !hasToast(t, /حُذفت الوظيفة/), JSON.stringify(t.toasts().slice(-2)));
  check('الوظيفة ما زالت موجودة', !!t.Store.getJob(t.job.code));
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
console.log('═'.repeat(74) + '\n');
if (problems.length) { console.log('  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); console.log(); }
server.close();
process.exit(fail ? 1 : 0);
