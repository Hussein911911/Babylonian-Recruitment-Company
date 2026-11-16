/* ═══════════════════════════════════════════════════════════════════════════
   الطريق الثاني: التنفيذ المباشر بلا أي لصق ولا تقسيم.

   المالك اختار (2026-11-15): «اختار رقم ٢» — أي `psql`/تنفيذ مباشر بدل
   لصق ثلاثين جزءاً في محرّر SQL.

   هذا الفحص يثبت الأمر من طرفه إلى طرفه على **PostgreSQL حقيقي** (PGlite):
     ١. يُنشئ نسخة .hrcbak بكلمة مرور (كما تفعل صفحة التنزيل).
     ٢. يستدعي الأداة الحقيقية tools/restore-portable.mjs.
     ٣. يفكّ التشفير، يولّد SQL، ينفّذه، ثم **يتحقّق من الأعداد في القاعدة**.
     ٤. يرفض النسخة إن لم تطابق — لا يقول «اكتمل» وهو فاشل.
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

let ok = 0, bad = 0;
const check = (label, cond, extra) => {
  cond ? ok++ : bad++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}` + (cond ? '' : ' — ' + extra));
};

/* ═══ ١) نسخة حقيقية بكلمة مرور ═══ */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
globalThis.window = globalThis;
new Function(readFileSync('assets/js/portable-backup.js', 'utf8'))();
const PB = globalThis.HRCPortableBackup;

const PASSWORD = 'رمز-التجربة-الطويل-٢٠٢٦';
const STAFF = '93900c94-9bde-4176-b418-e8a4721e9fb2';
const payload = {
  exportedAt: '2026-11-15T09:00:00Z',
  schema: 'sha256:cli',
  counts: { jobs: 3, applicants: 40, attempts: 20, audit: 5 },
  staff: [{ id: STAFF, username: 'admin', full_name: 'المدير', role: 'admin', active: true }],
  jobs: [1, 2, 3].map((i) => ({
    code: 'JOB-00' + i, title: 'وظيفة ' + i, employer_name: 'شركة ' + i,
    employer_phone: '0770000000' + i, requirements: ['شروط'], vacancies: 5,
    status: 'available', created_by: STAFF
  })),
  applicants: Array.from({ length: 40 }, (_, i) => ({
    id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    serial: 'HRC-BC-' + String(i + 1).padStart(6, '0'),
    full_name: 'باحث عن عمل رقم ' + (i + 1), phone: '0770' + String(100000 + i),
    address: 'الحلة', status: 'active', attempt_limit: 3, fee_amount: 5000,
    expiry_date: '2026-12-31', created_by: STAFF
  })),
  job_attempts: Array.from({ length: 20 }, (_, i) => ({
    id: `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    serial: 'HRC-BC-' + String(i + 1).padStart(6, '0'),
    attempt_no: 1, job_code: 'JOB-001',
    slot_status: 'succeeded', selected_at: '2026-11-01T10:00:00Z', staff_id: STAFF
  })),
  audit_log: Array.from({ length: 5 }, (_, i) => ({
    ts: '2026-11-01T00:00:00Z', username: 'admin', role: 'admin',
    action: 'فحص', entity: 'applicants', entity_id: 'HRC-BC-000001',
    details: 'تفصيل ' + i, user_id: STAFF
  }))
};

const dir = mkdtempSync(join(tmpdir(), 'hrc-cli-'));
const bak = join(dir, 'hrc-backup-test.hrcbak');
const env = await PB.seal(payload, PASSWORD);
writeFileSync(bak, JSON.stringify(env), 'utf8');
check('نسخة .hrcbak أُنشئت', existsSync(bak), bak);

/* ═══ ٢) الأداة تفكّ وتولّد SQL ═══ */
const out = join(dir, 'restore.sql');
try {
  execFileSync(process.execPath, ['tools/restore-portable.mjs', bak, '--out', out], {
    env: { ...process.env, HRC_BACKUP_PASSWORD: PASSWORD },
    stdio: 'pipe'
  });
  check('الأداة فكّت النسخة وولّدت SQL', existsSync(out), 'لم يُكتب الملف');
} catch (e) {
  check('الأداة فكّت النسخة وولّدت SQL', false, (e.stderr || '').toString().slice(0, 150));
}

const sql = existsSync(out) ? readFileSync(out, 'utf8') : '';
check('ملف SQL غير فارغ', sql.length > 1000, sql.length + ' حرفاً');
check('يبدأ بـ TRUNCATE ويحتوي BEGIN', sql.includes('TRUNCATE') && sql.includes('BEGIN;'));

/* ═══ ٣) كلمة مرور خاطئة تُرفض ولا تكتب شيئاً ═══ */
const badOut = join(dir, 'should-not-exist.sql');
let rejected = false;
try {
  execFileSync(process.execPath, ['tools/restore-portable.mjs', bak, '--out', badOut], {
    env: { ...process.env, HRC_BACKUP_PASSWORD: 'رمز-خاطئ-٩٩٩٩٩' }, stdio: 'pipe'
  });
} catch (e) { rejected = true; }
check('كلمة مرور خاطئة تُرفض ولا تكتب ملفاً', rejected && !existsSync(badOut));

/* ═══ ٤) التنفيذ على PostgreSQL حقيقي ═══
   ⚠ PGlite يكتشف «هل أنا في متصفح» بوجود `window`. نحن عرّفناه فوق كي
   تعمل وحدات المتصفح (portable-backup) — فيظنّ PGlite أنه في متصفح ويحاول
   قراءة `location.pathname` فيسقط. نُزيله الآن؛ لم نبقَ بحاجة إليه. */
delete globalThis.window;
const db = new PGlite();
await db.waitReady;

/* نُهيّئ ما يوفّره Supabase تلقائياً، كما يفعل أي مشروع جديد */
await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE SCHEMA IF NOT EXISTS cron;
  CREATE SCHEMA IF NOT EXISTS storage;
  /* pgcrypto substitutes — في مخطط extensions كما يفعل Supabase */
  CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(int) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5(random()::text),'hex') $$;
  CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(md5($1),'hex') $$;
  CREATE OR REPLACE FUNCTION extensions.pgp_sym_encrypt(text, text) RETURNS bytea LANGUAGE sql AS $$ SELECT $1::bytea $$;
`);

const schemaSql = readFileSync('docs/schema.sql', 'utf8')
  .replace(/CREATE EXTENSION[^;]*;/gi, '--');
try {
  await db.exec(schemaSql);
  const t = await db.query(`select count(*)::int n from information_schema.tables where table_schema='brc'`);
  check('الهيكل نُفِّذ على القاعدة الجديدة', t.rows[0].n >= 19, t.rows[0].n + ' جدولاً');
} catch (e) {
  check('الهيكل نُفِّذ على القاعدة الجديدة', false, e.message.split('\n')[0].slice(0, 120));
}

try {
  await db.exec(sql);
  const a = await db.query(`select count(*)::int n from brc.applicants`);
  const j = await db.query(`select count(*)::int n from brc.jobs`);
  check('البطاقات ٤٠', a.rows[0].n === 40, a.rows[0].n);
  check('الوظائف ٣', j.rows[0].n === 3, j.rows[0].n);
  const name = await db.query(`select full_name from brc.applicants where serial='HRC-BC-000001'`);
  check('الاسم العربي سليم', (name.rows[0] || {}).full_name === 'باحث عن عمل رقم 1',
        JSON.stringify(name.rows[0]));
} catch (e) {
  check('تنفيذ ملف SQL على القاعدة', false, e.message.split('\n')[0].slice(0, 200));
}
await db.close();

console.log('\n' + '─'.repeat(60));
console.log(bad === 0
  ? `✅ الطريق الثاني مثبت من طرفه إلى طرفه — ${ok} فحصاً`
  : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
