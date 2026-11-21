#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — بناء حزمة الطوارئ (rescue-kit.zip أو rescue-kit.hrcbak المشفّرة)
   ---------------------------------------------------------------------------
   ⚠️ لماذا سكربت وليس مجلداً في المستودع؟
   لأن الحزمة تحتوي نسخة كاملة من الكود وبيانات شخصية لأصحاب البطاقات. دفعها
   إلى Git يعني تكرار عشرات الميغابايت مع كل تحديث، وتسريب بيانات لا يجوز أن
   تكون في مستودع، وحزمة تتقادم بصمت. فتُبنى عند الطلب وتبقى في .gitignore.

   ما يفعله:
     ١. يقرأ ملف البيانات HRC-FULL-*.sql ويستخرج منه: الأعداد، الموظفين،
        ومسارات الصور المطلوبة (بلا قاعدة بيانات).
     ٢. يبني الحزمة: الكود + الموقع الجاهز + الأدوات + الإعدادات + الصور.
     ٣. يكتب accounts.json (بلا كلمات مرور) وproject-settings.json وmanifest.json.
     ٤. يشفّر مفتاح البصمة داخل الحزمة إن مُرّر (--secret-file أو HRC_BRC_SECRET).
     ٥. يحسب CHECKSUMS.sha256 لكل ملف.
     ٦. يضغط، ثم يشفّر الحزمة بكلمة مرور (scrypt+AES-256-GCM) إن مُرّرت.

   الاستعمال:
     node tools/build-rescue-kit.mjs                       # مجلد + zip بلا تشفير
     node tools/build-rescue-kit.mjs --password-file pw.txt \\ 
          --secret-file brc_secret.txt                      # حزمة مشفّرة كاملة
     node tools/build-rescue-kit.mjs --no-zip              # المجلد فقط
   ملاحظة: الصور تُقرأ من storage/job-images/jobs/ وليست في Git؛
   تُنزَّل من لوحة Supabase أو من زر «ضمّن الصور» في صفحة النسخ.
   ═══════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, rmSync, copyFileSync, cpSync, writeFileSync, readdirSync, statSync, readFileSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { headerCounts } from './dump-header.mjs';
import { tableRows, storagePaths } from './dump-facts.mjs';
import { encryptBuffer } from './backup-crypto.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'rescue');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const flag = (n) => process.argv.includes(`--${n}`);
const readPass = (file) => readFileSync(file, 'utf8').replace(/\r?\n$/, '');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/* ── ٠) المتغيّرات السرّية: من ملف أو بيئة، ولا تُطبع أبداً ───────────────── */
const pwFile = arg('password-file');
const password = pwFile ? readPass(pwFile) : (process.env.HRC_BACKUP_PASSWORD || '');
const secretFile = arg('secret-file');
const brcSecret = secretFile ? readPass(secretFile) : (process.env.HRC_BRC_SECRET || '');
if (password && password.length < 12) { console.error('✖ كلمة مرور الحزمة قصيرة (١٢ حرفاً على الأقل)'); process.exit(2); }

if (existsSync(OUT)) { console.log('• حذف الحزمة القديمة…'); rmSync(OUT, { recursive: true, force: true }); }
for (const d of ['database', 'config', 'storage/job-images/jobs', 'recovery-tools/recovery']) {
  mkdirSync(join(OUT, d), { recursive: true });
}

/* ── ١) الكود والموقع ─────────────────────────────────────────────────────── */
console.log('• [1/8] أرشفة الكود عند HEAD…');
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
sh('git', ['archive', '--format=zip', '-o', join(OUT, 'source-code.zip'), 'HEAD']);

console.log('• [2/8] الأدوات وقاعدة البيانات…');
for (const f of ['recovery-server.mjs', 'recovery-app.html', 'recovery-core.mjs', 'sql-split-core.mjs',
  'build-full-dump.mjs', 'restore-full-file.mjs', 'patch-restore-triggers.mjs', 'dump-header.mjs',
  'dump-facts.mjs', 'backup-crypto.mjs', 'open-backup.mjs', 'verify-rescue-kit.mjs']) {
  copyFileSync(join(ROOT, 'tools', f), join(OUT, 'recovery-tools', f));
}
cpSync(join(ROOT, 'tools', 'recovery'), join(OUT, 'recovery-tools', 'recovery'), { recursive: true });
/* كتل الإصلاح: patch-restore-triggers يقرأها من ../docs/… نسبةً إلى موضعه */
mkdirSync(join(OUT, 'docs', 'sql-parts', 'fixes'), { recursive: true });
for (const f of ['03-restore-trigger-blocks.sql', '04-brc-secret-fallback.sql']) {
  copyFileSync(join(ROOT, 'docs', 'sql-parts', 'fixes', f), join(OUT, 'docs', 'sql-parts', 'fixes', f));
  copyFileSync(join(ROOT, 'docs', 'sql-parts', 'fixes', f), join(OUT, 'database', f));
}
for (const [from, to] of [
  ['docs/schema.sql', 'database/schema.sql'],
  ['docs/schema-live-inventory.json', 'database/schema-live-inventory.json'],
  ['docs/RECOVERY-ONE-CLICK.md', 'database/RECOVERY-ONE-CLICK.md'],
  ['docs/sql-parts/fixes/02-restore-gap.sql', 'database/02-restore-gap.sql'],
]) copyFileSync(join(ROOT, from), join(OUT, to));
for (const f of ['recreate-cron.sql', 'storage-restore.sql', 'auth-settings.md', '.env.example']) {
  const src = join(ROOT, 'docs', 'rescue', f);
  if (existsSync(src)) copyFileSync(src, join(OUT, 'config', f));
}
for (const f of ['STANDBY-AR.md', 'RESTORE-GUIDE-AR.md', 'INVENTORY.json.md', 'MISSING-ITEMS.md', 'TEST-RESULTS.md', 'HANDOFF-AR.md']) {
  const src = join(ROOT, 'docs', 'rescue', f);
  if (existsSync(src)) copyFileSync(src, join(OUT, f));
}

console.log('• [3/8] بناء الموقع جاهزاً للنشر…');
sh('npm', ['run', 'dist'], { stdio: 'inherit' });
cpSync(join(ROOT, 'dist'), join(OUT, 'site-ready-to-deploy'), { recursive: true });

/* ── ٢) ملف البيانات + حقائقه ─────────────────────────────────────────────── */
console.log('• [4/8] ملف البيانات وقراءة حقائقه…');
const dumps = readdirSync(ROOT).filter((f) => /^HRC-FULL-.*\.sql$/i.test(f)).sort();
if (!dumps.length) {
  console.error('✖ لا يوجد HRC-FULL-*.sql في جذر المستودع — الحزمة بلا بيانات لا قيمة لها.');
  console.error('  ضع الملف (المُنزَّل من صفحة النسخ الاحتياطي) في جذر المشروع ثم أعد البناء.');
  process.exit(2);
}
const dumpName = dumps[dumps.length - 1];
copyFileSync(join(ROOT, dumpName), join(OUT, 'database', dumpName));
const dumpPath = join(OUT, 'database', dumpName);
const dumpText = readFileSync(dumpPath, 'utf8');
const counts = headerCounts(dumpText) || {};
const staff = tableRows(dumpText, 'staff');
const expectedImages = storagePaths(dumpText);
console.log(`  ✓ ${dumpName} · ${counts.applicants ?? '?'} بطاقة · ${staff.length} موظفاً · ${expectedImages.length} صورة مطلوبة`);

/* ── ٣) الصور ─────────────────────────────────────────────────────────────── */
const imgSrc = join(ROOT, 'storage', 'job-images', 'jobs');
const found = [];
for (const rel of expectedImages) {
  const name = rel.replace(/^jobs\//, '');
  const from = join(imgSrc, name);
  if (existsSync(from)) { copyFileSync(from, join(OUT, 'storage', 'job-images', 'jobs', name)); found.push(rel); }
}
if (found.length < expectedImages.length) {
  console.log(`  ! صور ناقصة: ${expectedImages.length - found.length} من ${expectedImages.length}.`);
  console.log('    ضعها في storage/job-images/jobs/ ثم أعد البناء — أو أعِد تنزيلها من لوحة Supabase.');
  console.log('    الحزمة تُبنى مع ذلك، والمانيفست يعلن الناقص بصراحة.');
} else {
  console.log(`  ✓ الصور: ${found.length}/${expectedImages.length}`);
}

/* ── ٤) الحسابات والإعدادات والمانيفست ────────────────────────────────────── */
console.log('• [5/8] accounts.json · project-settings.json · manifest.json…');
const accounts = {
  note: 'لا تحمل هذه النسخة أي كلمة مرور — Supabase لا يصدّرها. أنشئ الحسابات بنفس البريد ثم أعد تعيين كلمة المرور، وأضف البريد في الحقل email قبل الإنشاء.',
  generatedAt: new Date().toISOString(),
  staff: staff.map((s) => ({
    username: s.username, full_name: s.full_name, role: s.role,
    job_title: s.job_title || '', phone: s.phone || '', active: s.active !== false,
    email: null, auth_id: null,
  })),
};
writeFileSync(join(OUT, 'config', 'accounts.json'), JSON.stringify(accounts, null, 2) + '\n');

const projectSettings = {
  note: 'إعدادات مشروع Supabase التي لا تعيش في ملف البيانات — تُضبط يدوياً بعد الاسترجاع. القيم المذكورة هي المطلوبة، لا القديمة؛ واقرأ القديمة من لوحة المشروع قبل الحاجة.',
  api: { exposed_schemas: ['public', 'brc'] },
  auth: {
    site_url: '<رابط الموقع الجديد>',
    uri_allow_list: '<نفس الرابط + /verify.html>',
    mailer_autoconfirm: false,
    password_min_length: 6,
  },
  storage: { bucket: 'job-images', public: true, file_size_limit: 2097152 },
  cron: { file: 'config/recreate-cron.sql', jobs: 4 },
  secrets: { brc_secret: 'لا يُقرأ من القاعدة — احفظه في مدير كلمات المرور؛ وإن أردته داخل الحزمة فمرّر --secret-file' },
};
writeFileSync(join(OUT, 'config', 'project-settings.json'), JSON.stringify(projectSettings, null, 2) + '\n');

if (brcSecret) {
  if (!password) {
    console.log('  ! مُرّر مفتاح بصمة بلا كلمة مرور للحزمة — لن يُضمَّن (لا نكتب سراً بلا تشفير).');
  } else {
    const enc = encryptBuffer(Buffer.from(brcSecret, 'utf8'), password, { name: 'brc_secret.txt' });
    writeFileSync(join(OUT, 'config', 'brc_secret.enc'), enc);
    console.log('  ✓ brc_secret.enc — مشفّر بنفس كلمة مرور الحزمة، لا يُقرأ بلا كلمة المرور');
  }
}

const manifest = {
  version: '2.0',
  generatedAt: new Date().toISOString(),
  commit: head,
  dump: {
    name: dumpName,
    bytes: statSync(dumpPath).size,
    sha256: sha(dumpPath),
    counts,
    statements: dumpText.split('\n').filter((l) => /;\s*$/.test(l)).length,
  },
  source: { code: 'source-code.zip', site: 'site-ready-to-deploy/' },
  storage: { bucket: 'job-images', expected: expectedImages, found },
  tools: ['recovery-tools/restore-full-file.mjs', 'recovery-tools/open-backup.mjs', 'recovery-tools/verify-rescue-kit.mjs'],
  secrets: { brc_secret: brcSecret && password ? 'config/brc_secret.enc (مشفّر)' : 'غير مضمّن — احفظه خارجاً' },
  accounts: 'config/accounts.json (بلا كلمات مرور)',
  docs: 'STANDBY-AR.md',
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

/* ── ٥) البصمات ───────────────────────────────────────────────────────────── */
console.log('• [6/8] بصمات SHA-256…');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(OUT).filter((p) => !p.endsWith('CHECKSUMS.sha256') && !p.endsWith('rescue-kit.zip')
  && !p.endsWith('.hrcbak')).sort();
writeFileSync(join(OUT, 'CHECKSUMS.sha256'), files.map((p) => `${sha(p)}  ${p.slice(OUT.length + 1)}`).join('\n') + '\n');
console.log(`  ${files.length} ملفاً`);

writeFileSync(join(OUT, 'BUILD.md'), `# كيف بُنيت هذه الحزمة

\`\`\`
node tools/build-rescue-kit.mjs
\`\`\`

- الالتزام: \`${head}\`
- ملف البيانات: \`${dumpName}\` · \`${manifest.dump.sha256}\`
- البناء: \`npm ci\` ثم \`npm run dist\`
- البصمات: \`CHECKSUMS.sha256\`

للتحقّق:
\`\`\`
sha256sum -c CHECKSUMS.sha256
\`\`\`
`);

/* ── ٦) الضغط والتشفير ────────────────────────────────────────────────────── */
console.log('• [7/8] الضغط…');
let artifact = null;
if (!flag('no-zip')) {
  const zip = join(OUT, 'rescue-kit.zip');
  try { rmSync(zip); } catch {}
  /* CHECKSUMS يُضمَّن كي يتحقّق منه من يستلم الحزمة */
  sh('zip', ['-qr', zip, 'rescue', '-x', 'rescue/rescue-kit.zip', 'rescue/*.hrcbak'], { cwd: ROOT });
  artifact = zip;
  console.log(`  ✓ ${(statSync(zip).size / 1048576).toFixed(1)} م.ب`);
}

console.log('• [8/8] التشفير…');
if (artifact && password) {
  const buf = readFileSync(artifact);
  const enc = encryptBuffer(buf, password, { name: 'rescue-kit.zip' });
  const out = join(OUT, 'rescue-kit.hrcbak');
  writeFileSync(out, enc);
  rmSync(artifact);          // لا نُبقي نسخة غير مشفّرة بجانب المشفّرة
  artifact = out;
  console.log('  ✓ حزمة مشفّرة — النسخة غير المشفّرة حُذفت');
} else if (password && !artifact) {
  console.log('  ! التشفير يحتاج ضغطاً — أُهمل (--no-zip)');
} else {
  console.log('  ℹ بلا كلمة مرور: الحزمة غير مشفّرة (فيها بيانات شخصية — احفظها في مكان خاص)');
}

if (artifact) {
  console.log('');
  console.log('══ الحزمة جاهزة ══');
  console.log('  الملف :', artifact.slice(ROOT.length + 1));
  console.log('  الحجم :', (statSync(artifact).size / 1048576).toFixed(2), 'م.ب');
  console.log('  sha256:', sha(artifact));
  console.log('  ⚠ احفظ هذه البصمة **خارج** الحزمة (مدير كلمات المرور) — بها تُثبت أنها لم تُعدَّل.');
  console.log('  الفحص : node tools/verify-rescue-kit.mjs', artifact.slice(ROOT.length + 1), '--password-file <ملف>');
}
