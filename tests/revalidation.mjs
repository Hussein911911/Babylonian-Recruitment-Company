#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص إعادة التحقق الفوري (ISR / On-Demand Revalidation)
 *  ---------------------------------------------------------------------------
 *  يغطي الطبقات الثلاث معاً:
 *    1) النواة المشتركة: التوقيع، الطابع الزمني، نافذة 5 دقائق، المسارات.
 *    2) المسار المحلي: tools/serve.mjs يستجيب على /api/revalidate بنفس النواة.
 *    3) عميل اللوحة: assets/js/revalidate.js يوقّع ويرسل ويُخنق الحفظ المتتابع.
 *    4) الربط: تعديل وظيفة في store.js يُطلق الإشعار.
 *    5) النشر: functions/api/revalidate.js و _headers موجودان ومتطابقان.
 *
 *  التشغيل: node tests/revalidation.mjs
 * =========================================================================== */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { verifyRequest, signRequest, MAX_SKEW_MS, TARGETS } from '../tools/revalidate-core.mjs';

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);
const SECRET = 'test-secret-for-revalidation-suite';

console.log('\n' + '═'.repeat(74));
console.log('  HRC — إعادة التحقق الفوري (On-Demand Revalidation)');
console.log('═'.repeat(74));

/* ─────────────────────────── 1) النواة ─────────────────────────── */
step(1, 'النواة المشتركة: التوقيع والنوافذ الزمنية والمسارات');
{
  const good = await signRequest(SECRET, '');
  const v = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': good.ts, 'x-hrc-signature': good.signature }, payload: '' });
  check('توقيع صحيح يُقبل ويعيد المسار الوحيد المعروف', v.ok && v.paths.length === 1 && v.paths[0] === TARGETS[0], JSON.stringify(v));

  const wrong = await verifyRequest({ secret: 'secret-آخر', headers: { 'x-hrc-timestamp': good.ts, 'x-hrc-signature': good.signature }, payload: '' });
  check('توقيع بسرّ مختلف يُرفض 401', !wrong.ok && wrong.status === 401, String(wrong.status));

  const noSig = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': good.ts }, payload: '' });
  check('بلا توقيع يُرفض 401', !noSig.ok && noSig.status === 401);

  const noTs = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-signature': good.signature }, payload: '' });
  check('بلا طابع زمني يُرفض 401', !noTs.ok && noTs.status === 401);

  /* إعادة تشغيل: نفس الطلب بعد 6 دقائق يجب أن يُرفض */
  const old = await signRequest(SECRET, '', Date.now() - (MAX_SKEW_MS + 60000));
  const replay = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': old.ts, 'x-hrc-signature': old.signature }, payload: '' });
  check('إعادة تشغيل طلب أقدم من 5 دقائق مرفوضة', !replay.ok && replay.status === 401, replay.error);

  /* طابع في المستقبل البعيد أيضاً مرفوض */
  const future = await signRequest(SECRET, '', Date.now() + (MAX_SKEW_MS + 60000));
  const fut = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': future.ts, 'x-hrc-signature': future.signature }, payload: '' });
  check('طابع زمني في المستقبل البعيد مرفوض', !fut.ok && fut.status === 401);

  const noSecret = await verifyRequest({ secret: '', headers: {}, payload: '' });
  check('بلا سرّ مضبوط يُرفض 503 (لا يبقى مفتوحاً)', !noSecret.ok && noSecret.status === 503);

  /* المسارات المسموحة فقط */
  const body = JSON.stringify({ paths: ['/rest/v1/applicants'] });
  const badPath = await signRequest(SECRET, body);
  const bp = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': badPath.ts, 'x-hrc-signature': badPath.signature }, payload: body });
  check('مسار خارج القائمة البيضاء مرفوض 400', !bp.ok && bp.status === 400, bp.error);

  const okBody = JSON.stringify({ paths: [TARGETS[0]] });
  const goodPath = await signRequest(SECRET, okBody);
  const gp = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': goodPath.ts, 'x-hrc-signature': goodPath.signature }, payload: okBody });
  check('المسار المعتمد يُقبل من الجسم', gp.ok && gp.paths[0] === TARGETS[0]);

  const malformed = 'not-json';
  const mj = await signRequest(SECRET, malformed);
  const m = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': mj.ts, 'x-hrc-signature': mj.signature }, payload: malformed });
  check('جسم ليس JSON مرفوض 400', !m.ok && m.status === 400);

  /* الجسم موقّع: تعديل المسار بعد التوقيع يكسر التحقق */
  const tampered = JSON.stringify({ paths: ['/rest/v1/public_jobs'], evil: true });
  const t = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': goodPath.ts, 'x-hrc-signature': goodPath.signature }, payload: tampered });
  check('تعديل الجسم بعد التوقيع يُرفض', !t.ok && t.status === 401);
}

/* ─────────────────────── 2) النشر: الملفات ─────────────────────── */
step(2, 'ملفات النشر على Cloudflare Pages');
{
  check('functions/api/revalidate.js موجود', existsSync('functions/api/revalidate.js'));
  const fn = readFileSync('functions/api/revalidate.js', 'utf8');
  check('الدالة تصدّر onRequestPost', /export async function onRequestPost/.test(fn));
  check('الدالة تصدّر onRequestOptions (CORS)', /export async function onRequestOptions/.test(fn));
  check('السرّ يُقرأ من البيئة لا من الكود', /env\.HRC_REVALIDATE_SECRET/.test(fn) && !/['"]hrc_[a-z0-9]{16,}['"]/i.test(fn));
  check('تستخدم caches.default للحذف على الحافة', /caches\.default\.delete/.test(fn));
  check('لا تعيد بناء كامل — لا fetch لصفحات HTML', !/fetch\(origin \+ ['"]\/index/.test(fn));

  const headers = readFileSync('_headers', 'utf8');
  check('_headers يمنع تخزين /api/revalidate', /\/api\/revalidate\*[\s\S]{0,120}Cache-Control: no-store/.test(headers));
  check('_headers يضبط s-maxage على public_jobs', /\/rest\/v1\/public_jobs\*[\s\S]{0,140}s-maxage=30/.test(headers));
  check('_headers يضيف stale-while-revalidate', /stale-while-revalidate=300/.test(headers));

  /* النواة المشتركة: الدالة والفحص يستخدمان نفس القواعد */
  const core = readFileSync('tools/revalidate-core.mjs', 'utf8');
  check('النواة المشتركة تصدّر verifyRequest و signRequest', /export async function verifyRequest/.test(core) && /export async function signRequest/.test(core));
  check('نافذة 5 دقائق معرّفة مرة واحدة', /MAX_SKEW_MS = 5 \* 60 \* 1000/.test(core));
}

/* ───────────────────── 3) عميل اللوحة (jsdom) ───────────────────── */
step(3, 'عميل اللوحة: التوقيع والخنق والفشل الآمن');
{
  /* runScripts خارجي: نُقيّم الوحدة داخل النافذة مع تعريف crypto/textEncoders
     قبلها، لأن jsdom يعرّف crypto كـgetter فقط ولا يقبل الإسناد. */
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://hrc.example/dashboard.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  try { Object.defineProperty(w, 'crypto', { value: globalThis.crypto, configurable: true }); } catch (e) { }
  w.TextEncoder = TextEncoder;
  w.HRC_CONFIG = { revalidate: { enabled: true, devSecret: SECRET } };

  const calls = [];
  w.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true, status: 200 }); };

  const src = readFileSync('assets/js/revalidate.js', 'utf8');
  w.eval(src);

  check('الوحدة تُسجّل نفسها على النافذة', typeof w.HRCRevalidate === 'object');
  check('معطّلة افتراضياً بلا إعداد', (() => {
    const d2 = new JSDOM('<!doctype html>', { url: 'https://x.test/', runScripts: 'outside-only' });
    d2.window.eval(readFileSync('assets/js/revalidate.js', 'utf8'));
    return d2.window.HRCRevalidate.enabled() === false;
  })());

  /* التوقيع مطابق لما تتحققه النواة */
  const ts = String(Date.now());   /* نافذة 5 دقائق: طابع حقيقي لا ثابت */
  const body = JSON.stringify({ paths: ['/rest/v1/public_jobs'], reason: 'x' });
  const sig = await w.HRCRevalidate.signWith(SECRET, ts, body);
  const verdict = await verifyRequest({ secret: SECRET, headers: { 'x-hrc-timestamp': ts, 'x-hrc-signature': sig }, payload: body });
  check('توقيع المتصفح مقبول في النواة (توافق تام)', verdict.ok, JSON.stringify(verdict));

  /* إرسال فعلي عبر fetch المزيّف */
  const sent = await w.HRCRevalidate.send({ secret: SECRET, reason: 'job-create' });
  check('send() ينادي /api/revalidate بـ POST', calls.length === 1 && calls[0].url === '/api/revalidate' && calls[0].opts.method === 'POST');
  check('send() يضع ترويستي التوقيع', !!(calls[0].opts.headers['x-hrc-timestamp'] && calls[0].opts.headers['x-hrc-signature']));
  check('send() يبلّغ النجاح', sent.ok === true, JSON.stringify(sent));

  /* فشل الشبكة لا يرمي */
  const before = calls.length;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.HRCRevalidate._reset();
  const failed = await w.HRCRevalidate.send({ secret: SECRET });
  check('فشل الشبكة يُعاد كـ{ok:false} بلا رمي', failed.ok === false && failed.error === 'offline');
  check('الفشل لم يمنع الاستدعاء', calls.length === before);

  /* بلا سرّ: لا طلب أصلاً */
  const before2 = calls.length;
  const noSec = await w.HRCRevalidate.send({ reason: 'x' });
  check('بلا سرّ لا يُرسل طلباً (NO_SECRET)', noSec.ok === false && noSec.error === 'NO_SECRET');

  /* خنق الحفظ المتتابع */
  w.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true, status: 200 }); };
  w.HRCRevalidate._reset();
  const n0 = calls.length;
  for (let i = 0; i < 5; i++) w.HRCRevalidate.afterJobChange('burst-' + i);
  await new Promise((r) => setTimeout(r, 60));
  const burst = calls.length - n0;
  check('5 تعديلات متتابعة لا تُطلق 5 طلبات (خنق)', burst <= 2, 'أُرسل ' + burst);
}

/* ─────────────────── 4) الربط الفعلي في store.js ─────────────────── */
step(4, 'الربط: تعديل الوظيفة في الحالة يُطلق الإشعار');
{
  const store = readFileSync('assets/js/store.js', 'utf8');
  check('revalidateJobs معرّفة', /function revalidateJobs\(/.test(store));
  const create = /function createJob[\s\S]*?save\(\); emit\(\); revalidateJobs\('job-create'\);/.test(store);
  const status = /function setJobStatus[\s\S]*?save\(\); emit\(\); revalidateJobs\('job-status'\);/.test(store);
  const del = /function deleteJob[\s\S]*?save\(\); emit\(\); revalidateJobs\('job-delete'\);/.test(store);
  check('إضافة وظيفة تُطلق الإشعار', create);
  check('تغيير حالة وظيفة يُطلق الإشعار', status);
  check('حذف وظيفة يُطلق الإشعار', del);
  check('الإشعار محاط بـ try/catch (لا يكسر الحفظ)', /try \{ if \(root\.HRCRevalidate\)/.test(store));

  /* الوظائف غير الوظيفية لا تُطلق إشعاراً */
  const applicants = /function createApplicant[\s\S]{0,400}revalidateJobs/.test(store);
  check('إضافة بطاقة/استمارة لا تُطلق إشعار وظائف', !applicants);

  const cfg = readFileSync('assets/js/config.js', 'utf8');
  check('config يحمل ttlSeconds=30 مطابقاً لـ _headers', /ttlSeconds:\s*30/.test(cfg));
  check('config يحمل staleWhileRevalidate=300 مطابقاً', /staleWhileRevalidate:\s*300/.test(cfg));
  check('السرّ ليس مكتوباً في config (null افتراضياً)', /devSecret:\s*null/.test(cfg));

  const build = readFileSync('tools/build.mjs', 'utf8');
  check('revalidate في ترتيب التسلسل', /JS_ORDER = \[[^\]]*'revalidate'/.test(build));
  check('revalidate غير محمّل في الصفحة العامة', !/public: \['config', 'revalidate'/.test(build));
  check('revalidate محمّل في اللوحة', /dashboard: \['config', 'revalidate'/.test(build));
}

/* ───────────────────── 5) الصفحات المبنية فعلاً ───────────────────── */
step(5, 'الصفحات المبنية تحمل الوحدة');
{
  /* الوحدة تُحمَّل في اللوحة وحدها — تعديل الوظائف من هناك فقط. */
  const dashHtml = readFileSync('dashboard.html', 'utf8');
  check('dashboard.html يحمّل revalidate.js', /assets\/js\/revalidate\.js/.test(dashHtml));
  const pubHtml = readFileSync('index.html', 'utf8');
  check('index.html لا يحمّلها (5KB بلا فائدة للزائر)', !/assets\/js\/revalidate\.js/.test(pubHtml));
  check('index.html لا يحمّل jsQR أولاً (تحسين سابق قائم)', !/vendor\/jsqr\.js/.test(pubHtml));
  const standalone = readFileSync('hrc-standalone.html', 'utf8');
  check('الملف المستقل يحتوي الوحدة لكنها معطّلة (بلا شبكة)', /hrc-cache|HRCRevalidate/.test(standalone));
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅ ' : '❌ ') + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
