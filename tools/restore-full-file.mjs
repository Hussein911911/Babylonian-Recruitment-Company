#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — منفّذ ملف الاسترجاع الكامل + تحقّق إلزامي بعده
   ---------------------------------------------------------------------------
   يفعل بالترتيب:
     ١) يفحص الملف: الحجم، SHA-256، عدد العبارات.
     ٢) يرقّع كتلتَي المشغّلات (Supabase لا يسمح بـ … TRIGGER ALL بلا superuser).
     ٣) ينفّذ الملف كاملاً بأداة حقيقية: psql (‏ON_ERROR_STOP=1) أو سائق pg.
     ٤) يشغّل استعلامات التحقّق ويقارن كل رقم بالمتوقّع لهذه النسخة.
     ٥) يطبع PASS/FAIL صريحاً ويُرجع رمز خروج غير صفري عند أي اختلاف.

   الاستخدام:
     # بـ psql (الأفضل: عبارة عبارة، سجل كامل)
     node tools/restore-full-file.mjs <file.sql> --dsn "<dsn>" --yes

     # بلا psql (على ويندوز مثلاً): سائق pg من npm — الملف كله في معاملة واحدة
     npm i pg --no-save
     node tools/restore-full-file.mjs <file.sql> --dsn "<dsn>" --driver pg --yes

   ملاحظات سلامة:
     • يرفض العمل على مشروع الإنتاج vqsvztudvfukyuerzcgx (محظور نهائياً).
     • لا يطبع كلمة المرور: تُقنَّع في كل سطر سجل، وتنتقل عبر البيئة لا argv.
     • لا يعيد المحاولة تلقائياً بعد فشل (الملف يبدأ بـ TRUNCATE).
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { splitStatements } from './sql-split-core.mjs';
import { patchTriggerBlocks } from './patch-restore-triggers.mjs';

const FORBIDDEN_REF = 'vqsvztudvfukyuerzcgx';   // مشروع الإنتاج — محظور نهائياً

const KNOWN = {
  'a1cce0475ae8158cacb523e738cd1bbe34def36dd77787a2fee25763f84ec8ba':
    { bytes: 3858946, statements: 400, label: 'HRC-FULL-2026-11-19' },
};

const EXPECTED = {
  staff: 3, applicants: 726, jobs: 22, job_attempts: 1537, issued_serials: 770,
  card_number_registry: 176, audit_log: 3809, settings: 5,
  recovery_chances: 1537, recovery_prints: 726, office_receipts: 0,
};
const EXPECTED_EXTRA = { printed: 422, spent: 46, counter: 176, cards: 726, disabled_triggers: 0 };

/* ── أدوات مساعدة ───────────────────────────────────────────────────────── */
function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const mask = (s) => String(s).replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1***@');
function die(msg, code = 2) { console.error(`✖ ${msg}`); process.exit(code); }

const file = process.argv[2];
if (!file || file.startsWith('--')) die('الاستخدام: node tools/restore-full-file.mjs <file.sql> --dsn "<dsn>" [--driver psql|pg]');
if (!existsSync(file)) die(`الملف غير موجود: ${file}`);

const dsn = arg('dsn') || process.env.HRC_RESTORE_DSN || null;
if (!dsn || dsn === true) die('مطلوب --dsn (أو HRC_RESTORE_DSN). لا تضع كلمة المرور في المحادثة — psql/pg يقرآنها من الـ DSN محلياً.');
if (String(dsn).includes(FORBIDDEN_REF)) die(`الـ DSN يشير إلى مشروع الإنتاج المحظور ${FORBIDDEN_REF} — رُفض التنفيذ.`);

const driver = String(arg('driver') || process.env.HRC_RESTORE_DRIVER || 'psql');
if (!['psql', 'pg'].includes(driver)) die(`سائق غير معروف: ${driver} (المسموح: psql أو pg)`);
const psql = arg('psql') || process.env.PSQL || 'psql';
const logPath = arg('log') || path.join(process.cwd(), `restore-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const doPatch = !arg('no-patch', false);
const yes = !!arg('yes', false);

/* ── ١) فحص الملف ──────────────────────────────────────────────────────── */
const raw = readFileSync(file);
const sha = createHash('sha256').update(raw).digest('hex');
const text = raw.toString('utf8');
const stmts = splitStatements(text);
/* ملاحظة: لا تستعمل تعبيراً نمطياً هنا — `^\s*(--[^\n]*\s*)+$` يُبتلى بتراجع كارثي
   على عبارة بحجم ٢٫٨ م.ب فيتوقّف التنفيذ بلا نهاية. الفحص سطراً سطراً خطّي وآمن. */
const isCommentOnly = (s) => s.split('\n').every((l) => { const t = l.trim(); return t === '' || t.startsWith('--'); });
const realStatements = stmts.filter((s) => !isCommentOnly(s)).length;
const known = KNOWN[sha];
const logLines = [];
function say(line) { logLines.push(line); console.log(line); }

say('══════ فحص ملف الاسترجاع ══════');
say(`الملف      : ${path.resolve(file)}`);
say(`الحجم      : ${raw.length.toLocaleString('en-US')} بايت`);
say(`SHAsum     : ${sha}`);
say(`العبارات   : ${stmts.length} مقطع (منها ${realStatements} عبارة فعلية + ${stmts.length - realStatements} ذيل تعليقات)`);
if (known) say(`النسخة     : ${known.label} — مطابقة للبصمة المعروفة ✔`);
else say('⚠ البصمة غير معروفة لهذه الأداة — تحقّق أنك تستخدم الملف الصحيح قبل المتابعة.');

/* ── ٢) الترقيع ─────────────────────────────────────────────────────────── */
let sql = text;
if (doPatch) {
  const res = patchTriggerBlocks(text);
  sql = res.text;
  for (const r of res.replaced) say(`ترقيع      : كتلة «${r.kind}» عند السطر ${r.line} → نسخة تسمّي كل مشغّل (بلا TRIGGER ALL)`);
  say(`ترقيع      : عدد العبارات بعد الترقيع ${res.statements} (بلا تغيير)`);
} else {
  say('⚠ الترقيع معطّل (--no-patch): على مشروع Supabase حديث ستفشل كتلة ENABLE TRIGGER ALL وتُجهض البيانات.');
}

const dir = mkdtempSync(path.join(tmpdir(), 'hrc-restore-'));
const patched = path.join(dir, 'HRC-FULL-patched.sql');
writeFileSync(patched, sql);
say(`ملف مؤقّت  : ${patched}`);

/* ── كلمة المرور تنتقل عبر البيئة (‏PGPASSWORD) لا عبر سطر الأوامر ─────── */
function connEnv(dsnStr) {
  const s = String(dsnStr);
  if (!/^postgres(ql)?:\/\//.test(s)) return { env: {}, extraArgs: ['-d', s] };
  let u;
  try { u = new URL(s); } catch { return { env: {}, extraArgs: ['-d', s] }; }
  const env = {};
  const hostParam = u.searchParams.get('host');
  if (hostParam) env.PGHOST = hostParam;
  else if (u.hostname) env.PGHOST = decodeURIComponent(u.hostname);
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db) env.PGDATABASE = db;
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  else env.PGSSLMODE = 'require';
  return { env, extraArgs: [] };
}
const conn = connEnv(dsn);
/* هل نحتاج TLS؟ نعم إن كان sslmode مطلوباً، أو إن كان المضيف TCP (لا مقبس يونكس) */
function sslFor(dsnStr) {
  const s = String(dsnStr);
  if (/sslmode=disable/.test(s)) return false;
  if (/sslmode=(require|verify-ca|verify-full|prefer)/.test(s)) return { rejectUnauthorized: false };
  const sockHost = /[?&]host=\//.test(s);
  return sockHost ? false : { rejectUnauthorized: false };
}
const baseEnv = {
  ...process.env, ...conn.env,
  PGCLIENTENCODING: 'UTF8',
  PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '30',
  PSQLRC: '/dev/null',
};

/* ── ٣) التنفيذ ─────────────────────────────────────────────────────────── */
say('');
say('══════ التنفيذ ══════');
say(`الهدف      : ${mask(dsn)}`);
say(`السائق     : ${driver}${driver === 'psql' ? ` (${psql})` : ' (npm pg — الملف كله في معاملة واحدة)'}`);
if (driver === 'psql' && !yes) say('(بلا --yes سيسأل psql عن كلمة المرور إن لم تكن في الـ DSN)');
say(`السجل      : ${logPath}`);

const errFrom = (out) => {
  const lines = String(out || '').split('\n');
  const at = [...lines].reverse().find((l) => /^psql:.*:\d+: (ERROR|FATAL)/.test(l))
          || [...lines].reverse().find((l) => /^(ERROR|FATAL):/.test(l)) || '';
  const msg = [...lines].reverse().find((l) => /\b(ERROR|FATAL):/.test(l)) || '(لا رسالة خطأ في المخرجات)';
  return { at, msg };
};

let execOutput = '';
if (driver === 'psql') {
  const run = spawnSync(psql, ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', ...conn.extraArgs, '-f', patched], {
    env: baseEnv, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  execOutput = (run.stdout || '') + (run.stderr || '');
  if (run.error) die(`تعذّر تشغيل psql (${run.error.code || run.error.message}). إن لم يكن مثبتاً استخدم --driver pg`);
  if (run.status !== 0) {
    writeFileSync(logPath, `# HRC restore\n# file=${file}\n# sha256=${sha}\n# dsn=${mask(dsn)}\n# driver=psql\n\n${execOutput}`);
    const { at, msg } = errFrom(execOutput);
    say('');
    say(`✖ فشل التنفيذ — رمز الخروج ${run.status}`);
    if (at) say(`  الموضع : ${at}`);
    say(`  الخطأ  : ${msg}`);
    say('  القاعدة : بعد فشل هنا **لا تُعِد التنفيذ عشوائياً**. افحص حالة brc أولاً (قد تكون المعاملة تراجعت كلياً).');
    say(`  السجل  : ${logPath}`);
    process.exit(1);
  }
  say('✔ psql أنهى الملف برمز خروج 0 (ON_ERROR_STOP=1)');
} else {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: String(dsn), ssl: sslFor(dsn), connectionTimeoutMillis: 30000 });
  try {
    await client.connect();
    say('✔ اتصلت بالقاعدة');
    const t0 = Date.now();
    await client.query(sql);              // بلا معاملات → بروتوكول بسيط → الملف كله معاملة واحدة
    say(`✔ نُفِّذ الملف كاملاً في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية`);
    await client.end();
  } catch (e) {
    writeFileSync(logPath, `# HRC restore\n# file=${file}\n# sha256=${sha}\n# dsn=${mask(dsn)}\n# driver=pg\n\n${execOutput}\n${e.stack || e.message}`);
    say('');
    say('✖ فشل التنفيذ (المعاملة تراجعت — لم يُثبَّت شيء)');
    say(`  الخطأ  : ${e.message}`);
    if (e.position) say(`  الموضع : position ${e.position} داخل الملف المرقّع (${patched})`);
    say(`  السجل  : ${logPath}`);
    try { await client.end(); } catch { /* ignore */ }
    process.exit(1);
  }
}

/* ── ٤) التحقّق ─────────────────────────────────────────────────────────── */
const countSql = `
select json_build_object(
  'staff', (select count(*) from brc.staff),
  'applicants', (select count(*) from brc.applicants),
  'jobs', (select count(*) from brc.jobs),
  'job_attempts', (select count(*) from brc.job_attempts),
  'issued_serials', (select count(*) from brc.issued_serials),
  'card_number_registry', (select count(*) from brc.card_number_registry),
  'audit_log', (select count(*) from brc.audit_log),
  'settings', (select count(*) from brc.settings),
  'recovery_chances', (select count(*) from brc.recovery_chances),
  'recovery_prints', (select count(*) from brc.recovery_prints),
  'office_receipts', (select count(*) from brc.office_receipts),
  'printed', (select count(*) from brc.recovery_prints where printed),
  'spent', (select count(*) from brc.recovery_chances where spent),
  'counter', (select last_number from brc.card_number_counter),
  'cards', (select count(*) from brc.recovery_prints),
  'disabled_triggers', (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                          join pg_namespace n on n.oid=c.relnamespace
                         where n.nspname='brc' and not t.tgisinternal and t.tgenabled <> 'O'),
  'auth_linked', (select count(*) from brc.staff where auth_id is not null)
) as v;`;

let got;
if (driver === 'psql') {
  const ver = spawnSync(psql, ['--no-psqlrc', '-A', '-t', ...conn.extraArgs, '-c', countSql], {
    env: baseEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (ver.status !== 0) die(`تعذّر تشغيل استعلامات التحقّق: ${(ver.stderr || '').trim().split('\n').pop()}`);
  try { got = JSON.parse(ver.stdout.trim()); } catch { die(`مخرجات التحقّق غير مفهومة: ${String(ver.stdout).slice(0, 200)}`); }
} else {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: String(dsn), ssl: sslFor(dsn), connectionTimeoutMillis: 30000 });
  await client.connect();
  const r = await client.query(countSql);
  got = r.rows[0].v;
  await client.end();
}

say('');
say('══════ التحقّق بعد التنفيذ ══════');
let fail = 0;
const rows = [];
for (const [k, want] of Object.entries({ ...EXPECTED, ...EXPECTED_EXTRA })) {
  const have = Number(got[k]);
  const ok = have === want;
  if (!ok) fail++;
  rows.push(`${ok ? '✔' : '✖'} ${k.padEnd(22)} المتوقع ${String(want).padStart(6)}   الفعلي ${String(have).padStart(6)}`);
}
rows.push(`ℹ auth_linked            (معلوماتي) ${got.auth_linked} — الروابط تُنشأ بعد إنشاء حسابات Auth`);
rows.forEach(say);
writeFileSync(logPath, `# HRC restore\n# file=${file}\n# sha256=${sha}\n# dsn=${mask(dsn)}\n# driver=${driver}\n\n${execOutput}\n${logLines.join('\n')}\n`);
say('');
if (fail === 0) {
  say('✅ PASS — كل الأعداد مطابقة لنسخة 2026-11-19. لا تشغّل الموقع قبل ربط الحسابات ورفع الصور.');
  say(`السجل: ${logPath}`);
} else {
  say(`❌ FAIL — ${fail} قيمة مخالفة. لا تبدأ العمل على هذه القاعدة. السجل: ${logPath}`);
  process.exit(1);
}
