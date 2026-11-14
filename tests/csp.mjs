#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص سياسة أمان المحتوى (CSP) و HSTS
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا هذا الملف؟
 *
 *  CSP تُعطّل الأزرار بصمت. لا رسالة خطأ للمستخدم، ولا شيء في الواجهة —
 *  الزر لا يفعل شيئاً، ويظنّ الزبون أن الموقع معطّل. وهذا أسوأ من ثغرة:
 *  الثغرة تُكتشف، والزرّ الميت يُتَّهم به الموقع نفسه.
 *
 *  والخطأ الأسهل هنا هو **بصمة قديمة**: تُعدَّل كتلة سكربت أو `onclick`
 *  بحرف واحد، فتُرفض في المتصفح. لا يكشفه أي فحص نصّي — لأنه سليم نحوياً.
 *
 *  فما يفحصه هذا الملف:
 *   ١) أن _headers تحمل الكتلة، وأن البصمات **مطابقة للملفات الآن**.
 *   ٢) أن كل سياسة صارمة فعلاً — لا `unsafe-inline` في script-src ولا
 *      `unsafe-eval` (وإلا صارت زينة).
 *   ٣) أن HSTS موجود وبقيمة قصيرة (لا تُقفل الموقع سنة بالخطأ).
 *   ٤) أن كل صفحة منشورة تُغطَّى.
 *   ٥) — الأهم — أن **كل معالج onclick في كل صفحة له بصمة**، محسوبة
 *      بالطريقة التي يحسبها المتصفح (فكّ كيانات HTML). معالج بلا بصمة =
 *      زرّ ميت في الإنتاج.
 *
 *  التشغيل: node tests/csp.mjs   أو   npm run test:csp
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

const sha = (t) => "'sha256-" + createHash('sha256').update(t, 'utf8').digest('base64') + "'";
const decodeEntities = (s) => s
  .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* ═══ قراءة _headers ═══════════════════════════════════════════════════════ */
const H = read('_headers');
const cspLine = (H.match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1] || '';
const hstsLine = (H.match(/^\s*Strict-Transport-Security:\s*(.+)$/m) || [])[1] || '';
const policyHashes = new Set((cspLine.match(/'sha256-[A-Za-z0-9+/=]+'/g) || []));
const directive = (name) => {
  const m = cspLine.split(';').map((x) => x.trim()).find((x) => x.toLowerCase().startsWith(name.toLowerCase() + ' '));
  return m ? m.slice(name.length).trim() : '';
};

/* بصمات كل وجهة على حدة — الخلط بينهما هو الخطأ الذي نحمي منه:
   كتلة <script> تُطابقها script-src، ومعالج onclick لا تُطابقه إلا script-src-attr. */
const elemHashes = new Set((directive('script-src').match(/'sha256-[A-Za-z0-9+/=]+'/g) || []));
const attrHashes = new Set((directive('script-src-attr').match(/'sha256-[A-Za-z0-9+/=]+'/g) || []));

console.log('══════════════════════════════════════════════════════════════════════════');
console.log('  CSP و HSTS — هل تُنشر السياسة، وهل تكسر زراً؟');
console.log('══════════════════════════════════════════════════════════════════════════');

/* ═══ 1) الوجود والشكل ═════════════════════════════════════════════════════ */
step(1, '_headers تنشر الترويستين');

check('Content-Security-Policy موجودة', !!cspLine);
check('Strict-Transport-Security موجودة', !!hstsLine, 'غائبة');
check('السياسة تُطبَّق على كل المسارات (/*)', /^\/\*\s*$/m.test(H) || /^\s*\/\*/m.test(H));

/* ═══ 2) صرامة السياسة ═════════════════════════════════════════════════════ */
step(2, 'السياسة صارمة فعلاً — لا استثناء يُبطلها');

const scriptSrc = directive('script-src');
const scriptSrcAttr = directive('script-src-attr');
check('script-src موجودة صراحةً', !!scriptSrc);
/* ⚠️ الفحص الذي كان غائباً وأوقعني: بصمات onclick **لا تُطابق** بلا
   'unsafe-hashes' في script-src-attr. السياسة التي تحوي البصمات في script-src
   وحدها تبدو صارمة ومكتملة في أي فحص نصّي — وتُعطّل ٧٦ زراً في الإنتاج. */
check('script-src-attr موجودة (المعالجات تحتاجها صراحةً)', !!scriptSrcAttr,
  'بصمات onclick لا تُطابق بلا script-src-attr');
check("script-src-attr تحوي 'unsafe-hashes'", /'unsafe-hashes'/.test(scriptSrcAttr),
  'بلا unsafe-hashes: كل onclick مرفوض');
check("script-src-attr لا تحوي 'unsafe-inline'", !/unsafe-inline/.test(scriptSrcAttr));
check("script-src لا تحوي 'unsafe-inline'", !/unsafe-inline/.test(scriptSrc), scriptSrc.slice(0, 80));
check("script-src لا تحوي 'unsafe-eval'", !/unsafe-eval/.test(scriptSrc), scriptSrc.slice(0, 80));
check('script-src لا تسمح بـ * (أي مصدر)', !/(^|\s)\*(\s|$)/.test(scriptSrc));
check('object-src = none', directive('object-src') === "'none'", directive('object-src'));
check('base-uri محدّدة', !!directive('base-uri'), 'غائبة — تسمح بحقن <base>');
check('frame-ancestors محدّدة', !!directive('frame-ancestors'), 'غائبة');
check('frame-src = none', directive('frame-src') === "'none'", directive('frame-src'));
check('form-action محدّدة', !!directive('form-action'), 'غائبة');
check('default-src = self', directive('default-src') === "'self'", directive('default-src'));

/* ═══ 3) HSTS بقيمة آمنة ══════════════════════════════════════════════════ */
step(3, 'HSTS موجودة وبقيمة لا تُقفل الموقع');

const maxAge = Number((hstsLine.match(/max-age=(\d+)/) || [])[1] || -1);
check('HSTS تحمل max-age', maxAge >= 0, hstsLine || 'غائبة');
/* ⚠️ القاعدة الأهم: النشر الأول بقيمة قصيرة. لو نُشرت سنة على نطاق بلا
   شهادة صالحة، يُقفل الموقع على كل زائر لمدة سنة ولا مهلة تراجع. */
check('max-age قصيرة في النشر الأول (≤ 86400 أي يوم)', maxAge >= 0 && maxAge <= 86400,
  String(maxAge) + ' — ابدأ بـ 60 ثم ارفعها');

/* ═══ 4) التغطية: كل صفحة منشورة لها بصماتها ══════════════════════════════ */
step(4, 'كل صفحة منشورة مغطّاة ببصمات معالجاتها');

const PAGES = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
let totalHandlers = 0, covered = 0;
const uncovered = [];

for (const p of PAGES) {
  if (!existsSync(join(ROOT, p))) continue;
  const html = read(p);
  const handlers = [];
  for (const m of html.matchAll(/\son(click|change|input|keydown|keyup|submit|focus|blur|load|error|mouseover|mouseout)\s*=\s*"([^"]*)"/gi)) {
    handlers.push(decodeEntities(m[2]));
  }
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => {
      const type = (m[1].match(/type\s*=\s*["']([^"']+)["']/i) || [])[1];
      return !type || /^(text\/javascript|application\/javascript|module)?$/i.test(type.trim());
    })
    .map((m) => m[2]).filter((b) => b.trim());

  /* ⚠️ نفصل الوجهتين: معالج موجود في script-src فقط لا يعمل في المتصفح.
     كان الفحص السابق يجمعهما في مجموعة واحدة، فيمرّ معالج في المكان الخطأ. */
  for (const h of handlers) {
    totalHandlers++;
    if (attrHashes.has(sha(h))) covered++;
    else uncovered.push(p + ' :: on* ' + h.slice(0, 50));
  }
  for (const b of blocks) {
    totalHandlers++;
    if (elemHashes.has(sha(b))) covered++;
    else uncovered.push(p + ' :: <script> ' + b.trim().slice(0, 40));
  }
}

check('كل معالج/كتلة مضمّنة لها بصمة في السياسة',
  uncovered.length === 0,
  uncovered.length + ' بلا بصمة — الأول: ' + (uncovered[0] || ''));
check('لا بصمات زائدة تشير لنصّ غير موجود',
  policyHashes.size <= totalHandlers + 1,
  policyHashes.size + ' بصمة مقابل ' + totalHandlers + ' عنصر');
console.log(`      ${covered}/${totalHandlers} عنصر مغطّى · ${policyHashes.size} بصمة في السياسة`);

/* ═══ 5) البصمات لم تتقادم ════════════════════════════════════════════════ */
step(5, 'البصمات مولَّدة من الملفات الحالية (لا قديمة)');

/* نعيد الحساب بنفس أداة التوليد ونقارن — هذا يمسك «عدّلت onclick ونسيت npm run csp» */
const before = policyHashes.size;
const { execFileSync } = await import('node:child_process');
let synced = false;
try {
  execFileSync(process.execPath, [join(ROOT, 'tools/build-csp.mjs'), '--check'], { stdio: 'pipe' });
  synced = true;
} catch { synced = false; }
check('npm run csp --check يمرّ (السياسة غير متقادمة)', synced,
  'شغّل: npm run csp — بصمة قديمة تعني أزراراً معطّلة في الإنتاج');

/* ═══ 5.5) مجلد النشر يحمل كل ما تشير إليه الصفحات ═════════════════════════
   ⚠️ لماذا هذا في فحص CSP؟ لأن الاثنين يفشلان بصمت: سياسة قديمة تُعطّل
   زراً، وملف ناقص في dist يُنتج موقعاً بلا manifest. وقد وجدنا الثاني قائماً:
   manifest.webmanifest و robots.txt و sitemap.xml كانت غائبة عن قائمة
   tools/dist.mjs، فكان `npm run dist` يُسقط البناء بخطأ «مراجع ناقصة» —
   أي أن نشر الطوارئ اليدوي كان معطّلاً تماماً. */
step(5.5, 'مجلد النشر يحمل الملفات التي تشير إليها الصفحات');

const distSrc = read('tools/dist.mjs');
for (const f of ['manifest.webmanifest', 'robots.txt', 'sitemap.xml', 'sw.js', '_headers', '_redirects']) {
  check("dist يُدرج " + f, new RegExp("'" + f.replace('.', '\\.') + "'").test(distSrc));
}

/* ═══ 6) لا شيء في الموقع يحتاج ما مُنع ══════════════════════════════════ */
step(6, 'الموقع لا يستخدم ما منعته السياسة');

const allHtml = PAGES.map((p) => read(p)).join('\n');
check('لا eval( في الكود المضمّن', !/[^.\w]eval\s*\(/.test(allHtml.replace(/\.eval\s*\(/g, '')), 'يوجد eval');
check("لا iframe في أي صفحة (frame-src 'none')", !/<iframe\b/i.test(allHtml), 'يوجد iframe');
check('لا روابط خارجية تُحمَّل كسكربت', !/<script[^>]+src="https?:\/\//i.test(allHtml));
check("لا inline event handlers تُحقن من بيانات غير مهرَّبة",
  /esc\(/.test(read('apply.html')), 'لا توجد دالة esc — مراجعة يدوية');

console.log('\n' + '═'.repeat(74));
if (fail === 0) {
  console.log('  النتيجة: ✅ ' + pass + ' فحصاً ناجحاً | 0 فاشل');
  console.log('  CSP صارمة بلا unsafe-inline · ' + policyHashes.size + ' بصمة · HSTS ' + maxAge + 's');
} else {
  console.log('  النتيجة: ❌ ' + pass + ' ناجح | ' + fail + ' فاشل');
  console.log('\n  المشاكل:');
  problems.forEach((p) => console.log('   • ' + p));
}
console.log('═'.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
