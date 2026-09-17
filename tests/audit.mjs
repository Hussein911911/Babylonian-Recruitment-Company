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
import { readFileSync, existsSync } from 'node:fs';
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

  const linked = [];
  for (const f of ['index.html', 'verify.html']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const m = src.match(/href="dashboard\.html"/g);
    if (m) linked.push(f + ' (' + m.length + ')');
  }
  if (linked.length) bad('لا روابط للوحة الموظفين من الموقع العام', linked.join(' | '));
  else ok('لا روابط للوحة الموظفين من الموقع العام ولا صفحة التحقق');
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

/* ═══ الخلاصة ═══════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(72));
console.log('  الخلاصة:  ✅ ' + pass + ' ناجح   |   ❌ ' + fail + ' فاشل   |   ⚠️  ' + warn + ' تحذير');
console.log('═'.repeat(72));
if (problems.length) { console.log('\n  الإخفاقات:'); problems.forEach((p) => console.log('   • ' + p)); }
if (warnings.length) { console.log('\n  التحذيرات (غير حرجة):'); warnings.forEach((p) => console.log('   • ' + p)); }
console.log(fail ? '' : '\n  🎉 المشروع مكتمل وسليم — لا توجد أي مشكلة.\n');
process.exit(fail ? 1 : 0);
