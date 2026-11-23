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

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

/* ── ١) أساس الظهور عند التمرير ─────────────────────────────────────────── */
ok(/\.reveal\s*\{[^}]*opacity:\s*\.6[^}]*transform:\s*translateY\(12px\)/s.test(style),
  'الشفافية الابتدائية .6 والإزاحة 12px (منع الوميض عند السحب السريع)');
ok(/\.reveal\.is-visible\s*\{[^}]*opacity:\s*1[^}]*transform:\s*none/s.test(style),
  'الحالة النهائية: ظاهر تماماً بلا إزاحة');
ok(/\.reveal\s*\{[^}]*cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/s.test(style),
  'منحنى الحركة الاحترافي cubic-bezier(.22,1,.36,1)');

/* ── ٢) حركة دخول الواجهة الرئيسية ──────────────────────────────────────── */
ok(/@keyframes\s+mkRiseIn/.test(style), 'وجود keyframes mkRiseIn');
for (const i of [1, 2, 3, 4]) {
  ok(new RegExp(`\\.hero-app \\.app-hero > :nth-child\\(${i}\\)\\s*\\{\\s*animation-delay`).test(style),
    `تتابع عنصر الواجهة رقم ${i}`);
}
ok(/prefers-reduced-motion:\s*no-preference[\s\S]{0,900}\.hero-app \.app-hero > \*/.test(style),
  'الحركة داخل بوابة prefers-reduced-motion: no-preference');
const heroBlock = style.slice(style.indexOf('@keyframes mkRiseIn'), style.indexOf('@keyframes mkRiseIn') + 1800);
ok(!/infinite/.test(heroBlock), 'لا حركة لانهائية في دخول الواجهة');
ok(/animation:\s*mkRiseIn[^;]*backwards/.test(heroBlock),
  'fill-mode=backwards حتى لا تبقى قيمة transform بعد الانتهاء');
ok(/\.hero-app \+ \.app-search-wrap \.app-search\s*\{[^}]*mkRiseIn[^}]*animation-delay/s.test(style),
  'شريط البحث يكمل التتابع بعد الواجهة');

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
ok(/prefers-reduced-motion: no-preference[\s\S]{0,900}animation:pageIn \.26s var\(--flow-ease\) backwards/.test(shell),
  'انتقال تبويبات التطبيق بتلاشٍ خفيف (backwards)');
ok(/\.btn:active,\.bk-cta:active,\.bk-footbtn:active,\.tabbar \[data-page-tab\]:active\{transform:scale\(\.97\)/.test(shell),
  'ضغطة الزر تصغير ٣٪');
ok(/\.app-card \.job-image:not\(\.has-img\) img\{transform:scale\(1\.02\)\}/.test(shell),
  'صورة الوظيفة تكبر ثم تستقر (بلا تغيير شفافية)');
ok(/\.app-card:hover\{transform:translateY\(-2px\)/.test(shell), 'رفع خفيف للبطاقة على المؤشّر');
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
