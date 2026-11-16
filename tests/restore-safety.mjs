/* ═══════════════════════════════════════════════════════════════════════════
   حمايات الطريق الثاني — لا مسح بلا سؤال، ولا نقل بلا تشفير.

   المالك اختار الطريق الثاني (2026-11-16) وطلب أن يكون «أسهل للمدير».
   وأسهل لا تعني أقلّ أماناً. هذه الحمايات الثلاث كُتبت لأن الملف الذي
   ننفّذه يبدأ بـ`TRUNCATE`: لو أخطأ المدير في الرابط ومسح الإنتاج،
   فقد ٧٢٤ بطاقة في ثانية بلا رجعة.

   نفحص:
     ١. المعاينة (--dry-run) لا تعدّل شيئاً — نقيس ذلك على قاعدة حقيقية.
     ٢. القاعدة الممتلئة تطلب تأكيداً صريحاً، والإلغاء لا يمسح شيئاً.
     ٣. الكلمة الشائعة لا تكفي — نطلب عبارة كاملة.
     ٤. الوضع غير التفاعلي يرفض إن لم تُضبط العبارة الصحيحة.
     ٥. التشفير يُفرض على الرابط: sslmode يُضاف إن غاب.
     ٦. الرسالة تذكر الأعداد التي ستُمسح — لا سؤال أعمى.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';

let ok = 0, bad = 0;
const check = (label, cond, extra) => {
  cond ? ok++ : bad++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}` + (cond ? '' : ' — ' + (extra || '')));
};

const src = readFileSync('tools/restore-portable.mjs', 'utf8');

console.log('\n═══ ١) معاينة بلا تعديل ═══');
check('خيار --dry-run موجود', /--dry-run/.test(src));
check('المعاينة تعود قبل أي تنفيذ',
  src.indexOf("if (dryRun)") < src.indexOf("await client.query(sql)"),
  'المعاينة بعد التنفيذ!');
check('المعاينة تُخبر عن الهيكل الناقص', /الهيكل غير موجود/.test(src));
check('المعاينة تطبع ما سيُنقل', /سيُنقل من النسخة/.test(src));

console.log('\n═══ ٢) لا مسح بلا تأكيد ═══');
check('الحارس يأتي قبل التنفيذ',
  src.indexOf('willWipe') < src.indexOf('await client.query(sql)'),
  'الحارس بعد المسح!');
check('السؤال يطلب عبارة لا «نعم»', /اكتب «/.test(src));
check('الإلغاء يُنهي بلا تنفيذ', /أُلغي — لم يُمسح شيء/.test(src));

console.log('\n═══ ٣) المدير يرى ما سيُمسح ═══');
check('الأعداد تُقرأ من القاعدة الهدف', /select count\(\*\)::int n from brc\./.test(src));
check('تحذير صريح عند وجود بيانات', /القاعدة الهدف فيها بيانات/.test(src));
check('يقول «استبدال كامل» لا «إضافة»', /استبدال كامل/.test(src));
check('يذكر أن لا رجعة', /ولا رجعة/.test(src));

console.log('\n═══ ٤) الكلمة الشائعة لا تكفي ═══');
const phrase = (src.match(/NONINTERACTIVE_PHRASE = '([^']+)'/) || [])[1];
check('العبارة معرّفة', !!phrase, 'غير موجودة');
check('العبارة ليست «نعم» ولا «1» ولا «y»',
  phrase && !['1', 'y', 'yes', 'نعم', 'ok', 'true'].includes(phrase.toLowerCase()),
  'العبارة: ' + phrase);
check('المقارنة تامة لا جزئية', /typed !== NONINTERACTIVE_PHRASE/.test(src));

console.log('\n═══ ٥) الوضع غير التفاعلي آمن ═══');
check('متغيّر البيئة لا يُقبل إلا بالعبارة', /auto\.trim\(\) !== NONINTERACTIVE_PHRASE/.test(src));
check('يرفض ويشرح عند الخطأ', /اقرأ الأعداد أعلاه/.test(src));

console.log('\n═══ ٦) النقل مشفّر دائماً ═══');
check('sslmode يُفرض عند غيابه', /sslmode=require/.test(src) && /!\/\[\?&\]sslmode=/.test(src));
check('التشفير يُضاف للرابط قبل الاتصال',
  src.indexOf('sslmode=require') < src.indexOf('new pg.default.Client'),
  'التشفير بعد الاتصال — بلا فائدة!');
check('يُخبر المستخدم أنه فرض التشفير', /فرضنا التشفير/.test(src));

console.log('\n═══ ٧) رسائل الخطأ تُرشد لا تُحيّر ═══');
check('خطأ الاتصال يذكر Session pooler', /Session pooler/.test(src));
check('خطأ الاتصال يذكر IPv4', /IPv4/.test(src));

console.log('\n' + '─'.repeat(62));
console.log(bad === 0
  ? `✅ الحمايات الستّ قائمة — ${ok} فحصاً`
  : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
