/* ═══ هل تشغيل الـmigrations بالترتيب ينجح فعلاً؟ ═════════════════════════
   المالك يعتمد على تكاملة GitHub: سوبابيس تُطبّق supabase/migrations/
   بالترتيب الزمني عند الدمج في main. فأي ملف يفشل **يوقف كل ما بعده**.

   وهذا ما حدث: 20261020120000 كان يعرّف view بلا card_number، بينما
   20261105120000 يعرّفه به — و`create or replace view` لا يحذف عموداً.
   فتوقّف التشغيل، ولم يصل منح job_code_seq و form_serial_seq أبداً.

   الفحص يُشغّل الترحيلات كلها بالترتيب على قاعدة فارغة ويتحقق أن منح
   التسلسلات الثلاثة وصل. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

/* محاكاة ما يوفّره Supabase ولا يوفّره Postgres العاري */
const SHIM = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT current_user::text $f$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE SCHEMA IF NOT EXISTS cron;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(int) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5(random()::text),'hex') $f$;
  CREATE OR REPLACE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5($1),'hex') $f$;
  /* pgcrypto الحقيقي يقبل معامل تشفير ثالثاً اختيارياً */
  CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt(text,text) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5($1),'hex') $f$;
  CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt(text,text,text) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5($1),'hex') $f$;
  CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, path_tokens text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz);
  CREATE TABLE IF NOT EXISTS cron.job (jobid int PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
  CREATE OR REPLACE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $f$ SELECT 1::bigint $f$;
  CREATE OR REPLACE FUNCTION cron.unschedule(text) RETURNS bool LANGUAGE sql AS $f$ SELECT true $f$;
  CREATE OR REPLACE FUNCTION cron.unschedule(bigint) RETURNS bool LANGUAGE sql AS $f$ SELECT true $f$;
  DO $d$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN SUPERUSER; END IF;
  END $d$;`;

const db = new PGlite(); await db.waitReady; await db.exec(SHIM);

const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
console.log(`\n═══ تشغيل ${files.length} ترحيلاً بالترتيب ═══`);

const failures = [];
for (const f of files) {
  const sql = readFileSync('supabase/migrations/' + f, 'utf8').replace(/CREATE EXTENSION[^;]*;/gi, '--');
  try {
    await db.exec(sql);
  } catch (e) {
    failures.push({ f, m: e.message.split('\n')[0] });
  }
}

check('لا ملف يُسقط التشغيل', failures.length === 0,
  failures.map(x => x.f + ': ' + x.m).join(' | ').slice(0, 300));

console.log('\n═══ النتيجة على القاعدة ═══');
const t = await db.query(`select count(*)::int n from information_schema.tables where table_schema='brc' and table_type='BASE TABLE'`);
const fn = await db.query(`select count(*)::int n from pg_proc where pronamespace='brc'::regnamespace`);
check('الجداول أُنشئت (≥19)', t.rows[0].n >= 19, t.rows[0].n + ' جدولاً');
check('الدوال أُنشئت (≥60)', fn.rows[0].n >= 60, fn.rows[0].n + ' دالة');

console.log('\n═══ منح التسلسلات — أصل عطل المالك ═══');
/* لو توقّف التشغيل قبل الترحيلات اللاحقة، تبقى هاتان محجوبتين */
for (const seq of ['audit_log_id_seq', 'job_code_seq', 'form_serial_seq']) {
  const r = await db.query(`select has_sequence_privilege('authenticated','brc.${seq}','USAGE') as u`);
  check(`${seq}: authenticated يملك USAGE`, r.rows[0].u === true,
    'مفقود — الترحيلات توقفت قبله');
}

console.log('\n═══ الـview يعمل بعد الإصلاح ═══');
try {
  const v = await db.query(`select count(*)::int n from brc.working_applicants`);
  check('brc.working_applicants قابلة للقراءة', typeof v.rows[0].n === 'number', 'فشل');
} catch (e) {
  check('brc.working_applicants قابلة للقراءة', false, e.message.split('\n')[0].slice(0, 110));
}

await db.close();
console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — الترحيلات تعمل بالترتيب` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
