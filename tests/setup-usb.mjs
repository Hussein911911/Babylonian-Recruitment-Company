#!/usr/bin/env node
/* ===========================================================================
 *  HRC — أداة إعداد Drive (tools/setup-usb.mjs)
 *  ---------------------------------------------------------------------------
 *  ⚠️ ما يثبته هذا الملف بالتنفيذ:
 *
 *  ١) **فخ JSON.** مسار ويندوز منسوخ كما هو (`C:\Users`) يحتوي `\U` —
 *     وهو ليس هروباً صحيحاً، فيُفسد الملف كله. الوكيل يفشل بخطأ صياغة
 *     لا علاقة له بـDrive. الأداة تكتب `/` فتُغلق الفخ.
 *  ٢) **فخ Stream.** مجلد موجود لكن غير قابل للكتابة ⇒ لا شيء على القرص.
 *     الأداة تفحص بالكتابة والقراءة الفعليتين لا بالوجود وحده.
 *  ٣) **لا يمسح ما ليس له.** نسخ قديمة في المجلد تبقى.
 *  ٤) **الحقول الناقصة تُذكر، لا تُخفى.**
 *
 *  التشغيل: node tests/setup-usb.mjs
 * =========================================================================== */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOL = join(import.meta.dirname, '..', 'tools', 'setup-usb.mjs');
let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));

function run(args, home) {
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], {
      env: { ...process.env, HRC_OFFICE_HOME: home }, encoding: 'utf8', stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const root = mkdtempSync(join(tmpdir(), 'hrc-setup-'));

console.log('\n▌ 1 — بلا مسار: يعرض الاستخدام لا ينهار');
{
  const home = join(root, 'h1'); mkdirSync(home, { recursive: true });
  const r = run([], home);
  check('يرجع 0 ويعرض الاستخدام', r.code === 0 && /الاستخدام/.test(r.out), 'code=' + r.code);
  check('ينبّه لضرورة علامات التنصيص', /تنصيص/.test(r.out));
}

console.log('\n▌ 2 — مجلد غير موجود: يرفض بوضوح');
{
  const home = join(root, 'h2'); mkdirSync(home, { recursive: true });
  const r = run([join(root, 'لا-يوجد')], home);
  check('يرفض بلا إنشاء مجلد وهمي', r.code === 1 && /غير موجود/.test(r.out), 'code=' + r.code);
  check('لا يُنشئ مجلداً من تلقاء نفسه', !existsSync(join(root, 'لا-يوجد')));
}

console.log('\n▌ 3 — مسار صحيح فيه فراغات (مثل "Google Drive")');
{
  const home = join(root, 'h3'); mkdirSync(home, { recursive: true });
  const drive = join(home, 'Google Drive', 'HRC-Backups');
  mkdirSync(drive, { recursive: true });
  const r = run([drive], home);
  check('ينجح', r.code === 0, 'code=' + r.code);
  check('يتعرّف على مجلد Drive', /Google Drive/.test(r.out));
  check('يكتب الإعداد', existsSync(join(home, 'backup-config.json')));
  const cfg = JSON.parse(readFileSync(join(home, 'backup-config.json'), 'utf8'));
  check('هدف واحد مضاف', cfg.mirrorTargets.length === 1);
  check('mirrorKeep = ٣', cfg.mirrorKeep === 3, String(cfg.mirrorKeep));
  check('⚠️ المسار بلا شرطة معكوسة', !/\\/.test(cfg.mirrorTargets[0].path), cfg.mirrorTargets[0].path);
}

console.log('\n▌ 4 — ⚠️ فخ JSON: ملف تالف لا يُقرأ');
{
  const home = join(root, 'h4'); mkdirSync(home, { recursive: true });
  /* `\U` هروب غير صحيح — هذا ما يحدث عند لصق مسار ويندوز في JSON */
  writeFileSync(join(home, 'backup-config.json'), '{"mirrorTargets":[{"path":"C:\\Users\\x"}]}');
  const r = run(['--check'], home);
  check('يكتشف التلف', r.code === 1 && /تالف/.test(r.out), 'code=' + r.code);
  check('⚠️ يشرح السبب (شرطة معكوسة)', /معكوسة|\\\\/.test(r.out));
  check('لا يمسح الملف التالف', existsSync(join(home, 'backup-config.json')));
}

console.log('\n▌ 5 — --check على إعداد سليم');
{
  const home = join(root, 'h5'); mkdirSync(home, { recursive: true });
  const drive = join(home, 'Drive', 'HRC-Backups');
  mkdirSync(drive, { recursive: true });
  run([drive], home);
  /* نسخ قديمة موجودة مسبقاً */
  writeFileSync(join(drive, 'hrc-2026-01-01T00-00-00Z.hrcdb'), 'قديمة');
  const r = run(['--check'], home);
  check('يرجع 0', r.code === 0, 'code=' + r.code);
  check('يعدّ النسخ الموجودة', /نسخ محفوظة: 1/.test(r.out), r.out.slice(-200));
  check('يذكر الأحدث', /الأحدث: hrc-2026-01-01/.test(r.out));
  check('⚠️ لا يحذف النسخة القديمة', existsSync(join(drive, 'hrc-2026-01-01T00-00-00Z.hrcdb')));
}

console.log('\n▌ 6 — --check على مجلد سُحب/فُصل');
{
  const home = join(root, 'h6'); mkdirSync(home, { recursive: true });
  const drive = join(home, 'Drive', 'HRC-Backups');
  mkdirSync(drive, { recursive: true });
  run([drive], home);
  rmSync(drive, { recursive: true, force: true });  /* كأن USB فُصل أو Drive أُغلق */
  const r = run(['--check'], home);
  check('يفشل بصدق', r.code === 1 && /غير جاهز/.test(r.out), 'code=' + r.code);
}

console.log('\n▌ 7 — إضافة هدف ثانٍ لا تُلغي الأول');
{
  const home = join(root, 'h7'); mkdirSync(home, { recursive: true });
  const a = join(home, 'Google Drive', 'HRC-Backups');
  const b = join(home, 'USB', 'HRC-Backups');
  mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true });
  run([a], home);
  run([b], home);
  const cfg = JSON.parse(readFileSync(join(home, 'backup-config.json'), 'utf8'));
  check('هدفان الآن', cfg.mirrorTargets.length === 2, String(cfg.mirrorTargets.length));
  run([a], home);  /* نفس المسار مرة أخرى */
  const cfg2 = JSON.parse(readFileSync(join(home, 'backup-config.json'), 'utf8'));
  check('إعادة نفس المسار لا تُكرّره', cfg2.mirrorTargets.length === 2, String(cfg2.mirrorTargets.length));
}

console.log('\n▌ 8 — الحقول الناقصة تُذكر لا تُخفى');
{
  const home = join(root, 'h8'); mkdirSync(home, { recursive: true });
  const drive = join(home, 'Drive', 'HRC-Backups'); mkdirSync(drive, { recursive: true });
  const r = run([drive], home);
  check('ينبّه على نقص databaseUrl', /databaseUrl/.test(r.out));
  check('ينبّه على نقص المفاتيح', /recipientPrivateKey/.test(r.out));
  check('⚠️ لا يدّعي الجهوزية الكاملة', /النسخة الكاملة تحتاج/.test(r.out));
}

rmSync(root, { recursive: true, force: true });

console.log('\n' + '═'.repeat(72));
console.log(`  النتيجة: ${fail === 0 ? '✅' : '❌'} ${pass} ناجح | ${fail} فاشل`);
if (fail) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
else console.log('  الأداة تمنع فخ JSON ومسار القرص، ولا تمسح ما ليس لها.');
console.log('═'.repeat(72) + '\n');
process.exit(fail ? 1 : 0);
