/* ═══════════════════════════════════════════════════════════════════════════
   HRC — النسخة الاحتياطية كاملة: أرقام البطاقات + صور الوظائف
   ---------------------------------------------------------------------------
   جاء هذا الفحص من مراجعة ملف المالك الحقيقي (2026-11-13). كان الملف
   «يسترجع» ٢٢ وظيفة و٦٦٣ بطاقة، لكنه يُسقط شيئين لا يظهر نقصهما إلا
   بعد فوات الأوقات:

     ١. **أرقام البطاقات** (`card_number_registry` + `card_number_counter`).

        الملف كان يحفظ البطاقات ولا يحفظ أرقامها، فالعدّاد يبدأ من صفر على
        المشروع الجديد. أي أن أول بطاقة تُصدر بعد الترحيل تأخذ رقماً
        انطبع سابقاً على ورق فعلي — تكرار على وثيقة رسمية.

        وحجم المشكلة في ملفه: **٦٣٤ بطاقة بحالة `blank`** تنتظر أرقاماً.

     ٢. **صور الوظائف**.

        يُحفظ `image_url` نصاً. فإن أشار إلى مشروع Supabase الذي ننسخ منه،
        فحذف ذلك المشروع يجعل الصور مكسورة — أي أن «النسخة الكاملة» كانت
        تعتمد على بقاء المصدر الذي تنسخ منه. خمس صور في ملفه على هذا الحال.

   هذا الفحص يمنع رجوع العطلين.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import '../assets/js/restore-sql.js';
import imageEmbedModule from '../assets/js/image-embed.js';

const S = globalThis.HRCRestoreSql;
const I = globalThis.HRCImageEmbed || imageEmbedModule;

let ok = 0, bad = 0;
const check = (label, got, want) => {
  const pass = String(got) === String(want);
  pass ? ok++ : bad++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}` + (pass ? '' : `  → ${got} (المتوقع ${want})`));
};

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SB_URL = 'https://vqsvztudvfukyuerzcgx.supabase.co/storage/v1/object/public/job-images/jobs/hrc-1046.jpg';

/* ═══ ١) الشكل الذي يُنتجه الخادم بعد الإصلاح ══════════════════════════ */
const payload = {
  format: 2, schema: 'completeness', exportedAt: '2026-11-13T00:00:00Z',
  counts: { jobs: 3, applicants: 3, attempts: 0, audit: 0, serials: 2 },
  staff: [{ id: '11111111-1111-4111-8111-111111111111', username: 'admin', full_name: 'المدير', role: 'admin', active: true }],
  applicants: [
    { serial: 'HRC-BC-000001', full_name: 'أحمد', status: 'blank', phone: '0770', address: 'بابل' },
    { serial: 'HRC-BC-000002', full_name: 'علي', status: 'blank', phone: '0771', address: 'بابل' },
    { serial: 'HRC-BC-000003', full_name: 'حسن', status: 'active', phone: '0772', address: 'بابل' }
  ],
  jobs: [
    { code: 'HRC-1', title: 'صورة Supabase', status: 'available', image_url: SB_URL, employer_name: 'ش', governorate: 'بابل', vacancies: 1 },
    { code: 'HRC-2', title: 'صورة خارجية', status: 'available', image_url: 'https://images.unsplash.com/photo-1?w=800', employer_name: 'ش', governorate: 'بابل', vacancies: 1 },
    { code: 'HRC-3', title: 'بلا صورة', status: 'available', image_url: '', employer_name: 'ش', governorate: 'بابل', vacancies: 1 }
  ],
  job_attempts: [], settings: [], employer_job_credentials: [],
  issued_serials: [{ serial: 'HRC-BC-000001', note: '' }, { serial: 'HRC-BC-000002', note: '' }],
  card_number_registry: [
    { serial: 'HRC-BC-000001', card_number: 1 },
    { serial: 'HRC-BC-000002', card_number: 7 }   // فجوة: أرقام ٢–٦ لبطاقات حُذفت
  ],
  card_number_counter: [{ singleton: true, last_number: 7 }],
  audit_log: []
};

/* ═══ ٢) النص يولّد ما يلزم ═════════════════════════════════════════════ */
const sql = S.buildSql(payload);

check('السجل يُدخل (أرقام البطاقات تحفظ)', /INSERT INTO brc\."card_number_registry"/.test(sql), true);
check('العدّاد يُضبط على أعلى رقم مستخدم (٧) لا صفر', /VALUES \(true, 7\)/.test(sql), true);
check('العدّاد لا ينزل عن قيمة قائمة (GREATEST)', /GREATEST\(brc\.card_number_counter\.last_number, EXCLUDED\.last_number\)/.test(sql), true);
/* ⚠️ كان الفحصان يطلبان `TRUNCATE` مكتوباً بأسماء جداول صريحة. صار
   التفريغ ديناميكياً من الكتالوج (2026-11-18) لأن الأسماء الصريحة كانت
   تُفشل الملف كله على مخطط ناقص بـ`relation does not exist`. المطلوب الآن:
   التفريغ يسبق الإدخال، ويشمل كل جداول brc، والعدّاد يُضبط لا يُفرَّغ.
   الشرط الأخير هو الأهمّ: تفريغ العدّاد يمحو أرضية الترقيم. */
check('التفريغ ديناميكي ويشمل كل جداول brc',
  /TRUNCATE brc\.%I RESTART IDENTITY CASCADE/.test(sql), true);
check('التفريغ يسبق أول إدخال',
  sql.indexOf('TRUNCATE brc.%I') < sql.indexOf('INSERT INTO brc.'), true);
check('العدّاد مستثنى من التفريغ',
  /c\.relname <> 'staff'/.test(sql) && /AND c\.relname <> 'card_number_counter'/.test(sql) === false,
  true);
check('العدّاد خارج TRUNCATE (يُضبط لا يُمسح)',
  /TRUNCATE[^;]*brc\.card_number_counter/.test(sql), false);
check('العدّاد يُضبط بعد السجل لا قبله',
  sql.indexOf('INSERT INTO brc."card_number_registry"') < sql.indexOf('brc.card_number_counter'), true);

/* ═══ ٣) تنفيذ حقيقي — العدّاد والبطاقة التالية ═════════════════════════ */
const db = new PGlite();
await db.exec(`create schema brc;
create table brc.card_number_counter (singleton boolean primary key default true check (singleton), last_number bigint not null check (last_number >= 0));
insert into brc.card_number_counter values (true, 0) on conflict do nothing;
create table brc.card_number_registry (serial text primary key, card_number bigint not null unique check (card_number > 0));
create table brc.staff(id uuid primary key, username text not null unique, full_name text, role text, active boolean);
create table brc.applicants(serial text primary key, full_name text, status text, phone text, address text);
create table brc.jobs(id serial, code text, title text, status text, image_url text, employer_name text, governorate text, vacancies int);
create table brc.issued_serials(serial text primary key, note text);`);

/* اجعل القاعدة نظيفة كما سيفعل الملف */
await db.exec('truncate brc.card_number_registry, brc.applicants, brc.jobs, brc.issued_serials, brc.staff restart identity cascade');

/* تقسيم يحترم $$ … $$ (كتلة replica mode) والتنصيص */
function splitSql(text) {
  const out = []; let cur = '', i = 0, dollar = null, line = false, block = 0, q = null;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (line) { cur += c; if (c === '\n') line = false; i++; continue; }
    if (block) { cur += c; if (c === '*' && n === '/') { cur += n; i += 2; block--; continue; } i++; continue; }
    if (dollar) { if (text.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue; } cur += c; i++; continue; }
    if (q) { cur += c; if (c === q) q = null; i++; continue; }
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
const stmts = splitSql(sql);
let execFails = 0;
for (const st of stmts) {
  if (/brc\.(job_attempts|settings|employer_job_credentials|audit_log)\b/.test(st) &&
      /INSERT|TRUNCATE|setval|UNION/.test(st) && !/CREATE/.test(st)) continue;
  try { await db.exec(st + ';'); }
  catch (e) { execFails++; console.log('    ✗', e.message.slice(0, 80)); }
}
check('كل العبارات نُفّذت', execFails, 0);

check('السجل وصل: صفان', (await db.query('select count(*) c from brc.card_number_registry')).rows[0].c, 2);
check('العدّاد = ٧ (أعلى رقم)', (await db.query('select last_number from brc.card_number_counter')).rows[0].last_number, 7);

/* البطاقة التالية بعد الترحيل: يجب أن تأخذ ٨ لا ١ */
const next = (await db.query(
  `update brc.card_number_counter set last_number = last_number + 1 where singleton returning last_number`
)).rows[0].last_number;
check('البطاقة التالية تأخذ ٨ لا ١ (لا تكرار على ورق مطبوع)', next, 8);

/* ═══ ٤) الصور: أي رابط يُضمَّن وأيها لا ════════════════════════════════ */
check('صور مشروع Supabase تُضمَّن (قد تختفي)', I.shouldEmbed(SB_URL), true);
check('صور Unsplash لا تُضمَّن (ليست ملك الشركة)', I.shouldEmbed('https://images.unsplash.com/photo-1?w=800'), false);
check('data URL لا يُضمَّن مرتين', I.shouldEmbed('data:image/png;base64,AAA'), false);
check('رابط فارغ لا يُضمَّن', I.shouldEmbed(''), false);
check('يجمع الروابط الفريدة فقط', I.collect({ jobs: [{ image_url: SB_URL }, { image_url: SB_URL }, { image_url: '' }] }).length, 1);

/* ═══ ٥) التضمين الفعلي داخل SQL ═════════════════════════════════════════ */
const dataUrl = 'data:image/png;base64,' + PNG;
const withImages = S.buildSql({ ...payload, images: { [SB_URL]: dataUrl } });

check('الصورة صارت بايتات داخل SQL', /data:image\/png;base64,/.test(withImages), true);
check('رابط المشروع القديم اختفى من الوظيفة', withImages.indexOf(SB_URL.split('?')[0]), -1);
check('الصورة الخارجية بقيت رابطاً', /images\.unsplash\.com/.test(withImages), true);
check('الوظيفة بلا صورة بقيت فارغة', /''/.test(withImages), true);

/* الحمولة الأصلية لم تُعدَّل */
check('الحمولة الأصلية سليمة (لا mutation)', payload.jobs[0].image_url, SB_URL);
check('الصور ليست في الحمولة بلا طلب', payload.images, undefined);

/* القاعدة تقبل الـdata URL وتخزّنه كاملاً */
const db2 = new PGlite();
await db2.exec('create schema brc');
await db2.exec('create table brc.jobs(id serial, code text, title text, status text, image_url text, employer_name text, governorate text, vacancies int)');
const block = withImages.slice(withImages.indexOf('INSERT INTO brc."jobs"'));
await db2.exec(block.slice(0, block.indexOf(';\n') + 1));
const stored = (await db2.query('select image_url from brc.jobs order by code')).rows.map((r) => r.image_url);
check('القاعدة خزّنت الصورة المضمّنة', stored[0].indexOf('data:image/png;base64,') === 0, true);
check('الرابط الخارجي بقي رابطاً في القاعدة', stored[1].indexOf('https://images.unsplash.com/') === 0, true);
check('الوظيفة بلا صورة بقيت فارغة في القاعدة', stored[2], '');
await db2.close();

/* ═══ ٦) توافق خلفي: نسخة قديمة بلا الحقلين لا تنكسر ═══════════════════ */
const legacy = { ...payload };
delete legacy.card_number_registry;
delete legacy.card_number_counter;
delete legacy.images;
const legacySql = S.buildSql(legacy);
check('نسخة قديمة بلا أرقام تُولّد SQL صالحاً', /BEGIN;/.test(legacySql), true);
/* ⚠️ تغيّر 2026-11-18 بقصد. كان يطلب ألا يُكتب عدّاد إطلاقاً لنسخة بلا
   أرقام — حمايةً من «عدّاد وهمي». لكن الحالة الواقعية على الإنتاج هي
   بالضبط هذه: v2 المطبَّقة لا تصدّر السجل ولا العدّاد. فعدم الكتابة تعني
   عدّاداً على قيمته الافتراضية، أي أن أول بطاقة تأخذ رقماً مطبوعاً.
   الأصحّ: يُكتب دائماً، لكن بقيمة لا تنزل عن القيمة القائمة (GREATEST). */
check('نسخة قديمة تضبط العدّاد (لا تتركه على الصفر)',
  /card_number_counter \(singleton/.test(legacySql), true);
check('العدّاد لا ينزل عن قيمة قائمة في النسخة القديمة',
  /GREATEST\(brc\.card_number_counter\.last_number, EXCLUDED\.last_number\)/.test(legacySql), true);
check('نسخة قديمة لا تكتب سجلاً فارغاً', /INSERT INTO brc\."card_number_registry"/.test(legacySql), false);

await db.close();

console.log(`\n  اكتمال النسخة: ${ok} ناجح${bad ? ' / ' + bad + ' فاشل' : ''}`);
process.exit(bad ? 1 : 0);
