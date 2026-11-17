/* ═══ هل تعمل **أجزاء اللصق** فعلاً؟ ═══════════════════════════════════════
   المالك لا يُنفّذ docs/schema.sql، بل يلصق ٥ أجزاء واحداً بعد الآخر في
   محرّر Supabase. فإن لم يحمل الجزءُ المنحَ، بقي العطل رغم إصلاحنا للمصدر.

   هذا الفحص يُطبّق الأجزاء الخمسة بالترتيب — كما يفعل المالك حرفياً — ثم
   يتحقق أن منح التسلسلات وصل، وأن الإدراج في audit_log ينجح فعلاً. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

const db = new PGlite(); await db.waitReady;
await db.exec(`
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
  END $d$;`);

const files = readdirSync('docs/sql-parts/schema').filter(f => /^schema-part-\d+\.sql$/.test(f)).sort();
console.log('\n═══ لصق الأجزاء بالترتيب (كما يفعل المالك) ═══');
check('وُجدت ٥ أجزاء', files.length === 5, files.length + ' جزءاً');

for (const f of files) {
  const sql = readFileSync('docs/sql-parts/schema/' + f, 'utf8')
    .replace(/CREATE EXTENSION[^;]*;/gi, '--');
  try {
    await db.exec(sql);
    check(`${f} لُصق بلا خطأ`, true);
  } catch (e) {
    check(`${f} لُصق بلا خطأ`, false, e.message.split('\n')[0].slice(0, 120));
  }
}

console.log('\n═══ هل وصل منح التسلسلات بعد اللصق؟ ═══');
const seqs = await db.query(`select c.relname n,
    has_sequence_privilege('authenticated', c.oid, 'USAGE') u,
    has_sequence_privilege('authenticated', c.oid, 'UPDATE') up
  from pg_class c where c.relkind='S' and c.relnamespace='brc'::regnamespace order by 1`);
check('وُجدت تسلسلات', seqs.rows.length >= 3, seqs.rows.length + '');
for (const r of seqs.rows) {
  check(`${r.n}: USAGE`, r.u === true, 'مفقود — العطل سيعود عند اللصق');
  check(`${r.n}: UPDATE`, r.up === true, 'ناقص — nextval سيفشل');
}

console.log('\n═══ الإدراج الفعلي بعد اللصق ═══');
await db.exec(`grant usage on schema brc to staff_test;
  grant select, insert, update on brc.audit_log to staff_test; grant select on brc.staff to staff_test;
  insert into auth.users (id,email) values ('33333333-3333-3333-3333-333333333333','p@p') on conflict do nothing;
  insert into brc.staff (auth_id,username,full_name,role,active)
  values ('33333333-3333-3333-3333-333333333333','paster','لاصِق','staff',true) on conflict (username) do nothing;
  set role staff_test;`);
await db.query(`select set_config('test.uid','33333333-3333-3333-3333-333333333333', false)`);
let err = null;
try {
  await db.exec(`insert into brc.audit_log (username,role,action,entity,entity_id,details)
    values ('paster','staff','بعد اللصق','t','—','x')`);
} catch (e) { err = e; }
check('الإدراج في audit_log نجح', !err, err && err.message.split('\n')[0].slice(0, 120));
try {
  const r = await db.query(`select brc.next_job_code() as c`);
  check('next_job_code نجحت', /^HRC-\d+$/.test(r.rows[0].c), JSON.stringify(r.rows[0]));
} catch (e) { check('next_job_code نجحت', false, e.message.split('\n')[0].slice(0, 120)); }
await db.exec(`reset role;`);

await db.close();
console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — أجزاء اللصق تعمل` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
