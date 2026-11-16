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

/* ── توليد SQL: من الوحدة المشتركة ───────────────────────────────────────
   لم نُبقِ نسخة من المنطق هنا. `assets/js/restore-sql.js` هو المصدر الوحيد،
   يُحمَّل في المتصفح مباشرة ويُستورد هنا. سبب وجود وحدة مشتركة: كان هذا
   الملف يحمل نسخة من قواعد الأعمدة، وأي تحديث للجدول لا يصل إليها — فسقطت
   `card_print_code` و`archived_at` و`employer_decision` بصمت، وفشل الاسترجاع.
   الآن لا يمكن أن يتفرّع المنطقان. */
const SQL = await (async () => {
  if (typeof globalThis.HRCRestoreSql === 'undefined') {
    await import('../assets/js/restore-sql.js');
  }
  return globalThis.HRCRestoreSql;
})();
const { buildSql, columnsOf } = SQL;

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

    /* ═══ لماذا لا نكتفي بـ«اكتمل»؟ ═══════════════════════════════════════
       لأن الملف يبدأ بـ `BEGIN`، وأي خطأ في وسطه يُجهض المعاملة **كلها**.
       فيظهر للمستخدم «اكتمل» بينما القاعدة فارغة — وهذا أسوأ ما يمكن أن
       يحدث في يوم استرجاع حقيقي. لذلك نقرأ الأعداد من القاعدة نفسها بعد
       التنفيذ ونقارنها بأعداد النسخة. لا ادّعاء بلا إثبات. */
    const t0 = Date.now();
    await client.query(sql);

    const want = payload.counts || {};
    const expected = {
      jobs: want.jobs != null ? want.jobs : (payload.jobs || []).length,
      applicants: want.applicants != null ? want.applicants : (payload.applicants || []).length,
      job_attempts: want.attempts != null ? want.attempts : (payload.job_attempts || []).length,
      audit_log: want.audit != null ? want.audit : (payload.audit_log || []).length
    };
    let mismatch = 0;
    console.log('');
    for (const [table, exp] of Object.entries(expected)) {
      if (!exp) continue;
      let got = null;
      try {
        const r = await client.query('select count(*)::int n from brc.' + table);
        got = r.rows[0].n;
      } catch (e) {
        got = 'تعذّر العدّ: ' + (e.message || '').split('\n')[0];
      }
      const fine = String(got) === String(exp);
      if (!fine) mismatch++;
      console.log(`  ${fine ? '✓' : '✗'} brc.${table}: ${got} (المتوقع ${exp})`);
    }
    await client.end();

    if (mismatch) {
      die(`الاسترجاع لم يكتمل — ${mismatch} جدولاً بأعداد مختلفة. القاعدة لم تُترك فارغة بالكامل، لكن لا تعتمد عليها قبل المعالجة.`);
    }
    ok(`اكتمل الاسترجاع وتحقّق — ${((Date.now() - t0) / 1000).toFixed(1)} ثانية`);
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
