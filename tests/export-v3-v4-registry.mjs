/* ═══ هل النسخة تُصدّر سجل أرقام البطاقات فعلاً؟ ══════════════════════════
   ⚠️ العطل الذي أوجب هذا الفحص (2026-11-18):

   على الإنتاج، `recovery_export_v3` يضع `card_number_registry` **في الأعداد**
   فقط. قراءةً في تعريف الدالة:
       'card_number_registry', (select count(*) from brc.card_number_registry)
   أي أن المالك يرى «175» ويظنّ أن السجل وصل — والمفتاح `card_number_registry`
   غير موجود في الحمولة أصلاً. عددٌ بلا بيانات أسوأ من غيابه: يُطمئن كذباً.

   وبلا هذا السجل، بعد الاسترجاع على مشروع جديد: العدّاد يُشتقّ من
   `issued_serials` وحده، وهو تقريب لا مطابقة. قد تأخذ بطاقة جديدة رقماً
   موجوداً على بطاقة مطبوعة على ورق رسمي — أخطر نتيجة ممكنة في الاسترجاع.

   هذا الفحص:
     ١) يبني المخطط الكامل (docs/schema.sql) في PGlite،
     ٢) يُطبّق هجرة v3 ثم هجرة v4 كما هي من الملف،
     ٣) يزرع سجلاً وعدّاداً، ينادي v4، ويُدقّق الحمولة بمفاتيحها.
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e ?? ''))); };
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const MIG3 = 'supabase/migrations/20261115120000_portable_backup_v3.sql';
const MIG4 = 'supabase/migrations/20261118120000_portable_backup_v4_registry.sql';
for (const f of [MIG3, MIG4]) check(`ملف الهجرة موجود: ${f.split('/').pop()}`, existsSync(resolve(ROOT, f)));

/* ── بيئة Supabase مصغّرة: الأدوار والدوال التي يعتمد عليها المخطط ── */
const SHIM = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
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

console.log('\n═══ بناء المخطط ═══');
const db = new PGlite();
await db.waitReady;
await db.exec(SHIM);
await db.exec(read('docs/schema.sql'));
const q = async (s) => (await db.query(s)).rows;
check('المخطط بُني', (await q(`select count(*)::int n from information_schema.tables where table_schema='brc'`))[0].n > 15);

console.log('\n═══ تطبيق الهجرتين كما هما في المستودع ═══');
let v3err = null;
try { await db.exec(read(MIG3)); } catch (e) { v3err = e.message.split('\n')[0]; }
check('v3 نُفِّذت', !v3err, v3err);
let v4err = null;
try { await db.exec(read(MIG4)); } catch (e) { v4err = e.message.split('\n')[0]; }
check('v4 نُفِّذت', !v4err, v4err);

const fns = await q(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname='brc' and proname like 'recovery_export_%' order by 1`);
const names = fns.map(r => r.proname);
check('الدالتان موجودتان بعد التطبيق',
  names.includes('recovery_export_v3') && names.includes('recovery_export_v4'), names.join(', '));

console.log('\n═══ الحمولة: هل السجل بداخلها أم عددٌ فقط؟ ═══');
/* مدير: نتجاوز حارس is_admin كما تفعل بقية الفحوص */
await db.exec(`create or replace function brc.is_admin() returns boolean language sql stable as $f$ select true $f$;`);
await db.exec(`
  insert into brc.card_number_registry (serial, card_number) values
    ('HRC-BC-700001', 1), ('HRC-BC-700002', 2), ('HRC-BC-700003', 3);
  update brc.card_number_counter set last_number = 175 where singleton;
  insert into brc.issued_serials (serial) values ('HRC-BC-700001'), ('HRC-BC-700002');
`);
let p = null, perr = null;
try { p = (await q(`select brc.recovery_export_v4() as p`))[0].p; } catch (e) { perr = e.message.split('\n')[0]; }
check('v4 أنتجت حمولة', !!p, perr);

if (p) {
  check('format = 4', Number(p.format) === 4, p.format);
  /* جوهر الفحص: الصفوف نفسها، لا العدد */
  const reg = p.card_number_registry;
  check('card_number_registry مفتاح موجود في الحمولة', Array.isArray(reg), typeof reg);
  check('card_number_registry فيه 3 صفوف', Array.isArray(reg) && reg.length === 3, Array.isArray(reg) ? reg.length : '—');
  check('الصفوف تحمل (serial, card_number)',
    Array.isArray(reg) && reg.every(r => r.serial && r.card_number !== undefined),
    JSON.stringify(reg && reg[0]));
  /* الفلور: أعلى رقم في السجل لا العدّاد وحده */
  check('card_number_floor = 175 (العدّاد أعلى من السجل)', Number(p.card_number_floor) === 175, p.card_number_floor);
  /* v3 كان يعدّها فقط — نؤكّد أن الفرق حقيقي لا وهمي */
  check('العدد في counts يطابق الصفوف المصدّرة',
    Number(p.counts.card_number_registry) === reg.length, p.counts.card_number_registry);
  /* ما قبل v4 يجب أن يكون ناقصاً — وإلا فالفحص لا يُثبت شيئاً */
  const p3 = (await q(`select brc.recovery_export_v3() as p`))[0].p;
  check('v3 فعلاً لا يصدّر السجل (يُثبت أن v4 ضرورية)',
    p3.card_number_registry === undefined, JSON.stringify(p3.card_number_registry));
  check('v3 يعدّ السجل بلا تصديره (التناقض الموثَّق)',
    Number(p3.counts.card_number_registry) === 3, p3.counts.card_number_registry);
  /* الجداول الأربعة التي كانت تُفقد — تبقى مصدّرة في v4 */
  for (const k of ['recovery_chances', 'recovery_prints', 'office_receipts', 'card_issue_requests', 'recovery_cutoff']) {
    check(`v4 يحفظ ${k}`, p[k] !== undefined, 'غائب');
  }
}
await db.close();

console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — النسخة تُصدّر سجل أرقام البطاقات` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
