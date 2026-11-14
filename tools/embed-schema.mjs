#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — تضمين مخطط القاعدة داخل restore.html
   ---------------------------------------------------------------------------
   ⚠ لماذا تضمين لا قراءة؟

   صفحة الاسترجاع تعمل من `file://` بلا شبكة — هذا شرطها الأساسي (المالك
   يفتحها بعد انقطاع الموقع). و`fetch('docs/schema.sql')` يفشل هناك دائماً
   بسبب سياسة CORS للملفات المحلية.

   فالمخطط يُحقن كنص داخل الصفحة عند البناء. وإن لم يُحقن، ينزل الملف من
   المستودع يدوياً — الزر نفسه يقول ذلك بدل أن يفشل بصمت.

   ⚠ الفحص الأمني قبل الحقن:

   هذا الملف يُنشر على الإنترنت. لا يجوز أن يحمل:
     • مفتاح مشروع (anon/service_role) — أي JWT يبدأ بـeyJ
     • كلمة مرور أو سرّ مكتوب
     • بيانات عملاء

   المخطط الحالي نظيف: لا مفاتيح، و`app.brc_secret` يُشار إليه كتعليمة
   فقط ويُضبط يدوياً في القاعدة. لكن الفحص يمنع أن يدخل سرّ لاحقاً سهواً.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA = 'docs/schema.sql';
const PAGE = 'restore.html';
const MARK_START = '<!-- SCHEMA-EMBED:START -->';
const MARK_END = '<!-- SCHEMA-EMBED:END -->';

const schema = readFileSync(root + SCHEMA, 'utf8');

/* ═══ فحص أمني: لا أسرار تُنشر ═══════════════════════════════════════════ */
const RISKS = [
  [/eyJ[A-Za-z0-9_-]{20,}/, 'مفتاح JWT (anon أو service_role)'],
  [/postgres(?:ql)?:\/\/[^\s'"`]*:[^\s'"`]*@/, 'رابط قاعدة فيه كلمة مرور'],
  [/\bservice_role\b\s*[:=]\s*['"][^'"]{10,}/i, 'مفتاح service_role مكتوب'],
  [/\bpassword\s*[:=]\s*['"][^'"]{4,}/i, 'كلمة مرور مكتوبة']
];

const found = RISKS.filter(([re]) => re.test(schema)).map(([, why]) => why);

/* تعليمات ضبط السرّ مقبولة — نص التعليمة ليس سرّاً */
const placeholders = (schema.match(/app\.brc_secret\s*=\s*'<[^>]*>'/g) || []).length;

if (found.length) {
  console.error('❌ رُفض التضمين — المخطط يحتوي ما لا يُنشر:');
  found.forEach((f) => console.error('   • ' + f));
  console.error('\n   هذا الملف يُقدَّم للمتصفح. أزل السرّ أولاً.');
  process.exit(1);
}

console.log(`✓ فحص أمني: لا مفاتيح ولا كلمات مرور (${placeholders} تعليمة ضبط سرّ — نصّية فقط)`);

/* ═══ الحقن ══════════════════════════════════════════════════════════════ */
const pagePath = root + PAGE;
let page = readFileSync(pagePath, 'utf8');

/* ⚠ HTML لا يسمح بـ`</script>` داخل سكربت، ولا بـ`<!--` — كلاهما ينهي
   الكتلة مبكراً أو يفسد التحليل. JSON.stringify لا يهرّبهما. نستبدلهما
   بتسلسل مكافئ بعد فكّ الترميز في JS. */
function jsStringSafe(text) {
  return JSON.stringify(text)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\u0021--')
    .replace(/<script/gi, '<\\u003cscript');
}

/* ═══ فحص البوابة: هل الصفحة تحمي التضمين من الزائر؟ ═══════════════════════
   ⚠ ما تفعله هذه البوابة وما لا تفعله — بصراحة:

   المتصفح يستطيع قراءة source الصفحة قبل تنفيذ أي جافاسكربت، فمن يعرف
   الرابط يقرأ المخطط الخام. لذلك البوابة **ليست** حدّاً أمنياً للخادم، وحدّ
   الأسرار الحقيقي يبقى في القاعدة (المفتاح المنشور لا يفتح جدولاً).

   لكنها تُغلق مسارين واقعيين: عرض المخطط في نصّ الصفحة لمن يفتحها، وفتح
   أي ملف نسخة احتياطية من متصفح لا يملك صلاحية. ولهذا نتحقق من وجودها:
   لو حُذفت يوماً، يفشل البناء ولا يُنشر ملف يظنّ المالك أنه محمي. */
const pageSrc = readFileSync(root + PAGE, 'utf8');
/* ⚠️ نفحص **وسم السكربت** لا ذكر المسار: الصفحة تشرح البوابة في تعليق
   HTML يذكر مسارها، فـ`includes(path)` كان ينجح ولو حُذف الوسم فعلاً —
   فيُضمَّن المخطط بلا حماية ويظنّ المالك أنه محمي. (قِيس: حذف الوسم مرّ.) */
const gateScript = /<script[^>]+src="assets\/js\/restore-gate\.js"/.test(pageSrc);
const gateElem = /id="rp-gate"/.test(pageSrc);
if (!gateScript || !gateElem) {
  console.error('❌ رُفض التضمين — الصفحة تحمل مخطط القاعدة بلا بوابة مدير:');
  console.error('   • سكربت البوابة: ' + (gateScript ? 'موجود' : 'غائب (assets/js/restore-gate.js)'));
  console.error('   • عنصر البوابة: ' + (gateElem ? 'موجود' : 'غائب (#rp-gate)'));
  console.error('\n   المخطط يُنشر على الإنترنت. أعد البوابة أو لا تُضمّن.');
  process.exit(1);
}

/* ═══ الإخفاء من النشر (2026-11-13) ═════════════════════════════════════════
   ⚠️ لماذا المخطط **لا** يُحمَّل عند التحميل؟

   النشر على Cloudflare Pages من جذر المستودع (`Build output = .`, بلا أمر
   بناء)، فكل ملف في المستودع — ومنه `restore.html` — يُقدَّم للعالم على
   `<domain>/restore.html`. وبوابة المدير تحمي الواجهة لا الملف: من يقرأ
   source الصفحة يقرأ الـ150 ك.ب الخام قبل تنفيذ أي جافاسكربت.

   فالحل: المخطط يبقى **مكتوباً في الملف** (تحتاجه الأداة عند الكوارث) لكنه
   يُخزَّن في بيانات لا في متغيّر عام، ولا يُفكّ إلا على `file://`.

     <script type="text/plain" id="hrc-schema-embed" disabled>…</script>

   • `type="text/plain"` ⇒ المتصفح لا ينفّذه، فلا يصير `window.__HRC_SCHEMA_SQL__`
     موجوداً في نافذة أي زائر. زرّ التنزيل لا يجد شيئاً.
   • `disabled` للتأكيد المزدوج (بعض الأدوات تتجاهل `type`).
   • على `file://` تنسخ البوابة محتوى الوسم إلى المتغيّر فيعمل كل شيء كما كان.

   ⚠️ يبقى النص مقروءاً في source الصفحة على الموقع. هذا **بند معروف** لا
   يُخفيه أي حل داخل المتصفح؛ الحلّ الحقيقي هو Cloudflare Access أو إيقاف
   النشر. التوثيق يقول ذلك صريحاً ولا يدّعي أكثر. */
const block = MARK_START + '\n' +
  '<script type="text/plain" id="hrc-schema-embed" disabled>' +
  jsStringSafe(schema) + '</script>\n' +
  MARK_END;

/* استبدال الكتلة القديمة إن وُجدت، وإلا إدراجها قبل سكربتات الصفحة */
const re = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END);
/* ⚠ دالة لا نص: النص يُفسَّر فيه `$$` و`$'` كأنماط استبدال، والمخطط مليء
   بـ`do $$ ... $$` — فكان الحقن يمحو أجزاء من الملف. */
if (re.test(page)) {
  page = page.replace(re, () => block);
} else {
  const anchor = '<script src="assets/js/portable-backup.js"></script>';
  if (!page.includes(anchor)) {
    console.error('❌ لم أجد نقطة الإدراج في ' + PAGE);
    process.exit(1);
  }
  page = page.replace(anchor, () => block + '\n' + anchor);
}

writeFileSync(pagePath, page);
console.log(`✓ ضُمّن المخطط في ${PAGE} (${(schema.length / 1024).toFixed(1)} ك.ب)`);
console.log(`  الصفحة الآن: ${(page.length / 1024).toFixed(1)} ك.ب`);
