/* إثبات أن تطبيق v3+v4 **لا يكسر** زر التنزيل الحالي.

   السؤال الذي يخيف المالك بحق: «لو طبّقت الهجرتين، هل يتوقف التنزيل
   اللي يعمل اليوم؟» الجواب يُقاس لا يُدّعى.

   نطبّق الهجرتين على مخطط مصغّر فيه v2 بالضبط كما في الإنتاج (SECURITY
   DEFINER، مالك postgres، منح authenticated)، ثم نقارن:
     • تعريف v2 وصلاحياتها قبل/بعد
     • أن v2 ما زالت تُنفَّذ وتُرجع format=2
     • أن v3 وv4 وصلتا بنفس نمط المنح
     • أن v4 تُرجع سجل الأرقام كصفوف لا كعدد */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const { SHIM } = await import('./pg-shim.mjs');

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e ?? ''))); };

const db = new PGlite();
await db.exec(SHIM);

// مخطط مصغّر: نفس كائنات الإنتاج التي تلمسها الدالتان.
await db.exec(`
create schema if not exists brc;
create table brc.staff(id uuid primary key default gen_random_uuid(), username text, full_name text,
  role text, job_title text, phone text, active boolean default true, created_at timestamptz default now(), auth_id uuid);
create table brc.applicants(serial text primary key);
create table brc.jobs(id uuid primary key default gen_random_uuid());
create table brc.job_attempts(serial text, attempt_no int, primary key(serial,attempt_no));
create table brc.settings(key text primary key, value jsonb);
create table brc.employer_job_credentials(job_id uuid primary key);
create table brc.issued_serials(serial text primary key);
create table brc.audit_log(id bigserial primary key, diff jsonb);
create table brc.card_number_counter(singleton boolean primary key default true, last_number bigint not null default 0);
insert into brc.card_number_counter values(true,0);
create table brc.card_number_registry(serial text primary key, card_number bigint not null unique);
create table brc.recovery_chances(serial text, attempt_no int, spent boolean default false, code_hash text,
  primary key(serial,attempt_no));
create table brc.recovery_prints(serial text primary key, printed boolean default false, code_hash text);
create table brc.office_receipts(operation_id text primary key);
create table brc.card_issue_requests(id uuid primary key, actor uuid, params jsonb, serials text[]);
create table brc.recovery_control(singleton boolean primary key default true, cutoff bigint default 0, secret text);
insert into brc.recovery_control(singleton, secret) values(true,'x');
create or replace function brc.is_admin() returns boolean language sql stable as $f$ select true $f$;
create or replace function brc.recovery_schema_hash() returns text language sql stable as $f$ select 'h' $f$;

-- v2 منسوخة من الإنتاج: نفس النمط، نفس الصلاحية.
create or replace function brc.recovery_export_v2() returns jsonb
language plpgsql security definer set search_path to 'brc','public' as $f$
declare p jsonb;
begin
  if not brc.is_admin() then raise exception 'x'; end if;
  return jsonb_build_object('format',2,
    'counts', jsonb_build_object('jobs',(select count(*) from brc.jobs)),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j)) from brc.jobs j),'[]'::jsonb));
end $f$;
revoke all on function brc.recovery_export_v2() from public, anon, authenticated;
grant execute on function brc.recovery_export_v2() to authenticated;
`);

const snap = async () => (await db.query(
  `select proname, prosecdef, proowner::regrole::text as owner,
          coalesce(array_to_string(proacl,' | '),'(default)') as acl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'brc' and proname like 'recovery_export%' order by proname`)).rows;

console.log('\n═══ وصف الحالة قبل ═══');
const before = await snap();
for (const r of before) console.log(`  ${r.proname} · definer=${r.prosecdef} · ${r.acl}`);

for (const f of ['supabase/migrations/20261115120000_portable_backup_v3.sql',
                 'supabase/migrations/20261118120000_portable_backup_v4_registry.sql']) {
  await db.exec(readFileSync(ROOT + f, 'utf8'));
}

console.log('\n═══ وصف الحالة بعد ═══');
const after = await snap();
for (const r of after) console.log(`  ${r.proname} · definer=${r.prosecdef} · ${r.acl}`);

console.log('\n═══ هل انكسر شي؟ ═══');
const b2 = before.find(r => r.proname === 'recovery_export_v2');
const a2 = after.find(r => r.proname === 'recovery_export_v2');
check('v2 باقية بعد التطبيق', !!a2);
check('v2 لم يتغيّر تعريفها ولا صلاحيتها',
  JSON.stringify(b2) === JSON.stringify(a2), 'تغيّرت');
check('v2 ما زالت SECURITY DEFINER', a2?.prosecdef === true);
check('v2 ما زالت ممنوحة لـauthenticated', a2?.acl.includes('authenticated=X'));
check('v2 ما زالت تُنفَّذ', (await db.query('select brc.recovery_export_v2() as p')).rows[0].p.format === 2);

const a3 = after.find(r => r.proname === 'recovery_export_v3');
const a4 = after.find(r => r.proname === 'recovery_export_v4');
check('v3 أُضيفت بـSECURITY DEFINER', a3?.prosecdef === true);
check('v3 ممنوحة لـauthenticated', a3?.acl.includes('authenticated=X'));
check('v4 أُضيفت بـSECURITY DEFINER', a4?.prosecdef === true);
check('v4 ممنوحة لـauthenticated', a4?.acl.includes('authenticated=X'));
check('v3 وv4 لا تُمنح لـanon', !a3?.acl.includes('anon=X') && !a4?.acl.includes('anon=X'));

const v4 = (await db.query('select brc.recovery_export_v4() as p')).rows[0].p;
check('v4 تُرجع format=4', v4.format === 4);
check('v4 تحمل card_number_registry كصفوف لا كعدد', Array.isArray(v4.card_number_registry));
check('v4 تحمل card_number_floor', 'card_number_floor' in v4);
check('v4 تبني على v3 (تحمل مفاتيحها)',
  ['recovery_chances','recovery_prints','office_receipts','card_issue_requests'].every(k => k in v4));

console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — التطبيق يُضيف ولا يكسر` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
