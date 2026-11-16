/* ═══════════════════════════════════════════════════════════════════════════
   دليل دائم لعطل بلاغ المالك (2026-11-15):
   «أكتب رمز النسخة وأنزّلها، وأجي أقرأها وأفكّ التشفير بنفس الرمز يقول خطأ».

   القاعدة التي نُثبتها: النسخة التي تُكتب على الـUSB يجب أن تُفتح بنفس
   الكلمة، مهما كان شكل الرمز أو الملف. وإن تعذّر ذلك — يُرفض التسليم.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
globalThis.window = globalThis;
new Function(readFileSync('assets/js/portable-backup.js', 'utf8'))();
const PB = globalThis.HRCPortableBackup;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

/* حمولة تشبه الواقع: عربية ثقيلة + محارف نادرة + حجم معقول */
function fixture(n) {
  return {
    format: 3,
    counts: { jobs: 22, applicants: n, attempts: n * 2, audit: 40 },
    applicants: Array.from({ length: n }, (_, i) => ({
      serial: 'HRC-BC-' + String(i).padStart(6, '0'),
      full_name: 'حسين كاظم عبد الله ' + i,
      phone: '0770123' + String(4560 + i),
      address: 'الحلة — شارع ٤٠ · مبنى ' + i,
      notes: '「' + i + '」 ✓ ★ 𠜎'
    }))
  };
}

const PASSWORDS = [
  ['عربية', 'المفتاح-السري-الطويل'],
  ['لاتينية ورموز', 'MyPass2026!#$%^&*'],
  ['فيها مسافة داخلية', 'كلمة مرور فيها مسافة'],
  ['عشر «a»', 'aaaaaaaaaa'],
  ['أرقام عربية-هندية', 'كلمة-سر-١٢٣٤٥٦'],
  ['طويلة جدا ٦٤', 'x'.repeat(32) + 'ي'.repeat(32)]
];

console.log('\n═══ ١) الرمز نفسه: يُشفّر ويُفكّ بلا استثناء ═══');
for (const [label, pw] of PASSWORDS) {
  try {
    const env = await PB.seal(fixture(3), pw);
    const { payload } = await PB.open(JSON.stringify(env), pw);
    ok(label, payload.applicants.length === 3);
  } catch (e) { ok(label, false, e.message.slice(0, 50)); }
}

/* ⚠️ تصحيح ذاتي 2026-11-16: اكتشفتُ أن هذا الفحص كان **ضعيفاً**.
   `String.prototype.trim()` تُزيل BOM أصلاً (U+FEFF من فئة WhiteSpace)،
   فحذف سطر إزالة BOM من الشيفرة لم يُسقط أي فحص — أي أن الاختبار لم يكن
   يختبر ما يدّعيه. والسبب أن `cleanText` تبدأ بـ`replace` ثم `trim`،
   فـ`trim` تلتقط BOM بالنيابة.
   ما يهمّ فعلاً: أن أيّاً من هذه الأشكال **لا يمنع الفتح**. وهذا ما نفحصه
   صراحةً هنا — مع إدخال علامة اتجاه مخفية (U+200F) التي **لا** تُزيلها
   `trim`، وهي الحالة التي تحتاج السطر الصريح فعلاً. */
console.log('\n═══ ٢) الملف بعد الكتابة/النقل (هنا كان العطل) ═══');
const pw = 'المفتاح-السري-الطويل';
const env = await PB.seal(fixture(5), pw);
const good = JSON.stringify(env);

const SHAPES = [
  ['نصّ سليم', good],
  ['BOM في الأول', '\uFEFF' + good],
  ['BOM + CRLF', '\uFEFF' + good.replace(/\n/g, '\r\n')],
  ['مسافة في الأول', '   ' + good],
  ['سطر جديد في الآخر', good + '\n'],
  ['BOM + مسافات + سطر جديد', '\uFEFF \n' + good + '\r\n\n'],
  ['علامة اتجاه مخفية (RTL mark)', '\u200F' + good],
  ['علامة اتجاه + BOM + CRLF معاً', '\u200F\uFEFF' + good.replace(/\n/g, '\r\n') + '\r\n']
];
for (const [label, text] of SHAPES) {
  try {
    const { payload } = await PB.open(text, pw);
    ok(label, payload.applicants.length === 5);
  } catch (e) { ok(label, false, e.message.slice(0, 50)); }
}

console.log('\n═══ ٣) الملف التالف يُرفض ولا يُعطي بيانات كاذبة ═══');
const truncated = good.slice(0, Math.floor(good.length * 0.7));
try {
  await PB.open(truncated, pw);
  ok('ملف مبتور يُرفض', false, 'قُبل ملف ناقص!');
} catch (e) { ok('ملف مبتور يُرفض', true); }

try {
  await PB.open('ملف نصّي عادي وليس نسخة', pw);
  ok('ملف غريب يُرفض', false, 'قُبل ملف ليس نسخة!');
} catch (e) { ok('ملف غريب يُرفض', true); }

console.log('\n═══ ٤) الرمز الخاطئ يُرفض، ولا يُخلط بينه وبين الملف التالف ═══');
try {
  await PB.open(good, 'رمز-آخر-تماما-١٢٣');
  ok('رمز خاطئ يُرفض', false, 'قُبل رمز خاطئ!');
} catch (e) {
  ok('رمز خاطئ يُرفض', true);
  ok('الرسالة تذكر احتمالين لا اتهاماً واحداً',
     e.message.includes('كلمة المرور') && e.message.includes('الملف'),
     e.message.slice(0, 60));
  ok('الرسالة تطبع أرقاماً للتشخيص (طول/بايتات)', /الطول \d+/.test(e.message), e.message.slice(0, 80));
}

console.log('\n═══ ٥) حجم واقعي كامل (٧٢٤ بطاقة) ═══');
const big = fixture(724);
big.counts.attempts = 1448;
try {
  const t0 = Date.now();
  const bigEnv = await PB.seal(big, pw);
  const text = JSON.stringify(bigEnv);
  const { payload } = await PB.open(text, pw);
  ok('٧٢٤ بطاقة تُفتح', payload.applicants.length === 724);
  ok('الحجم معقول', text.length > 100000, (text.length / 1024).toFixed(0) + ' ك.ب');
  console.log('     ⏱  ' + ((Date.now() - t0) / 1000).toFixed(1) + ' ثانية · ' +
              (text.length / 1024).toFixed(0) + ' ك.ب');
} catch (e) { ok('٧٢٤ بطاقة تُفتح', false, e.message.slice(0, 60)); }

console.log('\n═══ ٦) فحص ذاتي: النسخة لا تُسلَّم إن لم تُفتح ═══');
const src = readFileSync('assets/js/recovery.js', 'utf8');
ok('حارس الفحص الذاتي موجود في صفحة التنزيل',
   src.includes('selfCheck') && src.includes('لا تُفتح بنفس كلمة المرور'));
/* نقيس داخل مسار التنزيل نفسه: موضع seal ثم الحارس ثم الكتابة.
   (‏indexOf للاسم وحده يلتقط تعريف الدالة في أعلى الملف — لا الاستدعاء.) */
const iSeal = src.indexOf('var env=await PB.seal(');
const iGuard = src.indexOf('selfCheck');
const iWrite = src.indexOf('usbTargetFile(handle,name)', iSeal);
ok('الحارس يأتي بعد التشفير وقبل الكتابة على الـUSB',
   iSeal > -1 && iGuard > iSeal && iWrite > iGuard,
   `seal=${iSeal} guard=${iGuard} write=${iWrite}`);

console.log('\n═══ ٧) صفحة الاستعادة تتقبّل مسافة زائدة في الرمز ═══');
const rp = readFileSync('assets/js/restore-page.js', 'utf8');
ok('محاولة ثانية بعد قصّ المسافات', rp.includes('cleaned') && rp.includes('PB.open(state.envelope, cleaned)'));
ok('تُخبر المستخدم أن السبب مسافة لا رمز خاطئ', rp.includes('مسافة زائدة'));

console.log('\n' + '─'.repeat(60));
console.log(fail === 0
  ? `✅ كل الفحوص نجحت — ${pass} فحصاً · لا فشل`
  : `❌ ${fail} فشل من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
