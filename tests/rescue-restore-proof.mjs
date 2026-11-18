/* فحص النسخة المُصلَحة: يستورد ملف SQL كاملاً على PostgreSQL 17 (PGlite)
   ويقارن كل عدد بعدد الإنتاج. يُتخطّى تلقائياً إن غاب الملف (gitignored).

   التشغيل: node tests/rescue-restore-proof.mjs [مسار الملف] */
import { readFileSync, existsSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { splitStatements } from '../tools/sql-split-core.mjs';

const FILE = process.argv[2] ?? 'rescue/database/HRC-FULL-2026-11-18-REPAIRED.sql';

// الأعداد من الإنتاج — المرجع. لا تُعدَّل إلا بسحب جديد من الإنتاج.
const TABLES = {
  applicants: 725, jobs: 22, job_attempts: 1535, issued_serials: 769,
  audit_log: 3803, settings: 5, staff: 3, employer_job_credentials: 3,
  card_number_registry: 175, recovery_prints: 725, recovery_chances: 1535,
  card_issue_requests: 29, office_receipts: 0,
};
const DERIVED = {
  'prints.printed': ['select count(*)::int n from brc.recovery_prints where printed', 422],
  'chances.spent': ['select count(*)::int n from brc.recovery_chances where spent', 46],
  'counter.last_number': ['select last_number::int n from brc.card_number_counter', 175],
};

if (!existsSync(FILE)) {
  console.log(`تخطٍّ: ${FILE} غير موجود (ملف بيانات خاص، خارج Git)`);
  process.exit(0);
}

// المخطط الكامل كما في الإنتاج: أدوار، auth، storage، cron، extensions.
// يُستورد من pg-shim.mjs — نسخة واحدة، فلا تنحرف نسختان.
import { SHIM } from './pg-shim.mjs';

const stmts = splitStatements(readFileSync(FILE, 'utf8'));
const db = new PGlite();
await db.exec(SHIM);

const fails = [];
for (const s of stmts) {
  try { await db.exec(s); } catch (e) { fails.push(e.message.slice(0, 90)); }
}

const one = async (sql) => {
  try { return (await db.query(sql)).rows[0]; } catch { return null; }
};

let bad = 0;
for (const [t, want] of Object.entries(TABLES)) {
  const r = await one(`select count(*)::int n from brc.${t}`);
  const n = r ? r.n : -1;
  if (n !== want) bad++;
  console.log(`${n === want ? '✅' : '❌'} ${t}: ${n}/${want}`);
}
for (const [label, [sql, want]] of Object.entries(DERIVED)) {
  const r = await one(sql);
  const n = r ? r.n : -1;
  if (n !== want) bad++;
  console.log(`${n === want ? '✅' : '❌'} ${label}: ${n}/${want}`);
}

// المشغّلات كلها فعّالة — تعطيلها الدائم أسوأ من فشل الاستيراد.
const tg = await one(`select count(*)::int n from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'brc' and not t.tgisinternal and t.tgenabled <> 'O'`);
if (tg.n !== 0) bad++;
console.log(`${tg.n === 0 ? '✅' : '❌'} مشغّلات معطّلة: ${tg.n}/0`);

// الرقم التالي بعد الاسترجاع 176 لا 1 — أخطر عطل إن فشل.
const next = await one(`update brc.card_number_counter set last_number = last_number + 1
  where singleton returning last_number::int n`);
if (!next || next.n !== 176) bad++;
console.log(`${next && next.n === 176 ? '✅' : '❌'} الرقم التالي 176: ${next ? next.n : '-'}`);

console.log(`\nعبارات: ${stmts.length} | فشل: ${fails.length} | اختلافات: ${bad}`,
  fails.slice(0, 3));
process.exit(bad || fails.length ? 1 : 0);
