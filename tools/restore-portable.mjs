#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   hrc-restore — استرجاع نسخة محمولة إلى قاعدة PostgreSQL
   ---------------------------------------------------------------------------
   يفكّ ملف .hrcbak (AES-256-GCM + PBKDF2-SHA256) ويولّد ملف SQL، أو ينفّذه
   مباشرة على قاعدة يحدّدها المستخدم.

   الاستخدام:
     node tools/restore-portable.mjs نسخة.hrcbak                # يولّد SQL فقط
     node tools/restore-portable.mjs نسخة.hrcbak --out bk.sql
     node tools/restore-portable.mjs نسخة.hrcbak --database URL # ينفّذ مباشرة

   الأمان:
     • كلمة المرور تُقرأ من الطرفية بلا صدى (stdin) أو من HRC_BACKUP_PASSWORD.
     • لا تُطبع ولا تُسجَّل ولا تُمرَّر على سطر الأوامر (لا تظهر في ps).
     • الملف لا يُعدَّل.

   المتطلبات: node 18+ (webcrypto مدمج). للتنفيذ المباشر: حزمة `pg`.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createInterface } from 'node:readline';

const { subtle } = webcrypto;
const FORMAT = 'HRC-BACKUP/1';

/* ── أدوات ──────────────────────────────────────────────────────────────── */
const die = (m) => { console.error('\n  ✗ ' + m + '\n'); process.exit(1); };
const ok = (m) => console.log('  ✓ ' + m);
const info = (m) => console.log('  · ' + m);

function fromB64(s) {
  const buf = Buffer.from(s, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function toB64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/* ── قراءة كلمة المرور بلا صدى ──────────────────────────────────────────── */
function askPassword(prompt) {
  if (process.env.HRC_BACKUP_PASSWORD) return Promise.resolve(process.env.HRC_BACKUP_PASSWORD);
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {};          /* كتم الصدى */
    rl.question('', (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

/* ── فكّ التشفير ────────────────────────────────────────────────────────── */
async function decrypt(envelope, password) {
  let env;
  try { env = JSON.parse(envelope); }
  catch { die('الملف ليس JSON صالحاً — تأكد أنه ملف .hrcbak'); }

  if (env.format !== FORMAT) die(`إصدار غير مدعوم: ${env.format} (المتوقع ${FORMAT})`);
  if (env.cipher !== 'AES-256-GCM') die('خوارزمية التشفير غير معروفة: ' + env.cipher);

  const iterations = Number(env.iterations);
  if (!Number.isFinite(iterations) || iterations < 100000) die('عدد دورات الاشتقاق غير مقبول');

  const salt = fromB64(env.salt);
  const iv = fromB64(env.iv);
  const data = fromB64(env.data);
  if (iv.length !== 12 || salt.length < 16) die('ترويسة الملف تالفة');

  info(`اشتقاق المفتاح — ${iterations.toLocaleString('en-US')} دورة PBKDF2-SHA256…`);
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );

  let plain;
  try {
    plain = await subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, data);
  } catch {
    die('كلمة المرور غير صحيحة، أو أن الملف تغيّر بعد تنزيله');
  }

  const bytes = new Uint8Array(plain);
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  const hex = Buffer.from(digest).toString('hex');
  if (env.checksum && hex !== env.checksum) die('بصمة البيانات لا تطابق الملف — النسخة معدَّلة');

  let payload;
  try { payload = JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch { die('محتوى النسخة غير صالح بعد فك التشفير'); }

  return { payload, checksum: hex, bytes: bytes.length };
}

/* ── توليد SQL ──────────────────────────────────────────────────────────── */
const IDENT = (s) => '"' + String(s).replace(/"/g, '""') + '"';

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function insertRows(table, rows, columns) {
  if (!rows || !rows.length) return '';
  const cols = columns.filter((c) => rows.some((r) => r[c] !== undefined));
  if (!cols.length) return '';
  const values = rows.map((r) => '  (' + cols.map((c) => lit(r[c])).join(', ') + ')').join(',\n');
  return `-- ${rows.length} صفاً في ${table}\nINSERT INTO brc.${IDENT(table)} (${cols.map(IDENT).join(', ')})\nVALUES\n${values};\n\n`;
}

function buildSql(p) {
  const head = `-- ═══════════════════════════════════════════════════════════════════════════
--  HRC — استرجاع نسخة محمولة
--  أُنشئت في : ${p.exportedAt || '—'}
--  البصمة    : ${p.schema || '—'}
--  الأعداد   : ${JSON.stringify(p.counts || {})}
--
--  ⚠ لا تُشغّل هذا الملف على قاعدة فيها بيانات — يبدأ بـ TRUNCATE.
--  ⚠ استرجعه على قاعدة جديدة أولاً، وتحقّق من الأعداد قبل نقلها للإنتاج.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_encoding = 'UTF8';
BEGIN;

CREATE SCHEMA IF NOT EXISTS brc;

-- إفراغ بنفس ترتيب المفاتيح الأجنبية
TRUNCATE brc.job_attempts, brc.applicants, brc.jobs, brc.employer_job_credentials, brc.issued_serials, brc.audit_log, brc.settings RESTART IDENTITY CASCADE;

`;

  let body = '';
  body += insertRows('jobs', p.jobs, ['id', 'code', 'title', 'category', 'region', 'governorate', 'shift', 'salary_min', 'salary_max', 'gender', 'vacancies', 'requirements', 'status', 'hold_expires_at', 'created_at', 'description', 'image_url', 'available_vacancies', 'company', 'employer_name', 'employer_phone', 'employer_address', 'interview_location', 'created_by', 'updated_at']);
  body += insertRows('applicants', p.applicants, ['serial', 'full_name', 'phone', 'status', 'fee_paid', 'printed', 'created_at', 'expiry_date', 'notes', 'address', 'gender', 'region', 'job_id', 'chances', 'staff_id', 'updated_at']);
  body += insertRows('job_attempts', p.job_attempts, ['serial', 'attempt_no', 'slot_status', 'job_id', 'job_code', 'chance_code', 'selected_at', 'hold_expires_at', 'closed_at', 'outcome', 'outcome_note', 'created_at']);
  body += insertRows('settings', p.settings, ['key', 'value', 'updated_at', 'updated_by']);
  body += insertRows('employer_job_credentials', p.employer_job_credentials, ['job_id', 'pin_hash', 'failures', 'window_start', 'changed_at']);
  body += insertRows('issued_serials', p.issued_serials, ['serial', 'issued_at', 'note']);
  body += insertRows('audit_log', p.audit_log, ['id', 'ts', 'user_id', 'username', 'role', 'ip', 'action', 'entity', 'entity_id', 'details', 'diff']);

  /* بعد الإدخال: اضبط تسلسلات bigint كي لا تتصادم الصفوف الجديدة. */
  const tail = `
-- إعادة ضبط التسلسلات بعد الإدخال بأرقام صريحة
SELECT setval(pg_get_serial_sequence('brc.audit_log', 'id'),
              COALESCE((SELECT MAX(id) FROM brc.audit_log), 1), true);

COMMIT;

-- تحقّق
SELECT 'jobs' AS tbl, count(*) FROM brc.jobs
UNION ALL SELECT 'applicants', count(*) FROM brc.applicants
UNION ALL SELECT 'job_attempts', count(*) FROM brc.job_attempts
UNION ALL SELECT 'audit_log', count(*) FROM brc.audit_log
UNION ALL SELECT 'issued_serials', count(*) FROM brc.issued_serials
ORDER BY tbl;
`;

  return head + body + tail;
}

/* ── التنفيذ ────────────────────────────────────────────────────────────── */
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(`
  استرجاع نسخة محمولة — منصة مكسب للتوظيف

    node tools/restore-portable.mjs <ملف.hrcbak>                  يولّد SQL
    node tools/restore-portable.mjs <ملف.hrcbak> --out bk.sql
    node tools/restore-portable.mjs <ملف.hrcbak> --database URL   ينفّذ مباشرة
    node tools/restore-portable.mjs <ملف.hrcbak> --inspect        يفحص بلا فكّ

  كلمة المرور: تُطلب من الطرفية بلا صدى، أو HRC_BACKUP_PASSWORD.
`);
    process.exit(0);
  }

  const file = args.find((a) => !a.startsWith('--') && !args.slice(args.indexOf(a) - 1)[0]?.startsWith('--out'));
  if (!file) die('لم تحدّد اسم الملف');

  let raw;
  try { raw = readFileSync(file, 'utf8'); }
  catch { die('تعذّرت قراءة الملف: ' + file); }

  const env = JSON.parse(raw);
  info(`الملف: ${file} (${fmtBytes(raw.length)})`);
  info(`الصيغة: ${env.format} · ${env.cipher} · ${Number(env.iterations).toLocaleString('en-US')} دورة`);
  if (env.counts) info(`الأعداد: ${JSON.stringify(env.counts)}`);

  if (args.includes('--inspect')) { ok('فحص فقط — لم يُفكّ التشفير'); return; }

  const password = await askPassword('  كلمة مرور النسخة: ');
  if (!password) die('لم تُدخل كلمة مرور');

  const { payload, checksum, bytes } = await decrypt(raw, password);
  ok(`فُكّ التشفير — ${fmtBytes(bytes)} · البصمة ${checksum.slice(0, 16)}…`);

  const sql = buildSql(payload);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : file.replace(/\.hrcbak$/, '') + '-restore.sql';

  if (args.includes('--database')) {
    const url = args[args.indexOf('--database') + 1];
    if (!url) die('--database يحتاج رابط اتصال');
    let pg;
    try { pg = await import('pg'); }
    catch { die('التنفيذ المباشر يحتاج حزمة pg — شغّل: npm i pg'); }
    const client = new pg.default.Client({ connectionString: url });
    await client.connect();
    info('متصل — تنفيذ السكربت…');
    await client.query(sql);
    await client.end();
    ok('اكتمل الاسترجاع');
    return;
  }

  writeFileSync(outPath, sql, 'utf8');
  ok(`كُتب ${outPath} (${fmtBytes(Buffer.byteLength(sql))})`);
  console.log(`
  التالي:
    psql "<رابط القاعدة الجديدة>" -f ${outPath}
`);
}

main().catch((e) => die(e.message || String(e)));
