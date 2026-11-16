/* ═══════════════════════════════════════════════════════════════════════════
   دليل المالك: «أكتب رمز النسخة وأنزّلها، وأجي أقرأها وأفكّ التشفير بنفس
   الرمز يقول خطأ».

   هذا الاختبار يمرّ عبر **restore.html الحقيقية**، لا عبر الوحدة وحدها:
    ١. نُنشئ نسخة بكلمة مرور (كما تفعل صفحة التنزيل).
    ٢. نكتبها على القرص كما تُكتب فعلاً.
    ٣. نُعيد قراءتها **بالبايتات** كما يقرأها المتصفح عند اختيار الملف.
    ٤. نمرّرها على منطق الصفحة الحقيقي: inspect ← handleText ← open.
    ٥. نتحقق أن الوصول للخطوة ٤ يحدث وأن الأعداد مطابقة.

   ونُثبت أيضاً أن الأنماط الواقعية للملف (BOM من Notepad، CRLF، سطر زائد)
   لا تمنع الفكّ — وهذا هو العطل الذي كان قائماً.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

/* ── عالم المتصفح: WebCrypto حقيقي + DOM حقيقي من restore.html ─────────── */
const dom = new JSDOM(readFileSync('restore.html', 'utf8'), {
  url: 'https://fixture.test/restore.html',
  runScripts: 'outside-only'
});
const w = dom.window;
Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
w.HTMLElement.prototype.scrollIntoView = function () {};
/* jsdom ينقصه TextEncoder/TextDecoder داخل سياق النافذة */
w.TextEncoder = TextEncoder;
w.TextDecoder = TextDecoder;

/* نُحمّل الوحدات بنفس ترتيب الصفحة، مع كائن النافذة الحقيقي لـ jsdom
   حتى تُسجّل الوحدات نفسها في globalThis الصحيح (root = window). */
w.eval(readFileSync('assets/js/portable-backup.js', 'utf8'));
const PB = w.HRCPortableBackup;
check('وحدة التشفير حُمّلت في الصفحة', !!(PB && PB.seal && PB.open));

/* ── ١) نسخة حقيقية تُكتب على القرص ──────────────────────────────────── */
const PASSWORD = 'رمز-المدير-الطويل-٢٠٢٦';
const payload = {
  format: 3,
  counts: { jobs: 22, applicants: 724, attempts: 1448, audit: 3775 },
  jobs: Array.from({ length: 22 }, (_, i) => ({ id: i + 1, title: 'وظيفة ' + (i + 1) })),
  applicants: Array.from({ length: 724 }, (_, i) => ({
    serial: 'HRC-BC-' + String(i).padStart(6, '0'),
    full_name: 'باحث عن عمل رقم ' + (i + 1),
    phone: '0770' + String(100000 + i),
    address: 'الحلة — شارع ٤٠',
    status: i % 3 === 0 ? 'active' : 'frozen'
  }))
};
const env = await PB.seal(payload, PASSWORD);
const sealed = JSON.stringify(env);
const dir = mkdtempSync(join(tmpdir(), 'hrc-pass-'));
const realFile = join(dir, 'hrc-backup-2026-11-15-0900.hrcbak');
writeFileSync(realFile, sealed, 'utf8');
check('الملف كُتب على القرص', readFileSync(realFile, 'utf8').length === sealed.length);
check('الحجم واقعي (>١٠٠ ك.ب)', sealed.length > 100 * 1024, (sealed.length / 1024).toFixed(0) + ' ك.ب');

/* ── ٢) نُحمّل منطق صفحة الاستعادة الحقيقي ───────────────────────────── */
w.eval(readFileSync('assets/js/restore-page.js', 'utf8'));
check('منطق صفحة الاستعادة حُمّل', !!w.document.getElementById('rp-pass'));

/* FileReader في jsdom يعمل: نُمرّر الملف كما يفعل المتصفح تماماً */
const readAsBrowser = (path) => new Promise((res, rej) => {
  const fr = new w.FileReader();
  fr.onload = () => res(String(fr.result || ''));
  fr.onerror = () => rej(new Error('تعذّرت قراءة الملف'));
  fr.readAsText(new w.Blob([readFileSync(path)], { type: 'application/json' }), 'utf-8');
});

/* ── ٣) السيناريو الذي أبلغ عنه المالك، حرفياً ────────────────────────── */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => w.document.getElementById(id);

async function uploadFile(path) {
  const file = new w.File([readFileSync(path)], 'hrc-backup.hrcbak', { type: 'application/json' });
  Object.defineProperty($('rp-file'), 'files', { value: [file], configurable: true });
  $('rp-file').dispatchEvent(new w.Event('change', { bubbles: true }));
  /* ننتظر انتهاء FileReader فعلياً — لا نُفترض زمناً */
  for (let i = 0; i < 200 && $('rp-step2').classList.contains('is-hidden'); i++) await wait(10);
}

async function unlock(password) {
  $('rp-pass').value = password;
  $('rp-unlock').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 400; i++) {
    const done = !$('rp-step4').classList.contains('is-hidden') ||
                 $('rp-unlock-status').className.includes('is-error');
    if (done) break;
    await wait(10);
  }
  return {
    unlocked: !$('rp-step4').classList.contains('is-hidden'),
    message: $('rp-unlock-status').textContent,
    body: $('rp-step4').textContent
  };
}

console.log('\n═══ ١) النسخة الأصلية: الرمز نفسه يفتحها من الصفحة ═══');
await uploadFile(realFile);
check('الخطوة ٢ ظهرت بعد اختيار الملف (ملف صالح)',
      !$('rp-step2').classList.contains('is-hidden'),
      $('rp-file-status').textContent);
check('اسم الملف يظهر على الشاشة', $('rp-file-status').textContent.includes('hrc-backup.hrcbak'));

let r = await unlock(PASSWORD);
check('🔑 الرمز نفسه فكّ التشفير ووصل للخطوة ٤', r.unlocked, r.message);
check('الأعداد المعروضة ٧٢٤', r.body.includes('724'), r.body.slice(0, 120));
check('رسالة النجاح واضحة', r.message.includes('نجح'), r.message);

console.log('\n═══ ٢) الرمز الخاطئ: يُرفض بلا ادّعاء نجاح ═══');
await uploadFile(realFile);
r = await unlock('رمز-خاطئ-تماماً-٩٩٩');
check('الرمز الخاطئ لا يفتح', !r.unlocked);
check('الرسالة تذكر «كلمة المرور» أو «الملف» لا اتّهاماً غامضاً',
      /كلمة المرور|الملف/.test(r.message), r.message.slice(0, 70));
check('الرسالة تطبع أرقاماً للتشخيص', /الطول\s*\d+/.test(r.message), r.message.slice(0, 80));

console.log('\n═══ ٣) الملف كما يعود من Notepad: BOM — العطل الذي كان يمنع الفتح ═══');
const bomFile = join(dir, 'bom.hrcbak');
writeFileSync(bomFile, '\uFEFF' + sealed + '\n', 'utf8');
await uploadFile(bomFile);
check('ملف فيه BOM يُقبل كملف صالح', !$('rp-step2').classList.contains('is-hidden'),
      $('rp-file-status').textContent);
r = await unlock(PASSWORD);
check('🔑 ويفكّ التشفير بالرمز نفسه', r.unlocked, r.message);

console.log('\n═══ ٤) ملف فيه أسطر CRLF (Windows) ═══');
const crlfFile = join(dir, 'crlf.hrcbak');
writeFileSync(crlfFile, sealed.replace(/\n/g, '\r\n'), 'utf8');
await uploadFile(crlfFile);
r = await unlock(PASSWORD);
check('CRLF لا يمنع الفكّ', r.unlocked, r.message);

console.log('\n═══ ٥) الرمز مع مسافة زائدة سهواً ═══');
await uploadFile(realFile);
r = await unlock(PASSWORD + ' ');
check('مسافة زائدة في الآخر لا تُسقط المحاولة', r.unlocked, r.message);
check('وتُخبره أن السبب مسافة لا رمز خاطئ', /مسافة/.test(r.message), r.message);

console.log('\n═══ ٦) ملف مبتور من الـUSB ═══');
const cutFile = join(dir, 'cut.hrcbak');
writeFileSync(cutFile, sealed.slice(0, Math.floor(sealed.length * 0.6)), 'utf8');
await uploadFile(cutFile);
r = await unlock(PASSWORD);
check('الملف المبتور لا يُفتح (لا بيانات كاذبة)', !r.unlocked);

console.log('\n═══ ٧) ملفّ ليس نسخة أصلاً ═══');
const wrongFile = join(dir, 'wrong.txt');
writeFileSync(wrongFile, 'هذا ملف نصّي عادي وليس نسخة احتياطية', 'utf8');
await uploadFile(wrongFile);
check('رسالة صريحة: ليس ملف نسخة', /ليس|صالح/.test($('rp-file-status').textContent),
      $('rp-file-status').textContent);

console.log('\n' + '─'.repeat(62));
console.log(fail === 0
  ? `✅ النسخة تُفتح بنفس الرمز — ${pass} فحصاً عبر restore.html الحقيقية`
  : `❌ ${fail} فشل من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
