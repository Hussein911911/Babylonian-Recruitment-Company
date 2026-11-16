/* ═══════════════════════════════════════════════════════════════════════════
   HRC — المسار الكامل: نسخة محمولة → جهاز المستخدم → قاعدة جديدة
   ---------------------------------------------------------------------------
   هذا الفحص يجيب سؤال المالك الوحيد المهم:

     «اليوم انهار الموقع، باجر أبني موقعاً جديداً — النسخة تكفي؟»

   فلا يكفي أن يُنتج المولّد نصاً يشبه SQL. المطلوب إثبات أن:
     ١. ملف `.hrcbak` يُفكّ بكلمة المرور على جهاز بلا شبكة
     ٢. المحتوى المفكوك يحتوي كل الصفوف (لا الأعداد فقط)
     ٣. النص المولَّد يُنفَّذ فعلاً على PostgreSQL فيعيد بناء البيانات
     ٤. لا يُطمس حساب المدير الذي أنشأه المالك على المشروع الجديد
     ٥. الحسابات القديمة تُضاف، والربط بـ auth لا يُكسر

   بلا هذه السلسلة كاملة، «الاسترجاع» ورقة لا تعمل يوم الحاجة.
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import '../assets/js/portable-backup.js';
import '../assets/js/restore-sql.js';

const PB = globalThis.HRCPortableBackup;
const S = globalThis.HRCRestoreSql;

let ok = 0, bad = 0;
const check = (label, got, want) => {
  const pass = String(got) === String(want);
  pass ? ok++ : bad++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}` + (pass ? '' : `  → ${got} (المتوقع ${want})`));
};

/* ═══ ١) حمولة تمثّل النسخة الحقيقية ═══════════════════════════════════════
   صفوف كافية لإثبات أن كل جدول يُنقل، مع الحالات الحدّية التي كسرت أشياء
   في الماضي: مصفوفة int[]، enum، jsonb، حقل فارغ (NULL)، نص عربي، اقتباس. */
const payload = {
  format: 2,
  schema: 'full-cycle',
  exportedAt: '2026-11-12T23:00:00.000Z',
  counts: { jobs: 2, applicants: 3, attempts: 3, audit: 4, serials: 3, staff: 2 },
  jobs: [
    {
      code: 'HRC-1055', title: "عامل إنتاج", category: 'صناعة', governorate: 'بابل',
      shift: 'صباحي', vacancies: 100, status: 'available', salary_min: 700000,
      salary_max: 900000, employer_name: "مصنع الفرات", manual_closed: false,
      critical: true, filled_vacancy_numbers: [1, 2, 3]
    },
    {
      code: "HRC-1066", title: "محاسب 'أول'", category: 'إداري', governorate: 'بغداد',
      shift: 'دوام كامل', vacancies: 1, status: 'closed', salary_min: 800000,
      salary_max: 1000000, employer_name: 'شركة الرافدين', manual_closed: true,
      critical: false, filled_vacancy_numbers: []
    }
  ],
  applicants: [
    { serial: 'AAAA111111', full_name: 'أحمد علي حسين', phone: '07701234567', status: 'active', attempt_limit: 3, printed_count: 1, fee_amount: 5000 },
    { serial: 'BBBB222222', full_name: 'علي محمد جاسم', phone: '07709876543', status: 'blank', attempt_limit: 3, printed_count: 0, fee_amount: 5000 },
    { serial: 'CCCC333333', full_name: 'حسن كريم', phone: null, status: 'expired', attempt_limit: 3, printed_count: 2, fee_amount: 0 }
  ],
  job_attempts: [
    { serial: 'AAAA111111', attempt_no: 1, job_code: 'HRC-1055', slot_status: 'succeeded', vacancy_no: 1 },
    { serial: 'AAAA111111', attempt_no: 2, job_code: null, slot_status: 'empty', vacancy_no: null },
    { serial: 'BBBB222222', attempt_no: 1, job_code: 'HRC-1066', slot_status: 'reserved', vacancy_no: 12 }
  ],
  settings: [
    { key: 'rules', value: { attempt_limit: 3, fee: 5000 } },
    { key: 'notice', value: { text: 'رسالة إدارية' } }
  ],
  employer_job_credentials: [
    { job_code: 'HRC-1055', token: 'tok-111' },
    { job_code: 'HRC-1066', token: 'tok-222' }
  ],
  issued_serials: [
    { serial: 'AAAA111111', note: '' },
    { serial: 'BBBB222222', note: null },
    { serial: 'CCCC333333', note: 'ملاحظة' }
  ],
  audit_log: [
    { id: 1, ts: '2026-11-01T10:00:00Z', username: 'admin', role: 'admin', action: 'إصدار بطاقة', entity: 'applicants', entity_id: 'AAAA111111', details: 'تفصيل', diff: { a: 1 } },
    { id: 2, ts: '2026-11-02T10:00:00Z', username: 'admin', role: 'admin', action: 'تعديل وظيفة', entity: 'jobs', entity_id: 'HRC-1055', details: 'تفصيل', diff: null },
    { id: 3, ts: '2026-11-03T10:00:00Z', username: 'Ali', role: 'staff', action: 'حجز شاغر', entity: 'job_attempts', entity_id: '1', details: '', diff: null },
    { id: 7, ts: '2026-11-04T10:00:00Z', username: 'Ali', role: 'staff', action: 'تسجيل', entity: 'staff', entity_id: 'x', details: '', diff: null }
  ],
  staff: [
    { id: '11111111-1111-1111-1111-111111111111', auth_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', username: 'admin', full_name: 'المدير القديم', role: 'admin', job_title: 'مدير', phone: '0770', active: true },
    { id: '22222222-2222-2222-2222-222222222222', auth_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', username: 'AliAhmed919', full_name: 'علي أحمد', role: 'staff', job_title: 'موظف', phone: '0780', active: true }
  ]
};

/* ═══ ٢) الختم ثم الفكّ بكلمة المرور — كما يفعل المتصفح تماماً ═════════════ */
const envelope = await PB.seal(payload, 'كلمة-مرور-الفحص-2026');
const opened = await PB.open(envelope, 'كلمة-مرور-الفحص-2026');

check('الملف يُفكّ بكلمة المرور الصحيحة', opened.payload.schema, 'full-cycle');
check('الأعداد في المغلف تطابق المحتوى', opened.payload.jobs.length, 2);
check('البطاقات كلها موجودة', opened.payload.applicants.length, 3);
check('سجل التدقيق كامل (لا يُقصّ)', opened.payload.audit_log.length, 4);

let rejected = false;
try { await PB.open(envelope, 'كلمة-مرور-خاطئة'); } catch (e) { rejected = true; }
check('كلمة المرور الخاطئة تُرفض', rejected, true);

/* ═══ ٣) توليد SQL — والتحقق من مضمونه قبل التنفيذ ═════════════════════════ */
const sql = S.buildSql(opened.payload);
check('SQL يبدأ بمعاملة واحدة', /BEGIN;/.test(sql) && /COMMIT;/.test(sql), true);
check('يحذّر من TRUNCATE على قاعدة فيها بيانات', /لا تُشغّل هذا الملف على قاعدة فيها بيانات/.test(sql), true);
check('staff ليست في TRUNCATE (حماية المدير)', /TRUNCATE[^;]*brc\.staff/.test(sql), false);
check('الحسابات تُضاف بـ ON CONFLICT', /ON CONFLICT \("username"\) DO NOTHING/.test(sql), true);
check('auth_id لا يُنقل', /"auth_id"/.test(sql), false);

/* ═══ ٤) التنفيذ على قاعدة حقيقية ═══════════════════════════════════════════
   DDL مصغّر يطابق أسماء الأعمدة وأنواعها الفعلية في brc (وليس داخل المخطط
   الحقيقي فقط) — الفحص يُثبت أن SQL صالح لـPostgreSQL، لا أن نصّه معقول. */
const db = new PGlite();
await db.exec(`
CREATE SCHEMA brc;
CREATE TYPE brc.user_role AS ENUM ('admin','staff');
CREATE TYPE brc.job_status AS ENUM ('available','reserved','closed','hiring');
CREATE TYPE brc.form_status AS ENUM ('active','expired','exhausted','completed','pending','rejected','blank');
CREATE TYPE brc.slot_status AS ENUM ('empty','reserved','succeeded','rejected','expired','critical','hiring');
CREATE TABLE brc.jobs (id serial PRIMARY KEY, code text UNIQUE, title text, category text, region text,
  shift text, salary_min int, salary_max int, gender text, vacancies int, requirements text, description text,
  employer_name text, employer_phone text, employer_address text, interview_location text,
  status brc.job_status DEFAULT 'available', reserved_by text, hold_expires_at timestamptz, closed_at timestamptz,
  notes text, image_url text, created_by text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  critical boolean DEFAULT false, governorate text, manual_closed boolean DEFAULT false, filled_vacancy_numbers int[]);
CREATE TABLE brc.applicants (id serial PRIMARY KEY, serial text UNIQUE, full_name text, phone text, address text,
  dob date, gender text, nationality text, issue_date date, expiry_date date, attempt_limit int DEFAULT 3,
  status brc.form_status DEFAULT 'blank', fee_amount int DEFAULT 0, fee_paid boolean DEFAULT false,
  printed_count int DEFAULT 0, requested_code text, reject_reason text, created_by text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), notes text, pos_name text,
  self_application_data jsonb, archived_at timestamptz, card_print_code text);
CREATE TABLE brc.job_attempts (id serial PRIMARY KEY, serial text, attempt_no int, job_code text,
  slot_status brc.slot_status, employer_decision text, decision_at timestamptz, employer_reason text,
  vacancy_no smallint, job_snapshot jsonb, hold_expires_at timestamptz);
CREATE TABLE brc.settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE brc.employer_job_credentials (id serial PRIMARY KEY, job_code text, token text, created_at timestamptz DEFAULT now());
CREATE TABLE brc.issued_serials (serial text PRIMARY KEY, issued_at timestamptz DEFAULT now(), note text);
CREATE TABLE brc.staff (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_id uuid UNIQUE,
  username text NOT NULL UNIQUE, full_name text NOT NULL, role brc.user_role NOT NULL DEFAULT 'staff',
  job_title text DEFAULT '', phone text DEFAULT '', active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE brc.card_number_counter (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), last_number bigint NOT NULL CHECK (last_number >= 0));
INSERT INTO brc.card_number_counter VALUES (true, 0) ON CONFLICT DO NOTHING;
CREATE TABLE brc.card_number_registry (serial text PRIMARY KEY, card_number bigint NOT NULL UNIQUE CHECK (card_number > 0));
CREATE TABLE brc.audit_log (id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(), user_id uuid, username text,
  role text, ip text, action text, entity text, entity_id text, details text, diff jsonb);

/* ⚠️ الجداول الأربعة التي أضافها التصدير v3 (2026-11-15) — تُضاف هنا بنفس أعمدة docs/schema.sql. */
CREATE TABLE brc.recovery_chances (serial text NOT NULL, attempt_no smallint NOT NULL,
  spent boolean NOT NULL, code_hash text NOT NULL, PRIMARY KEY(serial,attempt_no));
CREATE TABLE brc.recovery_prints (serial text PRIMARY KEY, printed boolean NOT NULL, code_hash text);
CREATE TABLE brc.card_issue_requests (id uuid PRIMARY KEY, actor uuid, params jsonb, serials text[]);
CREATE TABLE brc.office_receipts (operation_id text PRIMARY KEY, actor uuid, payload jsonb, created_at timestamptz);
`);

/* المالك أنشأ حسابه على المشروع الجديد قبل الترحيل — يجب ألا يُطمس */
await db.exec(`insert into brc.staff (username, full_name, role, active)
  values ('admin', 'المدير على المشروع الجديد', 'admin', true);`);

await db.exec(sql);

const q = async (s) => (await db.query(s)).rows;
const count = async (t) => Number((await q(`select count(*) c from brc.${t}`))[0].c);

check('الوظائف استُرجعت', await count('jobs'), 2);
check('البطاقات استُرجعت', await count('applicants'), 3);
check('الفرص استُرجعت', await count('job_attempts'), 3);
check('الإعدادات استُرجعت', await count('settings'), 2);
check('بيانات جهات العمل استُرجعت', await count('employer_job_credentials'), 2);
check('الأرقام المُصدرة استُرجعت', await count('issued_serials'), 3);
check('سجل التدقيق استُرجعت كل صفوفه', await count('audit_log'), 4);

/* ── الحسابات: الحسابان القديمان يُضافان، والمدير الجديد يبقى ── */
check('الحسابات: القديم أُضيف + المدير الجديد بقي', await count('staff'), 2);
check('حساب المدير على المشروع الجديد لم يُطمس',
  (await q("select full_name from brc.staff where username='admin'"))[0]?.full_name,
  'المدير على المشروع الجديد');
check('الموظف القديم وصل', 
  (await q("select full_name from brc.staff where username='AliAhmed919'"))[0]?.full_name,
  'علي أحمد');

/* ── القيم الحسّاسة التي كسرت الاسترجاع سابقاً ── */
check('المصفوفة int[] سليمة',
  (await q("select array_to_string(filled_vacancy_numbers,',') v from brc.jobs where code='HRC-1055'"))[0]?.v, '1,2,3');
check('المصفوفة الفارغة لم تُصبح NULL',
  (await q("select filled_vacancy_numbers is null n from brc.jobs where code='HRC-1066'"))[0]?.n, false);
check('الاقتباس داخل النص لم يكسر SQL',
  (await q("select title from brc.jobs where code='HRC-1066'"))[0]?.title, "محاسب 'أول'");
check('NULL يبقى NULL لا نصاً فارغاً',
  (await q("select phone is null n from brc.applicants where serial='CCCC333333'"))[0]?.n, true);
check('jsonb سليم',
  (await q("select value->>'attempt_limit' v from brc.settings where key='rules'"))[0]?.v, '3');
check('uuid المولّد للحساب صالح',
  (await q("select id is not null n from brc.staff where username='AliAhmed919'"))[0]?.n, true);

/* ── التسلسلات: إدخال جديد بعد الاسترجاع لا يصطدم بمعرّف قديم ── */
const nextAudit = Number((await q("select nextval(pg_get_serial_sequence('brc.audit_log','id')) n"))[0].n);
check('تسلسل التدقيق يقف بعد أكبر معرّف (7 → 8)', nextAudit, 8);

/* ═══ ٥) تصدير CSV — المخرج الآخر الذي قد يعتمد عليه المالك ══════════════ */
const csv = S.toCsv(opened.payload.applicants);
check('CSV يبدأ بـBOM ليقرأ Excel العربية', csv.charCodeAt(0), 0xfeff);
check('CSV فيه سطر لكل بطاقة + الترويسة', csv.trim().split('\r\n').length, 4);
check("CSV يلفّ النص الذي فيه فاصلة", /"/.test(S.toCsv([{ a: 'x,y' }])), true);

await db.close();

console.log(`\n  المسار الكامل: ${ok} ناجح${bad ? ' / ' + bad + ' فاشل' : ''}`);
process.exit(bad ? 1 : 0);
