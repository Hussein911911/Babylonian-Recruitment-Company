/* ===========================================================================
 *  حركة الظهور في الموقع العام — فحص ثابت (بلا متصفح)
 *  ---------------------------------------------------------------------------
 *  يحمي أربعة أشياء لا تُرى بالعين في وقت المراجعة:
 *   ١) أساس الظهور عند التمرير لا يعود لـ «اختفاء كامل» (كان يسبب وميضاً
 *      وفراغاً عند السحب السريع — قرار 2026-11-02).
 *   ٢) حركة دخول الواجهة الرئيسية موجودة ومتتابعة وليست لانهائية.
 *   ٣) تتالي بطاقات الوظائف يعمل في أول رسم فقط، ولا يتكرر عند تحديث البيانات.
 *   ٤) كل حركة جديدة تُلغى مع prefers-reduced-motion.
 * =========================================================================== */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const style = read('assets/css/style.css');
const shell = read('assets/css/app-shell.css');
const js = read('assets/js/public.js');
const html = read('index.html');
const polish = read('assets/css/public-polish.css');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

/* ── ١) أساس الظهور عند التمرير ─────────────────────────────────────────── */
ok(/\.reveal\s*\{[^}]*opacity:\s*\.6[^}]*transform:\s*translateY\(12px\)/s.test(style),
  'الشفافية الابتدائية .6 والإزاحة 12px (منع الوميض عند السحب السريع)');
ok(/\.reveal\.is-visible\s*\{[^}]*opacity:\s*1[^}]*transform:\s*none/s.test(style),
  'الحالة النهائية: ظاهر تماماً بلا إزاحة');
ok(/\.reveal\s*\{[^}]*cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/s.test(style),
  'منحنى الحركة الاحترافي cubic-bezier(.22,1,.36,1)');

/* ── ٢) حركة دخول الواجهة الرئيسية (متنوّعة: زوم/يمين/يسار/زوم أوت) ─────── */
/* ⚠️ هذه الكتلة في public-polish.css (الصفحات العامة فقط) لا في style.css،
   لأن style.css يُحمَّل في لوحة الموظفين أيضاً فلا داعي لتحميل حركات الواجهة. */
for (const [name, desc] of [
  ['mkZoomIn', 'زوم إن (scale .94 → 1)'],
  ['mkZoomOut', 'زوم أوت (scale 1.07 → 1)'],
  ['mkFromRight', 'دخول من اليمين (translateX 32px → 0)'],
  ['mkFromLeft', 'دخول من اليسار (translateX -32px → 0)'],
]) {
  ok(new RegExp(`@keyframes ${name}\\{from\\{opacity:0;transform:`).test(polish), `وجود keyframes ${name} — ${desc}`);
}
const heroBlock = polish.slice(polish.indexOf('@keyframes mkRise{'), polish.indexOf('@keyframes mkRise{') + 1500);
ok(!/infinite/.test(heroBlock), 'لا حركة لانهائية في دخول الواجهة');
ok((heroBlock.match(/backwards/g) || []).length >= 6, 'كل حركات الدخول بـ backwards (لا transform عالقاً)');
/* لكل عنصر من الأربعة حركة مختلفة — هذا معنى «منسّق ومتنوّع» */
for (const [i, name] of [[1, 'mkZoomIn'], [2, 'mkFromRight'], [3, 'mkFromLeft'], [4, 'mkZoomOut']]) {
  ok(new RegExp(`\\.hero-app \\.app-hero > :nth-child\\(${i}\\)\\{animation:${name}`).test(polish),
    `العنصر ${i} يتحرّك بـ ${name} (لا تكرار للحركة نفسها)`);
}
ok(/\.hero-app \+ \.app-search-wrap \.app-search\{animation:mkZoomIn/.test(polish),
  'شريط البحث يكمل بـ زوم إن بعد الواجهة');
ok(/prefers-reduced-motion: no-preference[\s\S]{0,700}\.hero-app \.app-hero > \*/.test(polish),
  'كل الحركات داخل بوابة prefers-reduced-motion: no-preference');

/* ── ٣) تتالي بطاقات الوظائف في أول رسم ─────────────────────────────────── */
ok(/\.jobs-grid\.is-first-paint \.job-card\s*\{[^}]*animation:\s*jobsCardIn/s.test(shell),
  'تتالي أول رسم لبطاقات الوظائف');
ok(/is-first-paint \.job-card:nth-child\(1\)\s*\{\s*animation-delay:\s*0ms/.test(shell),
  'التأخير يبدأ من صفر للبطاقة الأولى');
ok(/is-first-paint \.job-card:nth-child\(n\+7\)/.test(shell),
  'سقف التأخير بعد البطاقة السادسة');
ok(/jobsFirstPaintDone/.test(js), 'public.js يحفظ «تم أول رسم» في حالة');
ok(/classList\.add\('is-first-paint'\)/.test(js) && /classList\.remove\('is-first-paint'\)/.test(js),
  'الفئة تُضاف ثم تُزال فلا تتكرر الحركة عند التحديث');
ok(/if \(shown\.length && \(!jobsFirstPaintDone \|\| filterChanged\)\)/.test(js),
  'الإضافة مشروطة بوجود بطاقات + أول رسم أو تغيير فلتر');

/* ── ٣ب) لغة الحركة الموحّدة ─────────────────────────────────────────────── */
ok(/--flow-ease:cubic-bezier\(\.22,1,\.36,1\)/.test(style), 'منحنى موحّد في مُتغيّر واحد');
ok(/--m-fast:\.18s;--m-base:\.32s;--m-slow:\.52s/.test(style), 'مُدد الحركة الثلاث معرَّفة');
ok(/animation: pageIn \.26s var\(--flow-ease\) backwards/.test(polish),
  'انتقال تبويبات التطبيق بتلاشٍ خفيف (backwards)');
ok(/\.btn:active, \.bk-cta:active, \.bk-footbtn:active, \.tabbar \[data-page-tab\]:active \{ transform: scale\(\.97\)/.test(polish),
  'ضغطة الزر تصغير ٣٪');
ok(/\.app-card \.job-image:not\(\.has-img\) img \{ transform: scale\(1\.02\); \}/.test(polish),
  'صورة الوظيفة تكبر ثم تستقر (بلا تغيير شفافية)');
ok(/\.app-card:hover \{ transform: translateY\(-2px\)/.test(polish), 'رفع خفيف للبطاقة على المؤشّر');
ok(/filterChanged/.test(js) && /!jobsFirstPaintDone \|\| filterChanged/.test(js),
  'تتالٍ عند تغيير الفلتر فقط، لا عند تحديث البيانات');

/* ── ٤) احترام تقليل الحركة ─────────────────────────────────────────────── */
ok(/prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]{0,220}animation:\s*none !important/.test(style),
  'القاعدة العامة تُلغي كل الحركات عند تقليل الحركة');
ok(/prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]{0,400}is-first-paint \.job-card/.test(shell),
  'تتالي البطاقات مُلغى صراحةً عند تقليل الحركة');

/* ── ٥) الصفحة المولَّدة تحمل كل ذلك ────────────────────────────────────── */
ok(/assets\/css\/style\.css\?v=/.test(html), 'index.html يحمّل style.css');
ok(/assets\/css\/app-shell\.css\?v=/.test(html), 'index.html يحمّل app-shell.css');
ok(/class="app-hero"/.test(html), 'index.html يحتوي عناصر الواجهة الرئيسية');
ok(/id="jobs-grid"/.test(html) && /class="jobs-grid/.test(html), 'index.html يحتوي شبكة الوظائف');
ok(/assets\/js\/public\.js\?v=/.test(html), 'index.html يحمّل public.js');

console.log(`\n✅ حركة الظهور: ${n} فحصاً ناجحاً — تتابع عند الدخول، وتتالٍ للبطاقات، وتقليل حركة محترم.`);
