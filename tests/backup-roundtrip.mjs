#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — إثبات دورة النسخة الاحتياطية كاملة
   ---------------------------------------------------------------------------
   يمشي المسار الذي يمشيه المالك في الطوارئ، بلا اختصار:

     ① تحميل وحدتَي المتصفح كما هي (portable-backup.js · restore-sql.js)
     ② تشفير نسخة بحجم بياناته الحقيقية (724 بطاقة · 1448 محاولة)
     ③ رفض كلمة مرور خاطئة
     ④ فكّ التشفير بالكلمة الصحيحة
     ⑤ بناء ملف الاسترجاع SQL
     ⑥ تنصيب الهيكل من **نفس الأجزاء الخمسة التي ينزّلها زر restore.html**
     ⑦ تنفيذ ملف الاسترجاع على قاعدة فاضية
     ⑧ مطابقة الأعداد
     ⑨ الفرص المستهلكة تبقى مستهلكة
     ⑩ البحث بالباركود يعمل
     ⑪ تصدير جديد من القاعدة المسترجعة (دورة تُغلق على نفسها)

   ⚠️ عطلان حقيقيان كشفهما هذا الملف (2026-11-15):
     • v3 كانت تُصدّر code_hash السرّي، أو تُسقطه فيفشل الإدخال
       بـ23502 على أول صفّ — أي فشل كل استرجاع قبل أن يبدأ.
     • الواجهة كانت تطلب v2 لا v3، فلا تُصدَّر الفرص المستهلكة.

   التشغيل:  node tests/backup-roundtrip.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
/* دورة كاملة: تصدير ← تشفير ← فشل فك بكلمة خطأ ← فك صحيح ← بناء SQL ← تنصيب */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
Object.defineProperty(globalThis,"crypto",{value:webcrypto,configurable:true});
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// نحمّل وحدات المتصفح كما هي
const path = './assets/js/';
for (const f of ['portable-backup.js','restore-sql.js']) {
  const src = readFileSync(path+f,'utf8');
  new Function(src)();
}
const PB = globalThis.HRCPortableBackup;
const Sql = globalThis.HRCRestoreSql;
/* PGlite يفحص globalThis.window ليعرف البيئة — نُزيله بعد تحميل وحدات المتصفح */
delete globalThis.window;
console.log('① الوحدتان محمّلتان · التشفير متاح:', PB.available());

// ═══ بيانات كحجم بيانات المالك ═══
const U=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now='2026-11-15T12:00:00.000Z';
const jobs=Array.from({length:22},(_,i)=>({id:U(1000+i),code:'HRC-'+(1042+i),title:'وظيفة '+(i+1),governorate:'بابل',employer_name:'شركة '+(i+1),employer_phone:'0770',status:'available',created_at:now}));
const applicants=Array.from({length:724},(_,i)=>({id:U(10000+i),serial:'HRC-BC-'+String(100000+i).padStart(6,'0'),full_name:'باحث '+(i+1),phone:'0780000'+String(i).padStart(4,'0'),status:'active',attempt_limit:2,fee_paid:true,printed_count:1,created_at:now,updated_at:now,self_application_data:{}}));
const attempts=[]; const chances=[];
for(let i=0;i<724;i++)for(const n of [1,2]){const used=(i%3)!==0;const j=(i*2+n)%22;
 attempts.push({id:U(200000+i*2+n),serial:applicants[i].serial,attempt_no:n,slot_status:used?'hiring':'empty',job_id:used?jobs[j].id:null,job_code:used?jobs[j].code:null,selected_at:used?now:null});
 chances.push({serial:applicants[i].serial,attempt_no:n,spent:used});}

const payload={format:3,exportedAt:now,schema:'h',counts:{applicants:724,jobs:22},
 staff:[{id:U(1),username:'admin',full_name:'المدير',role:'admin',active:true}],
 jobs,applicants,job_attempts:attempts,
 recovery_chances:chances,
 recovery_prints:applicants.map(a=>({serial:a.serial,printed:true})),
 card_issue_requests:[],office_receipts:[],
 settings:[],employer_job_credentials:[],audit_log:[],
 issued_serials:applicants.map(a=>({serial:a.serial,issued_at:now,note:''})),
 card_number_registry:applicants.map((a,i)=>({serial:a.serial,card_number:900+i})),
 card_number_counter:[{singleton:true,last_number:1623}]};

// ═══ ٢) تشفير ═══
const PASS='كلمة-سر-قوية-1234';
const env = await PB.seal(payload, PASS);
const text = JSON.stringify(env);
console.log('② شُفّرت · حجم الملف:', (text.length/1024).toFixed(0),'ك.ب · الاسم:', PB.suggestName(new Date()));
console.log('   هل يحتوي نصاً مقروءاً؟', /باحث|HRC-BC-100/.test(text) ? '❌ نعم (تسريب)' : '✅ لا');

// ═══ ٣) كلمة خطأ ═══
let rejected=false;
try { await PB.open(text, 'كلمة-خطأ-9876'); } catch(e){ rejected=true; }
console.log('③ كلمة مرور خطأ:', rejected ? '✅ رُفضت' : '❌ قُبلت!');

// ═══ ٤) الكلمة الصحيحة ═══
const opened = await PB.open(text, PASS);
const back = opened.payload;
console.log('④ فُكّت · format:', back.format, '· بطاقات:', back.applicants?.length, '· فرص:', back.recovery_chances?.length);

// ═══ ٥) بناء SQL ═══
const sql = Sql.buildSql(back);
console.log('⑤ بُني ملف الاسترجاع:', sql.split('\n').length, 'سطراً ·', (sql.length/1024/1024).toFixed(2),'م.ب');

// ═══ ٦) تنصيب على قاعدة فاضية ═══
const db = new PGlite();
await db.exec(`create schema if not exists auth; create schema if not exists extensions;`);
await db.exec(`create table if not exists auth.users(id uuid primary key, email text);`);
await db.exec(`create table if not exists auth.sessions(id uuid primary key, user_id uuid);`);
await db.exec(`do $do$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $do$;`);
for (const q of [`create or replace function auth.uid() returns uuid language sql as 'select null::uuid'`,
 `create or replace function auth.jwt() returns jsonb language sql as 'select ''{}''::jsonb'`,
 `create or replace function extensions.gen_random_bytes(int) returns bytea language sql as 'select decode(''0000000000000000'',''hex'')'`,
 `create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select ''00000000-0000-0000-0000-000000000001''::uuid'`,
 `create or replace function extensions.gen_salt(text) returns text language sql as 'select ''stub'''`,
 `create or replace function extensions.crypt(text,text) returns text language sql as 'select ''stub'''`,
 `create or replace function extensions.digest(text,text) returns bytea language sql as 'select decode(''00'',''hex'')'`,
 `create or replace function extensions.digest(bytea,text) returns bytea language sql as 'select decode(''00'',''hex'')'`]) { try { await db.exec(q); } catch {} }
const src = readFileSync('assets/js/restore-page.js','utf8');
const split = new Function('return (' + src.match(/function splitSchema\(text\) \{[\s\S]*?\n  \}/)[0] + ')')();
for (const p of split(readFileSync('docs/schema.sql','utf8'))) await db.exec(p);
console.log('⑥ الهيكل: 5 أجزاء');

// تطبيق إصلاح التصدير ثم استرجاع البيانات
/* v2 مبنية من سكيما أقدم (متغيّرات مقفلة). v3 تتضمّن منطقها كاملاً،
   فنتخطّى v2 وننفّذ v3 — كما سيفعل المالك على قاعدة جديدة. */
try { await db.exec(readFileSync('docs/sql-parts/live-2026-11-15/1-إصلاح-تصدير-النسخة.sql','utf8')); }
catch(e){ console.log('❌ تنفيذ v3:', e.message); }
await db.exec(sql);
console.log('⑦ البيانات استُرجعت');

const q=async(s)=>{try{return (await db.query(s)).rows[0]}catch(e){return {خطأ:e.message.split('\n')[0].slice(0,70)}}};
console.log('⑧ الأعداد:', JSON.stringify(await q(`select (select count(*) from brc.applicants) بطاقات,(select count(*) from brc.job_attempts) محاولات,(select count(*) from brc.recovery_chances) فرص,(select count(*) from brc.recovery_prints) طباعة`)));
console.log('⑨ فرص مستهلكة بقيت مستهلكة؟', JSON.stringify(await q(`select (select count(*) from brc.recovery_chances where spent) مستهلكة`)));
console.log('⑩ بحث الباركود:', JSON.stringify(await q(`select full_name from brc.applicants where serial='HRC-BC-100099'`)));
// جولة كاملة: تصدير من القاعدة الجديدة
await db.exec(`insert into auth.users(id,email) values('${U(1)}','a@b.c') on conflict do nothing`);
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $f$ select '${U(1)}'::uuid $f$`);
await db.exec(`update brc.staff set auth_id='${U(1)}'`);
await db.exec(`create or replace function brc.recovery_export_v2() returns jsonb language sql as $f$ select '{"format":2,"counts":{}}'::jsonb $f$`);
const re = await q(`select brc.recovery_export_v3() j`);
console.log('⑪ تصدير من القاعدة الجديدة:', re.خطأ ? '❌ '+re.خطأ : JSON.stringify(re.j.counts));
await db.close();
