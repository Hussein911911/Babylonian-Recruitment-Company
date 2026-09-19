#!/usr/bin/env node
/* ===========================================================================
 *  BRC — تقرير مولّد الكيو آر كود (بدون أي حزم خارجية)
 *  يشغّل الاختبارات الذاتية ويعرض جدول السعات ونماذج من رموز الاستمارات.
 *  التشغيل:  node tests/qr-report.mjs
 * =========================================================================== */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const QR = require(resolve(ROOT, 'assets/js/qr.js'));

console.log('\n═'.repeat(32));
console.log('  تقرير مولّد الكيو آر كود — شركة الهدف للتوظيف (BRC)');
console.log('═'.repeat(32) + '\n');

/* 1) الاختبارات الذاتية */
const rep = QR.selfTest();
rep.results.forEach((r) => console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')));
console.log('\n  النتيجة: ' + rep.passed + '/' + rep.total + (rep.failed ? ' — يوجد إخفاق!' : ' — كل الاختبارات ناجحة'));

/* 2) جدول السعة لكل مستوى تصحيح */
console.log('\n— السعة القصوى (بايت) حسب مستوى تصحيح الخطأ —');
const versions = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 35, 40];
console.log('  النسخة |  الأبعاد  |    L    |    M    |    Q    |    H');
versions.forEach((v) => {
  const size = v * 4 + 17;
  const row = ['L', 'M', 'Q', 'H'].map((lv) => String(new QR.model(v, lv).byteCapacity()).padStart(7)).join(' |');
  console.log('   ' + String(v).padStart(4) + '  | ' + String(size + '×' + size).padStart(8) + ' |' + row);
});

/* 3) نموذج عملي: روابط التحقق وقياسات الرمز */
console.log('\n— نماذج فعلية من روابط التحقق —');
const samples = [
  'BRC-NO-000120',
  'https://brc-babil.com/verify?form=BRC-NO-000120&t=a1b2c3d4',
  'BRC-1042|BRC-1043|BRC-1044|BRC-1045|BRC-1046|BRC-NO-000120',
  'شركة الهدف للتوظيف — حلة شارع 60'
];
samples.forEach((s) => {
  const m = QR.encode(s, 'M');
  const svg = QR.renderSVG(m, { margin: 2, size: 200 });
  console.log('  • "' + (s.length > 52 ? s.slice(0, 52) + '…' : s) + '"');
  console.log('    النسخة ' + m.version + ' — ' + m.getModuleCount() + '×' + m.getModuleCount() +
    ' وحدة — قناع ' + m.maskPattern + ' — القناع يُختار تلقائياً لتقليل أخطاء القراءة');
  console.log('    SVG: ' + (svg.length / 1024).toFixed(1) + ' KB — ' + (svg.match(/<path/g) || []).length + ' مسار');
});

console.log('\n— ملاحظة تقنية —');
console.log('  • تنفيذ مستقل بلا أي مكتبة خارجية (يعمل بدون إنترنت وفي الملف المستقل).');
console.log('  • مطابقة المعيار ISO/IEC 18004 (QR Model 2) لجميع النسخ 1..40 والمستويات L/M/Q/H.');
console.log('  • تمّ التحقق عبر: (1) اختبارات هندسية ذاتية، (2) مطابقة مصفوفة كاملة مع تنفيذ مرجعي،');
console.log('    (3) فك ترميز فعلي بمُفكِّك مستقل لـ 600+ رمز عشوائي. نفّذ: node tests/qr-crosscheck.mjs\n');
process.exit(rep.failed ? 1 : 0);
