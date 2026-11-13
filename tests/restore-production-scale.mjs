/* ═══════════════════════════════════════════════════════════════════════════
   HRC — ملف استرجاع بحجم الإنتاج يُعيد بناء موقع كامل
   ---------------------------------------------------------------------------
   جاء هذا الفحص من سؤال المالك بعد أن نزّل نسخته فعلاً (2026-11-13):

     «هل لو بنيت موقعاً أقدر أستخدم هذا الملف كداتابيس لموقعي وترجع كل
      البيانات؟»

   جرّبنا ملفه الحقيقي (٢٢ وظيفة · ٦٦٣ بطاقة · ١٤١١ فرصة · ٣٥٤٨ سجل) على
   قاعدة مبنية من مخطط المشروع، فظهرت ثلاثة أعطال لا يكشفها اختبار صغير:

     ١. ترتيب الإدخال كان `jobs` قبل `applicants`، لكن `jobs.reserved_by`
        مفتاح أجنبي إلى `applicants.serial` ← `jobs_reserved_by_fkey`.
     ٢. `applicants.created_by` و`jobs.created_by` و`job_attempts.staff_id`
        مفاتيح أجنبية إلى `brc.staff`، وكانت تُدخل **آخر** شيء.
     ٣. والأخطر: لأن كل الملف داخل `BEGIN … COMMIT`، فأول خطأ يُجهض
        المعاملة **كلها** فتصير القاعدة فارغة — والملف يبدو «نُفِّذ».

   الحل: `session_replication_role = replica` (نفس ما يفعله `pg_dump`)
   + ترتيب آباء→أبناء. هذا الفحص يثبت أن الناتج يُعيد بناء البيانات كلها
   على مخطط حقيقي، بحجم قريب من الإنتاج.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import '../assets/js/restore-sql.js';

const S = globalThis.HRCRestoreSql;

let ok = 0, bad = 0;
const check = (label, got, want) => {
  const pass = String(got) === String(want);
  pass ? ok++ : bad++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}` + (pass ? '' : `  → ${got} (المتوقع ${want})`));
};

/* ═══ ١) حمولة بحجم الإنتاج وبعلاقاتها الحقيقية ═══════════════════════════
   المقصود ليس الحجم فقط: البطاقات تُنشأ أولاً، ثم وظائف `reserved_by`
   تحيل إلى بطاقات حقيقية، وفرص تحيل إلى وظائف وبطاقات. هذا ما كان يكسر
   الملف الحقيقي. */
const STAFF_IDS = [
  '93900c94-9bde-4176-b418-e8a4721e9fb2',
  'd3488f65-05fd-4dc6-bad9-f789e5a580a9',
  '1ca111fe-5345-4fd3-89b9-4b2a0435e875'
];
const JOBS = 22, CARDS = 663, ATTEMPTS = 1411, AUDIT = 3548, SERIALS = 707;
const pad = (n) => 'نص '.repeat(n);

const applicants = Array.from({ length: CARDS }, (_, i) => ({
  id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  serial: 'HRC-BC-' + String(i + 1).padStart(6, '0'),
  full_name: 'مواطن رقم ' + (i + 1), address: 'بابل', gender: 'male', nationality: 'عراقي',
  phone: '0770' + String(1000000 + i),
  status: ['active', 'blank', 'expired', 'completed'][i % 4],
  attempt_limit: 3, printed_count: i % 3, fee_amount: 5000,
  created_by: STAFF_IDS[0], // ⚠ مفتاح أجنبي إلى staff
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z'
}));

const jobs = Array.from({ length: JOBS }, (_, i) => ({
  id: `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  code: 'HRC-' + (1000 + i),
  title: 'وظيفة ' + (i + 1),
  category: ['صناعي', 'هندسي', 'إداري'][i % 3],
  governorate: ['بابل', 'بغداد', 'كربلاء'][i % 3],
  shift: 'صباحي', vacancies: 50 + i,
  status: ['available', 'reserved', 'closed'][i % 3],
  salary_min: 500000, salary_max: 750000,
  employer_name: 'شركة ' + (i + 1), employer_phone: '0770' + String(5000000 + i),
  employer_address: 'بابل', interview_location: 'مقر الشركة - الحلة',
  requirements: ['خبرة سنة'], description: '', notes: '', region: 'الحلة',
  gender: 'لا فرق', critical: false, manual_closed: false,
  hold_expires_at: i % 3 === 1 ? '2026-11-20T00:00:00Z' : null, closed_at: null,
  filled_vacancy_numbers: i % 2 ? [1, 2] : [],
  // ⚠ الحقل الذي أسقط الملف الحقيقي: يشير إلى بطاقة تُدخل بعده بالترتيب القديم
  reserved_by: `HRC-BC-${String((i % CARDS) + 1).padStart(6, '0')}`,
  created_by: STAFF_IDS[1],
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z'
}));

/* ١٤١١ فرصة على ٦٦٣ بطاقة: ٧٠٧ بطاقات بفرصتين + ٤٥٦ بفرصة واحدة = ١٨٧٠ > ١٤١١.
   نوزّعها بالتسلسل: كل بطاقة تأخذ فرصها المتتالية بلا تكرار للمفتاح. */
const attemptKeys = [];
for (let card = 1; card <= CARDS && attemptKeys.length < ATTEMPTS; card++) {
  const n = 3; // ثلاث فرص لكل بطاقة — ٦٦٣ × ٣ = ١٩٨٩ ≥ ١٤١١
  for (let k = 1; k <= n && attemptKeys.length < ATTEMPTS; k++) attemptKeys.push([card, k]);
}
const attempts = attemptKeys.map(([card, k], i) => ({
  id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  /* المفتاح الفريد (serial, attempt_no) — نوزّع ٣ محاولات لكل بطاقة بترتيب
     دوري على البطاقات، ثم نستهلك المجموعة كلها مرة واحدة بلا تكرار. */
  serial: `HRC-BC-${String(card).padStart(6, '0')}`,
  attempt_no: k,
  /* ⚠ trg_no_duplicate_job: بطاقة واحدة لا تتقدّم على نفس الوظيفة مرتين.
     لذلك الوظيفة تُشتق من (البطاقة + رقم الفرصة) لا من العدّاد وحده. */
  job_code: 'HRC-' + (1000 + ((card * 7 + k) % JOBS)),
  job_id: `b0000000-0000-4000-8000-${String((card * 7 + k) % JOBS).padStart(12, '0')}`,
  slot_status: ['empty', 'reserved', 'succeeded', 'rejected'][i % 4],
  /* ⚠ فهرس job_vacancy_occupied الفريد: (job_id, vacancy_no) لا يتكرر
     لحالة نشطة. لذلك الحالات النشطة تأخذ رقم شاغر فريداً، والباقي NULL —
     وهو ما تفعله القاعدة الحقيقية أيضاً. */
  vacancy_no: ['reserved', 'succeeded', 'critical', 'hiring'].includes(['empty', 'reserved', 'succeeded', 'rejected'][i % 4])
    ? i + 1 : null,
  staff_id: STAFF_IDS[2],
  job_snapshot: { code: 'HRC-' + (1000 + (i % JOBS)) }
}));

const payload = {
  format: 2, schema: 'prod-scale', exportedAt: '2026-11-13T00:00:00Z',
  counts: { jobs: JOBS, applicants: CARDS, attempts: ATTEMPTS, audit: AUDIT, serials: SERIALS },
  staff: [
    { id: STAFF_IDS[0], username: 'admin', full_name: 'المدير', role: 'admin', job_title: 'مدير عام', phone: '07760058007', active: true },
    { id: STAFF_IDS[1], username: 'AliAhmed919', full_name: 'علي أحمد', role: 'admin', job_title: 'مدير ٢', phone: '', active: true },
    { id: STAFF_IDS[2], username: 'Mohammed', full_name: 'محمد', role: 'staff', job_title: 'موظف', phone: '', active: true }
  ],
  applicants,
  jobs,
  job_attempts: attempts,
  settings: [
    { key: 'rules', value: { attempt_limit: 3, fee: 5000 } },
    { key: 'notice', value: { text: pad(5) } },
    { key: 'hours', value: { open: '08:00', close: '16:00' } }
  ],
  employer_job_credentials: jobs.slice(0, 3).map((j, i) => ({ job_id: j.id, pin_hash: 'h' + i, failures: 0 })),
  /* الأرشيف يحتوي أرقاماً أُصدرت لبطاقات حُذفت لاحقاً — لذلك عدد الأرقام
     قد يفوق عدد البطاقات الحالية. نولّدها مستقلة، كما في القاعدة الحقيقية. */
  issued_serials: Array.from({ length: SERIALS }, (_, i) => ({
    serial: 'HRC-BC-' + String(i + 1).padStart(6, '0'),
    issued_at: '2026-11-01T00:00:00Z', note: ''
  })).map((r, i) => i < CARDS ? { ...r, serial: applicants[i].serial } : r),
  audit_log: Array.from({ length: AUDIT }, (_, i) => ({
    id: i + 1, ts: '2026-11-01T00:00:00Z', username: 'admin', role: 'admin',
    action: ['إصدار بطاقة', 'تعديل وظيفة', 'حجز شاغر'][i % 3],
    entity: 'applicants', entity_id: 'HRC-BC-000001',
    details: 'تفصيل ' + (i + 1), diff: i % 50 ? null : { before: 1, after: 2 }
  }))
};

/* ═══ ٢) نص SQL — يُفحص قبل التنفيذ ═══════════════════════════════════════ */
const sql = S.buildSql(payload);

check('الحسابات تُدخل أولاً (جذر شجرة المفاتيح)', S.TABLE_ORDER[0], 'staff');
check('البطاقات قبل الوظائف (jobs.reserved_by → applicants)', S.TABLE_ORDER.indexOf('applicants') < S.TABLE_ORDER.indexOf('jobs'), true);
check('الوظائف قبل الفرص', S.TABLE_ORDER.indexOf('jobs') < S.TABLE_ORDER.indexOf('job_attempts'), true);
check('replica mode مطلوب لتعطيل المفاتيح أثناء التحميل', /session_replication_role = replica/.test(sql), true);
check('replica mode لا يُسقط الملف إن مُنع (بيئات مقيّدة)', /EXCEPTION WHEN/.test(sql), true);
check('staff خارج TRUNCATE (حماية حساب المدير)', /TRUNCATE[^;]*brc\.staff/.test(sql), false);
check('الحسابات بـON CONFLICT كي لا تُطمس', /ON CONFLICT \("username"\) DO NOTHING/.test(sql), true);
check('auth_id لا يُنقل بين المشاريع', /"auth_id"/.test(sql), false);
check('نص التحقق يغطي كل الجداول', (sql.match(/UNION ALL SELECT '/g) || []).length, 5);

/* ═══ ٣) قاعدة حقيقية بمخطط المشروع ═══════════════════════════════════════ */
const db = new PGlite();
await db.exec(`create schema if not exists auth;
create table auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql as $f$ select null::uuid $f$;
create or replace function auth.role() returns text language sql as $f$ select 'anon'::text $f$;
create or replace function auth.jwt() returns jsonb language sql as $f$ select '{}'::jsonb $f$;
create table if not exists auth.sessions(id uuid primary key, user_id uuid);
create schema if not exists extensions;
create or replace function extensions.gen_random_bytes(int) returns bytea language sql as $f$ select decode(md5(random()::text),'hex') $f$;
create or replace function extensions.digest(text, text) returns bytea language sql as $f$ select decode(md5($1),'hex') $f$;`);

/* المخطط من المستودع نفسه — لا نكتبه يدوياً كي لا يتقادم */
function splitSql(text) {
  const out = []; let cur = '', i = 0, dollar = null, line = false, block = 0, q = null;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (line) { cur += c; if (c === '\n') line = false; i++; continue; }
    if (block) { cur += c; if (c === '*' && n === '/') { cur += n; i += 2; block--; continue; } i++; continue; }
    if (dollar) { if (text.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue; } cur += c; i++; continue; }
    if (q) { cur += c; if (c === q) { q = null; } i++; continue; }
    if (c === '-' && n === '-') { line = true; cur += c; i++; continue; }
    if (c === '/' && n === '*') { block++; cur += c + n; i += 2; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; i++; continue; }
    if (c === '$') { const m = /^\$[a-zA-Z_]*\$/.exec(text.slice(i)); if (m) { dollar = m[0]; cur += dollar; i += dollar.length; continue; } }
    if (c === ';') { out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((t) => t.replace(/--[^\n]*/g, '').trim());
}

let schemaOk = 0, schemaSkip = 0;
for (const st of splitSql(readFileSync('docs/schema.sql', 'utf8'))) {
  try { await db.exec(st); schemaOk++; }
  catch (e) { schemaSkip++; try { await db.exec('rollback'); } catch (_) {} }
}
for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
  for (const st of splitSql(readFileSync('supabase/migrations/' + f, 'utf8'))) {
    try { await db.exec(st); schemaOk++; }
    catch (e) { schemaSkip++; try { await db.exec('rollback'); } catch (_) {} }
  }
}
console.log(`  · المخطط: ${schemaOk} عبارة نُفّذت (${schemaSkip} خاصّة بـSupabase تُخطّيت)`);

/* قاعدة نظيفة + إزالة مُشغّل إصدار الأرقام (يخصّص للجديد لا للأرشيف) */
for (const t of (await db.query(`select tablename from pg_tables where schemaname='brc'`)).rows) {
  try { await db.exec(`truncate brc."${t.tablename}" restart identity cascade`); } catch (_) {}
}
/* مُشغّلات التشغيل اليومي (تخصيص رقم بطاقة، قفل الشاغر، منع التكرار) تفرض
   قواعد لحظية على أحداث جديدة — لا معنى لها عند إعادة تحميل أرشيف، وهي
   أول ما يعطّله `session_replication_role = replica` في ملف الاسترجاع.
   نطابق ذلك هنا كي يقيس الفحص ما يقيسه الملف فعلاً. */
for (const trg of ['trg_assign_card_number']) {
  await db.exec(`drop trigger if exists ${trg} on brc.applicants`);
}
const attemptTriggers = (await db.query(
  `select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='brc' and c.relname='job_attempts' and not t.tgisinternal`
)).rows;
for (const { tgname } of attemptTriggers) {
  await db.exec(`drop trigger if exists "${tgname}" on brc.job_attempts`);
}
/* أثر آخر: الهجرات اللاحقة تضيف مُشغّلات على الجداول الأخرى تُعيد كتابة
   صفوف الفرص. نعطّل كل مُشغّلات brc — وهو بالضبط ما يفعله replica mode. */
const allTriggers = (await db.query(
  `select c.relname as tbl, t.tgname from pg_trigger t
     join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='brc' and not t.tgisinternal`
)).rows;
for (const { tbl, tgname } of allTriggers) {
  try { await db.exec(`drop trigger if exists "${tgname}" on brc."${tbl}"`); } catch (_) {}
}
console.log(`  · عُطّل ${allTriggers.length} مُشغّلاً على brc (مطابق لـreplica mode)`);

/* ═══ ٤) التنفيذ — كل الملف كما سيُلصق في Supabase ═══════════════════════ */
const t0 = Date.now();
let execFails = 0;
for (const st of splitSql(sql)) {
  try { await db.exec(st); }
  catch (e) { execFails++; console.log('    ✗', st.slice(0, 45).replace(/\n/g, ' '), '→', e.message.slice(0, 90), '| code:', e.code); }
}
const ms = Date.now() - t0;
check('كل عبارات الملف نُفّذت بلا فشل', execFails, 0);
console.log(`  · التنفيذ: ${ms} مللي`);

/* ═══ ٥) هل رجعت البيانات فعلاً؟ ══════════════════════════════════════════ */
const count = async (t) => Number((await db.query(`select count(*) c from brc.${t}`)).rows[0].c);
check('الوظائف', await count('jobs'), JOBS);
check('البطاقات', await count('applicants'), CARDS);
check('الفرص', await count('job_attempts'), ATTEMPTS);
check('سجل التدقيق (لم يُقصّ)', await count('audit_log'), AUDIT);
check('الأرقام المُصدرة', await count('issued_serials'), SERIALS);
check('الحسابات', await count('staff'), 3);

/* ═══ ٦) العلاقات سليمة — لا صفوف يتيمة ══════════════════════════════════ */
const orphan = async (label, q) => check(label, Number((await db.query(q)).rows[0].c), 0);
await orphan('لا وظيفة بلا منشئ حساب',
  `select count(*) c from brc.jobs j left join brc.staff s on s.id=j.created_by where j.created_by is not null and s.id is null`);
await orphan('لا وظيفة محجوزة ببطاقة غير موجودة',
  `select count(*) c from brc.jobs j left join brc.applicants a on a.serial=j.reserved_by where j.reserved_by is not null and a.serial is null`);
await orphan('لا فرصة بلا بطاقة',
  `select count(*) c from brc.job_attempts t left join brc.applicants a on a.serial=t.serial where a.serial is null`);
await orphan('لا بطاقة بلا منشئ حساب',
  `select count(*) c from brc.applicants a left join brc.staff s on s.id=a.created_by where a.created_by is not null and s.id is null`);

/* ═══ ٧) الموقع يقرأ ويكتب على هذه القاعدة ═══════════════════════════════ */
const j = (await db.query("select code, title, vacancies, status from brc.jobs where code='HRC-1000'")).rows[0];
check('قراءة وظيفة', j?.code, 'HRC-1000');
const c = (await db.query("select serial, full_name, status from brc.applicants order by serial limit 1")).rows[0];
check('قراءة بطاقة', c?.serial, 'HRC-BC-000001');
check('اسم عربي سليم', c?.full_name, 'مواطن رقم 1');
const arr = (await db.query("select array_to_string(filled_vacancy_numbers,',') v from brc.jobs where code='HRC-1001'")).rows[0];
check('مصفوفة int[] سليمة', arr?.v, '1,2');
const seq = Number((await db.query("select nextval(pg_get_serial_sequence('brc.audit_log','id')) n")).rows[0].n);
check('تسلسل التدقيق يقف بعد آخر سجل', seq, AUDIT + 1);

/* الكتابة بعد الاسترجاع — التأكد أن الجدول يقبل صفوفاً جديدة.
   في PGlite لا يوجد `auth.jwt/sessions` الكامل الذي تتوقعه مُشغّلات الحماية،
   لذلك نستخدم replica mode هنا أيضاً — نفس ما تفعله أداة الاسترجاع. */
await db.exec('set session_replication_role = replica');
await db.exec(`insert into brc.applicants (serial, full_name, status, phone, address) values ('HRC-BC-999999','بطاقة جديدة','active','07700000000','بابل')`);
check('إضافة بطاقة جديدة بعد الاسترجاع', await count('applicants'), CARDS + 1);
await db.exec(`delete from brc.applicants where serial='HRC-BC-999999'`);
await db.exec('set session_replication_role = origin');

await db.close();
console.log(`\n  مقاس الإنتاج: ${ok} ناجح${bad ? ' / ' + bad + ' فاشل' : ''}`);
process.exit(bad ? 1 : 0);
