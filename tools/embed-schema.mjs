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

const block = MARK_START + '\n' +
  '<script id="hrc-schema-embed">window.__HRC_SCHEMA_SQL__ = ' +
  jsStringSafe(schema) + ';</script>\n' +
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
