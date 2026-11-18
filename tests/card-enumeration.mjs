#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص تعداد البطاقات وتسريب بيانات الباحثين
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا هذا الملف؟
 *
 *  لأن الثغرة التي يمنعها **لم تكن خطأً في الكود**: كل سطر كان يعمل كما صُمّم.
 *  `card_gate` فيها حدّ طلبات لكنها لم تُستدعَ إطلاقاً. فحص نصّي لا يرى هذا —
 *  لا بدّ من تنفيذ الهجوم.
 *
 *  هذا الملف ينفّذ الهجوم الحقيقي بدور `anon` وبلا جلسة:
 *      أ) يعدّد البطاقات → يجب أن يُحجب قبل استنفاد النطاق.
 *      ب) يحاول ضخّ بصمة في السجل التدقيقي → يجب أن تُرفض.
 *
 *  ويُثبت أن **دورة العمل كما يريدها صاحب العمل سليمة**:
 *      ج) البطاقة المفعّلة → بيانات صاحبها كاملة (لا تقنين ولا إقفال).
 *      د) بيانات صاحب العمل → معروضة للزبون ليتصل به.
 *      هـ) بطاقة فارغة → تُعرض بلا بيانات (لا يوجد ما يُسرَّب).
 *
 *  ⚠️ سياسة التقنين أُلغيت 2026-11-13 بعد توضيح صاحب العمل لدورة العمل:
 *     المكتب يُصدر بطاقات فارغة ويبيعها كاشاً، و`card_print_code` غير مستعمل
 *     فيها (فارغ في 723/723 بطاقة). اشتراطه كان يُقنّع كل زبون عن نفسه ويقفل
 *     حقوله بلا مقابل. ما يحمي فعلاً: من يقدّم ببطاقة غيره يكتب اسمه فوقها
 *     (apply_with_card)، فيقارن صاحب العمل بالهوية الوطنية ويكشفه.
 *
 *  التشغيل:  node tests/card-enumeration.mjs   أو   npm run test:enumeration
 *  لا يحتاج قاعدة Supabase ولا شبكة ولا أسراراً.
 * =========================================================================== */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

const SHIM = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions; create schema cron; create schema storage;
  create table auth.users (id uuid primary key);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create table storage.buckets (id text primary key, name text, public boolean);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create function extensions.digest(text, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.digest(bytea, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.pgp_sym_encrypt(text, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.pgp_sym_decrypt(bytea, text) returns text language sql as $$ select ''::text $$;
  create function hmac(text, text, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create table cron.job (jobid bigint, jobname text, schedule text, command text);
  create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
  create function cron.schedule(text, text) returns bigint language sql as $$ select 1::bigint $$;
  create function cron.unschedule(text) returns boolean language sql as $$ select true $$;
`;

const FULL_NAME = 'غيث حماد عبد الصاحب';
const FULL_PHONE = '07800977448';

const db = new PGlite();
let ready = false;
try {
  await db.exec(SHIM);
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    try { await db.exec(read(`supabase/migrations/${f}`)); } catch { /* ترحيلات تعتمد امتدادات غير متاحة في PGlite */ }
  }
  ready = true;
} catch (e) {
  bad('تهيئة القاعدة', (e.message || '').slice(0, 200));
}

const asAnon = async (sql, params = []) => {
  await db.exec('set role anon');
  try { return { ok: true, d: (await db.query(sql, params)).rows[0]?.d }; }
  catch (e) { return { ok: false, e: e.message || String(e) }; }
  finally { await db.exec('reset role'); }
};
const asRole = async (role, sql, params = []) => {
  await db.exec(`set role ${role}`);
  try { return { ok: true, r: await db.query(sql, params) }; }
  catch (e) { return { ok: false, e: e.message || String(e) }; }
  finally { await db.exec('reset role'); }
};

if (ready) {
  /* ── بيانات واقعية: 40 بطاقة برقم متسلسل (كما في الإنتاج) ───────────────
     ⚠️ `self_application_data` لم يكن يُملأ هنا، فكان كل ما يقرأ «ملف صاحب
     البطاقة» يُظهر `{}` — أي أن الاختبار كان يمرّر بطاقة بلا ملف أصلاً.
     في الإنتاج يُكتب هذا الحقل من `apply_with_card`: بيانات صاحب البطاقة
     هي ما كتبه بنفسه، لا ما في أعمدة البطاقة (تلك تبقى للتقييد والتقنين). */
  for (let i = 1; i <= 40; i++) {
    await db.query(
      `insert into brc.applicants (serial, full_name, phone, address, dob, gender, status, fee_amount, fee_paid, card_print_code, self_application_data)
       values ($1, $2, $3, $5, '1995-04-12', 'ذكر', 'active', 10000, true, $4,
               jsonb_build_object('fullName', $2::text, 'phone', $3::text, 'address', $5::text, 'dob', '1995-04-12'))`,
      [`HRC-BC-9000${String(i).padStart(2, '0')}`, FULL_NAME, FULL_PHONE,
       i === 1 ? 'ABCD1234EFGH5678' : null, 'بابل — الحلة — المركز — قرب الجامعة']
    );
  }
  await db.query(`insert into brc.applicants (serial, full_name, phone, status, fee_amount, fee_paid)
    values ('HRC-BC-999999', '', '', 'blank', 10000, true)`);

  /* ═══ 1) البطاقة المفعّلة تُعرض لصاحبها كاملة ═══════════════════════════
     دورة العمل (كما وصفها صاحب العمل): المكتب يُصدر بطاقات فارغة ويبيعها
     كاشاً. من يمسك الباركود هو من دفع ثمنه، وبياناته كتبها بنفسه. و
     card_print_code غير مستعمل في هذه الدورة (فارغ في 723/723 بطاقة)،
     فاشتراطه كان يُقنّع كل زبون عن نفسه ويقفل حقوله بلا مقابل.
     ما يحمي فعلاً: من يقدّم ببطاقة غيره يكتب اسمه فوقها (apply_with_card)،
     وصاحب العمل يقارن بالهوية الوطنية. والتعداد يوقفه الحارس (القسم ٢). */
  step(1, 'البطاقة المفعّلة — بيانات صاحبها كاملة (بياناته ووظائفه)');

  const one = await asAnon(`select brc.lookup_card($1::text, null::text) d`, ['HRC-BC-900002']);
  check('lookup_card تعمل وتُرجع البطاقة', one.ok && one.d?.ok === true, one.e || '');
  check('الاسم الكامل يُعرض (لا تقنين)', one.d?.fullName === FULL_NAME, one.d?.fullName);
  check('الهاتف الكامل يُعرض', one.d?.phone === FULL_PHONE, one.d?.phone);
  check('masked=false و verified=true', one.d?.masked === false && one.d?.verified === true,
    'masked=' + one.d?.masked + ' verified=' + one.d?.verified);

  const svc = await asAnon(`select brc.self_service_card($1::text, null::text) d`, ['HRC-BC-900003']);
  check('self_service_card تُرجع الاسم الكامل', svc.d?.card?.profile?.fullName === FULL_NAME,
    String(svc.d?.card?.profile?.fullName));
  check('الملف غير مقفل (الزبون يصحّح بياناته)', svc.d?.card?.profileLocked === false,
    String(svc.d?.card?.profileLocked));
  check('masked=false في self_service_card', svc.d?.card?.masked === false, String(svc.d?.card?.masked));
  check('العنوان والميلاد معروضان', (svc.d?.card?.profile?.address ?? '') !== '' && !!svc.d?.card?.profile?.dob,
    JSON.stringify(svc.d?.card?.profile || {}).slice(0, 120));

  /* ═══ 2) التعداد — الهجوم الحقيقي ═════════════════════════════════════ */
  step(2, 'تعداد 40 بطاقة متتالية — يُحجب قبل استنفادها');

  /* الأرقام العشوائية 100000–999999 في الإنتاج (لا متسلسلة)، فالتعداد يحتاج
     ~777 ألف محاولة. الميزانية تخنقه عند 40 بطاقة مختلفة لكل مصدر/ساعة.
     نحاكي 60 محاولة ونثبت أنه يتوقف قبل إتمامها. */
  let blocked = 0, firstBlockAt = 0;
  for (let i = 1; i <= 60; i++) {
    const g = (await db.query(`select brc.card_lookup_guard($1::text, $2::text) d`,
      ['HRC-BC-8' + String(10000 + i), 'attacker-fingerprint-2'])).rows[0].d;
    if (g?.ok === false) { blocked++; if (!firstBlockAt) firstBlockAt = i; }
  }
  check('التعداد يتوقف: يُحجب بعد 40 بطاقة من مصدر واحد', blocked === 20, blocked + ' محجوبة من 60');
  check('الحجب يبدأ عند البطاقة 41 لا قبلها', firstBlockAt === 41, 'أول حجب عند ' + firstBlockAt);

  /* ⚠️ في Supabase يصل المصدر من ترويسات الطلب (brc.card_request_source).
     PGlite لا يوفّر تلك الترويسات، فنختبر الحارس بمصدر صريح كما يفعل الغلاف. */
  let srcBlocked = 0;
  for (let i = 1; i <= 50; i++) {
    const g = (await db.query(`select brc.card_lookup_guard($1::text, $2::text) d`,
      ['HRC-BC-9' + String(10000 + i), 'attacker-fingerprint'])).rows[0].d;
    if (g?.ok === false) srcBlocked++;
  }
  check('حدّ المصدر يوقف التعداد: 50 عرضاً من مصدر واحد → يُحجب بعد 40',
    srcBlocked === 10, srcBlocked + ' محجوبة من 50 (المتوقع 10)');

  const guardState = await db.query(`select count(*)::int n from brc.card_lookup_budget`);
  check('الميزانية تُسجَّل بالبصمة لا بـ IP خام', guardState.rows[0].n > 0);
  const rawKeys = await db.query(`select count(*)::int n from brc.card_lookup_budget where budget_key !~ '^(card|source):[0-9a-f]{32}$'`);
  check('كل مفتاح بصمة md5 لا قيمة خام', rawKeys.rows[0].n === 0, rawKeys.rows[0].n + ' مفتاح غير مطابق');

  /* ═══ 3) بيانات صاحب العمل متاحة بعد التقديم ═══════════════════════════
     هذا هو جوهر دورة العمل: الزبون يمسح الباركود ثانياً ليرى وظائفه وبيانات
     صاحب العمل لكل وظيفة كي يتصل به. */
  step(3, 'بيانات صاحب العمل متاحة للزبون بعد التقديم');

  /* جهّز تقديماً مسجلاً ببيانات صاحب عمل كما في الإنتاج */
  await db.query(`insert into brc.jobs (code, title, governorate, shift, employer_name, employer_phone, employer_address, salary_min, salary_max)
    values ('HRC-9101','فني كهرباء','بابل','صباحي','شركة الفرات','07701234567','الحلة — مركز المدينة',600000,900000)`);
  /* job_id يلزم: customer_application_details تقرأ job_snapshot أو job_id.
     المشغّل zz_capture_application_job_snapshot يملأ اللقطة تلقائياً. */
  await db.query(`update brc.job_attempts t
      set job_id = j.id, job_code='HRC-9101',
          slot_status='hiring', selected_at=now()
     from brc.jobs j
    where j.code='HRC-9101' and t.serial='HRC-BC-900001' and t.attempt_no=1`);

  const det = await asAnon(`select brc.customer_application_details($1::text, $2::int) d`,
    ['HRC-BC-900001', 1]);
  check('customer_application_details تعمل', det.d?.ok === true, JSON.stringify(det.d).slice(0, 120));
  check('بيانات صاحب العمل معروضة', !!(det.d?.attempt?.employerName || det.d?.attempt?.employerPhone),
    JSON.stringify(det.d?.attempt || {}).slice(0, 120));

  /* ═══ 4) البطاقة الفارغة ══════════════════════════════════════════════ */
  step(4, 'البطاقة الفارغة — تُعرض لكن بلا بيانات (لا يوجد ما يُسرَّب)');

  const blank = await asAnon(`select brc.lookup_card($1::text, null::text) d`, ['HRC-BC-999999']);
  check('البطاقة الفارغة تُعرض لصاحبها', blank.d?.ok === true && blank.d?.status === 'blank', JSON.stringify(blank.d).slice(0, 100));
  check('بلا اسم ولا هاتف', (blank.d?.fullName ?? '') === '' && (blank.d?.phone ?? '') === '');
  check('الفرص معروضة (2 فارغة)', blank.d?.chancesLeft === 2, String(blank.d?.chancesLeft));

  /* ═══ 5) السجل التدقيقي لا يحمل بصمات ═════════════════════════════════ */
  step(5, 'السجل التدقيقي يرفض أسطر البصمة');

  const fp = await asRole('anon', `insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('public','public','عرض','applicant','HRC-BC-900001','lookup:deadbeef')`);
  check('إدراج سطر يحمل بصمة يُرفض', !fp.ok && /62501|42501|permission|مرفوض/i.test(fp.e || ''), fp.e || 'نجح!');

  /* ═══ 5.5) إعادة التطبيق ══════════════════════════════════════════════ */
  step(5.5, 'إعادة تطبيق الترحيل لا تكسر شيئاً (idempotent)');

  try {
    await db.exec(read('supabase/migrations/20261113170000_card_enumeration_guard.sql'));
    ok('التطبيق الثاني نجح');
  } catch (e) { bad('التطبيق الثاني نجح', (e.message || '').slice(0, 120)); }
  const again = await asAnon(`select brc.lookup_card($1::text, null::text) d`, ['HRC-BC-900005']);
  check('العرض الكامل باقٍ بعد إعادة التطبيق', again.d?.masked === false, String(again.d?.masked));
  check('التوقيع ما زال واحداً بعد إعادة التطبيق',
    (await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='brc' and p.proname='lookup_card'`)).rows[0].n === 1);

  /* ═══ 6) لا كسر في التوقيعات ═════════════════════════════════════════ */
  step(6, 'توقيع واحد لكل دالة — النداء ليس غامضاً');

  const sigs = (await db.query(`
    select p.proname, count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'brc' and p.proname in ('lookup_card', 'self_service_card') group by 1`)).rows;
  for (const s of sigs) check(`توقيع واحد لـ ${s.proname} (لا function is not unique)`, s.n === 1, s.n + ' توقيع');
  check('lookup_card و self_service_card ما زالتا ممنوحتين للزائر',
    (await db.query(`select has_function_privilege('anon','brc.lookup_card(text,text)','EXECUTE') a,
                            has_function_privilege('anon','brc.self_service_card(text,text)','EXECUTE') b`)).rows[0].a === true);
  check('الأجسام القديمة (unguarded) محجوبة عن الزائر',
    (await db.query(`select has_function_privilege('anon','brc.lookup_card_unguarded(text,text)','EXECUTE') a`)).rows[0].a === false);
}

console.log('\n' + '═'.repeat(74));
if (fail === 0) {
  console.log('  النتيجة: ✅ ' + pass + ' فحصاً ناجحاً | 0 فاشل');
  console.log('  تعداد البطاقات مسدود بالميزانية · صاحب البطاقة يرى بياناته ووظائفه وبيانات صاحب العمل.');
} else {
  console.log('  النتيجة: ❌ ' + pass + ' ناجح | ' + fail + ' فاشل');
  console.log('\n  المشاكل:');
  problems.forEach((p) => console.log('   • ' + p));
}
console.log('═'.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
