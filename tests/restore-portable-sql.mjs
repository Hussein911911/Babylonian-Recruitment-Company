// قاعدة PostgreSQL حقيقية معزولة: يتحقق أن SQL المُولّد من الأداة يسترجع كل شيء.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let passed = 0;
const check = (n, c, d) => { assert.ok(c, n + (d ? ' → ' + d : '')); passed++; console.log('  ✅ ' + n); };

/* الحمولة الحقيقية: نفس بنية recovery_export_v2 (‎format 2) */
const payload = {
  format: 2, schema: 'abc123', exportedAt: '2026-11-12T10:00:00Z',
  counts: { jobs: 2, applicants: 2, attempts: 2, audit: 2 },
  jobs: [
    { id: '11111111-1111-4111-8111-111111111111', code: 'HRC-1001', title: 'عامل', category: 'خدمات', region: 'الحلة', shift: 'صباحي', salary_min: 700000, salary_max: 900000, gender: 'any', vacancies: 3, requirements: ['خبرة'], description: 'وصف', employer_name: 'شركة', employer_phone: '0770', employer_address: 'عنوان', interview_location: 'مكان', status: 'available', reserved_by: null, hold_expires_at: null, closed_at: null, notes: null, image_url: null, created_by: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', critical: false, governorate: 'بابل', manual_closed: false, filled_vacancy_numbers: [1] },
    { id: '22222222-2222-4222-8222-222222222222', code: 'HRC-1002', title: 'نجار', category: 'حرف', region: 'الحلة', shift: 'مسائي', salary_min: 500000, salary_max: 600000, gender: 'male', vacancies: 1, requirements: [], description: '', employer_name: '', employer_phone: '', employer_address: '', interview_location: '', status: 'reserved', reserved_by: 'AAAA111111', hold_expires_at: '2026-11-13T00:00:00Z', closed_at: null, notes: '', image_url: 'https://x/y.jpg', created_by: null, created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', critical: false, governorate: 'بابل', manual_closed: false, filled_vacancy_numbers: [] }
  ],
  applicants: [
    { id: '33333333-3333-4333-8333-333333333333', serial: 'AAAA111111', full_name: 'أحمد', phone: '0770', address: 'الحلة', dob: null, gender: 'male', nationality: 'عراقي', issue_date: '2026-11-01', expiry_date: '2026-12-01', attempt_limit: 3, status: 'active', fee_amount: 5000, fee_paid: true, printed_count: 1, requested_code: null, reject_reason: null, created_by: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', notes: '', pos_name: null, self_application_data: null, archived_at: null, card_print_code: 'SECRET123' },
    { id: '44444444-4444-4444-8444-444444444444', serial: 'BBBB222222', full_name: 'علي', phone: '0771', address: '', dob: null, gender: 'male', nationality: 'عراقي', issue_date: null, expiry_date: null, attempt_limit: 3, status: 'blank', fee_amount: 5000, fee_paid: false, printed_count: 0, requested_code: null, reject_reason: null, created_by: null, created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', notes: '', pos_name: null, self_application_data: null, archived_at: null, card_print_code: null }
  ],
  job_attempts: [
    { id: '55555555-5555-4555-8555-555555555555', serial: 'AAAA111111', attempt_no: 1, job_id: '22222222-2222-4222-8222-222222222222', job_code: 'HRC-1002', slot_status: 'reserved', selected_at: '2026-11-12T00:00:00Z', hold_expires_at: '2026-11-13T00:00:00Z', closed_at: null, outcome_note: '', staff_id: null, chance_code: null, employer_decision: null, decision_at: null, employer_reason: null, vacancy_no: 1, job_snapshot: { code: 'HRC-1002' } },
    { id: '66666666-6666-4666-8666-666666666666', serial: 'AAAA111111', attempt_no: 2, job_id: null, job_code: null, slot_status: 'empty', selected_at: null, hold_expires_at: null, closed_at: null, outcome_note: '', staff_id: null, chance_code: null, employer_decision: null, decision_at: null, employer_reason: null, vacancy_no: null, job_snapshot: null }
  ],
  /* ⚠️ الحالتان معاً بقصد: `company`/`rules` كائنات، و`recovery_last_scheduled_at`
     **نصّ** (jsonb_typeof = string). الثانية هي التي أوقفت استرجاع الإنتاج
     الحقيقي بـ22P02 — كان المولّد يكتبها بلا اقتباس داخلي. */
  settings: [
    { key: 'rules', value: { attempt_limit: 3 }, updated_at: '2026-11-01T00:00:00Z', updated_by: null },
    { key: 'recovery_last_scheduled_at', value: '2026-11-17T20:00:00.039681+00:00', updated_at: '2026-11-17T00:00:00Z', updated_by: null }],
  employer_job_credentials: [{ job_id: '11111111-1111-4111-8111-111111111111', pin_hash: 'h', failures: 0, window_start: null, changed_at: '2026-11-01T00:00:00Z' }],
  issued_serials: [{ serial: 'AAAA111111', issued_at: '2026-11-01T00:00:00Z', note: null }],
  audit_log: [
    { id: 1, ts: '2026-11-01T00:00:00Z', user_id: null, username: 'admin', role: 'admin', ip: null, action: 'تعديل jobs', entity: 'jobs', entity_id: 'HRC-1001', details: 'x', diff: { a: 1 } },
    { id: 2, ts: '2026-11-02T00:00:00Z', user_id: null, username: 'admin', role: 'admin', ip: null, action: 'تعديل jobs', entity: 'jobs', entity_id: 'HRC-1001', details: 'y', diffTrimmed: true }
  ]
};

/* مخطط brc مصغّر يطابق أسماء الأعمدة الحقيقية */
const SCHEMA = `
create schema brc;
create table brc.jobs(
  id uuid primary key, code text unique not null, title text, category text, region text, shift text,
  salary_min integer, salary_max integer, gender text, vacancies integer, requirements text[], description text,
  employer_name text, employer_phone text, employer_address text, interview_location text, status text,
  reserved_by text, hold_expires_at timestamptz, closed_at timestamptz, notes text, image_url text,
  created_by uuid, created_at timestamptz, updated_at timestamptz, critical boolean,
  governorate text, manual_closed boolean, filled_vacancy_numbers integer[]);
create table brc.applicants(
  id uuid primary key, serial text unique not null, full_name text, phone text, address text, dob date,
  gender text, nationality text, issue_date date, expiry_date date, attempt_limit integer, status text,
  fee_amount integer, fee_paid boolean, printed_count integer, requested_code text, reject_reason text,
  created_by uuid, created_at timestamptz, updated_at timestamptz, notes text, pos_name text,
  self_application_data jsonb, archived_at timestamptz, card_print_code text);
create table brc.job_attempts(
  id uuid primary key, serial text not null, attempt_no integer not null, job_id uuid, job_code text,
  slot_status text, selected_at timestamptz, hold_expires_at timestamptz, closed_at timestamptz,
  outcome_note text, staff_id uuid, chance_code text, employer_decision text, decision_at timestamptz,
  employer_reason text, vacancy_no integer, job_snapshot jsonb);
create table brc.settings(key text primary key, value jsonb, updated_at timestamptz, updated_by uuid);
create table brc.employer_job_credentials(job_id uuid primary key, pin_hash text, failures integer, window_start timestamptz, changed_at timestamptz);
create table brc.issued_serials(serial text primary key, issued_at timestamptz, note text);
create table brc.staff(
  id uuid primary key default gen_random_uuid(), auth_id uuid unique, username text not null unique,
  full_name text not null, role text not null default 'staff', job_title text default '', phone text default '',
  active boolean not null default true, created_at timestamptz not null default now());
create table brc.card_number_counter (singleton boolean primary key default true check (singleton), last_number bigint not null check (last_number >= 0));
insert into brc.card_number_counter values (true, 0) on conflict do nothing;
create table brc.card_number_registry (serial text primary key, card_number bigint not null unique check (card_number > 0));
create table brc.audit_log(id bigserial primary key, ts timestamptz, user_id uuid, username text, role text, ip text, action text, entity text, entity_id text, details text, diff jsonb);

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

const db = new PGlite();
try {
  await db.exec(SCHEMA);

  const { buildSql } = await import('../tools/restore-portable.mjs');
  const sql = buildSql(payload);

  await db.exec(sql);

  const j = (await db.query('select count(*)::int c from brc.jobs')).rows[0].c;
  check('كل الوظائف استُرجعت', j === 2, 'وجد ' + j);
  const a = (await db.query('select count(*)::int c from brc.applicants')).rows[0].c;
  check('كل البطاقات استُرجعت', a === 2, 'وجد ' + a);
  const t = (await db.query('select count(*)::int c from brc.job_attempts')).rows[0].c;
  check('كل الفرص استُرجعت', t === 2, 'وجد ' + t);
  const au = (await db.query('select count(*)::int c from brc.audit_log')).rows[0].c;
  check('كل سجل التدقيق استُرجعت', au === 2, 'وجد ' + au);
  const cp = (await db.query("select card_print_code from brc.applicants where serial='AAAA111111'")).rows[0].card_print_code;
  check('رمز البطاقة الأمني لم يُفقد', cp === 'SECRET123', String(cp));
  const dev = (await db.query("select employer_decision from brc.job_attempts where attempt_no=1")).rows[0];
  check('عمود قرار صاحب العمل موجود', 'employer_decision' in dev);
  const holder = (await db.query("select status from brc.jobs where code='HRC-1002'")).rows[0].status;
  check('حالة الحجز محفوظة', holder === 'reserved', holder);

  /* ⚠️ هذا الفحص وُلد من عطل حقيقي أوقف استرجاع الإنتاج (2026-11-18):
     `settings.value` عمود jsonb يسكنه كائنات **ونصوص**. النصّ يُكتب
     `'"…"'::jsonb`؛ وكتابته `'…'` وحدها تُعطي 22P02 عند التنفيذ. */
  const sv = (await db.query(
    "select jsonb_typeof(value) k, value #>> '{}' v from brc.settings where key='recovery_last_scheduled_at'"
  )).rows[0];
  check('قيمة settings النصية باقية كنصّ JSON', sv && sv.k === 'string' && sv.v === '2026-11-17T20:00:00.039681+00:00',
    JSON.stringify(sv));

  /* ═══ الحالة الواقعية على الإنتاج (2026-11-18) ═══════════════════════
     `recovery_export_v2` المطبَّقة **لا تصدّر** card_number_registry ولا
     card_number_counter. فالحمولة تصل بلا أي منهما — والكود كان يشترط
     وجود أحدهما ليضبط العدّاد، أي أنه لم يضبطه إطلاقاً. النتيجة: أول
     بطاقة بعد الاسترجاع تأخذ رقماً موجوداً على ورق مطبوع.
     نختبر الحالتين معاً: حمولة فقيرة (v2) وحمولة غنية (v4). */
  {
    const lean = JSON.parse(JSON.stringify(payload));
    delete lean.card_number_registry; delete lean.card_number_counter;
    const leanDb = new PGlite();
    try {
      await leanDb.exec(SCHEMA);
      await leanDb.exec(buildSql(lean));
      const row = (await leanDb.query('select last_number from brc.card_number_counter')).rows[0];
      check('حمولة v2 (بلا سجل) ما زالت تضبط العدّاد', !!row, 'لا صف عدّاد — يفشل عند أول بطاقة');
      /* لا يمكن أن يكون صفراً وأقل من أكبر رقم ظهر فعلاً في issued_serials */
      const serials = (await leanDb.query('select count(*)::int c from brc.issued_serials')).rows[0].c;
      /* الأهمّ: لا يبقى على الصفر. الحمولة فيها بطاقتان وسيريال واحد،
         فالحدّ الآمن = max(سيريالات، بطاقات) = 2 على الأقل. */
      check('العدّاد فوق صفر (لا تكرار على ورق مطبوع)',
        row && Number(row.last_number) >= 2, row && String(row.last_number));
      check('الملف يحمل تحذيراً صريحاً بأن الأرقام مجهولة',
        /أرقام البطاقات المطبوعة على ورق رسمي غير معروفة/.test(sql), true);
      void serials;
    } finally { await leanDb.close(); }

    /* حمولة v4: السجل والفلور صريحان، والعدّاد يجب أن يغلب على الاثنين */
    const rich = JSON.parse(JSON.stringify(payload));
    rich.format = 4;
    rich.card_number_registry = [
      { serial: 'AAAA111111', card_number: 41 }, { serial: 'BBBB222222', card_number: 42 }];
    rich.card_number_floor = 175;
    const richDb = new PGlite();
    try {
      await richDb.exec(SCHEMA);
      await richDb.exec(buildSql(rich));
      const row = (await richDb.query('select last_number from brc.card_number_counter')).rows[0];
      check('حمولة v4: العدّاد = card_number_floor (175)', row && Number(row.last_number) === 175,
        row && String(row.last_number));
      const reg = (await richDb.query('select count(*)::int c from brc.card_number_registry')).rows[0].c;
      check('حمولة v4: سجل الأرقام استُورد', reg === 2, 'وجد ' + reg);
    } finally { await richDb.close(); }
  }

  console.log(`\n  النتيجة: ${passed} فحصاً ناجحاً`);
} finally { await db.close(); }
