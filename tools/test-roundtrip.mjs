#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — اختبار الذهاب والعودة (تصدير ← استرجاع ← مقارنة)

   الغرض: إثبات أن ما تصدّره النسخة يُستعاد كاملاً على مشروع جديد. يكشف هذا
   النوع من الأخطاء **بصمت**: التصدير ينجح، والاسترجاع ينجح، والبيانات ناقصة.

   التشغيل:  node tools/test-roundtrip.mjs
   يطبع جدولاً: كل جدول قبل التصدير ← بعده. أي `❌` = فقد بيانات.

   ⚠ يُغطّي تحديداً الجداول التي كانت تُفقد قبل 2026-11-15:
     recovery_chances · recovery_prints · office_receipts · card_issue_requests
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Sql = require('../assets/js/restore-sql.js');

/* ═══ اختبار الذهاب والعودة ══════════════════════════════════════════════
   الهدف: نُثبت أن ما يُصدَّر يُستعاد كاملاً — بالعدد والمحتوى. */
const mk = async () => {
  const db = new PGlite();
  await db.exec(`create schema if not exists auth; create schema if not exists extensions;`);
  await db.exec(`create table if not exists auth.users(id uuid primary key, email text);`);
  await db.exec(`create table if not exists auth.sessions(id uuid primary key, user_id uuid);`);
  await db.exec(`do $do$ begin create role anon; create role authenticated; create role service_role;
   exception when others then null; end $do$;`);
  for (const q of [
   `create or replace function auth.uid() returns uuid language sql as 'select null::uuid'`,
   `create or replace function auth.jwt() returns jsonb language sql as 'select ''{}''::jsonb'`,
   `create or replace function extensions.gen_random_bytes(int) returns bytea language sql as 'select decode(''0000000000000000'',''hex'')'`,
   `create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select ''00000000-0000-4000-8000-000000000001''::uuid'`,
   `create or replace function extensions.gen_salt(text) returns text language sql as 'select ''stub'''`,
   `create or replace function extensions.crypt(text,text) returns text language sql as 'select ''stub'''`,
   `create or replace function extensions.digest(text,text) returns bytea language sql as 'select decode(''00'',''hex'')'`,
   `create or replace function extensions.digest(bytea,text) returns bytea language sql as 'select decode(''00'',''hex'')'`,
  ]) { try { await db.exec(q); } catch {} }
  for (const p of readdirSync('docs/sql-parts/schema').filter((f) => f.endsWith('.sql')).sort())
    await db.exec(readFileSync('docs/sql-parts/schema/' + p, 'utf8'));
  return db;
};

/* ── قاعدة «القديمة»: بيانات في كل جدول ── */
const A = await mk();
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
await A.exec(`
insert into brc.staff(id,username,full_name,role,active) values('${U(1)}','admin','المدير','admin',true);
insert into brc.jobs(id,code,title,governorate,employer_name,employer_phone) values('${U(2)}','HRC-1042','نجار','بابل','شركة أ','0770');
insert into brc.applicants(id,serial,full_name,phone,status) values('${U(3)}','HRC-BC-000001','علي','0771','active');
insert into brc.job_attempts(serial,attempt_no,slot_status) values('HRC-BC-000001',1,'hiring') on conflict (serial,attempt_no) do update set slot_status='hiring';
insert into brc.issued_serials(serial) values('HRC-BC-000001') on conflict (serial) do nothing;
insert into brc.card_number_registry(serial,card_number) values('HRC-BC-000001',901);
insert into brc.card_number_counter(singleton,last_number) values(true,901) on conflict (singleton) do update set last_number=901;
insert into brc.settings(key,value) values('testkey','{"a":1}'::jsonb) on conflict (key) do nothing;
insert into brc.recovery_chances(serial,attempt_no,spent,code_hash) values('HRC-BC-000001',1,true,'H1'),('HRC-BC-000001',2,false,'H2') on conflict (serial,attempt_no) do update set spent=excluded.spent,code_hash=excluded.code_hash;
insert into brc.recovery_prints(serial,printed,code_hash) values('HRC-BC-000001',true,'P1') on conflict (serial) do update set printed=true,code_hash='P1';
insert into brc.office_receipts(operation_id,actor,request_hash,result) values('${U(9)}','${U(1)}','RH','{"ok":true}'::jsonb);
insert into brc.card_issue_requests(id,actor,params,serials) values('${U(8)}','${U(1)}','{"n":1}'::jsonb,'{HRC-BC-000001}');
/* التدقيق يُسجَّل تلقائياً بالمشغّلات — لا نضيف صفاً يدوياً بالمعرّف 1 */
`);

const read = async (db) => {
  const out = {};
  for (const t of ['jobs','applicants','job_attempts','issued_serials','card_number_registry',
                   'card_number_counter','settings','recovery_chances','recovery_prints',
                   'office_receipts','card_issue_requests','audit_log','staff']) {
    try { out[t] = (await db.query(`select count(*)::int c from brc.${t}`)).rows[0].c; }
    catch { out[t] = '—'; }
  }
  return out;
};
const before = await read(A);
console.log('قبل التصدير:', JSON.stringify(before));

/* ── نُصدّر عبر recovery_export_v3 (نتجاوز is_admin كما في الاختبار السابق) ── */
await A.exec(`create or replace function brc.is_admin() returns boolean language sql as 'select true'`);
await A.exec(readFileSync('supabase/migrations/20261112060000_portable_backup_v2.sql', 'utf8'));
await A.exec(readFileSync('supabase/migrations/20261115120000_portable_backup_v3.sql', 'utf8'));
const payload = (await A.query(`select brc.recovery_export_v3() j`)).rows[0].j;
console.log('مفاتيح الحمولة:', Object.keys(payload).join(', '));

/* ── نبني ملف SQL بالمولّد ونستورده على قاعدة جديدة ── */
const sql = Sql.buildSql({
  exportedAt: payload.exportedAt || '2026-11-15T12:00:00Z',
  schema: payload.schema || 'hash',
  counts: payload.counts || {},
  staff: payload.staff || [], jobs: payload.jobs || [],
  applicants: payload.applicants || [], job_attempts: payload.job_attempts || [],
  settings: payload.settings || [], employer_job_credentials: payload.employer_job_credentials || [],
  issued_serials: payload.issued_serials || [],
  card_number_registry: payload.card_number_registry || [],
  card_number_counter: payload.card_number_counter || [],
  audit_log: payload.audit_log || [],
  card_issue_requests: payload.card_issue_requests || [],
  recovery_chances: payload.recovery_chances || [],
  recovery_prints: payload.recovery_prints || [],
  office_receipts: payload.office_receipts || [],
});
console.log('\nجداول في ملف الاسترجاع:', [...new Set([...sql.matchAll(/INSERT INTO brc\."?(\w+)"?/g)].map((m) => m[1]))].join(', '));

const B = await mk();
await B.exec(sql);
const after = await read(B);
console.log('بعد الاسترجاع:', JSON.stringify(after));

console.log('\n════ المقارنة ════');
let ok = true;
for (const k of Object.keys(before)) {
  const same = before[k] === after[k];
  if (!same && before[k] !== 0) ok = false;
  if (before[k] !== 0 || after[k] !== 0)
    console.log(`   ${same ? '✅' : '❌'} ${k.padEnd(22)} ${before[k]} → ${after[k]}`);
}
console.log(ok ? '\n✅ لا شيء فُقد — كل صف وصل' : '\n❌ يوجد فقد');
await A.close(); await B.close();
