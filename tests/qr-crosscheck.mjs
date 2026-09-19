#!/usr/bin/env node
/* ===========================================================================
 *  BRC — مطابقة مولّد الكيو آر كود مع مرجعين مستقلين
 *  ---------------------------------------------------------------------------
 *  1) مطابقة المصفوفة خلية-بخلية مع التنفيذ المرجعي qrcode-generator (MIT)
 *     (مع تثبيت القناع الثمانية لاستثناء اختلاف اختيار القناع الجمالي)
 *  2) فك ترميز فعلي لكل رمز بمُفكِّك jsQR (مستقل تماماً عن مولّدنا)
 *
 *  يتطلب حزمتي التطوير (اختيارية):
 *      npm i -D qrcode-generator jsqr
 *  التشغيل:  node tests/qr-crosscheck.mjs
 * =========================================================================== */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const QR = require(resolve(ROOT, 'assets/js/qr.js'));

let ref = null, jsQR = null;
try { ref = require('qrcode-generator'); } catch { }
try { jsQR = require('jsqr'); } catch { }
jsQR = jsQR && (typeof jsQR === 'function' ? jsQR : (jsQR.default || jsQR.jsQR));

if (!ref || !jsQR) {
  console.log('\n⚠  حزم التحقق غير مثبّتة. نفّذ:  npm i -D qrcode-generator jsqr\n');
  console.log('   (الاختبارات الذاتية المتوفرة دائماً:  node tests/qr-report.mjs )\n');
  process.exit(0);
}

/* نسخة مرجعية تدعم UTF-8 (qrcode_UTF8.js) */
function refFactory() {
  // نقرأ ملفات الحزمة من مجلدها مباشرة (متوافق مع اختلاف تنظيم الحزم بين الإصدارات)
  const mainPath = require.resolve('qrcode-generator');
  const dir = dirname(mainPath);
  const src = readFileSync(mainPath, 'utf8');
  const utf8 = readFileSync(resolve(dir, 'qrcode_UTF8.js'), 'utf8');
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', src + '\n' + utf8 + '\nmodule.exports = qrcode;');
  fn(mod, mod.exports);
  return mod.exports;
}
const refQR = refFactory();

function refMatrix(text, ec) {
  const q = refQR(0, ec); q.addData(text); q.make();
  const n = q.getModuleCount(), m = [];
  for (let r = 0; r < n; r++) { m.push([]); for (let c = 0; c < n; c++) m[r].push(q.isDark(r, c) ? 1 : 0); }
  return m;
}
function matrixToImage(isDark, n, scale = 4, quiet = 4) {
  const size = (n + quiet * 2) * scale, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const mr = Math.floor(y / scale) - quiet, mc = Math.floor(x / scale) - quiet;
    const dark = (mr >= 0 && mr < n && mc >= 0 && mc < n) ? isDark(mr, mc) : false;
    const v = dark ? 0 : 255, i = (y * size + x) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

const samples = [
  'BRC-000120',
  'BRC-1042',
  'https://brc-babil.com/verify?form=BRC-000120',
  'https://brc-babil.com/verify?form=BRC-NO-000120&t=9f2b1c3d',
  'شركة الهدف للتوظيف',
  'حلة - شارع 60 - قرب مدينة حمورابي - قرب مجمع الكرعاوي',
  'BRC-1042|محمد علي حسين|07760058007',
  JSON.stringify({ s: 'BRC-NO-000120', a: ['BRC-1042', 'BRC-1043'], n: 'علي حسين محمد' }),
  'A'.repeat(300),
  'x'.repeat(1200),
  '0123456789'.repeat(20),
  'مرحبا'.repeat(60)
];
const levels = ['L', 'M', 'Q', 'H'];

let exact = 0, maskOnly = 0, hardFail = 0, decoded = 0, decodeFail = 0;

console.log('\n— 1) مطابقة المصفوفة مع qrcode-generator (مع تثبيت القناع) —');
for (const s of samples) for (const lv of levels) {
  const r = refMatrix(s, lv), n = r.length;
  let matched = -1;
  for (let mask = 0; mask < 8; mask++) {
    const m = QR.encode(s, lv, mask);
    if (m.getModuleCount() !== n) continue;
    let ok = true;
    for (let row = 0; row < n && ok; row++) for (let col = 0; col < n; col++) {
      if ((m.isDark(row, col) ? 1 : 0) !== r[row][col]) { ok = false; break; }
    }
    if (ok) { matched = mask; break; }
  }
  if (matched >= 0) {
    exact++;
    if (QR.encode(s, lv).maskPattern !== matched) maskOnly++;
  } else {
    hardFail++;
    console.log('  ❌ اختلاف حقيقي: ' + lv + ' | ' + JSON.stringify(s.slice(0, 40)));
  }
}
console.log('  ✅ مطابقة تامة: ' + exact + ' / ' + (samples.length * levels.length) +
  (maskOnly ? '  (منها ' + maskOnly + ' حالة اختار مولّدنا قناعاً مختلفاً — وكلاهما صحيح وقابل للمسح)' : ''));
console.log('  ' + (hardFail ? '❌' : '✅') + ' حالات اختلاف حقيقي: ' + hardFail);

console.log('\n— 2) فك ترميز فعلي بمُفكِّك jsQR —');
for (const s of samples) for (const lv of levels) {
  const m = QR.encode(s, lv), n = m.getModuleCount();
  const scale = n < 60 ? 4 : (n < 100 ? 3 : 2);
  const img = matrixToImage((r, c) => m.isDark(r, c), n, scale, 4);
  const code = jsQR(img.data, img.width, img.height);
  if (code && code.data === s) decoded++;
  else { decodeFail++; console.log('  ❌ فشل فك: ' + lv + ' | ' + JSON.stringify(s.slice(0, 40))); }
}
console.log('  ✅ فك ترميز ناجح: ' + decoded + ' / ' + (samples.length * levels.length) + '   |   ❌ فاشل: ' + decodeFail);

/* اختبار عشوائي موسّع */
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.:/?#&=%+ ابجديةعربية٠١٢٣٤٥٦٧٨٩';
let rok = 0, rbad = 0;
const N = Number(process.argv[2] || 400);
for (let t = 0; t < N; t++) {
  const len = 1 + Math.floor(Math.random() * 400);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  const lv = levels[t % 4];
  try {
    const m = QR.encode(s, lv), n = m.getModuleCount();
    const scale = n < 60 ? 4 : (n < 100 ? 3 : 2);
    const img = matrixToImage((r, c) => m.isDark(r, c), n, scale, 4);
    const code = jsQR(img.data, img.width, img.height);
    if (code && code.data === s) rok++; else rbad++;
  } catch (e) { rbad++; }
}
console.log('\n— 3) اختبار عشوائي موسّع (' + N + ' رمز عشوائي بطول 1..400 بايت) —');
console.log('  ✅ نجح: ' + rok + '   |   ❌ فشل: ' + rbad);

const failed = hardFail + decodeFail + rbad;
console.log('\n' + (failed ? '❌ النتيجة النهائية: توجد إخفاقات (' + failed + ')' : '✅ النتيجة النهائية: مطابقة كاملة وقابلية مسح 100%') + '\n');
process.exit(failed ? 1 : 0);
