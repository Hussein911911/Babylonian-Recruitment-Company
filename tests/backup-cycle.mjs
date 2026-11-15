/* ═══════════════════════════════════════════════════════════════════════════
   دورة النسخ الاحتياطي الكاملة — قاعدة حقيقية إلى قاعدة حقيقية
   ---------------------------------------------------------------------------
   هذا أهم فحص في المشروع كله: يثبت أن النسخة الاحتياطية **تعمل فعلاً**،
   من لحظة أخذها إلى لحظة استرجاعها. الفحوص الأخرى تختبر أجزاءً؛ هذا يختبر
   السلسلة كاملة كما يعيشها المدير:

     قاعدة فيها بيانات  →  تصدير  →  تشفير بكلمة مرور  →  ملف .hrcbak
        →  كلمة مرور خاطئة تُرفض  →  فك التشفير  →  توليد SQL
        →  تنفيذ على قاعدة جديدة فارغة  →  تطابق كل الأعداد والمحتوى

   لا يمسّ أي قاعدة إنتاجية — كل شيء داخل PGlite في الذاكرة.
   ═══════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict';
import '../assets/js/portable-backup.js';
import { PGlite } from '@electric-sql/pglite';
import { buildSql } from '../tools/restore-portable.mjs';

const PB = globalThis.HRCPortableBackup;
let passed = 0;
const check = (name, ok, detail) => {
  assert.ok(ok, name + (detail ? ' → ' + detail : ''));
  passed++; console.log('  ✅ ' + name);
};

/* أسماء أعمدة مطابقة للقاعدة الحقيقية — تُحدَّث مع مخطط brc */
const SCHEMA = `
create schema brc;
create table brc.jobs(id uuid primary key, code text unique not null, title text, category text,
  region text, shift text, salary_min integer, salary_max integer, gender text, vacancies integer,
  requirements text[], description text, employer_name text, employer_phone text, employer_address text,
  interview_location text, status text, reserved_by text, hold_expires_at timestamptz, closed_at timestamptz,
  notes text, image_url text, created_by uuid, created_at timestamptz, updated_at timestamptz,
  critical boolean, governorate text, manual_closed boolean, filled_vacancy_numbers integer[]);
create table brc.applicants(id uuid primary key, serial text unique not null, full_name text, phone text,
  address text, dob date, gender text, nationality text, issue_date date, expiry_date date,
  attempt_limit integer, status text, fee_amount integer, fee_paid boolean, printed_count integer,
  requested_code text, reject_reason text, created_by uuid, created_at timestamptz, updated_at timestamptz,
  notes text, pos_name text, self_application_data jsonb, archived_at timestamptz, card_print_code text);
create table brc.job_attempts(id uuid primary key, serial text not null, attempt_no integer not null,
  job_id uuid, job_code text, slot_status text, selected_at timestamptz, hold_expires_at timestamptz,
  closed_at timestamptz, outcome_note text, staff_id uuid, chance_code text, employer_decision text,
  decision_at timestamptz, employer_reason text, vacancy_no integer, job_snapshot jsonb);
create table brc.settings(key text primary key, value jsonb, updated_at timestamptz, updated_by uuid);
create table brc.employer_job_credentials(job_id uuid primary key, pin_hash text, failures integer,
  window_start timestamptz, changed_at timestamptz);
create table brc.issued_serials(serial text primary key, issued_at timestamptz, note text);
create table brc.staff(id uuid primary key default gen_random_uuid(), auth_id uuid unique,
  username text not null unique, full_name text not null, role text not null default 'staff',
  job_title text default '', phone text default '', active boolean not null default true,
  created_at timestamptz not null default now());
create table brc.card_number_counter (singleton boolean primary key default true check (singleton), last_number bigint not null check (last_number >= 0));
insert into brc.card_number_counter values (true, 0) on conflict do nothing;
create table brc.card_number_registry (serial text primary key, card_number bigint not null unique check (card_number > 0));
create table brc.audit_log(id bigserial primary key, ts timestamptz default now(), user_id uuid,
  username text, role text, ip text, action text, entity text, entity_id text, details text, diff jsonb);

/* ⚠️ الجداول الأربعة التي أضافها التصدير v3 (2026-11-15).
   كانت الاختبارات تبني هيكلاً مختصراً بلاها، فيفشل TRUNCATE الجديد.
   تُضاف هنا بنفس أعمدة docs/schema.sql حرفياً. */
create table brc.recovery_chances (
  serial text not null, attempt_no smallint not null, spent boolean not null,
  code_hash text not null, primary key(serial,attempt_no));
create table brc.recovery_prints (
  serial text primary key, printed boolean not null, code_hash text);
create table brc.card_issue_requests (id uuid primary key, actor uuid, params jsonb, serials text[]);
create table brc.office_receipts (operation_id text primary key, actor uuid, payload jsonb, created_at timestamptz);

`;

const TABLES = ['jobs', 'applicants', 'job_attempts', 'audit_log', 'issued_serials', 'settings'];

const src = new PGlite();
try {
  await src.exec(SCHEMA);
  await src.exec(`
   insert into brc.jobs(id,code,title,category,region,shift,salary_min,salary_max,gender,vacancies,
     requirements,description,employer_name,employer_phone,employer_address,interview_location,status,
     governorate,critical,manual_closed,filled_vacancy_numbers,created_at,updated_at) values
    ('11111111-1111-4111-8111-111111111111','HRC-1055','عامل إنتاج','صناعة','الحلة','صباحي',
     700000,900000,'male',100,ARRAY['خبرة سنة','لياقة'],'وصف','مصنع الفرات','07701234567',
     'الحلة الصناعية','بوابة ٣','available','بابل',false,false,ARRAY[1,2,3],now(),now()),
    ('22222222-2222-4222-8222-222222222222','HRC-1046','محاسب','إداري','الحلة','دوام كامل',
     800000,1000000,'any',1,ARRAY[]::text[],'','','','','','available','بابل',false,false,
     ARRAY[]::integer[],now(),now());
   insert into brc.applicants(id,serial,full_name,phone,address,gender,nationality,attempt_limit,
     status,fee_amount,fee_paid,printed_count,card_print_code,created_at,updated_at,notes) values
    ('33333333-3333-4333-8333-333333333333','AAAA111111','أحمد علي حسين','07701234567',
     'الحلة، حي الجامعة','male','عراقي',3,'active',5000,true,1,'SECRET-AAAA',now(),now(),'ملاحظة'),
    ('44444444-4444-4444-8444-444444444444','BBBB222222','علي محمد','07709876543','',
     'male','عراقي',3,'blank',5000,false,0,null,now(),now(),'');
   insert into brc.job_attempts(id,serial,attempt_no,job_id,job_code,slot_status,selected_at,
     hold_expires_at,outcome_note,employer_decision,vacancy_no,job_snapshot) values
    ('55555555-5555-4555-8555-555555555555','AAAA111111',1,
     '22222222-2222-4222-8222-222222222222','HRC-1046','reserved',now(),
     now()+interval '24 hours','','',1,'null'::jsonb),
    ('66666666-6666-4666-8666-666666666666','AAAA111111',2,null,null,'empty',null,null,'',null,null,'null'::jsonb);
   insert into brc.settings(key,value) values('rules','{"attempt_limit":3,"fee":5000}'::jsonb);
   insert into brc.issued_serials(serial,issued_at) values('AAAA111111',now()),('BBBB222222',now());
   insert into brc.audit_log(username,role,action,entity,entity_id,details,diff) values
    ('admin','admin','تعديل jobs','jobs','HRC-1055','تحديث السعة','{"vacancies":[50,100]}'::jsonb),
    ('admin','admin','إصدار بطاقة','applicants','AAAA111111','إصدار','null'::jsonb);
  `);

  const count = async (db, t) => (await db.query(`select count(*)::int c from brc.${t}`)).rows[0].c;
  const before = {};
  for (const t of TABLES) before[t] = await count(src, t);
  console.log('  · القاعدة الأصلية: ' + JSON.stringify(before));

  /* ── ١) الحمولة بنفس شكل recovery_export_v2 ── */
  const grab = async (sql) => (await src.query(sql)).rows;
  const payload = {
    format: 2, schema: 'cycle-test', exportedAt: new Date().toISOString(),
    counts: { jobs: before.jobs, applicants: before.applicants, attempts: before.job_attempts, audit: before.audit_log },
    jobs: await grab('select * from brc.jobs order by code'),
    applicants: await grab('select * from brc.applicants order by serial'),
    job_attempts: await grab('select * from brc.job_attempts order by serial, attempt_no'),
    settings: await grab('select * from brc.settings'),
    employer_job_credentials: await grab('select * from brc.employer_job_credentials'),
    issued_serials: await grab('select * from brc.issued_serials'),
    audit_log: await grab('select * from brc.audit_log order by id')
  };

  /* ── ٢) التشفير ── */
  const pass = 'كلمة-مرور-قوية-2026';
  const env = await PB.seal(payload, pass);
  const file = JSON.stringify(env);
  check('الملف يُبنى بصيغة HRC-BACKUP/1', env.format === 'HRC-BACKUP/1');
  check('لا اسم ولا هاتف ظاهر في الملف المشفّر',
    !file.includes('أحمد') && !file.includes('07701234567'));

  /* ── ٣) كلمة مرور خاطئة تُرفض ── */
  let rejected = false;
  try { await PB.open(file, 'كلمة-غلط-تماماً-١٢٣'); } catch (e) { rejected = true; }
  check('كلمة المرور الخاطئة تُرفض ولا تُعيد شيئاً', rejected);

  /* ── ٤) الفك بكلمة المرور الصحيحة ── */
  const opened = await PB.open(file, pass);
  check('الفك يُعيد نفس الأعداد', opened.payload.applicants.length === before.applicants);

  /* ── ٥) الاسترجاع على قاعدة جديدة ── */
  const dst = new PGlite();
  try {
    await dst.exec(SCHEMA);
    await dst.exec(buildSql(opened.payload));

    for (const t of TABLES) {
      const after = await count(dst, t);
      check(`عدد ${t} مطابق`, after === before[t], `${after} مقابل ${before[t]}`);
    }
    const card = (await dst.query(
      "select card_print_code, full_name, phone from brc.applicants where serial='AAAA111111'")).rows[0];
    check('رمز البطاقة الأمني نجا من الدورة', card.card_print_code === 'SECRET-AAAA');
    check('الاسم العربي والهاتف لم يتشوّها',
      card.full_name === 'أحمد علي حسين' && card.phone === '07701234567');
    const job = (await dst.query(
      "select requirements, filled_vacancy_numbers, governorate from brc.jobs where code='HRC-1055'")).rows[0];
    check('مصفوفة المتطلبات النصية سليمة', JSON.stringify(job.requirements) === JSON.stringify(['خبرة سنة','لياقة']));
    check('مصفوفة أرقام الشواغر سليمة', JSON.stringify(job.filled_vacancy_numbers) === JSON.stringify([1,2,3]));
    check('المحافظة محفوظة', job.governorate === 'بابل');
    const att = (await dst.query(
      "select employer_decision, vacancy_no from brc.job_attempts where attempt_no=1")).rows[0];
    check('حقول الفرصة (قرار صاحب العمل، رقم الشاغر) موجودة',
      'employer_decision' in att && att.vacancy_no === 1);
    const seq = (await dst.query('select last_value::int v from brc.audit_log_id_seq')).rows[0].v;
    check('تسلسل التدقيق مضبوط بعد الإدخال بأرقام صريحة', seq >= before.audit_log, String(seq));
  } finally { await dst.close(); }
} finally { await src.close(); }

console.log(`\n  دورة النسخ الاحتياطي: ${passed} فحصاً ناجحاً`);
