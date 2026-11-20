#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — بناء حزمة الإنقاذ (rescue-kit.zip)
   ---------------------------------------------------------------------------
   ⚠️ لماذا سكربت وليس مجلداً في المستودع؟

   لأن الحزمة تحتوي نسخة كاملة من الكود و(عند توفرها) بيانات شخصية لأصحاب
   البطاقات. دفعها إلى Git يعني:
     • تكرار ٥٣ م.ب في كل تحديث
     • تسريب بيانات لا يجوز أن تكون في مستودع
     • حزمة تتقادم بصمت كلما تغيّر الكود

   فالملف يُبنى عند الطلب من المصدر الحقيقي، ويبقى مستبعداً في .gitignore.

   الاستعمال:
     node tools/build-rescue-kit.mjs            # يبني rescue/ + rescue-kit.zip
     node tools/build-rescue-kit.mjs --no-zip   # يبني المجلد فقط

   ما يفعله:
     ١. ينشئ rescue/ من الصفر (يحذف القديم إن وجد).
     ٢. `git archive` للكود عند HEAD الحالي.
     ٣. ينسخ الأدوات وقاعدة البيانات والإعدادات.
     ٤. يبني الموقع جاهزاً للنشر (npm run dist).
     ٥. يحسب CHECKSUMS.sha256 لكل ملف.
     ٦. يضغط الكل.
   ═══════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, copyFileSync, cpSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'rescue');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });

if (existsSync(OUT)) { console.log('• حذف الحزمة القديمة…'); rmSync(OUT, { recursive: true, force: true }); }
for (const d of ['database', 'config', 'storage/job-images/jobs', 'recovery-tools/recovery']) {
  mkdirSync(join(OUT, d), { recursive: true });
}

console.log('• [1/5] أرشفة الكود عند HEAD…');
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
sh('git', ['archive', '--format=zip', `-o`, join(OUT, 'source-code.zip'), 'HEAD']);

console.log('• [2/5] نسخ الأدوات وقاعدة البيانات…');
/* أدوات الاسترجاع الحديثة — بدونها لا تعرف الحزمة إلا مسار recovery-app القديم */
for (const f of ['recovery-server.mjs', 'recovery-app.html', 'recovery-core.mjs', 'sql-split-core.mjs',
  'build-full-dump.mjs', 'restore-full-file.mjs', 'patch-restore-triggers.mjs', 'dump-header.mjs']) {
  copyFileSync(join(ROOT, 'tools', f), join(OUT, 'recovery-tools', f));
}
/* كتل الإصلاح: patch-restore-triggers.mjs يقرأها من ../docs/sql-parts/fixes/ نسبةً إلى
   ملف الأداة، والأداة في rescue/recovery-tools/ ⇒ المسار هو rescue/docs/… */
mkdirSync(join(OUT, 'docs', 'sql-parts', 'fixes'), { recursive: true });
for (const f of ['03-restore-trigger-blocks.sql', '04-brc-secret-fallback.sql']) {
  copyFileSync(join(ROOT, 'docs', 'sql-parts', 'fixes', f), join(OUT, 'docs', 'sql-parts', 'fixes', f));
}
cpSync(join(ROOT, 'tools', 'recovery'), join(OUT, 'recovery-tools', 'recovery'), { recursive: true });
/* الكتلتان أيضاً في database/ ليجدهما من يقرأ الحزمة بلا أدوات */
for (const [from, to] of [
  ['docs/schema.sql', 'database/schema.sql'],
  ['docs/sql-parts/fixes/03-restore-trigger-blocks.sql', 'database/03-restore-trigger-blocks.sql'],
  ['docs/sql-parts/fixes/04-brc-secret-fallback.sql', 'database/04-brc-secret-fallback.sql'],
  ['docs/schema-live-inventory.json', 'database/schema-live-inventory.json'],
  ['docs/RECOVERY-ONE-CLICK.md', 'database/RECOVERY-ONE-CLICK.md'],
  ['docs/sql-parts/fixes/02-restore-gap.sql', 'database/02-restore-gap.sql']
]) copyFileSync(join(ROOT, from), join(OUT, to));
for (const f of ['recreate-cron.sql', 'storage-restore.sql', 'auth-settings.md', '.env.example']) {
  const src = join(ROOT, 'docs', 'rescue', f);
  if (existsSync(src)) copyFileSync(src, join(OUT, 'config', f));
}
/* المستندات التعريفية — مصدرها docs/rescue/ وليس الحزمة نفسها */
for (const f of ['STANDBY-AR.md', 'RESTORE-GUIDE-AR.md', 'INVENTORY.json.md', 'MISSING-ITEMS.md', 'TEST-RESULTS.md', 'HANDOFF-AR.md']) {
  const src = join(ROOT, 'docs', 'rescue', f);
  if (existsSync(src)) copyFileSync(src, join(OUT, f));
}

console.log('• [3/5] بناء الموقع جاهزاً للنشر…');
sh('npm', ['run', 'dist'], { stdio: 'inherit' });
cpSync(join(ROOT, 'dist'), join(OUT, 'site-ready-to-deploy'), { recursive: true });

/* ملف البيانات — إن وُجد، يُنسخ ويُعلَم في الجرد */
const dumps = readdirSync(ROOT).filter((f) => /^HRC-FULL-.*\.sql$/i.test(f));
for (const d of dumps) { copyFileSync(join(ROOT, d), join(OUT, 'database', d)); console.log('  ✓ أُدرج ملف البيانات: ' + d); }
if (!dumps.length) console.log('  ! لا يوجد HRC-FULL-*.sql — انظر rescue/MISSING-ITEMS.md');

console.log('• [4/5] بصمات SHA-256…');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(OUT).filter((p) => !p.endsWith('CHECKSUMS.sha256') && !p.endsWith('rescue-kit.zip')).sort();
const lines = files.map((p) => {
  const h = createHash('sha256').update(readFileSync(p)).digest('hex');
  return `${h}  ${p.slice(OUT.length + 1)}`;
});
writeFileSync(join(OUT, 'CHECKSUMS.sha256'), lines.join('\n') + '\n');
console.log(`  ${lines.length} ملفاً`);

writeFileSync(join(OUT, 'BUILD.md'), `# كيف بُنيت هذه الحزمة

\`\`\`
node tools/build-rescue-kit.mjs
\`\`\`

- الـcommit: \`${head}\`
- البناء: \`npm ci\` ثم \`npm run dist\`
- البصمات: \`CHECKSUMS.sha256\`

للتحقق من سلامة أي ملف:

\`\`\`
sha256sum -c CHECKSUMS.sha256
\`\`\`
`);

if (!process.argv.includes('--no-zip')) {
  console.log('• [5/5] الضغط…');
  const zip = join(OUT, 'rescue-kit.zip');
  try { rmSync(zip); } catch {}
  /* CHECKSUMS.sha256 يُضمَّن في الضغط كي يتحقّق منه من يستلم الحزمة (sha256sum -c).
     استثناؤه سابقاً كان يجعل التحقّق مستحيلاً بعد فكّ الضغط — عطب حقيقي. */
  sh('zip', ['-qr', zip, 'rescue', '-x', 'rescue/rescue-kit.zip'], { cwd: ROOT });
  console.log('✓ rescue/rescue-kit.zip');
} else {
  console.log('✓ rescue/ (بلا ضغط)');
}
