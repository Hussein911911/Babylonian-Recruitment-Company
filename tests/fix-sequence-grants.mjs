/* ═══ هل ملف الإصلاح يعمل فعلاً على قاعدة معطوبة؟ ═══════════════════════
   هذا هو أهم فحص في الحزمة: نُعيد إنتاج العطل بالضبط (نُطبّق السكيما
   القديمة، فنحصل على قاعدة بلا منح تسلسلات)، ثم نُطبّق ملف الإصلاح ونتأكد
   أن العطل زال. لو لم نُعِد إنتاج العطل لكان الفحص بلا معنى — يمرّ دائماً. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

const SHIM = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT current_user::text $f$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
  CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS cron; CREATE SCHEMA IF NOT EXISTS storage;
  CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(int) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5(random()::text),'hex') $f$;
  CREATE OR REPLACE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5($1),'hex') $f$;
  DO $d$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='staff_test') THEN CREATE ROLE staff_test NOLOGIN IN ROLE authenticated; END IF;
  END $d$;`;

async function fresh() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(SHIM);
  return db;
}

/* نُعيد إنتاج عطل المالك: قاعدة بُنيت من السكيما الحالية، ثم **نُزيل**
   منح التسلسلات منها — فتلك كانت حالة قاعدة المالك بالضبط.
   (كنّا نقرأ نسخة قديمة من /tmp/old.sql، وهو مسار مؤقت لا يبقى بين
   الجلسات فيفشل الفحص عند أول تشغيل على جهاز آخر. الآن مكتفٍ بذاته.) */
async function broken() {
  const db = await fresh();
  await db.exec(readFileSync('docs/schema.sql', 'utf8').replace(/CREATE EXTENSION[^;]*;/gi, '--'));
  /* نُزيل منح التسلسل عمداً — هكذا كانت قاعدة المالك فعلاً */
  await db.exec(`do $d$ declare r record; begin
    for r in select c.relname from pg_class c
      where c.relkind='S' and c.relnamespace='brc'::regnamespace loop
      execute format('revoke all on sequence brc.%I from authenticated', r.relname);
    end loop; end $d$;`);
  return db;
}

console.log('\n═══ ١) العطل مُعاد إنتاجه فعلاً ═══');
const db = await broken();
const before = await db.query(`select has_sequence_privilege('authenticated','brc.audit_log_id_seq','USAGE') as u`);
check('التسلسل محجوب قبل الإصلاح', before.rows[0].u === false, 'لم نُعِد إنتاج العطل!');

/* نجعل الموظف قادراً على الإدراج في الجدول — تماماً كقاعدة المالك */
await db.exec(`grant usage on schema brc to staff_test;
  grant select, insert, update on brc.audit_log to staff_test; grant select on brc.staff to staff_test;
  insert into auth.users (id,email) values ('22222222-2222-2222-2222-222222222222','t@t') on conflict do nothing;
  insert into brc.staff (auth_id,username,full_name,role,active)
  values ('22222222-2222-2222-2222-222222222222','fixer','مُصلِح','staff',true) on conflict (username) do nothing;
  set role staff_test;`);
await db.query(`select set_config('test.uid','22222222-2222-2222-2222-222222222222', false)`);
let err = null;
try {
  await db.exec(`insert into brc.audit_log (username,role,action,entity,entity_id,details)
    values ('fixer','staff','فحص','t','—','x')`);
} catch (e) { err = e.message; }
check('الإدراج يفشل بنفس خطأ المالك', /permission denied for sequence/.test(err || ''),
  err ? err.slice(0, 90) : 'نجح — العطل غير مُعاد إنتاجه');
await db.exec(`reset role;`);

console.log('\n═══ ٢) تطبيق ملف الإصلاح ═══');
try {
  await db.exec(readFileSync('docs/sql-parts/fixes/01-sequence-grants.sql', 'utf8'));
  check('ملف الإصلاح نُفِّذ بلا خطأ', true);
} catch (e) {
  check('ملف الإصلاح نُفِّذ بلا خطأ', false, e.message.split('\n')[0].slice(0, 120));
}

console.log('\n═══ ٣) العطل زال ═══');
const seqs = await db.query(`select c.relname n,
    has_sequence_privilege('authenticated', c.oid, 'USAGE') u,
    has_sequence_privilege('authenticated', c.oid, 'UPDATE') up
  from pg_class c where c.relkind='S' and c.relnamespace='brc'::regnamespace order by 1`);
for (const r of seqs.rows) {
  check(`${r.n}: USAGE`, r.u === true, 'ما زال محجوباً');
  check(`${r.n}: UPDATE`, r.up === true, 'ناقص — nextval سيفشل');
}

await db.exec(`set role staff_test;`);
await db.query(`select set_config('test.uid','22222222-2222-2222-2222-222222222222', false)`);
err = null;
try {
  await db.exec(`insert into brc.audit_log (username,role,action,entity,entity_id,details)
    values ('fixer','staff','بعد الإصلاح','t','—','x')`);
} catch (e) { err = e; }
check('الإدراج في audit_log نجح بعد الإصلاح', !err, err && err.message.split('\n')[0].slice(0, 110));
try {
  const r = await db.query(`select brc.next_job_code() as c`);
  check('next_job_code نجحت', /^HRC-\d+$/.test(r.rows[0].c), JSON.stringify(r.rows[0]));
} catch (e) { check('next_job_code نجحت', false, e.message.split('\n')[0].slice(0, 110)); }
await db.exec(`reset role;`);

console.log('\n═══ ٤) آمن للتكرار (idempotent) ═══');
try {
  await db.exec(readFileSync('docs/sql-parts/fixes/01-sequence-grants.sql', 'utf8'));
  check('تشغيله مرتين لا يفشل', true);
} catch (e) {
  check('تشغيله مرتين لا يفشل', false, e.message.split('\n')[0].slice(0, 120));
}

console.log('\n═══ ٥) لم يمسّ بيانات ═══');
const n = await db.query(`select count(*)::int n from brc.audit_log`);
check('لا أسطر حُذفت', n.rows[0].n === 1, n.rows[0].n + ' سطراً');

await db.close();
console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — الإصلاح يعمل على قاعدة معطوبة` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
