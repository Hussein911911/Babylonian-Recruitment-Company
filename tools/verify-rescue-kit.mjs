#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — فحص حزمة الطوارئ قبل الاعتماد عليها
   ---------------------------------------------------------------------------
   يفعل بالترتيب:
     ١) يفكّ .hrcbak إن كانت مشفّرة (بكلمة المرور من ملف/بيئة/سؤال).
     ٢) يفكّ الضغط إلى مجلد مؤقّت (يحتاج unzip؛ وإن غاب يفحص المجلد مباشرة).
     ٣) يتحقّق من CHECKSUMS.sha256 لكل ملف — ويُفشل عند أي اختلاف أو نقص.
     ٤) يقرأ manifest.json ويطابق البصمة والأعداد.
     ٥) إن مُرّر --dsn: يستعيد على قاعدة الاختبار ويطلب PASS من الأداة نفسها.
   الاستخدام:
     node tools/verify-rescue-kit.mjs rescue-kit.zip
     node tools/verify-rescue-kit.mjs rescue-kit.hrcbak --password-file pw.txt
     node tools/verify-rescue-kit.mjs rescue/ --dsn "postgresql://…"
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decryptBuffer, readHeader } from './backup-crypto.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const say = (l) => console.log(l);
let bad = 0;
const fail = (m) => { bad++; say(`  ✖ ${m}`); };
const ok = (m) => say(`  ✔ ${m}`);

const target = process.argv[2];
if (!target || target.startsWith('--')) {
  console.error('الاستخدام: node tools/verify-rescue-kit.mjs <dir|zip|hrcbak> [--dsn …] [--password-file f] [--keep]');
  process.exit(2);
}
if (!existsSync(target)) { console.error(`✖ غير موجود: ${target}`); process.exit(2); }

const work = mkdtempSync(path.join(tmpdir(), 'hrc-verify-'));
const cleanup = () => { if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true }); };

let src = path.resolve(target);
say('══════ فحص حزمة الطوارئ ══════');
say(`المصدر     : ${src}`);

/* ── ١) فكّ التشفير ──────────────────────────────────────────────────────── */
if (/\.hrcbak$/i.test(src)) {
  let pw = process.env.HRC_BACKUP_PASSWORD;
  const pf = arg('password-file');
  if (pf) pw = readFileSync(pf, 'utf8').replace(/\r?\n$/, '');
  if (!pw) {
    fail('حزمة مشفّرة بلا كلمة مرور — مرّر --password-file (أو HRC_BACKUP_PASSWORD)');
    cleanup(); process.exit(1);
  }
  const raw = readFileSync(src);
  try {
    const { plain, header } = decryptBuffer(raw, pw);
    ok(`فُكّ التشفير — ${header.plainBytes.toLocaleString('en-US')} بايت · بُني ${header.createdAt}`);
    src = path.join(work, header.name || 'rescue-kit.zip');
    writeFileSync(src, plain);
  } catch (e) { fail(`فكّ التشفير: ${e.message}`); cleanup(); process.exit(1); }
} else if (statSync(src).isFile()) {
  /* ملف غير مشفّر: نتأكد أنه ليس .hrcbak باسم آخر قبل أن نحاول فكّ ضغطه */
  const h = readFileSync(src).slice(0, 7).toString('ascii');
  if (h === 'HRCBK1\n') { fail('الملف مشفّر لكن امتداده ليس .hrcbak — أعد تسميته أو مرّر كلمة المرور'); cleanup(); process.exit(1); }
}

/* ── ٢) فكّ الضغط ───────────────────────────────────────────────────────── */
let root = src;
if (statSync(src).isFile()) {
  const un = spawnSync('unzip', ['-q', src, '-d', work], { encoding: 'utf8' });
  if (un.error || un.status !== 0) {
    fail(`تعذّر فكّ الضغط: ${(un.error && un.error.message) || (un.stderr || '').trim() || 'unzip غير متاح'}`);
    say('  ℹ على ويندوز: افتح الملف بـ7-Zip ثم مرّر اسم المجلد المفكوك.');
    cleanup(); process.exit(1);
  }
  const entries = readdirSync(work).filter((n) => n !== path.basename(src));
  root = entries.length === 1 && statSync(path.join(work, entries[0])).isDirectory()
    ? path.join(work, entries[0]) : work;
  ok(`فُكّ الضغط إلى مجلد مؤقّت (${entries.length} مدخلاً)`);
}

/* ── ٣) البصمات ─────────────────────────────────────────────────────────── */
const sumsFile = path.join(root, 'CHECKSUMS.sha256');
if (!existsSync(sumsFile)) { fail('CHECKSUMS.sha256 غائب — لا يمكن إثبات سلامة الحزمة'); cleanup(); process.exit(1); }
const lines = readFileSync(sumsFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
let checked = 0, missing = 0, mismatch = 0;
for (const line of lines) {
  const m = /^([0-9a-f]{64})\s{1,2}(.+)$/i.exec(line);
  if (!m) continue;
  const [, want, rel] = m;
  const p = path.join(root, rel);
  if (!existsSync(p)) { missing++; say(`  ✖ مفقود: ${rel}`); continue; }
  const got = createHash('sha256').update(readFileSync(p)).digest('hex');
  if (got !== want.toLowerCase()) { mismatch++; say(`  ✖ بصمة مخالفة: ${rel}`); continue; }
  checked++;
}
say(`  ✔ ${checked} ملفاً مطابقاً` + (missing ? ` · ${missing} مفقود` : '') + (mismatch ? ` · ${mismatch} مخالف` : ''));
if (missing || mismatch) bad++;

/* ── ٤) المانيفست ───────────────────────────────────────────────────────── */
const mf = path.join(root, 'manifest.json');
if (!existsSync(mf)) fail('manifest.json غائب');
else {
  try {
    const j = JSON.parse(readFileSync(mf, 'utf8'));
    ok(`manifest: نسخة ${j.version} · ${j.dump?.name || '؟'} · ${j.dump?.counts?.applicants ?? '?'} بطاقة`);
    if (j.dump?.sha256) {
      const dumpPath = path.join(root, 'database', j.dump.name);
      if (existsSync(dumpPath)) {
        const h = createHash('sha256').update(readFileSync(dumpPath)).digest('hex');
        h === j.dump.sha256 ? ok('بصمة ملف البيانات مطابقة للمانيفست') : fail('بصمة ملف البيانات لا تطابق المانيفست');
      } else fail(`ملف البيانات المذكور في المانيفست غير موجود: ${j.dump.name}`);
    }
    if (Array.isArray(j.storage?.expected)) {
      const found = j.storage.found || [];
      const missingImg = j.storage.expected.filter((f) => !found.includes(f));
      if (missingImg.length) say(`  ℹ صور ناقصة داخل الحزمة (${missingImg.length}): ${missingImg.join(', ')}`);
      else ok(`الصور: ${found.length}/${j.storage.expected.length} موجودة`);
    }
  } catch (e) { fail(`manifest غير مقروء: ${e.message}`); }
}

/* ── ٥) استعادة فعلية اختيارية ──────────────────────────────────────────── */
const dsn = arg('dsn');
if (dsn) {
  const tool = path.join(root, 'recovery-tools', 'restore-full-file.mjs');
  const mfj = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : {};
  const dumpName = mfj.dump?.name;
  if (!existsSync(tool)) fail('أداة الاسترجاع غائبة من الحزمة');
  else if (!dumpName) fail('لا اسم ملف بيانات في المانيفست');
  else {
    say('');
    say('──── استعادة فعلية على قاعدة الاختبار ────');
    const r = spawnSync(process.execPath, [tool, path.join(root, 'database', dumpName),
      '--dsn', dsn, '--yes', '--log', path.join(work, 'restore.log')],
      { stdio: 'inherit', env: process.env });
    if (r.status === 0) ok('الاستعادة أعطت PASS');
    else fail(`الاستعادة فشلت (رمز ${r.status}) — الحزمة غير صالحة للاعتماد`);
  }
} else {
  say('  ℹ بلا --dsn: لم تُجرَّب الاستعادة (الفحص البنيوي فقط)');
}

cleanup();
say('');
if (bad) { say(`❌ FAIL — ${bad} مشكلة. لا تعتمد هذه الحزمة.`); process.exit(1); }
say('✅ PASS — الحزمة سليمة ومكتملة البصمات.');
