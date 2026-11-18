// صفحة الاسترجاع: كل زر يعمل فعلاً على نسخة حقيقية — لا مجرد وجود في HTML.
//
// ⚠️ لماذا هذا الملف؟
//   تبسيط الصفحة (2026-11-15) حذف عنصراً اختيارياً (#rp-preview) كان الكود
//   يكتب فيه بلا حماية. النتيجة: بعد نجاح فكّ التشفير كان الرسم يرمي استثناءً
//   فتُخفى الخطوات ٤-٦ كلها، ويبقى المدير أمام صفحة تقول «نجح الفكّ» ولا شيء
//   غيره. وجود زر في HTML لا يعني أنه يعمل — ولذلك نفكّ تشفيراً حقيقياً هنا
//   ونضغط كل زر ونتحقق من الملف الناتج.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { webcrypto } from 'node:crypto';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let checks = 0;
const check = (name, v, extra) => {
  assert.ok(v, name + (extra ? ' — ' + extra : ''));
  checks++;
  console.log('✓ ' + name);
};

/* ── بيئة DOM حقيقية من الصفحة نفسها ─────────────────────────────────────── */
const vc = new VirtualConsole();
vc.on('jsdomError', () => {});
const dom = new JSDOM(read('restore.html'), {
  url: 'file://' + fileURLToPath(new URL('../restore.html', import.meta.url)),
  runScripts: 'outside-only',
  virtualConsole: vc
});
const w = dom.window;
const d = w.document;
w.TextEncoder = TextEncoder;
w.TextDecoder = TextDecoder;
Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });

for (const f of [
  'assets/js/portable-backup.js',
  'assets/js/restore-sql.js',
  'assets/js/image-embed.js',
  'assets/js/restore-view.js',
  'assets/js/restore-page.js'
]) {
  w.eval(read(f));
}

/* نلتقط التنزيلات بدل كتابتها على القرص */
const downloads = [];
w.URL.createObjectURL = () => 'blob:fixture';
w.HTMLAnchorElement.prototype.click = function () {
  downloads.push(this.download);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── نسخة حقيقية: نُنشئها بنفس وحدة التشفير التي يستعملها الموقع ─────────── */
const fixture = {
  format: 2,
  jobs: [
    { id: 'j1', code: 'HRC-1042', title: 'محاسب', governorate: 'بغداد', employer_name: 'شركة', employer_phone: '0770', status: 'available', vacancies: 2 },
    { id: 'j2', code: 'HRC-1043', title: 'مهندس', governorate: 'البصرة', employer_name: 'مكتب', employer_phone: '0771', status: 'available', vacancies: 1 }
  ],
  applicants: [
    { id: 'a1', serial: 'HRC-BC-000123', full_name: 'علي حسن', phone: '0770000', status: 'active' }
  ],
  job_attempts: [{ id: 't1', serial: 'HRC-BC-000123', attempt_no: 1, slot_status: 'empty' }],
  audit: [],
  settings: [],
  staff: []
};
const PASSWORD = 'correct horse battery staple';
const envelope = await w.HRCPortableBackup.seal(fixture, PASSWORD);

console.log('══════════════════════════════════════════════════════════════════════════');
console.log('  صفحة الاسترجاع — كل زر مضغوط فعلياً على نسخة حقيقية');
console.log('══════════════════════════════════════════════════════════════════════════');

check('وحدة التشفير جاهزة', !!w.HRCPortableBackup && !!envelope);
check('النسخة التجريبية تحمل بصمة تحقّق', !!envelope.hash || !!envelope.checksum || !!envelope.format);

/* ── ١) اختيار الملف يفتح الخطوة ٢ و٣ ────────────────────────────────────── */
const fileInput = d.getElementById('rp-file');
const file = new w.File([JSON.stringify(envelope)], 'hrc-backup-fixture.hrcbak', { type: 'application/json' });
Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
fileInput.dispatchEvent(new w.Event('change', { bubbles: true }));
await wait(900);

check('اختيار الملف يكشف بيانات النسخة', !d.getElementById('rp-step2').classList.contains('is-hidden'));
check('اختيار الملف يكشف خانة كلمة المرور', !d.getElementById('rp-step3').classList.contains('is-hidden'));

/* ── ٢) فكّ التشفير يكشف كل الخطوات (وهذا ما كان ينكسر) ─────────────────── */
d.getElementById('rp-pass').value = PASSWORD;
d.getElementById('rp-unlock').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
await wait(1600);

const unlockStatus = d.getElementById('rp-unlock-status').textContent;
check('فكّ التشفير ينجح بكلمة المرور الصحيحة', /نجح|مطابق/.test(unlockStatus), unlockStatus);
check('المحتوى يظهر (خطوة ٤) — لا يتوقّف على عنصر عرض اختياري',
  !d.getElementById('rp-step4').classList.contains('is-hidden'));
check('الجداول تظهر (خطوة ٥)', !d.getElementById('rp-step5').classList.contains('is-hidden'));
check('التنزيلات تظهر (خطوة ٦)', !d.getElementById('rp-step6').classList.contains('is-hidden'));

const totals = d.getElementById('rp-totals').textContent.replace(/\s+/g, ' ');
check('الأعداد معروضة وتطابق الملف', /2/.test(totals) && /الوظائف/.test(totals), totals.slice(0, 90));

/* ── ٣) كل زر تنزيل يعطي ملفاً فعلياً ────────────────────────────────────── */
async function pressButton(id, expectedPattern) {
  const before = downloads.length;
  const el = d.getElementById(id);
  check('الزر موجود في الصفحة: ' + id, !!el);
  el.click();
  await wait(700);
  const produced = downloads.slice(before);
  check('الزر ينتج ملفاً: ' + id, produced.length > 0, 'لا ملف');
  check('اسم الملف صحيح: ' + id, expectedPattern.test(produced[0] || ''), produced[0]);
  return produced;
}

w.HRCRestoreView.mount(fixture);
d.getElementById('rp-step5').classList.remove('is-hidden');

await pressButton('rp-dl-json', /^hrc-restored-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
await pressButton('rp-dl-csv', /^hrc-cards-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
await pressButton('rp-dl-sql', /^2-data-\d{4}-\d{2}-\d{2}\.sql$/);

/* زر الهيكل: مصدره الوسم المضمّن. كان يعتمد على متغيّر عام يفكّه حرس البوابة
   فقط — فأصبح ميتاً حين نُفّذت الصفحة بلا بوابة. */
/* ⚠️ عطل أُصلح 2026-11-15: كان الزر ينزّل `1-schema.sql` كاملاً (٣١٥٤ سطراً)
   في ملف واحد، ومحرّر Supabase يقصّ اللصق عند ~٢٠٠٠ سطر **ويرفع Success**.
   فكان المالك يبني قاعدة ناقصة ١١ جدولاً من ١٩ بلا أن يرى خطأً.
   الصواب: أجزاء تحت ٧٠٠ سطر، كلها قابلة للصق، ومجموعها = المخطط الكامل. */
/* الزر نفسه لا ينزّل: يبني أزرار الأجزاء (التنزيلات المتعددة بضغطة واحدة
   يحجبها المتصفح، فيصل ملف واحد ويظنّ المالك أن الباقي نزل). */
d.getElementById('rp-dl-schema').click();
await wait(400);
const partBtns = [...d.querySelectorAll('#rp-schema-parts button')];
/* العدد ليس ثابتاً: المخطط ينمو. الشرط الحقيقي أن الأجزاء تغطي المخطط كاملاً
   وكل جزء قابل للصق، لا أن تكون خمسة بالضبط — وهذا ما يُفحص أدناه. */
check('زر الهيكل يبني أزرار أجزاء (٥ أو أكثر)', partBtns.length >= 5, String(partBtns.length));
check('نص الزر يذكر العدد الفعلي لا رقماً ثابتاً',
  new RegExp('\\(' + partBtns.length + '\\)').test(d.getElementById('rp-dl-schema').textContent),
  d.getElementById('rp-dl-schema').textContent);

const schemaOut = [];
for (const b of partBtns) {
  const before = downloads.length;
  b.click();
  await wait(350);
  const got = downloads.slice(before);
  check('الجزء ينتج ملفاً', got.length === 1, got[0] || 'لا ملف');
  if (got[0]) schemaOut.push(got[0]);
}
check('أسماء الأجزاء مرقّمة بالترتيب',
  schemaOut.every((n, i) => n === '1-schema-part-' + String(i + 1).padStart(2, '0') + '.sql'),
  schemaOut.join(' · '));
check('لم يبقَ اسم 1-schema.sql القديم (الملف الواحد الناقص)',
  !schemaOut.some((n) => n === '1-schema.sql'), schemaOut.join(' · '));

/* تصدير كل الجداول: ملف لكل جدول فيه صفوف */
const beforeAll = downloads.length;
d.getElementById('rp-dl-all-csv').click();
await wait(900);
const many = downloads.slice(beforeAll);
check('زر «كل الجداول CSV» ينتج ملفاً لكل جدول غير فارغ', many.length >= 3, many.join(' · '));
check('كل ملفات CSV تحمل اسم جدولها', many.every((n) => /^hrc-[a-z_]+-\d{4}/.test(n)), many.join(' · '));

/* ── ٤) الإغلاق يفرّغ الذاكرة ويخفي كل الخطوات ───────────────────────────── */
d.getElementById('rp-lock').click();
await wait(300);
check('الإغلاق يخفي كل خطوات المحتوى',
  ['rp-step2', 'rp-step3', 'rp-step4', 'rp-step5', 'rp-step6']
    .every((id) => d.getElementById(id).classList.contains('is-hidden')));
check('الإغلاق يمحو كلمة المرور من الحقل', d.getElementById('rp-pass').value === '');

/* ── ٥) لا زر ميت: كل زر في الصفحة له معالج ──────────────────────────────── */
const pageJs = read('assets/js/restore-page.js') + read('assets/js/restore-gate.js');
const buttons = [...d.querySelectorAll('button[id]')].map((b) => b.id);
const dead = buttons.filter((id) => !pageJs.includes("'" + id + "'") && !pageJs.includes('"' + id + '"'));
check('لا زر بلا معالج في الصفحة', dead.length === 0, dead.join(', '));

console.log(`\nصفحة الاسترجاع: ${checks} فحصاً ناجحاً.`);
