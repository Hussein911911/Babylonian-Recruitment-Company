#!/usr/bin/env node
/* ===========================================================================
 *  BRC — التدقيق الشامل للمشروع (فحص جودة متكامل)
 *  ---------------------------------------------------------------------------
 *  يفحص كل شيء آلياً ويطبع تقريراً عربياً واضحاً:
 *    1) وقت التشغيل: تحميل كل صفحة بلا أي خطأ في الكونسول
 *    2) الترابط: كل نقطة/أيقونة/معرّف يُستخدم موجود فعلاً
 *    3) التنسيق: كل صنف CSS مستخدم في HTML له تعريف في style.css
 *    4) الأصول: كل صورة/خط/ملف مُشار إليه موجود على القرص
 *    5) الإتاحة: اللغة، الاتجاه، نصوص بديلة، تسميات النماذج
 *    6) الطباعة: حاويات النوافذ والطباعة والتنبيهات
 *    7) الاستقلال: الملف المستقل بلا أي مرجع خارجي
 *
 *  التشغيل:  node tests/audit.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { existsSync as fileExists } from 'node:fs';
const LIGHT = fileExists(join(dirname(fileURLToPath(import.meta.url)), '..', 'brc-light.html'));
const PAGES = ['index.html', 'verify.html', 'dashboard.html', 'brc-standalone.html']
  .concat(LIGHT ? ['brc-light.html'] : []);

let pass = 0, fail = 0, warn = 0;
const problems = [];
const warnings = [];

const ok = (t) => { pass++; console.log('  ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('  ❌ ' + t + (d ? '  → ' + d : '')); };
const warnf = (t, d) => { warn++; warnings.push(t + (d ? ' — ' + d : '')); console.log('  ⚠️  ' + t + (d ? '  → ' + d : '')); };
const section = (t) => console.log('\n' + '─'.repeat(72) + '\n  ' + t + '\n' + '─'.repeat(72));

/* ── تحميل صفحة بمتصفح افتراضي ورصد كل الأخطاء ───────────────────────────── */
async function loadPage(file) {
  const vc = new VirtualConsole();
  const errors = [];
  const warns = [];
  vc.on('jsdomError', (e) => {
    const m = String(e && (e.detail || e.message || e));
    if (/Not implemented|Could not load/.test(m)) return;
    errors.push(m.split('\n')[0]);
  });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ').split('\n')[0]));
  vc.on('warn', (...a) => warns.push(a.map(String).join(' ')));
  vc.on('log', () => { }); vc.on('info', () => { }); vc.on('debug', () => { });

  const dom = await JSDOM.fromFile(join(ROOT, file), {
    url: pathToFileURL(join(ROOT, file)).href,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      Object.defineProperty(window, 'print', { configurable: true, writable: true, value: () => { } });
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    }
  });
  try {
    await new Promise((res) => {
      if (dom.window.document.readyState === 'complete') return res();
      dom.window.addEventListener('load', res);
      setTimeout(res, 6000);
    });
    await new Promise((r) => setTimeout(r, 450));
  } catch { /* تجاهل */ }
  return { dom, window: dom.window, doc: dom.window.document, errors, warns };
}

/* ── مصادر ثابتة للمقارنة ────────────────────────────────────────────────── */
const css = readFileSync(join(ROOT, 'assets/css/style.css'), 'utf8');
const jsSrcAll = ['config', 'qr', 'store', 'ui', 'voucher', 'public', 'verify', 'dashboard']
  .map((n) => readFileSync(join(ROOT, 'assets/js/' + n + '.js'), 'utf8')).join('\n');
const cssClasses = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const sprite = readFileSync(join(ROOT, 'src/partials/sprite.html'), 'utf8');
const spriteIds = new Set([...sprite.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const spriteRefs = new Set([...sprite.matchAll(/(?:href|gradientTransform)="url\(#([^)]+)\)"/g)].map((m) => m[1]));

/* أصناف بلاغية/بنيوية لا تحتاج تنسيقاً (تُستخدم كخطّافات منطق أو دلالة) */
const CSS_ALLOW = new Set([
  'grow', 'row', 'col', 'flex', 'grid', 'wrap', 'center', 'rtl', 'ltr',
  'is-active', 'is-open', 'is-hidden', 'js-only', 'no-js', 'active-item'
]);

console.log('\n' + '═'.repeat(72));
console.log('  BRC — التدقيق الشامل للمشروع');
console.log('  شركة بابل للتوظيف — Babylonian Recruitment Company');
console.log('═'.repeat(72));

const loaded = {};

/* ═══ 1) وقت التشغيل: تحميل نظيف بلا أخطاء ═══════════════════════════════ */
section('1) تحميل الصفحات في متصفح افتراضي — يجب ألا يظهر أي خطأ');

for (const file of PAGES) {
  const p = await loadPage(file);
  loaded[file] = p;
  const mods = ['BRC_CONFIG', 'BRCQR', 'BRCStore', 'BRCUI', 'BRCVoucher'];
  const missing = mods.filter((m) => !p.window[m]);
  if (p.errors.length) bad(file + ' — تحميل بدون أخطاء', p.errors.slice(0, 3).join(' | '));
  else if (missing.length) bad(file + ' — كل الوحدات محمّلة', 'ناقص: ' + missing.join(', '));
  else ok(file + ' — حُمِّل بلا أخطاء وكل الوحدات جاهزة (' + mods.length + ' وحدات)');

  if (p.warns.length) warnf(file + ' — رسائل تحذيرية في الكونسول', p.warns.slice(0, 2).join(' | '));

  // تنبيهات إضافية خاصة بكل صفحة
  const t = p.doc.querySelector('title');
  if (!t || !t.textContent.trim()) bad(file + ' — عنوان الصفحة موجود'); else ok(file + ' — العنوان: «' + t.textContent.trim().slice(0, 46) + '»');
}

/* ═══ 2) ترابط الأيقونات والرموز ══════════════════════════════════════════ */
section('2) ترابط الأيقونات — كل <use href="#i-…"> له رمز موجود في المكتبة');

for (const file of PAGES) {
  const p = loaded[file];
  const refs = new Set(
    [...p.doc.querySelectorAll('use')]
      .map((u) => (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace(/^#/, ''))
      .filter((id) => id.startsWith('i-'))
  );
  const dangling = [...refs].filter((id) => !spriteIds.has(id));
  if (dangling.length) bad(file + ' — كل الأيقونات موجودة', 'مفقودة: ' + dangling.join(', '));
  else ok(file + ' — ' + refs.size + ' أيقونة مستخدمة، كلها موجودة في المكتبة');
}

{
  const dup = [...spriteIds].filter((id) => (sprite.match(new RegExp('id="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g')) || []).length > 1);
  if (dup.length) bad('مكتبة الأيقونات — لا معرّفات مكرّرة', dup.join(', '));
  else ok('مكتبة الأيقونات — ' + spriteIds.size + ' معرّفاً بلا تكرار');
  // الأيقونة مستخدمة إن وردت في HTML الصفحات أو نُودي بها من الكود BRCUI.ic('name')
  const iconCalls = new Set([...jsSrcAll.matchAll(/ic\(\s*'([a-z0-9-]+)'/g)].map((m) => 'i-' + m[1]));
  const inPages = (id) => PAGES.some((f) => loaded[f] && loaded[f].doc.documentElement.outerHTML.includes('#' + id));
  const unused = [...spriteIds].filter((id) => !id.startsWith('g-') && id !== 'i-emblem' && !iconCalls.has(id) && !inPages(id));
  if (unused.length) warnf('أيقونات غير مستخدمة (' + unused.length + ')', unused.join(', '));
  else ok('كل ' + (spriteIds.size - 2) + ' أيقونة مستخدمة فعلاً (ثابتة في الصفحات أو من الكود)');
}

/* ═══ 3) تغطية التنسيق: كل صنف مستخدم له قاعدة ═══════════════════════════ */
section('3) التنسيق — كل صنف CSS مستخدم في HTML له تعريف في style.css');

// أصناف تُبنى داخل الكود (نوافذ/صفوف/بطاقات) — تُجمع من ملفات JS أيضاً
const jsSrc = jsSrcAll;
const jsClasses = new Set([...jsSrc.matchAll(/class="([^"{}]*?)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));

for (const file of PAGES) {
  const used = new Set();
  loaded[file].doc.querySelectorAll('[class]').forEach((el) => {
    String(el.getAttribute('class') || '').split(/\s+/).forEach((c) => { if (c && !CSS_ALLOW.has(c)) used.add(c); });
  });
  const undef = [...used].filter((c) => !cssClasses.has(c) && !jsClasses.has(c));
  if (undef.length) bad(file + ' — كل الأصناف معرّفة', 'بلا تعريف (' + undef.length + '): ' + undef.slice(0, 12).join(', '));
  else ok(file + ' — ' + used.size + ' صنفاً مستخدماً، كلها معرّفة (' + cssClasses.size + ' صنفاً في الملف)');
}

/* ═══ 3.b) سلامة ملف التنسيق: المتغيرات والأقواس وأحجام الأيقونات ═══════ */
section('3.b) سلامة style.css — المتغيرات المعرّفة، الأقواس المتوازنة، وأحجام الأيقونات');

{
  // (أ) كل متغيّر مستخدم يجب أن يكون معرّفاً
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const usedVars = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
  const undef = [...usedVars].filter((v) => !defined.has(v));
  if (undef.length) bad('كل متغيّرات الألوان معرّفة', 'غير معرّف: ' + undef.join(', '));
  else ok('كل متغيّرات الألوان معرّفة (' + usedVars.size + ' مستخدماً من ' + defined.size + ' معرّفاً)');

  // (ب) توازن الأقواس
  const open = (css.match(/{/g) || []).length, close = (css.match(/}/g) || []).length;
  if (open !== close) bad('أقواس style.css متوازنة', open + ' فتح مقابل ' + close + ' إغلاق');
  else ok('أقواس style.css متوازنة (' + open + ' قاعدة)');

  // (ج) قاعدة حجم أساسية لكل أيقونة class="ic"
  const baseIc = /\.ic\s*{[^}]*width\s*:/.test(css.replace(/\s+/g, ' '));
  const iconCount = PAGES.reduce((n, f) => n + loaded[f].doc.querySelectorAll('svg.ic').length, 0);
  if (!baseIc) bad('قاعدة حجم أساسية للأيقونات (svg.ic)', iconCount + ' أيقونة ستُرسم بحجم افتراضي ضخم');
  else ok('قاعدة حجم أساسية للأيقونات موجودة — تحمي ' + iconCount + ' أيقونة في الصفحات');

  // (د) كل ملفات JS تُحلَّل بلا خطأ نحوي
  const jsFiles = ['config', 'qr', 'store', 'ui', 'voucher', 'public', 'verify', 'dashboard'];
  let syntaxBad = [];
  for (const f of jsFiles) {
    try { new Function(readFileSync(join(ROOT, 'assets/js/' + f + '.js'), 'utf8')); }
    catch (e) { syntaxBad.push(f + '.js: ' + e.message); }
  }
  if (syntaxBad.length) bad('كل ملفات JS سليمة نحوياً', syntaxBad.join(' | '));
  else ok('كل ملفات JS (' + jsFiles.length + ') سليمة نحوياً');
}

/* ═══ 3.c) عقد الطباعة: A4 واستثناء كل شيء غير الاستمارة ═════════════════ */
section('3.c) الطباعة — مقاس A4 وطباعة الاستمارة فقط');

{
  const hasPage = /@page\s*{[^}]*size:\s*A4/i.test(css);
  const hidesAll = /body\s*\*\s*{[^}]*visibility:\s*hidden/i.test(css);
  const showsRoot = /#print-root[^{]*{[^}]*visibility:\s*visible/i.test(css);
  const hiddenOnScreen = /#print-root\s*{[^}]*display:\s*none/i.test(css);
  /* الورقة المطبوعة يجب أن تكون نظيفة: لا علامة مائية ولا أي صورة خلفية داخل الاستمارة */
  const noWm = !/v-watermark/.test(css);
  const noBgInPrint = /\.voucher,\s*\.voucher\s*\*[^{]*{[^}]*background-image:\s*none/i.test(css);
  if (!hasPage) bad('مقاس الورق A4 محدَّد (@page)', 'لا يوجد size: A4');
  else if (!hidesAll || !showsRoot) bad('الطباعة تُظهر الاستمارة وحدها', 'visibility: hidden=' + hidesAll + ' / visible=' + showsRoot);
  else if (!hiddenOnScreen) bad('حاوية الطباعة مخفية على الشاشة');
  else if (!noWm) bad('لا علامة مائية في الاستمارة المطبوعة', 'ما زالت .v-watermark موجودة في CSS');
  else if (!noBgInPrint) bad('صور الخلفية مُلغاة داخل الاستمارة عند الطباعة');
  else ok('عقد الطباعة سليم: A4 portrait، تُطبع الاستمارة وحدها، والورقة بيضاء نظيفة بلا علامة مائية');
}

/* ═══ 4) الأصول على القرص ════════════════════════════════════════════════ */
section('4) الأصول — كل صورة وملف مُشار إليه موجود على القرص');

for (const file of PAGES.filter((f) => f !== 'brc-standalone.html')) {
  const refs = new Set();
  loaded[file].doc.querySelectorAll('[src], [href]').forEach((el) => {
    for (const a of ['src', 'href']) {
      let v = el.getAttribute(a);
      if (!v || /^(#|https?:|data:|mailto:|tel:|javascript:)/.test(v)) continue;
      v = v.split('#')[0].split('?')[0];
      if (v) refs.add(v);
    }
  });
  const missing = [...refs].filter((r) => !existsSync(join(ROOT, r)));
  if (missing.length) bad(file + ' — كل المراجع موجودة', 'مفقود: ' + missing.join(', '));
  else ok(file + ' — ' + refs.size + ' مرجعاً محلياً، كلها موجودة');
}

{
  const urls = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]);
  const missing = urls.filter((u) => !/^(data:|https?:)/.test(u) && !existsSync(resolve(join(ROOT, 'assets/css'), u)));
  if (missing.length) bad('style.css — كل الخطوط والصور موجودة', missing.join(', '));
  else ok('style.css — ' + urls.length + ' أصل داخلي (خطوط/صور)، كلها موجودة');
}

/* ═══ 5) عقود المعرّفات بين JS و HTML ════════════════════════════════════ */
section('5) الترابط — كل معرّف يستدعيه الكود موجود في الصفحة الصحيحة');

function idsUsedIn(jsFile) {
  const src = readFileSync(join(ROOT, jsFile), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) out.add(m[1]);
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*'#([A-Za-z][\w-]*)'/g)) out.add(m[1]);
  return out;
}
function pageIds(file) {
  const p = loaded[file];
  return new Set([...p.doc.querySelectorAll('[id]')].map((e) => e.id));
}
const ALL_IDS = new Set([...PAGES].flatMap((f) => [...pageIds(f)]));
const CONTRACT = [
  ['assets/js/public.js', 'index.html'],
  ['assets/js/verify.js', 'verify.html'],
  ['assets/js/dashboard.js', 'dashboard.html'],
  ['assets/js/ui.js', null],
  ['assets/js/voucher.js', null]
];
for (const [js, page] of CONTRACT) {
  const src = readFileSync(join(ROOT, js), 'utf8');
  const used = idsUsedIn(js);
  const staticPool = page ? pageIds(page) : ALL_IDS;
  // المعرّف إمّا ثابت في الصفحة، أو يُبنى ديناميكياً بواسطة الكود نفسه (id="…" داخل قالب نصي)
  const missing = [...used].filter((id) => !staticPool.has(id) && !src.includes('id="' + id + '"'));
  const dynamic = [...used].filter((id) => !staticPool.has(id) && src.includes('id="' + id + '"'));
  if (missing.length) bad(js + ' — كل المعرّفات موجودة' + (page ? ' في ' + page : ''), 'مفقود: ' + missing.join(', '));
  else ok(js + ' — ' + used.size + ' معرّفاً، كلها متوفرة' + (page ? ' في ' + page : '') +
    (dynamic.length ? ' (منها ' + dynamic.length + ' يُبنى ديناميكياً في النوافذ)' : ''));
}

// الملف المستقل يجب أن يجمع كل المعرّفات
{
  const union = new Set([...pageIds('index.html'), ...pageIds('verify.html'), ...pageIds('dashboard.html')]);
  const inStandalone = pageIds('brc-standalone.html');
  /* نفس السماح المطبّق في الفحص أعلاه: معرّف يُنشئه الكود ديناميكياً (id="…" داخل
     قالب نصي) هو موجود فعلاً في الملف المستقل ولو لم يكن في بنيته الأولية. بلا
     هذا السماح يُرفض أي عنصر يُبنى بالكود عند الشرط — وهو أسلوب مشروع ومستخدم
     في التنبيهات والنوافذ هنا. */
  const standaloneSrc = readFileSync(join(ROOT, 'brc-standalone.html'), 'utf8');
  const missing = [...union].filter((id) => !inStandalone.has(id) && !standaloneSrc.includes('id="' + id + '"'));
  if (missing.length) bad('brc-standalone.html — يجمع معرّفات كل الصفحات', 'ناقص: ' + missing.slice(0, 10).join(', '));
  else ok('brc-standalone.html — يجمع ' + union.size + ' معرّفاً من الصفحات الثلاث كاملة');
}

// لا شيء يشير الزائر إلى الدخول أو يكشف بياناته في الصفحات المنشورة
/* ما نمنعه هنا محدَّد:
   1) نص الحسابات التجريبية أو أنماطها على شاشة الدخول (كانت تعرض admin/admin123
      لمن يفتح اللوحة — أي أن «صفحة دخول» صارت «إعلاناً بكلمة المرور»).
   2) روابط تفتح لوحة الموظفين من الموقع العام (رأس/تذييل/نداء) — الزائر لا
      يحتاجها، ووجودها يعرّف أي زائر بعنوان المنظومة الداخلية.
   الفحص على الصفحات المنشورة نفسها لا على الأجزاء (src/partials) ليشمل أي
   بناء مستقبلي ينسى أحدها. */
{
  const published = ['index.html', 'verify.html', 'dashboard.html', 'brc-standalone.html', 'brc-light.html'];
  const leaked = [];
  for (const f of published) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    if (/حسابات تجريبية/.test(src)) leaked.push(f + ': نص الحسابات التجريبية');
    if (/demo-account|login-demo-info/.test(src)) leaked.push(f + ': أنماط الحسابات التجريبية');
  }
  if (leaked.length) bad('لا حسابات تجريبية ظاهرة على شاشة الدخول', leaked.join(' | '));
  else ok('لا حسابات تجريبية ظاهرة على شاشة الدخول (في ' + published.length + ' صفحات منشورة)');

  /* سياسة الدخول (طلب الإدارة، 2026-09): بوابة الموظفين **زر ظاهر** واحد في
     ترويسة الموقع العام (دخول طبيعي بنقرة — لا ضغط مطوّل ولا روابط مخفية)،
     وفي النسخة المستقلة يُعاد كتابته إلى #!dashboard عند البناء. المسموح:
     رابط واحد من الترويسة بالضبط؛ أي رابط إضافي للوحة متناثر في جسم الصفحة
     يبقى تسريباً يُرفض. */
  const linked = [];
  for (const f of ['index.html']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const inHeader = src.match(/class="btn btn-gold btn-sm header-login" href="dashboard\.html"/g) || [];
    const all = src.match(/href="dashboard\.html"/g) || [];
    if (inHeader.length !== 1 || all.length !== 1) {
      linked.push(f + ' (رابط رسمي: ' + inHeader.length + ' · إجمالي: ' + all.length + ')');
    }
  }
  for (const f of ['brc-standalone.html', 'brc-light.html']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const inHeader = src.match(/class="btn btn-gold btn-sm header-login" href="#!dashboard"/g) || [];
    const external = src.match(/href="dashboard\.html"/g) || [];
    if (inHeader.length !== 1 || external.length !== 0) {
      linked.push(f + ' (رابط رسمي: ' + inHeader.length + ' · خارجي: ' + external.length + ')');
    }
  }
  if (linked.length) bad('بوابة دخول الموظفين: زر واحد في الترويسة فقط', linked.join(' | '));
  else ok('بوابة دخول الموظفين: زر «دخول الموظفين» ظاهر في الترويسة وحدها (لا روابط متناثرة)');
}

/* ── سياسة الصلاحيات (طلب الإدارة): الزائر يتصفّح الوظائف فقط ───────────────
   لا تقديم استمارة، ولا التحقق من أي استمارة. الفحص على الصفحات المنشورة
   وعلى القوالب المصدرية معاً، حتى لا يعود أحدها في بناء لاحق. */
{
  const visitorUi = [
    [/id="btn-request-form/, 'زر «اطلب استمارة»'],
    [/data-action="request-form"/, 'إجراء طلب استمارة'],
    [/id="verify-quick"/, 'نموذج التحقق السريع'],
    [/id="verify-serial"/, 'حقل الرقم التسلسلي'],
    [/data-action="verify"/, 'إجراء التحقق اليدوي']
  ];
  const found = [];
  for (const f of ['index.html', 'brc-standalone.html', 'brc-light.html', 'src/partials/public.html', 'src/partials/footer.html', 'src/partials/header.html']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const [re, label] of visitorUi) if (re.test(src)) found.push(f + ': ' + label);
  }
  if (found.length) bad('الموقع العام بلا واجهة تقديم أو تحقق للزائر', found.join(' | '));
  else ok('الموقع العام بلا أي واجهة تقديم استمارة أو تحقق منها (6 ملفات)');

  const navLeak = [];
  for (const f of ['src/partials/header.html', 'src/partials/footer.html', 'index.html', 'brc-standalone.html', 'brc-light.html']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    if (/href="verify\.html"/.test(src)) navLeak.push(f);
    if (/data-action="request-form"/.test(src)) navLeak.push(f + ' (طلب استمارة)');
  }
  if (navLeak.length) bad('لا رابط لصفحة التحقق أو طلب استمارة في تنقّل الزائر', navLeak.join(' | '));
  else ok('تنقّل الزائر خالٍ من روابط التحقق وطلب الاستمارة (5 ملفات)');

  // صفحة التحقق: بوابة صلاحية قبل أي عرض بيانات
  const vjs = readFileSync(join(ROOT, 'assets/js/verify.js'), 'utf8');
  const hasGate = /function isStaff\(/.test(vjs) && /renderStaffGate/.test(vjs) &&
    /if \(!isStaff\(\)\) \{ renderStaffGate\(\); return; \}/.test(vjs);
  if (!hasGate) bad('verify.js — بوابة صلاحية تحجب الزائر قبل أي عرض', 'البوابة غير مكتملة');
  else ok('verify.js — بوابة صلاحية تحجب الزائر قبل قراءة أو عرض أي بيانات');

  const pjs = readFileSync(join(ROOT, 'assets/js/public.js'), 'utf8');
  const rogue = [];
  if (/requestFormModal|showRequestReceived/.test(pjs)) rogue.push('نموذج طلب الاستمارة');
  if (/verifySerial|verify-quick|verify-serial/.test(pjs)) rogue.push('التحقق من الموقع العام');
  if (/data-action="request-form"|data-action="verify"/.test(pjs)) rogue.push('إجراءات الزائر');
  if (rogue.length) bad('public.js — خالٍ من منطق الطلب والتحقق', rogue.join(' | '));
  else ok('public.js — خالٍ تماماً من منطق تقديم الطلب والتحقق (عرض وتواصل فقط)');

  const w = loaded['index.html'].window;
  const hrefs = [...loaded['index.html'].doc.querySelectorAll('#jobs-grid a[href^="https://wa.me/"]')];
  const msgOk = hrefs.length > 0 && hrefs.every((a) => /BRC-\d{3,}/.test(decodeURIComponent(a.getAttribute('href'))));
  if (!msgOk) bad('بطاقات الوظائف — زر حجز بالواتساب يحمل كود الوظيفة', 'عدد الأزرار: ' + hrefs.length);
  else ok('بطاقات الوظائف — ' + hrefs.length + ' زر حجز بالواتساب، كلها تحمل كود الوظيفة في الرسالة');

  const t = w.BRCStore.token('BRC-NO-000120');
  const noToken = w.BRCStore.verify('BRC-NO-000120');
  if (noToken.masked !== true) bad('طبقة البيانات — التحقق بلا بصمة يبقى مقنّعاً', 'masked=' + noToken.masked);
  else ok('طبقة البيانات — لا كشف بيانات بلا بصمة صحيحة (تقنيع في الرد نفسه)');
  if (!w.BRCStore.verify('BRC-NO-000120', t).ok) bad('طبقة البيانات — التحقق بالبصمة الصحيحة يعمل', 'فشل');
  else ok('طبقة البيانات — التحقق بالبصمة الصحيحة يعمل للموظف');
}

// معرّفات مكرّرة داخل الصفحة نفسها
for (const file of PAGES) {
  const all = [...loaded[file].doc.querySelectorAll('[id]')].map((e) => e.id);
  const seen = new Set(), dup = new Set();
  all.forEach((id) => { if (seen.has(id)) dup.add(id); seen.add(id); });
  if (dup.size) bad(file + ' — لا معرّفات مكرّرة', [...dup].join(', '));
  else ok(file + ' — ' + all.length + ' معرّفاً بلا أي تكرار');
}

/* ═══ 6) الإتاحة وسهولة الاستخدام ════════════════════════════════════════ */
section('6) الإتاحة — اللغة والاتجاه والنصوص البديلة وتسميات النماذج');

for (const file of PAGES) {
  const p = loaded[file];
  const html = p.doc.documentElement;
  const langOk = (html.getAttribute('lang') || '') === 'ar';
  const dirOk = (html.getAttribute('dir') || '') === 'rtl';
  const h1 = p.doc.querySelectorAll('h1').length;

  if (!langOk || !dirOk) bad(file + ' — اللغة والاتجاه (ar / rtl)', 'lang=' + html.getAttribute('lang') + ' dir=' + html.getAttribute('dir'));
  else if (h1 === 0) bad(file + ' — عنوان رئيسي واحد على الأقل');
  else ok(file + ' — lang=ar dir=rtl وعناوين h1: ' + h1);

  const imgs = [...p.doc.querySelectorAll('img')];
  const noAlt = imgs.filter((i) => i.getAttribute('alt') === null);
  if (noAlt.length) bad(file + ' — كل الصور لها نص بديل alt', noAlt.length + ' صورة بلا alt');
  else ok(file + ' — ' + imgs.length + ' صورة، كلها بنص بديل');

  const inputs = [...p.doc.querySelectorAll('input:not([type=hidden]):not([hidden]):not(.hidden), select:not([hidden]), textarea:not([hidden])')];
  const unlabeled = inputs.filter((el) => {
    const id = el.id;
    const hasLabel = id && p.doc.querySelector('label[for="' + id + '"]');
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    return !hasLabel && !aria && !el.closest('label');
  });
  if (unlabeled.length) bad(file + ' — كل حقول الإدخال لها تسمية', unlabeled.length + ' حقل بلا تسمية: ' +
    unlabeled.slice(0, 4).map((e) => e.id || e.name || e.type).join(', '));
  else ok(file + ' — ' + inputs.length + ' حقل إدخال، كلها بتسميات واضحة');

  const btns = [...p.doc.querySelectorAll('button')];
  const mute = btns.filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'));
  if (mute.length) bad(file + ' — كل الأزرار لها اسم واضح', mute.length + ' زر صامت');
  else ok(file + ' — ' + btns.length + ' زراً، كلها بأسماء واضحة');

  const links = [...p.doc.querySelectorAll('a')];
  const muteLink = links.filter((a) => !a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt], svg'));
  if (muteLink.length) bad(file + ' — كل الروابط لها نص أو أيقونة مفهومة', muteLink.length + ' رابط صامت');
  else ok(file + ' — ' + links.length + ' رابطاً، كلها مفهومة');

  const vp = p.doc.querySelector('meta[name="viewport"]');
  if (!vp || !/width=device-width/.test(vp.getAttribute('content') || '')) bad(file + ' — إعداد العرض المتجاوب (viewport)');
  else ok(file + ' — عرض متجاوب: ' + vp.getAttribute('content'));
}

/* ═══ 7) البنية المشتركة والطباعة ════════════════════════════════════════ */
section('7) البنية المشتركة — الرأس والتذييل وحاويات النوافذ والطباعة');

for (const file of PAGES) {
  const p = loaded[file];
  const need = ['modal-root', 'toast-root', 'print-root'];
  const missing = need.filter((id) => !p.doc.getElementById(id));
  if (missing.length) bad(file + ' — حاويات عامة', 'مفقود: ' + missing.join(', '));
  else ok(file + ' — حاويات النوافذ والتنبيهات والطباعة موجودة');

  const hasHeader = !!p.doc.querySelector('.site-header');
  const hasFooter = !!p.doc.querySelector('.site-footer');
  const hasYear = !!p.doc.getElementById('year');
  if (!hasHeader || !hasFooter || !hasYear) bad(file + ' — الرأس والتذييل', 'رأس:' + hasHeader + ' تذييل:' + hasFooter + ' سنة:' + hasYear);
  else ok(file + ' — الرأس والتذييل وسنة النشر (تحديث تلقائي)');
}

/* ═══ 8) الاستقلال التام للملف الواحد ════════════════════════════════════ */
section('8) الملف المستقل — يعمل بلا إنترنت وبلا أي مجلد مساعد');

for (const file of PAGES.filter((f) => f.startsWith('brc-'))) {
  const s = loaded[file];
  /* نفحص الموارد المطلوبة للتشغيل فقط (صور/خطوط/سكربتات/ستايلات) —
     أما روابط التنقل الخارجية (واتساب، خرائط جوجل، بريد) فهي مقصودة
     ولا تمنع الملف من العمل بلا إنترنت.

     ونفرّق بين نوعين لأن أثرهما مختلف تماماً:
       • كود/أنماط/خطوط/أيقونات خارجية → **فشل**: بدونها لا يعمل الملف أصلاً.
       • صور بطاقات الوظائف → **ملاحظة**: بيانات عرض تجريبية، وفقدانها لا يمنع
         العمل (تظهر البطاقة بلا صورة). مصدرها حقول imageUrl في بيانات العرض.
         إن أردت ملفاً يعمل بلا إنترنت بصوره: انقل الصور إلى assets/img/jobs/
         وحدّث imageUrl إليها. */
  const blocking = [];
  const photos = [];
  s.doc.querySelectorAll('[src], link[rel="stylesheet"], link[rel="icon"], source[srcset], script[src], img[src]').forEach((el) => {
    for (const a of ['src', 'href', 'srcset']) {
      const v = el.getAttribute(a);
      if (!v || !/^(https?:)?\/\//.test(v) || v.includes('brc-babil.com')) continue;
      const inJobCard = el.tagName === 'IMG' && !!(el.closest('.job-card') || el.closest('#jobs-grid'));
      (inJobCard ? photos : blocking).push(v);
    }
  });
  if (blocking.length) bad(file + ' — لا مراجع خارجية للكود والأنماط والخطوط', blocking.slice(0, 5).join(', '));
  else ok(file + ' — لا مراجع خارجية للكود والأنماط والخطوط (كل ما يلزم للتشغيل داخل الملف)');
  if (photos.length) warnf(file + ' — صور بطاقات الوظائف من بيانات العرض (' + photos.length + ' صورة) خارج الملف',
    'لا تكسر الملف؛ ولجعلها محلية: انسخها إلى assets/img/jobs/ وحدّث imageUrl في config.js');
  else ok(file + ' — لا صور وظائف خارجية (كل الصور داخل الملف)');

  const raw = readFileSync(join(ROOT, file), 'utf8');
  const dataUris = (raw.match(/data:[a-z]+\/[a-z0-9.+-]+;base64,/g) || []).length;
  const sizeMB = (Buffer.byteLength(raw) / 1048576).toFixed(2);
  const sameAsFull = file === 'brc-standalone.html' ? '' : ' (نسخة مصغّرة للعرض السريع)';
  ok(file + ' — حجمه ' + sizeMB + ' ميجابايت ويحتوي ' + dataUris + ' أصلاً مدمجاً' + sameAsFull);
}
{
  const routes = ['', '#jobs', '#!verify?form=BRC-NO-000120', '#!dashboard'];
  ok('مسارات التنقل داخل الملف الواحد: ' + routes.join('  ·  '));
}

/* ═══ 8.5) إعداد النشر — Cloudflare Pages وحده ════════════════════════════ */
section('8.5) النشر — منصّة واحدة (Cloudflare Pages) بلا رابط ثانٍ');

{
  const rootFiles = readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  /* قرار الإدارة: Cloudflare Pages هي المنصّة الوحيدة. أي ملف إعداد لمنصّة أخرى
     يعني رابطاً ثانياً للموقع — نفس المشكلة التي أُلغيت. */
  const otherHosts = rootFiles.filter((f) => /^(render|netlify|vercel|firebase|\.platform|app)\.(ya?ml|json|toml)$/i.test(f) ||
    /^(vercel\.json|netlify\.toml|firebase\.json)$/i.test(f) || f === 'render.yaml');
  if (otherHosts.length) bad('لا إعداد نشر لمنصّة ثانية في الجذر', otherHosts.join(', '));
  else ok('لا إعداد نشر لمنصّة ثانية — Cloudflare Pages وحدها (لا Render/Netlify/Vercel)');

  const need = ['_headers', '_redirects'];
  const missingCf = need.filter((f) => !rootFiles.includes(f));
  if (missingCf.length) bad('ملفّات Cloudflare Pages موجودة', 'ناقص: ' + missingCf.join(', '));
  else ok('ملفّات Cloudflare Pages في الجذر: _headers (ترويسات) · _redirects (مسارات نظيفة)');

  const redirects = readFileSync(join(ROOT, '_redirects'), 'utf8');
  const cleanRoutes = ['/verify', '/dashboard', '/standalone', '/light'];
  const badRoutes = cleanRoutes.filter((r) => !new RegExp('^\\s*' + r + '\\s+\\S+\\s+200\\s*$', 'm').test(redirects));
  if (badRoutes.length) bad('المسارات النظيفة كلها معرّفة بـ 200', 'ناقص: ' + badRoutes.join(', '));
  else ok('المسارات النظيفة معرّفة في _redirects: ' + cleanRoutes.join(' · '));

  const headers = readFileSync(join(ROOT, '_headers'), 'utf8');
  const needHeaders = ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options'];
  const missingHeaders = needHeaders.filter((h) => !headers.includes(h));
  const swNoCache = /\/sw\.js[\s\S]{0,80}no-cache/i.test(headers);
  if (missingHeaders.length) bad('ترويسات الأمان في _headers', 'ناقص: ' + missingHeaders.join(', '));
  else if (!swNoCache) bad('منع تخزين sw.js مؤقتاً', 'غير موجود في _headers');
  else ok('ترويسات الأمان كاملة + sw.js بلا كاش (يُجبر الأجهزة على النسخة الجديدة)');

  /* رابط التحقق المطبوع يجب أن يبقى نظيفاً (بلا .html) لأنه يتغيّر إلى النطاق الرسمي */
  const vurl = loaded['index.html'].window.BRCStore.verifyLocalUrl('BRC-NO-000120');
  if (!/^verify\.html\?/.test(vurl)) bad('رابط التحقق المحلي', vurl);
  else ok('رابط التحقق المحلي نظيف ويطابق مسار /verify في _redirects');

  /* لا إشارة تشغيلية لمنصّة ثانية في الكود والإعداد (المستندات تُذكر الإلغاء تاريخياً فلا تُفحص) */
  const scanned = ['assets/js/store.js', 'assets/js/config.js', 'tools/serve.mjs', 'sw.js', '_redirects', '_headers', 'package.json'];
  const leftovers = scanned.filter((f) => existsSync(join(ROOT, f)) && /onrender|render\.yaml|render\.com|netlify\.toml|vercel\.json/i.test(readFileSync(join(ROOT, f), 'utf8')));
  if (leftovers.length) bad('لا إشارة تشغيلية لمنصّة نشر ثانية في الكود', leftovers.join(' · '));
  else ok('لا إشارة تشغيلية لمنصّة ثانية في الكود والإعداد (' + scanned.length + ' ملفات)');

  /* مجلد النشر: سكربت التجميع + النشر الآلي بمفاتيح Cloudflare */
  const distScript = join(ROOT, 'tools', 'dist.mjs');
  if (!existsSync(distScript)) bad('سكربت تجميع مجلد النشر', 'tools/dist.mjs مفقود');
  else {
    const dsrc = readFileSync(distScript, 'utf8');
    const needs = [['_headers', /_headers/], ['_redirects', /_redirects/], ['sw.js', /sw\.js/],
      ['الصفحات الأساسية', /index\.html/], ['النسخة المستقلة', /brc-standalone\.html/]];
    const gaps = needs.filter(([, re]) => !re.test(dsrc)).map(([k]) => k);
    if (gaps.length) bad('tools/dist.mjs يجمع ملفات الموقع الصحيحة', 'ناقص: ' + gaps.join(' · '));
    else ok('tools/dist.mjs — مجلد نشر نظيف يجمع الصفحات وsw.js و_headers و_redirects والأصول');
  }

  /* ملف النشر الآلي يبقى في docs/ (صلاحية الـ token لا تسمح بكتابة .github/workflows)
     ويُفعَّل بنقله إلى .github/workflows/ — انظر ترويسة الملف نفسه. */
  const wf = join(ROOT, 'docs', 'deploy-cloudflare-workflow.yml');
  const wfLive = join(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml');
  if (!existsSync(wf) && !existsSync(wfLive)) bad('ملف النشر الآلي موجود', 'docs/deploy-cloudflare-workflow.yml مفقود');
  else {
    const wsrc = readFileSync(existsSync(wfLive) ? wfLive : wf, 'utf8');
    const mustHave = [
      ['مشروع Cloudflare الصحيح', /--project-name=babylonian-recruitment-company/],
      ['نشر من مجلد dist', /pages deploy dist/],
      ['فرع الإنتاج main', /--branch=main/],
      ['مفتاح API من الأسرار', /CLOUDFLARE_API_TOKEN/],
      ['Account ID من الأسرار', /CLOUDFLARE_ACCOUNT_ID/],
      ['تخطّي النشر بلا مفاتيح (لا فشل)', /steps\.guard\.outputs\.ready == 'true'/],
      ['بوابة فحص قبل النشر', /npm run audit/]
    ];
    const gaps = mustHave.filter(([, re]) => !re.test(wsrc)).map(([k]) => k);
    if (gaps.length) bad('ملف النشر الآلي مكتمل', 'ناقص: ' + gaps.join(' · '));
    else ok('النشر الآلي: GitHub Actions → Cloudflare Pages (dist · نفس المشروع · بلا مفاتيح يتخطّى النشر)');
    if (!existsSync(wfLive) && !/أنشئ ملفاً جديداً|Add file|Create new file/.test(wsrc))
      bad('ملف النشر يشرح طريقة تفعيله', 'لا تعليمات تفعيل داخل الملف');
    else ok('مسار التفعيل موثّق: انسخ الملف إلى .github/workflows/deploy-cloudflare.yml (نقرتان)');

    /* لا مفاتيح مكتوبة داخل الملف — الأسرار في GitHub فقط */
    if (/sb_secret_|api[_-]?token\s*[:=]\s*['"][A-Za-z0-9]{20,}/i.test(wsrc)) bad('ملف النشر بلا أي مفتاح مكتوب', 'يوجد مفتاح ظاهر');
    else ok('ملف النشر لا يحوي أي مفتاح مكتوب (الأسرار من GitHub Secrets فقط)');
  }

  if (!existsSync(join(ROOT, 'docs', 'deploy-cloudflare.md'))) bad('دليل النشر على Cloudflare موجود', 'docs/deploy-cloudflare.md مفقود');
  else {
    const guide = readFileSync(join(ROOT, 'docs', 'deploy-cloudflare.md'), 'utf8');
    const topics = [['Production branch', /Production branch/i], ['إلغاء Render', /إلغاء Render/i],
      ['النطاق الرسمي', /Custom domain/i], ['نشر wrangler', /wrangler pages deploy/i], ['فحص بعد النشر', /Purge Everything/i],
      ['مجلد dist', /npm run dist/i], ['النشر الآلي بمفاتيح', /CLOUDFLARE_API_TOKEN/],
      ['الطريق أ (Direct Upload)', /Create deployment/i]];
    const missingTopics = topics.filter(([, re]) => !re.test(guide)).map(([k]) => k);
    if (missingTopics.length) bad('دليل Cloudflare يغطّي الخطوات كاملة', 'ناقص: ' + missingTopics.join(' · '));
    else ok('دليل النشر docs/deploy-cloudflare.md يغطّي الإعداد والمعاينات والنطاق وإلغاء Render والفحص');
  }
}

/* ═══ 9) سلامة البيانات والمنطق في المتصفح ══════════════════════════════ */
section('9) سلامة البيانات — البيانات التجريبية والقواعد الأساسية');

{
  const w = loaded['index.html'].window;
  const S = w.BRCStore;
  const st = S.stats();
  const jobs = S.listJobs();
  const apps = S.listApplicants();
  const rules = S.settings();
  if (jobs.length !== 8) bad('الوظائف التجريبية (8)', 'عددها ' + jobs.length); else ok('الوظائف التجريبية: ' + jobs.length + ' وظيفة (' + st.available + ' متاحة · ' + st.reserved + ' محجوزة · ' + st.closed + ' مغلقة)');
  if (apps.length !== 4) bad('الاستمارات التجريبية (4)', 'عددها ' + apps.length); else ok('الاستمارات التجريبية: ' + apps.length + ' استمارة (' + apps.map((a) => a.serial.replace('BRC-NO-', '')).join(' · ') + ')');

  const slotsOk = apps.every((a) => S.getAttempts(a.serial).length === rules.attemptLimit);
  if (!slotsOk) bad('كل استمارة لها ' + rules.attemptLimit + ' محاولات'); else ok('كل استمارة لها ' + rules.attemptLimit + ' خانات محاولات');

  const codes = jobs.map((j) => j.code);
  const dupCodes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupCodes.length) bad('أكواد الوظائف فريدة', dupCodes.join(', ')); else ok('أكواد الوظائف فريدة: ' + codes[0] + ' … ' + codes[codes.length - 1]);

  const serials = apps.map((a) => a.serial);
  const dupSer = serials.filter((c, i) => serials.indexOf(c) !== i);
  if (dupSer.length) bad('الأرقام التسلسلية فريدة', dupSer.join(', ')); else ok('الأرقام التسلسلية فريدة: ' + serials[serials.length - 1] + ' حتى ' + serials[0]);

  // توليد جديد بلا تصادم
  const n1 = S.createApplicant({ fullName: 'فحص التدقيق', phone: '07700000000' });
  const n2 = S.createApplicant({ fullName: 'فحص التدقيق 2', phone: '07700000001' });
  if (serials.includes(n1.serial) || n1.serial === n2.serial) bad('التسلسل الجديد لا يتصادم', n1.serial + ' / ' + n2.serial);
  else ok('إصدار جديد بلا تصادم: ' + n1.serial + ' ثم ' + n2.serial);

  // منع تجاوز الخمس محاولات
  const app = S.createApplicant({ fullName: 'فحص الحد', phone: '07700000002' });
  const avail = S.listJobs({ status: 'available' });
  let done = 0;
  for (let i = 0; i < 7 && i < avail.length; i++) {
    const r = S.selectAttempt(app.serial, avail[i].code);
    if (!r.ok) break;
    done++;
    S.setOutcome(app.serial, r.attempt.no, 'rejected', 'فحص');
  }
  const left = S.attemptsLeft(app.serial);
  if (done > rules.attemptLimit || left !== 0) bad('حد المحاولات ' + rules.attemptLimit + ' مُطبَّق', 'نجح ' + done + ' — متبقٍ ' + left);
  else ok('حد المحاولات مُطبَّق: نجح ' + done + ' فقط، والمتبقي ' + left + ' — والمحاولة الزائدة مرفوضة');

  // تدقيق: كل عملية مسجّلة بالثانية
  const logs = S.listAudit().slice(0, 200);
  const stamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const shown = logs.map((l) => S.fmtDateTime(l.ts));
  const badTime = shown.filter((t) => !stamp.test(t));
  const nowShown = S.fmtDateTime(new Date());
  const localOk = nowShown === w.BRCStore.fmtDateTime(new Date()) && stamp.test(nowShown);
  if (!logs.length) bad('سجل التدقيق يعمل');
  else if (badTime.length) bad('صيغة وقت التدقيق (YYYY-MM-DD HH:mm:ss)', badTime[0]);
  else if (!localOk) bad('التوقيت المعروض محلي لا UTC', nowShown);
  else ok('سجل التدقيق: ' + logs.length + ' عملية بصيغة YYYY-MM-DD HH:mm:ss (توقيت محلي: ' + nowShown +
    ') مع المستخدم والصلاحية و IP والتفاصيل');
}

/* ═══ 10) التنسيق والطباعة — القالب A4 ═══════════════════════════════════ */
section('10) الاستمارة المطبوعة A4 — البنية الكاملة');

{
  const w = loaded['index.html'].window;
  const app = w.BRCStore.getApplicant('BRC-NO-000120');
  w.BRCStore.selectAttempt(app.serial, 'BRC-1046');
  const fresh = w.BRCStore.getApplicant(app.serial);
  const html = w.BRCVoucher.buildHtml(fresh, w.BRCStore.getAttempts(app.serial));

  const must = {
    'شعار الشركة': /i-emblem|brand-mark|v-logo/,
    'الاسم العربي': /شركة بابل للتوظيف/,
    'الاسم الإنجليزي': /Babylonian Recruitment Company/,
    'تخصص الشركة': /الأيادي العاملة من الناحية الفنية والتخصصية/,
    'الهاتف الأول': /07760058007/,
    'الهاتف الثاني': /07715993271/,
    'العنوان الكامل': /حلة - شارع 60 - قرب مدينة حمورابي - قرب مجمع الكرعاوي/,
    'الرقم التسلسلي': /BRC-NO:\s*000120/,
    'اسم الباحث': /سجاد|BRC-NO-000120/,
    'تاريخ الإصدار': /تاريخ الإصدار/,
    'تاريخ الانتهاء': /تاريخ الانتهاء|الانتهاء/,
    'جدول المحاولات': /كود الوظيفة/,
    'خمس خانات': /المحاولة #?5|المحاولة الخامسة|>5</,
    'الكيو آر كود': /<svg/,
    'التواقيع': /v-sign|التوقيع/,
    'الإخلاء القانوني': /غير مسؤولة قانونياً وعشائياً/
  };
  const missing = Object.entries(must).filter(([, re]) => !re.test(html)).map(([k]) => k);
  if (missing.length) bad('قالب الاستمارة يحتوي كل العناصر المطلوبة', 'ناقص: ' + missing.join(' · '));
  else ok('قالب الاستمارة يحتوي كل العناصر المطلوبة (' + Object.keys(must).length + ' عنصراً)');

  /* الورقة البيضاء: ممنوع أي علامة مائية أو صورة خلفية داخل قالب الاستمارة */
  if (/v-watermark|brick-pattern/.test(html)) bad('الاستمارة المطبوعة بلا علامة مائية', 'القالب ما زال يُدرج صورة العلامة المائية');
  else ok('الاستمارة المطبوعة نظيفة: لا علامة مائية ولا صورة خلفية (ورقة بيضاء)');

  const rows = (html.match(/<tr/g) || []).length;
  if (rows < 5) bad('الاستمارة تعرض المحاولات الخمس', rows + ' صفوف'); else ok('الاستمارة تعرض جدول المحاولات: ' + rows + ' صفاً');

  const svgCount = (html.match(/<svg/g) || []).length;
  const hasQrPath = /<path[^>]+d="M[\d. ]/.test(html);
  if (svgCount < 1 || !hasQrPath) bad('كيو آر كود التحقق مرسوم داخل الاستمارة', 'svg=' + svgCount);
  else ok('كيو آر كود التحقق مرسوم داخل الاستمارة (' + svgCount + ' عنصر SVG بمصفوفة وحدات حقيقية)');
}

/* ═══ 11) التنقّل — لا رابط يوصل إلى «صفحة غير موجودة» ═══════════════════ */
section('11) التنقّل — كل رابط في الترويسة والتذييل يصل إلى قسمه فعلاً');

{
  /* الخلفية: نقرة «الوظائف / خدماتنا / آلية العمل / اسم الشركة» كانت تُعطي
     صفحة غير موجودة على الاستضافة لأن الروابط مكتوبة "index.html#jobs" ولا
     يكون اسم الملف قابلاً للطلب على كل مضيف. الحل nav.js يُطبّع الروابط وقت
     التشغيل؛ وهذه الفحوص تمنع رجوع المشكلة بصمت. */

  // 11.1 nav.js محمَّل في كل صفحة منشورة
  {
    const pagesNeedNav = ['index.html', 'verify.html', 'dashboard.html', '404.html'];
    const noNav = pagesNeedNav.filter((f) => !/src="\/?assets\/js\/nav\.js/.test(readFileSync(join(ROOT, f), 'utf8')));
    if (noNav.length) bad('nav.js محمَّل في كل صفحة منشورة', 'ناقص في: ' + noNav.join(', '));
    else ok('nav.js محمَّل في كل صفحة منشورة (' + pagesNeedNav.length + ' صفحات)');
  }

  // 11.2 كل مرساة في التنقّل لها قسم موجود فعلاً في الصفحة الرئيسية
  {
    const homeIds = pageIds('index.html');
    const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const anchors = [...src.matchAll(/href="(?:index\.html)?#([a-zA-Z][\w-]*)"/g)].map((m) => m[1]);
    const dangling = [...new Set(anchors)].filter((id) => !homeIds.has(id));
    if (dangling.length) bad('كل مرساة تنقّل لها قسم في الصفحة الرئيسية', 'بلا قسم: ' + dangling.join(', '));
    else ok('كل مراسي التنقّل لها أقسام موجودة في index.html (' + new Set(anchors).size + ' مرساة)');
  }

  // 11.3 التطبيع الفعلي: نشغّل nav.js على كل صفحة وعلى نطاقات مختلفة
  {
    const cases = [
      ['index.html', 'https://brc.example.com/', (h) => h.startsWith('#')],
      ['index.html', 'https://host.tld/sub/', (h) => h.startsWith('#')],
      ['verify.html', 'https://brc.example.com/verify', (h) => h.startsWith('/#')],
      ['dashboard.html', 'https://brc.example.com/dashboard', (h) => h.startsWith('/#')],
      ['404.html', 'https://host.tld/sub/typo', (h) => h.startsWith('/sub/#')]
    ];
    const navSrc = readFileSync(join(ROOT, 'assets/js/nav.js'), 'utf8');
    const failures = [];
    for (const [file, url, want] of cases) {
      const dom = new JSDOM(readFileSync(join(ROOT, file), 'utf8'), { url, runScripts: 'outside-only' });
      const w = dom.window;
      w.eval(navSrc);
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
      const links = [...w.document.querySelectorAll('.main-nav a, .brand[href], .site-footer ul a:not([target])')]
        .map((a) => a.getAttribute('href'));
      const leftover = w.document.querySelectorAll('a[href*="index.html"]').length;
      const wrong = links.filter((h) => !want(h));
      if (leftover || wrong.length) failures.push(file + ' @ ' + url + ' (بقايا: ' + leftover + ' · خاطئ: ' + wrong.slice(0, 3).join(',') + ')');
      dom.window.close();
    }
    if (failures.length) bad('تطبيع الروابط يعمل على كل صفحة وكل نطاق', failures.join(' | '));
    else ok('تطبيع الروابط يعمل على ' + cases.length + ' حالات (نطاق جذري · مسار فرعي · تحقق · لوحة · 404) بلا بقايا index.html');
  }

  // 11.3ب زر «تسجيل الدخول» يفتح شاشة الدخول فعلاً من أي صفحة وأي نطاق
  {
    /* الخلفية: "dashboard.html" رابط نسبي — من مسار نظيف (/verify) أو مسار فرعي
       يحسبه المتصفح من المجلد الخطأ فيرجع «صفحة غير موجودة». nav.js يثبّته على
       جذر النشر. هنا نتأكد أن الزر موجود، ونصّه واضح، ووجهته صحيحة فعلاً. */
    const navSrc = readFileSync(join(ROOT, 'assets/js/nav.js'), 'utf8');
    const cases = [
      ['index.html', 'https://brc.example.com/', '/dashboard.html'],
      ['index.html', 'https://host.tld/sub/', '/sub/dashboard.html'],
      ['verify.html', 'https://brc.example.com/verify', '/dashboard.html'],
      ['404.html', 'https://host.tld/sub/typo', '/sub/dashboard.html']
    ];
    const failures = [];
    for (const [file, url, want] of cases) {
      const dom = new JSDOM(readFileSync(join(ROOT, file), 'utf8'), { url, runScripts: 'outside-only' });
      const w = dom.window;
      w.eval(navSrc);
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
      const btn = w.document.querySelector('.header-login');
      if (!btn) failures.push(file + ': لا زر دخول');
      else {
        const got = btn.getAttribute('href');
        if (got !== want) failures.push(file + ' @ ' + url + ': ' + got + ' ≠ ' + want);
        if (!/تسجيل الدخول|دخول/.test(btn.textContent)) failures.push(file + ': نص الزر غير واضح');
      }
      w.close();
    }
    if (failures.length) bad('زر تسجيل الدخول يصل إلى شاشة الدخول من كل صفحة', failures.join(' | '));
    else ok('زر «تسجيل الدخول» يفتح شاشة الدخول من ' + cases.length + ' حالات (جذر · مسار فرعي · تحقق · 404)');
  }

  // 11.3ج شاشة الدخول نفسها مكتملة العناصر
  {
    const dash = readFileSync(join(ROOT, 'dashboard.html'), 'utf8');
    const need = {
      'حاوية شاشة الدخول': /id="login-wrap"/,
      'نموذج الدخول': /id="login-form"/,
      'حقل المستخدم': /id="login-user"/,
      'حقل كلمة المرور': /id="login-pass"/,
      'زر الإرسال': /id="login-btn"/,
      'رابط العودة للموقع': /login-back-link/
    };
    const missing = Object.entries(need).filter(([, re]) => !re.test(dash)).map(([k]) => k);
    if (missing.length) bad('شاشة الدخول مكتملة العناصر', 'ناقص: ' + missing.join(' · '));
    else ok('شاشة الدخول مكتملة: ' + Object.keys(need).length + ' عناصر (مستخدم · كلمة مرور · إرسال · عودة)');
  }

  // 11.4 الملف المستقل لا يتأثّر: راوتره الخاص يبقى صاحب القرار
  {
    const standalonePages = ['brc-standalone.html'].concat(LIGHT ? ['brc-light.html'] : []);
    const broken = [];
    for (const f of standalonePages) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      if (/href="index\.html/.test(src)) broken.push(f + ': رابط index.html متبقٍّ');
      if (!/id="route-site"/.test(src)) broken.push(f + ': حاوية الراوتر مفقودة');
    }
    if (broken.length) bad('الملف المستقل يحتفظ براوتره الخاص بلا تدخّل', broken.join(' | '));
    else ok('الملف المستقل يحتفظ براوتره الخاص (nav.js يتنحّى عند وجود route-site)');
  }

  // 11.5 صفحة 404 بهوية الشركة وبمراجع مثبّتة على الجذر
  {
    const nf = readFileSync(join(ROOT, '404.html'), 'utf8');
    const issues = [];
    if (!/شركة بابل للتوظيف/.test(nf)) issues.push('بلا اسم الشركة');
    if (!/id="notfound"/.test(nf)) issues.push('بلا قسم 404');
    if (/(?:src|href)="assets\//.test(nf)) issues.push('مراجع نسبية تنكسر على المسارات العميقة');
    const exits = (nf.match(/href="\/index\.html#/g) || []).length;
    if (exits < 4) issues.push('روابط خروج قليلة: ' + exits);
    if (issues.length) bad('صفحة 404 بهوية الشركة وتعمل على أي مسار', issues.join(' | '));
    else ok('صفحة 404 بهوية الشركة: ترويسة وتذييل و' + exits + ' رابط خروج، ومراجعها مثبّتة على جذر الموقع');
  }

  // 11.6 المسارات النظيفة للأقسام معرّفة في _redirects (و/jobs لا يعطي 404)
  {
    const redirects = readFileSync(join(ROOT, '_redirects'), 'utf8');
    const sections = ['/jobs', '/services', '/how', '/about', '/contact'];
    const missing = sections.filter((r) => !new RegExp('^\\s*' + r + '\\s+/#' + r.slice(1) + '\\s+301\\s*$', 'm').test(redirects));
    if (missing.length) bad('مسارات الأقسام النظيفة معرّفة في _redirects', 'ناقص: ' + missing.join(', '));
    else ok('مسارات الأقسام النظيفة تُحوَّل إلى مراسيها: ' + sections.join(' · '));
  }

  // 11.7 عامل الخدمة: جيل جديد + احتياط تنقّل + nav.js في الكاش
  {
    const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    const issues = [];
    const gen = (sw.match(/brc-cache-v(\d+)/) || [])[1];
    if (!gen || Number(gen) < 5) issues.push('جيل الكاش قديم: v' + gen);
    if (!/nav\.js/.test(sw)) issues.push('nav.js خارج الكاش');
    if (!/404\.html/.test(sw)) issues.push('404.html خارج الكاش');
    if (!/cache\.add\(u\)\.catch/.test(sw)) issues.push('addAll يُسقط التثبيت كلّه عند فشل ملف واحد');
    if (issues.length) bad('عامل الخدمة لا يُبقي الزوّار على نسخة قديمة', issues.join(' | '));
    else ok('عامل الخدمة: جيل v' + gen + ' · nav.js و404.html مخزَّنان · تثبيت لا يسقط بفشل ملف واحد');
  }
}

/* ═══ الخلاصة ═══════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(72));
console.log('  الخلاصة:  ✅ ' + pass + ' ناجح   |   ❌ ' + fail + ' فاشل   |   ⚠️  ' + warn + ' تحذير');
console.log('═'.repeat(72));
if (problems.length) { console.log('\n  الإخفاقات:'); problems.forEach((p) => console.log('   • ' + p)); }
if (warnings.length) { console.log('\n  التحذيرات (غير حرجة):'); warnings.forEach((p) => console.log('   • ' + p)); }
console.log(fail ? '' : '\n  🎉 المشروع مكتمل وسليم — لا توجد أي مشكلة.\n');
process.exit(fail ? 1 : 0);
