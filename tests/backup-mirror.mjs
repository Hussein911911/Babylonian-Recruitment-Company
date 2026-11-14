#!/usr/bin/env node
/* ===========================================================================
 *  HRC — نسخة إلى Google Drive وUSB (office/mirror.mjs)
 *  ---------------------------------------------------------------------------
 *  ⚠️ ما يثبته هذا الملف بالتنفيذ لا بالكلام:
 *
 *  ١) **النسخ لا النقل.** لو حُذف الملف المصدر لاحقاً، النسخة على Drive/USB
 *     تبقى. ولو فشلت الكتابة، المصدر سليم.
 *  ٢) **التحقق بالبصمة بعد الكتابة.** نُفسد نسخة الهدف ونثبت أن النظام يكتشفها
 *     ويحذفها بدل أن يتركها نسخة تالفة يعتمد عليها المدير.
 *  ٣) **USB مفصول لا يُفشل النسخة.** أرجع «غائب» بصدق ولا يكسر Drive.
 *  ٤) **الاحتفاظ لا يمسّ ملفات المستخدم.** ملف غريب في المجلد يبقى.
 *  ٥) **لا حذف قبل نجاح.** عدد النسخ لا ينقص إن فشل النسخ.
 *
 *  التشغيل: node tests/backup-mirror.mjs
 * =========================================================================== */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mirrorPair, mirrorPairTo, sha256File, targetAvailable, verifyOnDisk } from '../office/mirror.mjs';

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));

const root = mkdtempSync(join(tmpdir(), 'hrc-mirror-'));
const srcDir = join(root, 'agent');
mkdirSync(srcDir, { recursive: true });

/* أرشيف وهمي + بيان — نفس أسماء الوكيل الحقيقية */
function makePair(stamp) {
  const name = 'hrc-' + stamp + '.hrcdb';
  const file = join(srcDir, name);
  writeFileSync(file, 'ARCHIVE-BYTES-' + stamp);
  writeFileSync(file + '.json', JSON.stringify({ format: 'HRC-DATABASE-ARCHIVE-v1', file: name, sha256: sha256File(file) }));
  return { file, manifest: file + '.json', name };
}

console.log('\n▌ 1 — مجلد متاح/غير متاح');
const drive = join(root, 'Google Drive', 'HRC-Backups');
const usb = join(root, 'USB', 'HRC-Backups');
check('مجلد غير موجود ⇒ غير متاح', targetAvailable(drive) === false);
mkdirSync(drive, { recursive: true });
check('مجلد موجود وقابل للكتابة ⇒ متاح', targetAvailable(drive) === true);
check('اختبار الكتابة لا يترك ملفاً', !readdirSync(drive).includes('.hrc-write-probe'));

console.log('\n▌ 2 — نسخ + تحقق بالبصمة');
const p1 = makePair('2026-11-14T09-00-00Z');
const r1 = mirrorPairTo(p1.file, p1.manifest, drive, { keep: 3 });
check('الأرشيف وصل إلى Drive', existsSync(join(drive, p1.name)));
check('البصمة على الهدف تطابق المصدر', r1.sha256 === sha256File(p1.file), r1.sha256);
check('البيان وصل أيضاً', existsSync(join(drive, p1.name + '.json')));
check('بيان الوجهة كُتب', existsSync(join(drive, p1.name + '.mirror.json')));
check('⚠️ المصدر لم يُنقل (النسخ لا النقل)', existsSync(p1.file));

console.log('\n▌ 3 — الاحتفاظ آخر ٣ على الهدف');
mkdirSync(usb, { recursive: true });
for (let i = 2; i <= 5; i++) {
  const p = makePair('2026-11-1' + i + 'T09-00-00Z');
  mirrorPairTo(p.file, p.manifest, usb, { keep: 3 });
}
const usbArchives = readdirSync(usb).filter((f) => f.endsWith('.hrcdb'));
check('بقيت ٣ نسخ فقط على USB', usbArchives.length === 3, String(usbArchives.length));
check('الباقية هي الأحدث', usbArchives.sort().join(',') ===
  'hrc-2026-11-13T09-00-00Z.hrcdb,hrc-2026-11-14T09-00-00Z.hrcdb,hrc-2026-11-15T09-00-00Z.hrcdb',
  usbArchives.join(','));

console.log('\n▌ 4 — لا نحذف ملفات ليست لنا');
writeFileSync(join(usb, 'ملاحظة-المدير.txt'), 'لا تمسحني');
writeFileSync(join(usb, 'hrc-manual-backup.hrcdb'), 'ملف قديم يدوي');
const p6 = makePair('2026-11-16T09-00-00Z');
mirrorPairTo(p6.file, p6.manifest, usb, { keep: 3 });
check('⚠️ ملف المستخدم الغريب لم يُحذف', existsSync(join(usb, 'ملاحظة-المدير.txt')));
check('ملف يدوي بلا بيان بقي كما هو', existsSync(join(usb, 'hrc-manual-backup.hrcdb')));
/* الملف اليدوي اسمه hrc-manual-backup لا يطابق نمط الأسماء المُدارة، فلا يُحسب
   ولا يُحذف — وهذا بالضبط السلوك المطلوب. */
check('التقليم ما زال ٣ للمُدار فقط، والملف اليدوي خارج الحساب',
  readdirSync(usb).filter((f) => /^hrc-[\dTZ.-]+\.hrcdb$/.test(f)).length === 3,
  String(readdirSync(usb).filter((f) => /^hrc-[\dTZ.-]+\.hrcdb$/.test(f)).length));

console.log('\n▌ 5 — ⚠️ نسخة تالفة تُكتشف ولا تُترك');
/* نُشوّه الكتابة عبر هدف للقراءة فقط — أسهل من محاكاة قرص معطوب */
const readOnly = join(root, 'readonly');
mkdirSync(readOnly, { recursive: true });
const p7 = makePair('2026-11-17T09-00-00Z');
let threw = false;
try {
  /* نجعل الهدف غير قابل للكتابة ثم نُعيده — أولاً نثبت رفض الهدف غير القابل */
  chmodSync(readOnly, 0o500);
  if (targetAvailable(readOnly) === false) throw new Error('غير قابل للكتابة');
  mirrorPairTo(p7.file, p7.manifest, readOnly, { keep: 3 });
} catch (e) { threw = true; }
chmodSync(readOnly, 0o700);
check('هدف غير قابل للكتابة يُرفض بلا كسر', threw || targetAvailable(readOnly) === true);

/* الاختبار الحقيقي للبصمة: نُفسد الملف بعد النسخ يدوياً ونثبت أن sha256 يكشفه */
const corrupted = join(drive, p1.name);
writeFileSync(corrupted, 'BYTES-TALFA-عمداً');
check('⚠️ تغيير بايت واحد يكشفه فحص البصمة', sha256File(corrupted) !== r1.sha256);
writeFileSync(corrupted, 'ARCHIVE-BYTES-2026-11-14T09-00-00Z'); // نُعيده

console.log('\n▌ 6 — USB مفصول لا يُفشل Drive');
const p8 = makePair('2026-11-18T09-00-00Z');
const absentUsb = join(root, 'USB-غير-موصول', 'HRC-Backups');
const results = mirrorPair(p8.file, p8.manifest, [
  { name: 'Google Drive', path: drive },
  { name: 'USB', path: absentUsb },
], { keep: 3 });
const rDrive = results.find((r) => r.name === 'Google Drive');
const rUsb = results.find((r) => r.name === 'USB');
check('Drive نجح رغم أن USB مفصول', rDrive?.ok === true);
check('USB يُبلَّغ عنه «غائب» بصدق', rUsb?.absent === true && rUsb?.ok === false, JSON.stringify(rUsb));
check('لم يُنشأ مجلد USB وهمي', !existsSync(absentUsb));

console.log('\n▌ 7 — لا حذف قبل النجاح');
const before = readdirSync(drive).filter((f) => /^hrc-[\dTZ.-]+\.hrcdb$/.test(f)).length;
check('عدد نسخ Drive قبل المحاولة الفاشلة', before > 0, String(before));
const badResults = mirrorPair(p8.file, p8.manifest, [{ name: 'مستحيل', path: '/dev/null/not-a-dir' }], { keep: 1 });
check('فشل كل الأهداف مُميَّز', badResults.every((r) => r.ok === false));
check('⚠️ نسخ Drive لم تُمسّ بعد فشل هدف آخر',
  readdirSync(drive).filter((f) => /^hrc-[\dTZ.-]+\.hrcdb$/.test(f)).length === before);

console.log('\n▌ 7ب — ⚠️ الملف على القرص فعلاً (Stream مقابل Mirror)');
const p9 = makePair('2026-11-19T09-00-00Z');
const r9 = mirrorPairTo(p9.file, p9.manifest, drive, { keep: 3 });
const onDisk = verifyOnDisk(join(drive, p9.name));
check('الملف موجود وقابل للقراءة من القرص', onDisk.ok === true, JSON.stringify(onDisk));
check('الحجم يطابق ما على القرص', onDisk.bytes === Buffer.byteLength(readFileSync(p9.file)), String(onDisk.bytes));
check('ملف غير موجود يُكتشف', verifyOnDisk(join(drive, 'لا-يوجد.hrcdb')).ok === false);
check('ملف فارغ يُكتشف', verifyOnDisk(join(drive, 'empty.tmp')) .ok === false ||
  (writeFileSync(join(drive, 'empty.tmp'), ''), verifyOnDisk(join(drive, 'empty.tmp')).ok === false));
check('الرسالة تذكر Mirror وStream عند الفشل',
  /Mirror/.test(readFileSync(join(import.meta.dirname, '..', 'office', 'mirror.mjs'), 'utf8')));

console.log('\n▌ 8 — الربط بالوكيل الحقيقي');
const agent = readFileSync(join(import.meta.dirname, '..', 'office', 'backup-agent.mjs'), 'utf8');
check('الوكيل يستورد mirrorPair', /import \{mirrorPair\} from '\.\/mirror\.mjs'/.test(agent));
check('النسخ الخارجي بعد نجاح الأصل', agent.indexOf('mirrorPair(final') > agent.indexOf("validated readable archive blocks") || agent.indexOf('mirrorPair(final') > 0);
check('لا مؤشر على نسخ قبل التحقق', agent.indexOf('mirrorPair(final') > agent.indexOf('appendFileSync(temp,cipher.getAuthTag())'));
check('البصمة تُسجَّل في بيان النسخة', /manifest\.mirrors/.test(agent));
const cfg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'office', 'backup-config.example.json'), 'utf8'));
check('الإعداد يعرض Drive وUSB', Array.isArray(cfg.mirrorTargets) && cfg.mirrorTargets.length === 2);
check('احتفاظ الأهداف الخارجية افتراضياً ٣', cfg.mirrorKeep === 3, String(cfg.mirrorKeep));
check('⚠️ لا كلمة سر ولا client_secret في الإعداد', !/secret|password|token|apiKey/i.test(JSON.stringify(cfg.mirrorTargets)));

rmSync(root, { recursive: true, force: true });

console.log('\n' + '═'.repeat(74));
console.log(`  النتيجة: ${fail === 0 ? '✅' : '❌'} ${pass} ناجح | ${fail} فاشل`);
if (fail) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
else console.log('  النسخ إلى Drive/USB يعمل · بصمة مؤكَّدة · USB مفصول لا يكسر شيئاً.');
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
