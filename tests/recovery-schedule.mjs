#!/usr/bin/env node
/* ===========================================================================
 *  HRC — الجدولة المرنة للنسخ الاحتياطي والاحتفاظ بآخر ٣ نسخ
 *  ---------------------------------------------------------------------------
 *  ⚠️ لماذا هذا الملف؟
 *
 *  لأن التصميم السابق كان:
 *    • جدولة = أيام + ساعة فقط — لا «كل ساعة» ولا «كل ٤ ساعات».
 *    • كل نسخة جديدة تحذف كل ما قبلها (delete ... where id<>result)
 *      ⇒ نسخة واحدة في القاعدة. مقيس على الإنتاج: صف واحد.
 *
 *  فخطأ يُكتشف بعد نسختين كان لا يمكن الرجوع عنه.
 *
 *  هذا الملف يُثبت بالتنفيذ:
 *    ١) تحويل النمط إلى cron صحيحاً، مع تحويل بغداد → UTC.
 *    ٢) الاحتفاظ: آخر ٣ نسخ مجدولة تبقى، والأقدم يُحذف.
 *    ٣) ⚠️ نسخ الأمان (safety=true) لا تُمسّ بالتقليم إطلاقاً.
 *    ٤) الواجهة تعرض النمطين وتحفظهما.
 *
 *  التشغيل: node tests/recovery-schedule.mjs  أو  npm run test:schedule
 *  لا يحتاج قاعدة Supabase ولا شبكة.
 * =========================================================================== */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));

const SHIM = `
  create role anon; create role authenticated; create role service_role;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;

const db = new PGlite();
let ready = false;
try {
  await db.exec(SHIM);
  /* نُنشئ جدول الإعدادات ودوال الجدولة فقط — لا القاعدة كاملة،
     فهذا الملف يخصّ الجدولة لا دورة الاسترجاع. */
  await db.exec(`
    create schema if not exists brc;
    create table if not exists brc.settings (
      key text primary key, value jsonb not null, updated_at timestamptz default now(), updated_by uuid);
  `);
  ready = true;
} catch (e) {
  bad('تهيئة القاعدة', (e.message || '').slice(0, 160));
}

/* نأخذ تعريفات الدوال من المصدر نفسه — نفحص ما سيُنشر فعلاً */
const src = read('docs/schema.sql');
const grab = (re) => (src.match(re) || [''])[0];
const keepFn   = grab(/create or replace function brc\.recovery_retention_keep\(\)[\s\S]*?\n\$\$;/);
const keepInit = grab(/insert into brc\.settings\(key, value, updated_at\)\n  values \('recovery_retention'[\s\S]*?exception when others then null; end \$\$;/);
const pruneFn  = grab(/create or replace function brc\.recovery_prune\(p_keep int\)[\s\S]*?\nend \$\$;/);
const pruneNo  = grab(/create or replace function brc\.recovery_prune\(\) returns integer[\s\S]*?\$\$;/);
const cronFn   = grab(/create or replace function brc\.recovery_cron_expr\(\n  p_mode text[\s\S]*?\nend \$\$;/);
const cronOld  = grab(/create or replace function brc\.recovery_cron_expr\(p_days int\[\], p_time text\)[\s\S]*?\$\$;/);
const dueFn    = grab(/create or replace function brc\.recovery_due_now\(\)[\s\S]*?\nend \$\$;/);

const asRole = async (role, sql, params = []) => {
  await db.exec('set role ' + role);
  try { return { ok: true, r: (await db.query(sql, params)).rows }; }
  catch (e) { return { ok: false, e: e.message || String(e) }; }
  finally { await db.exec('reset role'); }
};

if (ready) {
  console.log('\n▌ 1 — تعريفات المصدر موجودة بلا انحراف');
  check('recovery_retention_keep موجودة', keepFn.length > 50);
  check('recovery_prune(int) موجودة', pruneFn.length > 200);
  check('recovery_prune() بلا وسيط موجودة (توقيع داخلي)', pruneNo.length > 50);
  check('recovery_cron_expr(text,int,int[],text) موجودة', cronFn.length > 400);
  check('التوقيع القديم محفوظ للتوافق', cronOld.length > 50);
  check('recovery_due_now موجودة (بوابة «كل N يوم»)', dueFn.length > 300);

  console.log('\n▌ 2 — تحويل النمط إلى تعبير cron');
  try {
    await db.exec(cronFn); await db.exec(cronOld);
    const cron = async (mode, hours, days, time) => {
      const r = await db.query('select brc.recovery_cron_expr($1::text,$2::int,$3::int[],$4::text) c',
        [mode, hours, days, time]);
      return r.rows[0].c;
    };
    /* بغداد = UTC+3. ٠١:٠٠ بغداد = ٢٢:٠٠ UTC أمس ⇒ الساعة 22 */
    check('كل ساعة ⇒ الدقيقة ثابتة والباقي *', (await cron('interval', 1, null, '01:30')) === '30 * * * *',
      await cron('interval', 1, null, '01:30'));
    /* `h/4` = ابدأ من h ثم كل ٤ ساعات — لا `*​/4` التي تتجاهل h */
    check('كل ٤ ساعات من ٠٠:٠٠ بغداد ⇒ 21/4 UTC', (await cron('interval', 4, null, '00:00')) === '0 21/4 * * *',
      await cron('interval', 4, null, '00:00'));
    check('كل ٦ ساعات من ٠٦:٠٠ بغداد ⇒ تبدأ من ٣ UTC', (await cron('interval', 6, null, '06:00')) === '0 3/6 * * *',
      await cron('interval', 6, null, '06:00'));
    check('ساعة البداية تُحترم في النمط الدوري', (await cron('interval', 4, null, '06:00')) !==
      (await cron('interval', 4, null, '10:00')));
    check('كل ٢٤ ساعة ⇒ مرة يومياً', (await cron('interval', 24, null, '23:00')) === '0 20 * * *',
      await cron('interval', 24, null, '23:00'));
    check('بغداد ٠١:٠٠ = UTC ٢٢:٠٠ (نزوح للخلف)', (await cron('interval', 24, null, '01:00')) === '0 22 * * *',
      await cron('interval', 24, null, '01:00'));
    check('نمط الأيام كما كان: الجمعة ٢٣:٠٠ = 20 UTC', (await cron('days', null, [5], '23:00')) === '0 20 * * 5',
      await cron('days', null, [5], '23:00'));
    check('ساعات خارج ١..٢٤ مرفوضة', (await cron('interval', 0, null, '23:00')) === null &&
      (await cron('interval', 25, null, '23:00')) === null);
    check('وقت غير صالح مرفوض', (await cron('interval', 4, null, '25:00')) === null);
    check('نمط الأيام بلا أيام مرفوض', (await cron('days', null, [], '23:00')) === null);
    check('التوقيع القديم يعمل (توافق)', (await db.query(
      "select brc.recovery_cron_expr(array[5]::int[],'23:00'::text) c")).rows[0].c === '0 20 * * 5');
  } catch (e) { bad('تحويل cron', (e.message || '').slice(0, 160)); }

  console.log('\n▌ 2ب — الأنماط الخمسة التي طلبها صاحب العمل');
  try {
    const cron = async (mode, hours, days, time) => (await db.query(
      'select brc.recovery_cron_expr($1::text,$2::int,$3::int[],$4::text) c', [mode, hours, days, time])).rows[0].c;
    /* كل الاختبارات بوقت بغداد ٢٣:٠٠ = UTC ٢٠ */
    const cases = [
      ['١. كل ساعة',              'interval',   1, null, '23:00', '0 * * * *'],
      ['٢. كل ٣ ساعات من ٢٣:٠٠',  'interval',   3, null, '23:00', '0 20/3 * * *'],
      ['٣. كل يوم',               'daily',   null, null, '23:00', '0 20 * * *'],
      ['٤. كل ٥ أيام',            'every_days', 5, null, '23:00', '0 20 * * *'],
      ['٥. الجمعة والاثنين',      'days',    null, [1,5], '23:00', '0 20 * * 1,5'],
    ];
    for (const [label, m, h, d, t, want] of cases) {
      const got = await cron(m, h, d, t);
      check(label + ' ⇒ ' + want, got === want, String(got));
    }
    check('نمط مجهول يُرفض', (await cron('hourly', null, null, '23:00')) === null);
    check('كل ٣٦٦ يوم مرفوض (الحد ٣٦٥)', (await cron('every_days', 366, null, '23:00')) === null);
    check('كل صفر يوم مرفوض', (await cron('every_days', 0, null, '23:00')) === null);
    check('كل صفر ساعة مرفوض', (await cron('interval', 0, null, '23:00')) === null);

    /* ── بوابة الاستحقاق: قلب نمط «كل N يوم» ── */
    await db.exec(dueFn);
    const due = async () => (await db.query('select brc.recovery_due_now() b')).rows[0].b;
    const setSched = async (o) => db.query(
      `insert into brc.settings(key,value,updated_at) values ('recovery_schedule',$1::jsonb,now())
       on conflict (key) do update set value=excluded.value`,[JSON.stringify(o)]);

    await setSched({mode:'every_days',hours:5});
    check('كل ٥ أيام: أول مرة ⇒ حان الوقت فوراً', (await due()) === true);
    await db.query(`insert into brc.settings(key,value,updated_at) values ('recovery_last_scheduled_at',to_jsonb(now()),now())
      on conflict (key) do update set value=excluded.value`);
    check('كل ٥ أيام: بعد نسخة الآن ⇒ لا نسخة اليوم', (await due()) === false);
    await db.query(`update brc.settings set value=to_jsonb(now()-interval '4 days') where key='recovery_last_scheduled_at'`);
    check('كل ٥ أيام: مضى ٤ ⇒ لم يحن بعد', (await due()) === false);
    await db.query(`update brc.settings set value=to_jsonb(now()-interval '5 days') where key='recovery_last_scheduled_at'`);
    check('كل ٥ أيام: مضى ٥ ⇒ حان الوقت', (await due()) === true);

    await setSched({mode:'interval',hours:4});
    check('النمط الدوري لا يحتاج بوابة (cron يضبطه)', (await due()) === true);
    await setSched({mode:'daily',hours:1});
    check('النمط اليومي لا يحتاج بوابة', (await due()) === true);
    await setSched({mode:'days',days:[5]});
    check('نمط الأيام لا يحتاج بوابة', (await due()) === true);

    /* ⚠️ الحالة تُقرأ من الإعدادات لا من جدول النسخ */
    check('نسخة أمان يدوية لا تؤجّل النمط الدوري',
      /recovery_last_scheduled_at/.test(dueFn) && !/from brc\.recovery_copies/.test(dueFn));
  } catch (e) { bad('الأنماط الخمسة', (e.message || '').slice(0, 200)); }

  console.log('\n▌ 3 — الاحتفاظ بآخر ٣ نسخ والتقليم');
  try {
    /* الإعداد يُدرج مباشرة — keepInit يحتاج كتلة do $$ كاملة مع auth */
    await db.query(`insert into brc.settings(key,value) values ('recovery_retention','{"keep": 3}'::jsonb)
      on conflict (key) do nothing`);
    await db.exec(keepFn); await db.exec(pruneFn); await db.exec(pruneNo);
    await db.exec(`
      create table if not exists brc.recovery_tickets (id uuid primary key default gen_random_uuid(), copy_id uuid);
      create table if not exists brc.recovery_copies (
        id uuid primary key default gen_random_uuid(), name text, created_at timestamptz default now(),
        safety boolean default false);
    `);
    const keep = Number((await db.query('select brc.recovery_retention_keep() k')).rows[0].k);
    check('الحدّ الافتراضي ٣', keep === 3, String(keep));

    /* ٦ نسخ مجدولة + ٢ أمان */
    for (let i = 1; i <= 6; i++) {
      await db.query(`insert into brc.recovery_copies(name,safety,created_at) values ($1,false,now() + ($2||' seconds')::interval)`,
        ['مجدولة ' + i, String(i)]);
    }
    for (let i = 1; i <= 2; i++) await db.query(`insert into brc.recovery_copies(name,safety) values ('أمان','true')`);

    const beforeSched = Number((await db.query('select count(*)::int n from brc.recovery_copies where safety=false')).rows[0].n);
    const beforeSafe = Number((await db.query('select count(*)::int n from brc.recovery_copies where safety=true')).rows[0].n);
    check('قبل التقليم: ٦ مجدولة + ٢ أمان', beforeSched === 6 && beforeSafe === 2, beforeSched + ' / ' + beforeSafe);

    const deleted = Number((await db.query('select brc.recovery_prune() d')).rows[0].d);
    const afterSched = Number((await db.query('select count(*)::int n from brc.recovery_copies where safety=false')).rows[0].n);
    const afterSafe = Number((await db.query('select count(*)::int n from brc.recovery_copies where safety=true')).rows[0].n);
    check('التقليم حذف ٣ (٦ − ٣)', deleted === 3, String(deleted));
    check('بقيت ٣ نسخ مجدولة بالضبط', afterSched === 3, String(afterSched));
    check('⚠️ نسخ الأمان لم تُمسّ إطلاقاً', afterSafe === 2, afterSafe + ' (كانت ٢)');

    /* الأقدم حُذفت، الأحدث بقيت */
    const names = (await db.query('select name from brc.recovery_copies where safety=false order by name')).rows.map(r => r.name);
    check('الباقي هي الأحدث (٤،٥،٦)', names.join(',') === 'مجدولة 4,مجدولة 5,مجدولة 6', names.join(','));

    /* التقليم مرة أخرى لا يحذف شيئاً */
    const again = Number((await db.query('select brc.recovery_prune() d')).rows[0].d);
    check('التقليم المتكرر لا يحذف شيئاً (idempotent)', again === 0, String(again));

    /* حدّ صريح ١ */
    const d1 = Number((await db.query('select brc.recovery_prune(1) d')).rows[0].d);
    check('حدّ صريح ١ يُبقي نسخة واحدة', d1 === 2 &&
      Number((await db.query('select count(*)::int n from brc.recovery_copies where safety=false')).rows[0].n) === 1);

    /* تذاكر الاسترجاع تتبع النسخ الباقية */
    const ticketDel = Number((await db.query('select brc.recovery_prune(1) d')).rows[0].d);
    check('التقليم لا يكسر عند عدم وجود نسخ زائدة', ticketDel === 0);
  } catch (e) { bad('التقليم', (e.message || '').slice(0, 200)); }

  console.log('\n▌ 4 — الواجهة تعرض النمطين وتحفظهما');
  const ui = read('assets/js/recovery.js');
  const store = read('assets/js/store.js');
  const MODES=['interval','daily','every_days','days'];
  check('الأنماط الخمسة معروضة كلها', MODES.every(m=>new RegExp('recovery-mode-'+m).test(ui)),
    MODES.filter(m=>!new RegExp('recovery-mode-'+m).test(ui)).join(','));
  check('قائمة الساعات موجودة وتشمل ١ و٢٤', /recovery-sched-hours/.test(ui) && /value="1"/.test(ui) && /value="24"/.test(ui));
  check('محدّد «كل N يوم» موجود ويشمل ١ و٦٠', /recovery-sched-days-n/.test(ui) && /value="60"/.test(ui));
  check('إظهار/إخفاء الحقول حسب النمط', /function paintMode/.test(ui) && /show\.interval/.test(ui) && /show\.every_days/.test(ui) && /show\.days/.test(ui));
  check('الواجهة تُظهر أن «كل N يوم» فحص يومي لا نسخة يومية', /الفحص/.test(ui));
  check('المتجر يرسل النمط والساعات للقاعدة', /p_mode/.test(store) && /p_hours/.test(store));
  check('إيقاف الجدولة بلا أيام (دالة مستقلة)', /recoveryScheduleOff/.test(store));
  check('الواجهة تخبر المدير أن آخر ٣ نسخ تُحفظ', /آخر ٣ نسخ مجدولة/.test(ui));
  check('الواجهة تخبر أن نسخ الأمان لا تُحذف', /نسخ الأمان لا تُحذف/.test(ui));
  check('حساب الموعد التالي للنمط الدوري موجود', /function nextRunIntervalText/.test(ui));

  console.log('\n▌ 5 — الحراسة: لا تنفيذ بلا صلاحية');
  check('الجدولة محصورة بالمدير في المصدر', /function brc\.recovery_schedule_set[\s\S]{0,500}if not brc\.is_admin\(\)/.test(src));
  check('التقليم مسحوب عن المتصفح', /revoke all on function brc\.recovery_prune\(int\) from public, anon, authenticated/.test(src));
  check('عدد النسخ المحفوظة مسحوب عن المتصفح', /revoke all on function brc\.recovery_retention_keep\(\) from public, anon, authenticated/.test(src));
}

console.log('\n' + '═'.repeat(74));
console.log(`  النتيجة: ${fail === 0 ? '✅' : '❌'} ${pass} ناجح | ${fail} فاشل`);
if (fail) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
else console.log('  الجدولة المرنة تعمل · آخر ٣ نسخ تُحفظ · نسخ الأمان محميّة.');
console.log('═'.repeat(74) + '\n');
await db.close();
process.exit(fail ? 1 : 0);
