#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — التحقّق التنفيذي من أجزاء SQL
   ---------------------------------------------------------------------------
   لا يكفي فحص النص: التقسيم قد يُنتج ملفاً «يبدو» صحيحاً ويفشل عند التنفيذ.
   هذا السكربت يُنفّذ الأجزاء على قاعدة PostgreSQL حقيقية (PGlite)، **كل جزء
   بمعاملة منفصلة** — تماماً كما يفعل محرّر Supabase بين لصقة وأخرى. لو نجح
   هنا، فالتقسيم صالح فعلاً.

   التشغيل:  node tools/verify-sql-parts.mjs <مجلد> [<مجلد> …]
   مثال    :  node tools/verify-sql-parts.mjs docs/sql-parts/schema \
                                             docs/sql-parts/extra  \
                                             docs/sql-parts/data
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

/* ═══ الاختبار الحاسم ═══
   نفس ترتيب المستخدم: ① سكيما (٥ أجزاء) ② بيانات (١٠ أجزاء).
   كل جزء يُنفَّذ بمعاملته المستقلّة. ثم نقارن الأعداد بالمطلوب. */
const db = new PGlite();
await db.exec(`create schema if not exists auth; create schema if not exists extensions;`);
await db.exec(`create table if not exists auth.users(id uuid primary key, email text);`);
await db.exec(`create table if not exists auth.sessions(id uuid primary key, user_id uuid);`);
await db.exec(`do $do$ begin create role anon; create role authenticated; create role service_role;
  exception when others then null; end $do$;`);
for (const q of [
  `create or replace function auth.uid() returns uuid language sql as 'select null::uuid'`,
  `create or replace function auth.jwt() returns jsonb language sql as 'select ''{}''::jsonb'`,
  `create or replace function auth.role() returns text language sql as 'select ''anon'''`,
  `create or replace function extensions.gen_random_bytes(int) returns bytea language sql as 'select decode(''0000000000000000'',''hex'')'`,
  `create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select ''00000000-0000-0000-0000-000000000001''::uuid'`,
  `create or replace function extensions.gen_salt(text) returns text language sql as 'select ''stub'''`,
  `create or replace function extensions.crypt(text, text) returns text language sql as 'select ''stub'''`,
  `create or replace function extensions.digest(text, text) returns bytea language sql as 'select decode(''00'',''hex'')'`,
  `create or replace function extensions.digest(bytea, text) returns bytea language sql as 'select decode(''00'',''hex'')'`,
]) { try { await db.exec(q); } catch {} }

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('الاستعمال: node tools/verify-sql-parts.mjs <مجلد> [<مجلد> …]');
  process.exit(2);
}

const run = async (dir, label) => {
  let parts = readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('INDEX')).sort();
  /* ملف واحد بلا لاحقة part = ملف كامل */
  if (!parts.some((f) => f.includes('-part-'))) parts = parts.filter((f) => f !== 'INDEX');
  console.log(`\n── ${label} (${parts.length} جزءاً) ──`);
  let bad = 0;
  for (const p of parts) {
    try { await db.exec(readFileSync(dir + '/' + p, 'utf8')); console.log(`   ✅ ${p}`); }
    catch (e) { bad++; console.log(`   ❌ ${p} — ${String(e.message).split('\n')[0].slice(0, 130)}`); try { await db.exec('ROLLBACK;'); } catch {} }
  }
  return bad;
};

const LABELS = ['① السكيما', '② البيانات'];
let bad = 0, total = 0;
for (let i = 0; i < dirs.length; i++) {
  const before = bad;
  bad += await run(dirs[i], LABELS[i] || dirs[i]);
  total += readdirSync(dirs[i]).filter((f) => f.endsWith('.sql')).length;
}

console.log('\n════════ الأعداد النهائية ════════');
/* الأعداد المتوقعة: من تعليق «الأعداد» أعلى ملف البيانات إن وُجد، وإلا تُطبع
   الأعداد الفعلية للمقارنة اليدوية بأعداد النسخة الأصلية. */
const checks = [];
const expected = process.env.HRC_EXPECT;
if (expected) {
  for (const pair of expected.split(',')) {
    const [t, n] = pair.split('=');
    if (t && n) checks.push([t.trim(), Number(n)]);
  }
}
let allOk = true;
for (const [t, want] of checks) {
  try {
    const r = await db.query(`select count(*)::int c from brc.${t}`);
    const got = r.rows[0].c;
    const ok = got === want;
    if (!ok) allOk = false;
    console.log(`   ${ok?'✅':'⚠️ '} ${t.padEnd(16)} ${String(got).padStart(5)}  (المتوقع ${want})`);
  } catch (e) { allOk = false; console.log(`   ❌ ${t}: ${e.message.slice(0,80)}`); }
}
const f = await db.query(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='brc'`);
const tt = await db.query(`select count(*)::int c from pg_tables where schemaname='brc'`);
console.log(`   ℹ️  دوال brc: ${f.rows[0].c} · جداول brc: ${tt.rows[0].c}`);
if (!checks.length) console.log('   ℹ️  مرّر HRC_EXPECT="jobs=47,applicants=440,…" للمقارنة الآلية');
console.log(bad === 0 ? `\n✅✅ الإثبات كامل: ${total} ملفاً نُفِّذت بالترتيب، كل واحد بمعاملة مستقلّة` : `\n❌ ${bad} ملفاً فشل`);
await db.close();
