/* مخطط الإنتاج المصغّر لاختبار استيراد الملفات على PGlite.
   مشترك بين full-dump.mjs وrescue-restore-proof.mjs — نسخة واحدة لا تنحرف. */
export const SHIM = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT NULL::uuid $f$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT current_user::text $f$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{}'::jsonb $f$;
  CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS cron; CREATE SCHEMA IF NOT EXISTS storage;
  CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(int) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5(random()::text),'hex') $f$;
  CREATE OR REPLACE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $f$
    SELECT decode(md5($1),'hex') $f$;
  CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, path_tokens text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz);
  CREATE TABLE IF NOT EXISTS cron.job (jobid int PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
  CREATE OR REPLACE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $f$ SELECT 1::bigint $f$;
  DO $d$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN SUPERUSER; END IF;
  END $d$;`;
