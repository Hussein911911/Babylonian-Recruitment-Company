#!/usr/bin/env node
/* ===========================================================================
 *  HRC — بناء سياسة أمان المحتوى (CSP) من الملفات نفسها
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا تُحسَب البصمات ولا تُكتب يدوياً؟
 *
 *  الموقع يستخدم معالجات مضمّنة: `onclick="G.start()"` (٧٦ موضعاً في apply.html
 *  وحدها). وسياسة CSP الصارمة — بلا `'unsafe-inline'` — ترفض هذه المعالجات،
 *  فيتوقف كل زر في موقع التقديم. أما `'unsafe-inline'` فتُبطل الحماية من XSS،
 *  وهي بالضبط ما نريدها.
 *
 *  الحل القياسي: `'sha256-...'` لكل كتلة/معالج. المتصفح يحسب بصمة النص
 *  ويقارنها؛ المطابق يعمل، وأي سكربت مُحقَن لا يطابق فيُرفض. أي أننا نحصل
 *  على حماية حقيقية **بلا تعديل سطر واحد من كود الموقع** — وهذا مهم لأن
 *  apply.html هو مسار تقديم العملاء، وقد سبق أن أخطأتُ في تقدير أثر تعديله.
 *
 *  ⚠ ما لا تحميه هذه السياسة (بند صريح لا يُخفى):
 *    الحقن داخل `onclick` **المولَّد من البيانات** (مثلاً `G.pickJob('...')`).
 *    البصمة تُقرأ من نصّ السمة بعد التحليل، فلو غيّر المهاجم محتواها تغيّرت
 *    بصمتها ورُفضت — وهذا جيد. لكن لو كان الحقن عبر قيمة تُكتب في `class`
 *    أو `style` فذلك يخصّ `style-src` لا `script-src`. الحدّ الحقيقي يبقى
 *    التهريب (esc) في الكود، وهو موجود ومُختبَر في التطبيق.
 *
 *  التشغيل: node tools/build-csp.mjs          ← يكتب/يحدّث الكتلة في _headers
 *            node tools/build-csp.mjs --check ← يفشل إن كانت _headers قديمة
 * =========================================================================== */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* الصفحات التي تُنشر فعلاً — نفس ما يخدمه Cloudflare من جذر المستودع */
const PAGES = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

const sha = (text) => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'";

/* كل بصمات السكربتات المضمّنة والمعالجات في الصفحة.
   ⚠️ نفصلهما: الكتل تُطابق ببصمتها في `script-src` مباشرة، أما المعالجات
   (onclick) فلا تُطابقها البصمة **إلا** بوجود `'unsafe-hashes'` في
   `script-src-attr`. خلطهما يعني سياسة تبدو صارمة وتُعطّل كل زر. */
function scriptHashes(html) {
  const out = new Set();
  const handlers = new Set();

  /* 1) كتل <script> بلا src — البصمة على النص **كما هو** بالبايت */
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = (m[1].match(/type\s*=\s*["']([^"']+)["']/i) || [])[1];
    /* type="text/plain" لا ينفّذه المتصفح فلا يدخل السياسة */
    if (type && !/^(text\/javascript|application\/javascript|module)?$/i.test(type.trim())) continue;
    if (!m[2].trim()) continue;
    out.add(sha(m[2]));
  }

  /* 2) معالجات HTML المضمّنة — المتصفح يبصم قيمة السمة **بعد** فكّ كيانات HTML.
     نستخدم نفس منطق المتصفح: نُحوّل &quot; &amp; &#39; ثم نقصّ الأطراف. */
  const decode = (s) => s
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of html.matchAll(/\son(click|change|input|keydown|keyup|submit|focus|blur|load|error|mouseover|mouseout)\s*=\s*"([^"]*)"/gi)) {
    handlers.add(sha(decode(m[2])));
  }
  return { blocks: out, handlers };
}

/* ═══ بناء السياسة ══════════════════════════════════════════════════════════ */
const perPage = new Map();
const allBlocks = new Set();
const allHandlers = new Set();
for (const p of PAGES) {
  if (!existsSync(join(ROOT, p))) continue;
  const { blocks, handlers } = scriptHashes(read(p));
  perPage.set(p, { blocks: blocks.size, handlers: handlers.size });
  blocks.forEach((h) => allBlocks.add(h));
  handlers.forEach((h) => allHandlers.add(h));
}

/* نطاق Supabase يُقرأ من التهيئة نفسها لا يُكتب يدوياً — وإلا انكسر الموقع
   بصمت لو تغيّر المشروع */
const cfg = read('assets/js/supabase-config.js');
const sbUrl = (cfg.match(/url:\s*'([^']+)'/) || [])[1] || '';
const sbHost = sbUrl.replace(/^https?:\/\//, '');
const sbWs = sbHost.replace(/^/, 'wss://');

const CDN = 'https://cdn.jsdelivr.net'; /* لا يُستخدم اليوم، لكنه مسار معروف في الإعدادات */

const directives = [
  "default-src 'self'",
  /* السكربتات: النفس + بصمات السكربتات المضمّنة. لا unsafe-inline ولا unsafe-eval.
     'wasm-unsafe-eval' غير مطلوب: لا WebAssembly في الموقع. */
  /* الكتل المضمّنة: بصمات كاملة بلا أي استثناء.
     (البصمة هنا تُطابق نصّ الكتلة بايت ببايت، فأي حقن يُرفض.) */
  "script-src 'self' " + [...allBlocks].sort().join(' '),
  /* معالجات HTML (onclick=…): البصمة وحدها لا تكفي — المتصفح لا يطابقها على
     السمات إلا مع 'unsafe-hashes' (CSP3). هذا **ليس** 'unsafe-inline':
     السكربت المُحقَن لا بصمة له فيُرفض، وهذا هو هجوم XSS نفسه.
     ⚠️ يبقى أخفّ من إزالة المعالجات: من يستطيع حقن سمة يمكنه إعادة استخدام
     نصّ معالج مُعتمد (مثل G.go(-1)). لذلك هو **خطوة انتقال** لا نهاية،
     والتوثيق يقول ذلك. */
  "script-src-attr 'unsafe-hashes' " + [...allHandlers].sort().join(' '),
  /* الأنماط: الموقع يستخدم style="..." بكثافة داخل HTML (٢٨ في index وحده)،
     ولا توجد بصمات للأنماط في CSP (لا تدعمها المتصفحات لسمات style).
     لذلك 'unsafe-inline' هنا ضرورة لا تهاون — ولا تفتح باب XSS لأن
     script-src منفصل عنها. */
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: " + (sbHost ? 'https://' + sbHost : ''),
  "font-src 'self' data:",
  /* الاتصال: Supabase (REST + Realtime عبر wss) فقط */
  'connect-src ' + ["'self'", sbUrl, sbWs].filter(Boolean).join(' '),
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests"
];

const CSP = directives.join('; ').replace(/\s+/g, ' ').trim();

/* ═══ الكتابة في _headers ══════════════════════════════════════════════════ */
const MARK_S = '# ═══ CSP:START (يُولَّد بـ tools/build-csp.mjs — لا تعدّله يدوياً) ═══';
const MARK_E = '# ═══ CSP:END ═══';

const block = [
  MARK_S,
  '#',
  '#  سياسة أمان المحتوى + HSTS (2026-11-13)',
  '#',
  '#  ⚠️ البصمات محسوبة من الملفات نفسها. أي تعديل على سكربت مضمّن أو معالج',
  '#     onclick في أي صفحة يغيّر بصمته ⇒ إن لم تُعِد التوليد، يُرفض السكربت',
  '#     في المتصفح ويتعطّل الزر. لذلك: npm run csp  ثم  npm run test:csp',
  '#',
  '#  ⚠️ HSTS يُنشر بـ max-age قصير أولاً (٦٠ ثانية): لو ضُبط نطاق بلا شهادة',
  '#     صالحة بقيمة سنة، يُقفل الموقع على كل من زاره لمدة سنة كاملة ولا',
  '#     مهلة تراجع. بعد التأكد من أن HTTPS يعمل على كل النطاقات، ارفعها',
  '#     إلى 31536000 (سنة) ثم أضف includeSubDomains.',
  '#',
  '/*',
  '  Strict-Transport-Security: max-age=60',
  '  Content-Security-Policy: ' + CSP,
  '  X-Frame-Options: DENY',
  '  Cross-Origin-Opener-Policy: same-origin',
  '  Cross-Origin-Resource-Policy: same-site',
  MARK_E
].join('\n');

export function build() {
  return { csp: CSP, block, perPage, blocks: allBlocks.size, handlers: allHandlers.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes('--check');
  const headersPath = join(ROOT, '_headers');
  let headers = read('_headers');

  /* idempotent: احذف الكتلة القديمة أولاً (أو كتلة CSP سابقة بهذا الشكل) */
  const re = new RegExp(MARK_S.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + MARK_E.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const had = re.test(headers);
  const next = had ? headers.replace(re, () => block) : headers.trimEnd() + '\n\n' + block + '\n';

  if (checkOnly) {
    if (!had || headers !== next) {
      console.error('❌ _headers لا تطابق الملفات — شغّل: npm run csp');
      console.error('   (بصمة قديمة ⇒ المتصفح يرفض onclick أو سكربتاً مضمّناً ⇒ أزرار معطّلة)');
      process.exit(1);
    }
    console.log('✅ _headers مطابق للملفات (' + allBlocks.size + ' كتلة · ' + allHandlers.size + ' معالج)');
    process.exit(0);
  }

  writeFileSync(headersPath, next);
  console.log('✓ وُلِّدت CSP: ' + allBlocks.size + ' بصمة كتلة + ' + allHandlers.size + ' بصمة معالج');
  for (const [p, v] of perPage) if (v.blocks || v.handlers) console.log('    ' + p.padEnd(24) + v.blocks + ' كتلة · ' + v.handlers + ' معالج');
  console.log('  HSTS: max-age=60 (ابدأ قصيراً — انظر التعليق في _headers)');
}
