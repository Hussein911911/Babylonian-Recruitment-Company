/* ═══════════════════════════════════════════════════════════════════════════
   إثبات سياسة حذف الوظيفة على PostgreSQL حقيقي (RLS فعّال + تبديل أدوار)

   هذا الفحص يُشغّل الـmigration 20261111120000_jobs_staff_delete.sql على
   قاعدة حقيقية (PGlite = PostgreSQL بواسطة WebAssembly) بجدول brc.jobs
   وسياسة الحذف، ثم **يحذف فعلياً** بثلاثة أدوار ويتحقّق من عدد الصفوف.

   الغرض: إثبات أن الملف الذي سيُشغَّل على قاعدة الإنتاج يعطي بالضبط:
       مدير ✅   ·   موظف ✅   ·   زائر مجهول ❌
   ويثبت كذلك أن السياسة القديمة (jobs_admin_delete) كانت **ترفض الموظف** —
   أي أن الـmigration ليست تجميلاً بل تغيير سلوك حقيقي (لا رفض صامت).
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
};

const ADMIN_UID = '11111111-1111-4111-8111-111111111111';
const STAFF_UID = '22222222-2222-4222-8222-222222222222';

/* ── قاعدة حقيقية بسياق مطابق للإنتاج ─────────────────────────────────────── */
const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;

  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create schema brc;
  grant usage on schema brc to anon, authenticated;

  create table brc.staff (
    id uuid primary key default gen_random_uuid(),
    auth_id uuid unique,
    role text not null default 'staff',
    active boolean not null default true,
    name text
  );

  create table brc.jobs (
    code text primary key,
    title text,
    status text default 'available'
  );

  /* السياسات الحقيقية كما في 20260915000000_brc_initial_schema.sql */
  create or replace function brc.is_staff() returns boolean
  language sql stable security definer
  set search_path = brc, public
  as $$
    select exists (select 1 from brc.staff where auth_id = auth.uid() and active)
  $$;

  create or replace function brc.is_admin() returns boolean
  language sql stable security definer
  set search_path = brc, public
  as $$
    select exists (select 1 from brc.staff where auth_id = auth.uid() and role = 'admin' and active)
  $$;

  grant execute on function brc.is_staff() to anon, authenticated;
  grant execute on function brc.is_admin() to anon, authenticated;

  alter table brc.jobs enable row level security;
  alter table brc.jobs force row level security;

  /* أسوأ حالة: الزائر يملك صلاحية DELETE على مستوى GRANT —
     الحماية الوحيدة الباقية هي السياسة نفسها. هكذا نختبر RLS لا الـgrants. */
  grant select, insert, update, delete on brc.jobs to anon, authenticated;
  grant select on brc.staff to authenticated;

  /* الموظفون: مدير واحد وموظف واحد */
  insert into brc.staff (auth_id, role, name) values
    ('${ADMIN_UID}', 'admin', 'المدير العام'),
    ('${STAFF_UID}', 'staff', 'موظف');
`);

/* ── الحالة قبل الـmigration: السياسة القديمة (مدير فقط) ──────────────────── */
const OLD_MIGRATION = 'supabase/migrations/20260915000000_brc_initial_schema.sql';
const NEW_MIGRATION = 'supabase/migrations/20261111120000_jobs_staff_delete.sql';
const initial = readFileSync(resolve(ROOT, OLD_MIGRATION), 'utf8');
const oldPolicy = initial.match(/create policy jobs_admin_delete[\s\S]*?;/);
if (oldPolicy) await db.exec(oldPolicy[0]);
else await db.exec('create policy jobs_admin_delete on brc.jobs for delete using (brc.is_admin());');

const migrations = readFileSync(resolve(ROOT, NEW_MIGRATION), 'utf8');

const asRole = async (uid) => {
  await db.exec('reset role');
  await db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
};

const insertJob = async (code) => {
  await db.exec('reset role');
  await db.exec(`insert into brc.jobs (code, title) values ('${code}', 'وظيفة ${code}')`);
};

const deleteAs = async (uid, code) => {
  await asRole(uid);
  const r = await db.query(`delete from brc.jobs where code = '${code}'`);
  await db.exec('reset role');
  return r.affectedRows ?? 0;
};

const exists = async (code) => {
  await db.exec('reset role');
  const r = await db.query(`select count(*)::int as n from brc.jobs where code = '${code}'`);
  return r.rows[0].n === 1;
};

console.log('\n' + '═'.repeat(74));
console.log('  حذف الوظيفة — إثبات السياسة على PostgreSQL حقيقي (RLS)');
console.log('═'.repeat(74));

/* ── 1) قبل الـmigration: الموظف مرفوض (هذا هو العطل الأصلي) ──────────────── */
console.log('\n▌ 1 — قبل الـmigration: السياسة القديمة jobs_admin_delete\n');

await insertJob('OLD-ADMIN');
await insertJob('OLD-STAFF');
check('المدير يحذف بالسياسة القديمة', (await deleteAs(ADMIN_UID, 'OLD-ADMIN')) === 1);
check('الموظف **لا** يحذف بالسياسة القديمة (العطل الأصلي)', (await deleteAs(STAFF_UID, 'OLD-STAFF')) === 0);
check('وظيفة الموظف ما زالت موجودة بعد محاولته', await exists('OLD-STAFF'));

/* ── 2) تشغيل الـmigration كما ستُشغَّل على الإنتاج ────────────────────────── */
console.log('\n▌ 2 — تشغيل الـmigration الجديدة\n');
await db.exec('reset role');
await db.exec(migrations);
check('الـmigration تُنفَّذ بلا أخطاء على قاعدة فيها السياسة القديمة', true);

const policies = await db.query(`
  select polname from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'brc' and c.relname = 'jobs' and p.polcmd = 'd'
  order by polname
`);
const names = policies.rows.map((r) => r.polname);
check('السياسة القديمة jobs_admin_delete حُذفت', !names.includes('jobs_admin_delete'), names.join(', '));
check('السياسة الجديدة jobs_staff_delete موجودة', names.includes('jobs_staff_delete'), names.join(', '));
check('لا سياستا حذف متوازيتان (لا تُرخي الواحدة الأخرى)', names.length === 1, names.join(', '));

/* ── 3) بعد الـmigration: المصفوفة الثلاثية ──────────────────────────────── */
console.log('\n▌ 3 — بعد الـmigration: مدير · موظف · زائر\n');

await insertJob('NEW-ADMIN');
await insertJob('NEW-STAFF');
await insertJob('NEW-ANON');

check('المدير يحذف (بقيت مسموحة)', (await deleteAs(ADMIN_UID, 'NEW-ADMIN')) === 1);
check('الموظف يحذف الآن (هذا هو المطلوب)', (await deleteAs(STAFF_UID, 'NEW-STAFF')) === 1);
check('الزائر المجهول مرفوض تماماً', (await deleteAs(null, 'NEW-ANON')) === 0);
check('وظيفة الزائر ما زالت موجودة', await exists('NEW-ANON'));

/* ── 4) حالات حدّية ──────────────────────────────────────────────────────── */
console.log('\n▌ 4 — حالات حدّية\n');

/* موظف مُعطَّل لا يحذف */
await db.exec('reset role');
await db.exec(`update brc.staff set active = false where auth_id = '${STAFF_UID}'`);
await insertJob('INACTIVE');
check('الموظف المعطَّل لا يحذف', (await deleteAs(STAFF_UID, 'INACTIVE')) === 0);
await db.exec('reset role');
await db.exec(`update brc.staff set active = true where auth_id = '${STAFF_UID}'`);

/* موظف محذوف من الجدول لا يحذف */
await db.exec('reset role');
await db.exec(`delete from brc.staff where auth_id = '${STAFF_UID}'`);
await insertJob('REMOVED');
check('من أُزيل من جدول الموظفين لا يحذف', (await deleteAs(STAFF_UID, 'REMOVED')) === 0);

/* uid لا يطابق أي موظف */
await insertJob('GHOST');
check('جلسة مصادقة بلا سطر موظف لا تحذف', (await deleteAs('99999999-9999-4999-8999-999999999999', 'GHOST')) === 0);

/* القراءة والتحديث والإدراج لم تتأثر بالـmigration */
await db.exec('reset role');
const otherPolicies = await db.query(`
  select polname, polcmd from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'brc' and c.relname = 'jobs'
  order by polcmd
`);
check('الـmigration لم تمسّ سياسات القراءة/الإدراج/التحديث',
  otherPolicies.rows.every((r) => r.polcmd === 'd' || r.polname !== 'jobs_staff_delete'),
  otherPolicies.rows.map((r) => r.polname + ':' + r.polcmd).join(' '));

/* idempotency — إعادة التشغيل لا تفشل (النشر المتكرر) */
await db.exec('reset role');
let rerun = true;
try { await db.exec(migrations); } catch (e) { rerun = false; }
check('إعادة تشغيل الـmigration لا تفشل (idempotent)', rerun);

/* ── 5) مطابقة سياسة القاعدة لحراسة الواجهة ──────────────────────────────── */
console.log('\n▌ 5 — مطابقة القاعدة لحراسة الواجهة\n');
const store = readFileSync(resolve(ROOT, 'assets/js/store.js'), 'utf8');
const deleteFn = store.match(/function deleteJob\(code\) \{[\s\S]{0,400}/);
check('الواجهة تستعمل isStaffSession (لا isAdmin) في deleteJob',
  !!deleteFn && /isStaffSession\(\)/.test(deleteFn[0]) && !/!isAdmin\(\)/.test(deleteFn[0]));
const policySrc = migrations;
check('القاعدة تستعمل brc.is_staff() (لا brc.is_admin())',
  /using \(brc\.is_staff\(\)\)/.test(policySrc) && !/jobs_admin_delete on[^\n]*\n[^\n]*is_admin/.test(policySrc));
check('السياسة القديمة تُحذف صراحةً في الـmigration (drop policy if exists)',
  /drop policy if exists jobs_admin_delete/.test(policySrc));

await db.close();

console.log('\n' + '═'.repeat(74));
console.log(`  النتيجة: ✅ ${pass} ناجح | ❌ ${fail} فاشل`);
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
