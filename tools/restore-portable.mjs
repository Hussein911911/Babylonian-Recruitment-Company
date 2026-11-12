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

/* تمثيل قيمة SQL.
   ⚠ عطل حقيقي وجده الفحص على قاعدة PGlite:
   المصفوفة كانت تُرسل كـ`'[...]'::jsonb`، والقاعدة ترفضها:
   «column "filled_vacancy_numbers" is of type integer[] but expression is of type jsonb»
   فتفشل عملية الاسترجاع كلها. المصفوفات الآن تُرسل بصيغة PostgreSQL
   الحقيقية: `{1,2}` أو `{"نص"}`، بلا ::jsonb. */
function arrayLit(arr) {
  const parts = arr.map((x) => {
    if (x === null || x === undefined) return 'NULL';
    if (typeof x === 'number') return String(x);
    if (typeof x === 'boolean') return x ? 'true' : 'false';
    /* العناصر النصية: تُحاط بعلامات تنصيص دائمًا ونُهرّب \ و " */
    const t = String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return '"' + t + '"';
  });
  return "'{" + parts.join(',') + "}'";
}

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (Array.isArray(v)) return arrayLit(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/* ── اختيار الأعمدة: من الصف نفسه، لا من قائمة يدوية ───────────────────────
   كانت هناك قائمة أعمدة مكتوبة يدوياً لكل جدول، وقد تقادمت بصمت:
   `available_vacancies` و`company` و`printed` و`chances` و`outcome`
   و`region` و`job_id` لم تعد موجودة، و`card_print_code` و`archived_at`
   و`employer_decision` (حقول أمنية) لم تكن مذكورة إطلاقاً.
   النتيجة: SQL يفشل أو يسترجع بيانات ناقصة بلا تحذير.
   الحل: نأخذ مفاتيح الصف الفعلية من الحمولة، ونقصّها على الأعمدة
   الموجودة فعلاً في القاعدة الهدف إن توفّرت لدينا القائمة؛ وإلا نستخدم
   مفاتيح الصف كما هي. لا قائمة يدوية بعد اليوم. */
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function columnsOf(rows, allow) {
  const seen = new Set();
  (rows || []).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    Object.keys(r).forEach((k) => { if (SAFE_IDENT.test(k)) seen.add(k); });
  });
  let cols = [...seen];
  if (allow && allow.length) cols = cols.filter((c) => allow.includes(c));
  /* ترتيب ثابت كي يكون الناتج قابلاً للمقارنة بين تشغيلين */
  return cols.sort();
}

function insertRows(table, rows, allow) {
  if (!rows || !rows.length) return '';
  const cols = columnsOf(rows, allow);
  if (!cols.length) return `-- ⚠ ${table}: لا أعمدة صالحة — تم تخطّي ${rows.length} صفاً\n\n`;
  const values = rows.map((r) => '  (' + cols.map((c) => lit(r[c])).join(', ') + ')').join(',\n');
  return `-- ${rows.length} صفاً في ${table} (${cols.length} عموداً)\nINSERT INTO brc.${IDENT(table)} (${cols.map(IDENT).join(', ')})\nVALUES\n${values};\n\n`;
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
--  ⚠ يجب أن يكون مخطط brc منشأً قبل التنفيذ (docs/schema.sql أو الهجرات).
-- ═══════════════════════════════════════════════════════════════════════════

SET client_encoding = 'UTF8';
BEGIN;

CREATE SCHEMA IF NOT EXISTS brc;

-- إفراغ بنفس ترتيب المفاتيح الأجنبية
TRUNCATE brc.job_attempts, brc.applicants, brc.jobs, brc.employer_job_credentials, brc.issued_serials, brc.audit_log, brc.settings RESTART IDENTITY CASCADE;

`;

  let body = '';
  body += insertRows('jobs', p.jobs);
  body += insertRows('applicants', p.applicants);
  body += insertRows('job_attempts', p.job_attempts);
  body += insertRows('settings', p.settings);
  body += insertRows('employer_job_credentials', p.employer_job_credentials);
  body += insertRows('issued_serials', p.issued_serials);
  body += insertRows('audit_log', p.audit_log);

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

/* التصدير للفحص: يسمح باختبار مُولِّد SQL على قاعدة حقيقية بلا كلمة مرور.
   ولا يغيّر سلوك سطر الأوامر — main() لا تُستدعى عند الاستيراد. */
export { buildSql, columnsOf };
const isDirectRun = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href;
if (isDirectRun) main().catch((e) => die(e.message || String(e)));
