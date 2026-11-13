#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص حظر صفحة الاسترجاع عن النشر
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا هذا الملف؟
 *
 *  `restore.html` تحمل مخطط قاعدة البيانات كاملاً (١٥٠ ك.ب: الجداول والدوال
 *  وسياسات RLS) وتفتح أي نسخة احتياطية. والنشر من جذر المستودع
 *  (Build output = .)، فكل ملف يُقدَّم للعالم بلا قائمة استثناءات.
 *
 *  البوابة بالمصادقة (restore-gate.js) تحمي الواجهة لا الملف: من يقرأ source
 *  الصفحة يقرأ المخطط الخام قبل تنفيذ أي جافاسكربت. فالحظر في `_redirects`
 *  هو الحدّ الحقيقي المتاح داخل المستودع.
 *
 *  وهذا الفحص يحرسه من ثلاث جهات:
 *   ١) القاعدة موجودة فعلاً ولا تُحذف سهواً في تنظيف لاحق.
 *   ٢) `_redirects` كله سليم: لا قاعدة تصنع حلقة (وهي مشكلة حدثت فعلاً
 *      في هذا المشروع وأسقطت /dashboard و/verify بـ ERR_TOO_MANY_REDIRECTS).
 *   ٣) لا شيء في الموقع يشير إلى الصفحة المحظورة برابط عام.
 *
 *  التشغيل: node tests/restore-block.mjs   أو   npm run test:restore-block
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

const R = read('_redirects');

/* ── تحليل القواعد: نتجاهل التعليقات والسطور الفارغة ─────────────────────── */
const rules = R.split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [from, to, status] = l.split(/\s+/);
    return { from, to, status: status || '302', raw: l };
  });

console.log('══════════════════════════════════════════════════════════════════════════');
console.log('  حظر صفحة الاسترجاع — هل يُقدَّم المخطط لأي زائر؟');
console.log('══════════════════════════════════════════════════════════════════════════');

/* ═══ 1) الصفحة موجودة ومحظورة ═════════════════════════════════════════════ */
step(1, 'الصفحة باقية في المستودع ومحظورة على الموقع');

check('restore.html ما زالت في المستودع (الأداة تحتاجها عند الكارثة)',
  existsSync(join(ROOT, 'restore.html')));

const blockHtml = rules.find((r) => r.from === '/restore.html');
const blockClean = rules.find((r) => r.from === '/restore');

check('قاعدة تحظر /restore.html', !!blockHtml, rules.map((r) => r.from).join(', '));
check('قاعدة تحظر /restore (الصيغة النظيفة)', !!blockClean);
/* ⚠️ 404 لا 302: التحويل إلى صفحة أخرى يوحي بأنها موجودة، والزائر لا يحتاجها */
check('الحظر بـ 404 لا بتحويل يوهم بالوجود',
  blockHtml && blockHtml.status === '404' && blockClean && blockClean.status === '404',
  (blockHtml && blockHtml.status) + ' / ' + (blockClean && blockClean.status));
check('وجهة الحظر صفحة موجودة فعلاً',
  blockHtml && existsSync(join(ROOT, blockHtml.to.replace(/^\//, ''))), blockHtml && blockHtml.to);

/* الصفحة المحظورة لا تُذكر كمسموحة في أي قاعدة أخرى */
check('لا قاعدة تعيد فتح الصفحة على مسار آخر',
  !rules.some((r) => r.to === '/restore.html'),
  rules.filter((r) => r.to === '/restore.html').map((r) => r.raw).join(' · '));

/* ═══ 2) سلامة _redirects كله — لا حلقات ══════════════════════════════════ */
step(2, '_redirects سليم: لا قاعدة تصنع حلقة');

/* ⚠️ هذا الفحص موجود لأن الخطأ حدث فعلاً: قاعدة «/dashboard → /dashboard.html»
   صنعت حلقة مع تطبيع Cloudflare Pages (الذي يحوّل .html إلى المسار النظيف
   تلقائياً)، فأسقطت تسجيل الدخول والتحقق بـ ERR_TOO_MANY_REDIRECTS. */
const selfMapping = rules.filter((r) => {
  const from = r.from.replace(/\/$/, '');
  const to = r.to.split('?')[0].replace(/\/$/, '');
  /* نفس الاسم: /x → /x.html أو /x.html → /x */
  return to === from + '.html' || to === from.replace(/\.html$/, '') ||
         (r.to.startsWith('/') && to === from);
});
check('لا قاعدة تطابق مسارها الهدف (حلقة Pages)', selfMapping.length === 0,
  selfMapping.map((r) => r.raw).join(' · '));

/* كل وجهة 200 يجب أن تكون ملفاً موجوداً */
const missing200 = rules
  .filter((r) => r.status === '200' && r.to.startsWith('/') && !r.to.startsWith('//'))
  .filter((r) => !existsSync(join(ROOT, r.to.split('?')[0].replace(/^\//, ''))));
check('كل وجهة 200 ملف موجود', missing200.length === 0,
  missing200.map((r) => r.raw).join(' · '));

/* ═══ 3) لا رابط عام للصفحة المحظورة ═════════════════════════════════════ */
step(3, 'لا صفحة منشورة تشير إلى الصفحة المحظورة برابط عام');

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const linking = [];
for (const p of pages) {
  if (p === 'restore.html') continue;
  const html = read(p);
  /* نجرّد كتل التعليقات التي تشرح الحظر كي لا تُحتسب إشارات */
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of bare.matchAll(/(?:href|src)\s*=\s*["']([^"']*restore[^"']*)["']/gi)) {
    linking.push(p + ' → ' + m[1]);
  }
}
/* ═══ link من لوحة التحكم مقبول: يفتحه المدير من جهازه، والصفحة محظورة
   على الموقع فتصله 404 مع شرح. لكن نُبقيه مرئياً كي لا يمرّ صامتاً. */
if (linking.length) console.log('      إشارات موجودة: ' + linking.join(' · '));
check('لا رابط عام مباشر (href) إلى restore.html في أي صفحة',
  linking.filter((l) => !/^dashboard\.html/.test(l)).length === 0,
  linking.join(' · '));

/* ═══ 4) الحظر يُطبَّق قبل قراءة الملف ═══════════════════════════════════ */
step(4, 'الحظر يقع قبل تقديم الملف — أي لا يُقرأ المخطط أصلاً');

/* قاعدة في _redirects يقرأها Cloudflare قبل البحث عن الملف، فالملف لا
   يُقدَّم. هذا هو الفرق عن البوابة بالمصادقة: تلك تُرسل الملف ثم تقفله. */
check('_redirects في جذر النشر وليس داخل مجلد', existsSync(join(ROOT, '_redirects')));
check('dist يحمل _redirects (وإلا نُشر الملف بلا حماية)',
  /'_redirects'/.test(read('tools/dist.mjs')));

console.log('\n' + '═'.repeat(74));
if (fail === 0) {
  console.log('  النتيجة: ✅ ' + pass + ' فحصاً ناجحاً | 0 فاشل');
  console.log('  الصفحة محظورة على الموقع · الأدوات تعمل محلياً · _redirects سليم');
} else {
  console.log('  النتيجة: ❌ ' + pass + ' ناجح | ' + fail + ' فاشل');
  console.log('\n  المشاكل:');
  problems.forEach((p) => console.log('   • ' + p));
}
console.log('═'.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
