/* ═══ هل ينجح الإدراج فعلاً بعد الإصلاح؟ على PostgreSQL حقيقي ═══════════
   الفحص النصّي يقول «السطر موجود». هذا يقول: **هل يعمل؟**
   نُنشئ قاعدة، نطبّق السكيما، ننتحل دور authenticated، ثم نُدرج في
   audit_log — وهو بالضبط ما كان يفشل على قاعدة المالك. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

const db = new PGlite();
await db.waitReady;

await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid);
  /* auth.uid() يُقرأ من GUC كي ننتحل موظفاً بعينه — كما يفعل Supabase
     فعلاً عبر request.jwt.claims. بلا ذلك تبقى NULL فتفشل brc.is_staff()
     ويُحجب الإدراج بـRLS قبل أن نصل إلى التسلسل — فنخسر الفحص. */
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT current_user::text $f$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE SCHEMA IF NOT EXISTS cron;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(int) RETURNS bytea LANGUAGE sql AS $f$ SELECT decode(md5(random()::text),'hex') $f$;
  CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea LANGUAGE sql AS $f$ SELECT decode(md5($1),'hex') $f$;
  DO $d$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='staff_test') THEN CREATE ROLE staff_test NOLOGIN IN ROLE authenticated; END IF;
  END $d$;
`);

console.log('\n═══ تطبيق السكيما كاملة ═══');
try {
  await db.exec(readFileSync('docs/schema.sql', 'utf8').replace(/CREATE EXTENSION[^;]*;/gi, '--'));
  const t = await db.query(`select count(*)::int n from information_schema.tables where table_schema='brc'`);
  check('السكيما طُبِّقت', t.rows[0].n >= 19, t.rows[0].n + ' جدولاً');
} catch (e) {
  check('السكيما طُبِّقت', false, e.message.split('\n')[0].slice(0, 140));
}

console.log('\n═══ المنح على التسلسلات ═══');
for (const seq of ['audit_log_id_seq', 'job_code_seq', 'form_serial_seq']) {
  /* ⚠️ لا نستخدم aclexplode: pglite يفشل بـ«ACL arrays must be one-dimensional»
     على تسلسل بلا منح — أي على الحالة التي نبحث عنها بالضبط. و
     `has_sequence_privilege` تفعل الشيء نفسه بسطر واحد وبلا هذا القيد. */
  let r;
  try {
    r = await db.query(`select has_sequence_privilege('authenticated','brc.${seq}','USAGE') as can_use`);
  } catch (e) {
    check(`${seq}: موجود`, false, e.message.split('\n')[0].slice(0, 100));
    continue;
  }
  check(`${seq}: authenticated يملك USAGE`, r.rows[0].can_use === true,
    'مفقود — الإدراج سيفشل بـ42501');
}

console.log('\n═══ الإدراج الفعلي (هذا ما كان يفشل عند المالك) ═══');
try {
  /* نُدرج سطر موظف كي تنجح سياسة audit_insert (تتطلب brc.is_staff()).
   ولا بدّ أن يُطابق username سطر الموظف — السياسة تمنع تزوير النسبة. */
await db.exec(`grant usage on schema brc to staff_test;
   grant select, insert, update on brc.audit_log to staff_test;
   grant select on brc.staff to staff_test;
   insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','t@t')
   on conflict (id) do nothing;
   insert into brc.staff (auth_id, username, full_name, role, active)
   values ('11111111-1111-1111-1111-111111111111','tester','مختبِر','staff',true)
   on conflict (username) do nothing;
   `);
/* ⚠️ نضبط الهوية **داخل الجلسة** لا بـ`alter role ... set`: الثانية
   تُطبَّق على الجلسات الجديدة فقط، فتبقى auth.uid() فارغة ويُحجب الإدراج
   بـRLS قبل أن يصل إلى التسلسل — فيمرّ الفحص كذباً. */
await db.exec(`set role staff_test;`);
await db.query(`select set_config('test.uid','11111111-1111-1111-1111-111111111111', false)`);
const who = await db.query(`select brc.is_staff() as s`);
check('الانتحال يرى موظفاً', who.rows[0].s === true, 'is_staff()=false — الانتحال لا يعمل');
await db.exec(`insert into brc.audit_log (username, role, action, entity, entity_id, details)
   values ('tester','staff','فحص','test','—','تجربة');`);
await db.exec(`reset role;`);
  const n = await db.query(`select count(*)::int n from brc.audit_log where action='فحص'`);
  check('الإدراج في audit_log نجح', n.rows[0].n === 1, 'لم يُدرج');
} catch (e) {
  check('الإدراج في audit_log نجح', false, e.message.split('\n')[0].slice(0, 140));
}

console.log('\n═══ next_job_code تعمل للموظف ═══');
try {
  await db.exec(`grant execute on function brc.next_job_code() to staff_test; set role staff_test;`);
  const r = await db.query(`select brc.next_job_code() as code`);
  await db.exec(`reset role;`);
  check('next_job_code أعادت كوداً', /^HRC-\d+$/.test(r.rows[0].code), JSON.stringify(r.rows[0]));
} catch (e) {
  check('next_job_code أعادت كوداً', false, e.message.split('\n')[0].slice(0, 140));
}

await db.close();
console.log('\n' + '─'.repeat(60));
console.log(bad === 0 ? `✅ ${ok} فحصاً — الإصلاح يعمل على قاعدة حقيقية`
                      : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
