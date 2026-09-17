#!/usr/bin/env node
/* ===========================================================================
 *  BRC — سكربت البناء
 *  ---------------------------------------------------------------------------
 *  يُنتج من مجلد src/partials :
 *   1) index.html          — الموقع العام
 *   2) verify.html         — صفحة التحقق (تُفتح عبر الكيو آر كود)
 *   3) dashboard.html      — المنظومة الداخلية للموظفين
 *   4) brc-standalone.html — ملف واحد مستقل تماماً (CSS + JS + صور + خطوط مدمجة)
 *   5) brc-light.html      — نفس الملف لكن بصور مصغّرة (للعرض السريع والمشاركة)
 *
 *  التشغيل:  node tools/build.mjs            (النسخة الكاملة)
 *            node tools/build.mjs --light    (نسخة خفيفة brc-light.html)
 * =========================================================================== */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = (p) => join(ROOT, p);
const read = (p) => readFileSync(P(p), 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const warnings = [];

/* النسخة الخفيفة (--light): تُصغّر الصور المدمجة لتُعرض وتُشارك بسرعة
   (مناسبة للواتساب/الإيميل والعارضات التي لا تحبّ الملفات الضخمة) */
const LIGHT = process.argv.includes('--light');
const OUT_NAME = LIGHT ? 'brc-light.html' : 'brc-standalone.html';
const LIGHT_MAX = process.env.BRC_LIGHT_MAX || '860x860>';
const LIGHT_Q = process.env.BRC_LIGHT_Q || '56';

function readAsset(abs) {
  if (!LIGHT || !/\.jpe?g$/i.test(abs)) return readFileSync(abs);
  try {
    return execFileSync('convert', [abs, '-resize', LIGHT_MAX, '-strip', '-interlace', 'Plane',
      '-quality', LIGHT_Q, 'jpg:-'], { maxBuffer: 1 << 28 });
  } catch (e) { return readFileSync(abs); }   // بلا ImageMagick: نستخدم الأصل
}

/* ---------------- دمج الأصول كـ data URI ---------------- */
const cache = new Map();
function dataUri(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const abs = P(relPath);
  if (!existsSync(abs)) { warnings.push('ملف غير موجود للدمج: ' + relPath); cache.set(relPath, null); return null; }
  const buf = readAsset(abs);
  const mime =
    relPath.endsWith('.woff2') ? 'font/woff2' :
    relPath.endsWith('.svg') ? 'image/svg+xml' :
    relPath.endsWith('.png') ? 'image/png' :
    relPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const out = { uri: `data:${mime};base64,${buf.toString('base64')}`, size: buf.length };
  cache.set(relPath, out);
  return out;
}

/* ---------------- قراءة الأجزاء ---------------- */
const partials = {
  sprite: read('src/partials/sprite.html'),
  header: read('src/partials/header.html'),
  footer: read('src/partials/footer.html'),
  public: read('src/partials/public.html'),
  verify: read('src/partials/verify.html'),
  dashboard: read('src/partials/dashboard.html')
};
const CSS = read('assets/css/style.css');
const JS_ORDER = ['config', 'qr', 'qr-scan', 'store', 'ui', 'voucher', 'public', 'verify', 'dashboard'];

/* ---------------------------------------------------------------------------
 *  طبقة السحابة: تُحمَّل في الصفحات المنشورة **قبل** store.js حتى يكون الإقلاع
 *  جاهزاً عند أول init()، ولا تُدمج في brc-standalone/brc-light (تلك نسخة
 *  تُشارَك كملف واحد بلا إنترنت ولا معنى لسوبابيس فيها — فتشتغل محلياً بلا
 *  أي تنبيه لأن BRCSupabaseConfig لا يكون محمّلاً أصلاً).
 *  'vendor/supabase' مسار خاص: assets/vendor/supabase.js
 * ------------------------------------------------------------------------- */
const CLOUD_ORDER = ['vendor/supabase', 'supabase-config', 'cloud', 'cloud-auth', 'cloud-sync', 'cloud-http'];
/* ⚠️ الصفحات العامة تستخدم cloud-http (عميل مصغّر ~5KB) لا مكتبة سوبابيس الكاملة
   (213KB): الزائر يقرأ الواجهة العامة ويستدعي دالتين فقط، ولا يحتاج تسجيل دخول
   ولا اتصالاً لحظياً. قياس الحجم أظهر أن المكتبة الكاملة كانت ثلث ما ينزّله.
   اللوحة تبقى على المكتبة الكاملة لأنها تحتاج Auth و Realtime فعلاً. */
const SCRIPTS = {
  public: ['config', 'supabase-config', 'cloud-http', 'qr', 'qr-scan', 'cloud', 'cloud-sync', 'store', 'ui', 'voucher', 'public'],
  verify: ['config', 'supabase-config', 'cloud-http', 'qr', 'cloud', 'cloud-sync', 'store', 'ui', 'voucher', 'verify'],
  dashboard: ['config', 'vendor/supabase', 'supabase-config', 'qr', 'cloud', 'cloud-auth', 'cloud-sync', 'store', 'ui', 'voucher', 'dashboard']
};

/* مسار الأصل من الاسم: 'vendor/x' → assets/vendor/x.js وإلا assets/js/x.js */
const scriptPath = (n) => n.startsWith('vendor/')
  ? `assets/vendor/${n.slice(7)}.js`
  : `assets/js/${n}.js`;

/* بصمة الأصول: تُضاف كـ ?v= لروابط CSS/JS حتى لا يعلَق المتصفح بنسخة قديمة
   بعد النشر (تتغير تلقائياً فقط عند تعديل الأصول — بلا عشوائية بين البناءات).
   ⚠️ تشمل طبقة السحابة أيضاً: لو حسبناها من JS_ORDER وحده لما تغيّر الرقم عند
   تعديل cloud-sync.js — فيبقى المتصفح على نسخة قديمة **بصمت**، وهو أسوأ أنواع
   الأخطاء لأن الكود الجديد لا يصل أصلاً. */
const ASSET_VER = process.env.BRC_ASSET_VER || createHash('sha1')
  .update([CSS, ...JS_ORDER.map((n) => read(`assets/js/${n}.js`)),
           ...CLOUD_ORDER.map((n) => read(scriptPath(n)))].join('\u0000'))
  .digest('hex').slice(0, 10);
const verQ = (p) => `${p}?v=${ASSET_VER}`;

const META = {
  title: 'شركة بابل للتوظيف | Babylonian Recruitment Company',
  desc: 'شركة بابل للتوظيف (BRC) في الحلة — بابل: استمارات ترشيح موثّقة بكيو آر كود، خمس محاولات، صلاحية 30 يوماً، وحجز مؤقت للوظيفة 24 ساعة.',
  keywords: 'توظيف, بابل, الحلة, وظائف العراق, شركة توظيف, استمارة توظيف, BRC, عمالة فنية'
};

function docHead({ title, desc, css = null, icon = 'assets/img/favicon.svg', extra = '' }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="keywords" content="${META.keywords}">
<meta name="theme-color" content="#0b1a3a">
<meta name="author" content="Babylonian Recruitment Company">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_IQ">
<link rel="icon" type="image/svg+xml" href="${icon}">
${css ? `<link rel="stylesheet" href="${verQ(css)}">` : ''}
${extra}</head>
<body>
`;
}

/* ---------------- الصفحات المنفصلة ---------------- */
function buildPage({ title, desc, body, scripts }) {
  return docHead({ title, desc, css: 'assets/css/style.css' }) +
    partials.sprite + '\n' +
    partials.header + '\n' +
    body + '\n' +
    partials.footer + '\n' +
    scripts.map((n) => `<script src="${verQ(scriptPath(n))}"></script>`).join('\n') +
    '\n</body>\n</html>\n';
}

writeFileSync(P('index.html'), buildPage({
  title: META.title, desc: META.desc, body: partials.public, scripts: SCRIPTS.public
}));
writeFileSync(P('verify.html'), buildPage({
  title: 'التحقق من الاستمارة | شركة بابل للتوظيف',
  desc: 'صفحة التحقق الرسمية لاستمارات شركة بابل للتوظيف — امسح الكيو آر كود أو أدخل الرقم التسلسلي للتحقق من صحة الاستمارة وحالة المحاولات.',
  body: partials.verify, scripts: SCRIPTS.verify
}));
writeFileSync(P('dashboard.html'), buildPage({
  title: 'المنظومة الداخلية | شركة بابل للتوظيف',
  desc: 'لوحة الموظفين والإدارة لشركة بابل للتوظيف: إدارة الوظائف، إصدار الاستمارات، متابعة الحجوزات، سجل التدقيق، واللوحة المالية.',
  body: partials.dashboard, scripts: SCRIPTS.dashboard
}));

/* ---------------- النسخة المستقلة (ملف واحد) ---------------- */
function buildStandalone() {
  const stats = { fonts: 0, cssImgs: 0, htmlImgs: 0 };

  // 1) CSS مع دمج الخطوط والصور
  let css = CSS.replace(/url\(['"]?\.\.\/fonts\/([^'")]+)['"]?\)/g, (m, f) => {
    const d = dataUri('assets/fonts/' + f); if (!d) return m;
    stats.fonts += d.size; return `url(${d.uri})`;
  });
  css = css.replace(/url\(['"]?\.\.\/img\/([^'")]+)['"]?\)/g, (m, f) => {
    const d = dataUri('assets/img/' + f); if (!d) return m;
    stats.cssImgs += d.size; return `url(${d.uri})`;
  });

  // 2) إعادة كتابة الروابط + دمج صور <img>
  const rewriteLinks = (html) => html
    .replace(/href="index\.html#([^"]+)"/g, 'href="#$1"')
    .replace(/href="index\.html"/g, 'href="#home"')
    .replace(/href="verify\.html"/g, 'href="#!verify"')
    .replace(/href="dashboard\.html"/g, 'href="#!dashboard"');

  const prep = (html) => rewriteLinks(html).replace(/src="assets\/img\/([^"]+)"/g, (m, f) => {
    const d = dataUri('assets/img/' + f);
    if (!d) return m;
    stats.htmlImgs += d.size;
    return `src="${d.uri}"`;
  });

  const header = prep(partials.header);
  const footer = prep(partials.footer);
  const site = prep(partials.public);
  const verify = prep(partials.verify);
  const dash = prep(partials.dashboard);

  // 3) حزمة JavaScript مدمجة + ضبط + راوتر
  const jsBundle = JS_ORDER.map((n) => `/* ===================== ${n}.js ===================== */\n` + read(`assets/js/${n}.js`)).join('\n;\n');
  const icon = dataUri('assets/img/favicon.svg');

  const boot = `
/* ===== ضبط النسخة المستقلة ===== */
BRC_CONFIG.verifyLocal = '#!verify';
${icon ? `(function(){var l=document.querySelector('link[rel="icon"]');if(l)l.href=${JSON.stringify(icon.uri)};})();` : ''}
</body>`;
  // (نُبقي وسم الإغلاق في النهاية بعد الراوتر)

  const router = `
/* ===== راوتر الملف المستقل ===== */
(function () {
  var VIEWS = ['site', 'verify', 'dashboard'];
  function parse() {
    var h = location.hash || '';
    if (h.indexOf('#!') !== 0) return { name: 'site', query: '' };
    var rest = h.slice(2), qi = rest.indexOf('?');
    return { name: (qi < 0 ? rest : rest.slice(0, qi)) || 'site', query: qi < 0 ? '' : rest.slice(qi) };
  }
  function route() {
    var r = parse();
    if (VIEWS.indexOf(r.name) < 0) r.name = 'site';
    VIEWS.forEach(function (n) {
      var el = document.getElementById('route-' + n);
      if (el) el.hidden = (n !== r.name);
    });
    document.body.setAttribute('data-route', r.name);
    if (r.name === 'verify' && window.BRCVerify) window.BRCVerify.mount(r.query);
    if (r.name === 'dashboard') window.scrollTo(0, 0);
    if (r.name === 'site') {
      var h = location.hash || '';
      if (h && h.indexOf('#!') !== 0 && h !== '#') {
        var t = document.getElementById(h.slice(1));
        if (t) setTimeout(function () { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 40);
      }
    }
  }
  window.addEventListener('hashchange', route);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route);
  else route();
})();`;

  const html = docHead({
    title: META.title + ' — ملف واحد',
    desc: META.desc,
    icon: icon ? icon.uri : '',
    extra: `<style>\n${css}\n</style>\n`
  }) +
    partials.sprite + '\n' +
    header + '\n' +
    '<div class="route" id="route-site">\n' + site + '\n</div>\n' +
    '<div class="route" id="route-verify" hidden>\n' + verify + '\n</div>\n' +
    '<div class="route" id="route-dashboard" hidden>\n' + dash + '\n</div>\n' +
    footer + '\n' +
    '<script>\n' + jsBundle + '\n</script>\n' +
    '<script>\n' + boot.replace(/\n<\/body>$/, '') + '\n' + router + '\n</script>\n' +
    '</body>\n</html>\n';

  writeFileSync(P(OUT_NAME), html);
  return { size: Buffer.byteLength(html), ...stats };
}

const st = buildStandalone();

/* ---------------- التقرير ---------------- */
console.log('— تم البناء —  (بصمة الأصول: ' + ASSET_VER + ')');
[['index.html'], ['verify.html'], ['dashboard.html'], [OUT_NAME]].forEach(([n]) => {
  console.log('  ' + n.padEnd(22) + kb(statSync(P(n)).size));
});
console.log('  (المستقل: خطوط ' + kb(st.fonts) + ' + صور CSS ' + kb(st.cssImgs) + ' + صور HTML ' + kb(st.htmlImgs) + ')' +
  (LIGHT ? '   — نسخة خفيفة للعرض والمشاركة' : ''));

if (warnings.length) { console.log('— تحذيرات —'); [...new Set(warnings)].forEach((w) => console.log('  ⚠ ' + w)); }
else console.log('  ✓ كل الملفات المرجعية موجودة');

/* ---------------- فحص الاكتفاء الذاتي ---------------- */
const out = read(OUT_NAME);
const bad = [];
const patterns = [
  ['رابط CSS خارجي', /<link[^>]+href="assets\/css/],
  ['رابط JS خارجي', /<script[^>]+src="assets\/js/],
  ['خط خارجي', /url\(['"]?\.\.\/fonts/],
  ['صورة CSS خارجية', /url\(['"]?\.\.\/img/],
  ['صورة HTML خارجية', /<img[^>]+src="assets\/img/],
  ['رابط موضعي مفقود (href="")', /href=""\s*>/],
  ['رابط صفحة منفصلة', /href="(index|verify|dashboard)\.html/],
  ['أيقونة خارجية', /<link[^>]+rel="icon"[^>]+href="assets\//]
];
patterns.forEach(([label, re]) => { if (re.test(out)) bad.push(label); });
if (bad.length) { console.log('  ⚠ الملف المستقل غير مكتفٍ بذاته: ' + bad.join(' | ')); process.exitCode = 1; }
else console.log('  ✓ الملف المستقل مكتفٍ بذاته تماماً (يعمل بدون إنترنت وبدون مجلدات مساعدة)');
if (LIGHT) console.log('  ✓ نسخة خفيفة: ' + OUT_NAME + ' — ' + kb(statSync(P(OUT_NAME)).size));
