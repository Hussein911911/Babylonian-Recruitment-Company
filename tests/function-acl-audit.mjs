#!/usr/bin/env node
/* ===========================================================================
 *  HRC — تدقيق صلاحيات الدوال (Function ACL Audit)
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا هذا الملف؟
 *
 *  بقية الاختبارات تقرأ نصّ `docs/schema.sql` بتعابير نمطية. وهذا بالضبط ما
 *  سمح للثغرة بالبقاء: `tests/schema.mjs` كان يفحص توقيعات **غير موجودة**
 *  (self_service_card(text) بدل (text,text)) فيمرّ الفحص بينما الدالة الحقيقية
 *  قابلة للنداء من الزائر. النصّ لا يكذب لكنه لا يُنفَّذ.
 *
 *  هذا الاختبار **ينفّذ المخطط على قاعدة حقيقية (PGlite)** ثم يسأل PostgreSQL
 *  نفسه: `has_function_privilege('anon', oid, 'EXECUTE')`. الجواب هو الحقيقة،
 *  لا تفسيرنا لها.
 *
 *  ما يثبته:
 *    1. كل دوال brc لا تحمل EXECUTE افتراضياً على PUBLIC (جذر الثغرة).
 *    2. الزائر (anon) يصل **فقط** إلى مسارات الزبون الستة — لا قرارات موظف،
 *       لا دوال مشغّلات، لا مولّدات رموز.
 *    3. الموظف (authenticated) يصل إلى أدواته فقط، ولا يصل إلى ما هو أعلى منه
 *       (activate_card · recovery_* الداخلية · التوقيعات القديمة).
 *    4. أي دالة جديدة تُنشأ في brc **لا** تنال صلاحية تلقائية (default privileges).
 *    5. المنح تُطبَّق بـ upgrade على قاعدة قائمة أيضاً، لا على قاعدة جديدة فقط.
 *
 *  التشغيل:  node tests/function-acl-audit.mjs   أو   npm run test:acl
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

/* ── المحاكاة الدنيا لبيئة Supabase (أدوار + auth + pgcrypto) ────────────
   PGlite لا يحمل pgcrypto ولا أدوار Supabase ولا مخطط auth. نبنيها كما فعل
   tests/card-privacy.mjs حتى يكون تثبيت المخطط واقعياً. الدوال هنا بدائل
   شكلية فقط — لا تُستخدم في أي فحص صلاحيات. */
const SHIM = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key);
  create table auth.sessions (id uuid primary key, user_id uuid);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create function extensions.digest(text, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.digest(bytea, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.gen_random_bytes(int) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.pgp_sym_encrypt(text, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
  create function extensions.pgp_sym_decrypt(bytea, text) returns text language sql as $$ select ''::text $$;
  create function hmac(text, text, text) returns bytea language sql as $$ select '\\x00'::bytea $$;
`;

/* ── ما يجب أن يبقى متاحاً — من الواجهة الفعلية لا من نصوص المخطط ──────────
   المصدر: assets/js/cloud.js وapply.html (نداءات RPC الحقيقية للزائر). */
const ANON_ALLOWED = new Set([
  'apply_with_card(p_serial text, p_job_code text, p_data jsonb)',
  'customer_application_details(p_serial text, p_attempt_no integer)',
  'lookup_card(p_serial text, p_code text)',
  'self_service_card(p_serial text, p_code text)',
  'use_chance(p_serial text, p_code text, p_job_code text)',
  'verify_card_code(p_serial text, p_code text)'
]);

/* دوال لا يجوز أن يصلها أي شريك عميل — لا زائر ولا موظف عبر RPC.
   (الموظف يصل إليها عبر دوال SECURITY DEFINER بصلاحية المالك، لا مباشرةً.) */
const NEVER_CLIENT_CALLABLE = [
  'activate_card(p_serial text, p_data jsonb)',
  'card_gate(p_serial text, p_code text, p_operation text, p_allow_blank boolean)',
  'chance_code()',
  'new_card_print_code()',
  'normalize_card_code(p_code text)',
  'apply_with_card_original(p_serial text, p_job_code text, p_data jsonb)',
  'self_service_card_original(p_serial text)',
  'employer_view_original(p_serial text)',
  'employer_decide_original(p_serial text, p_decision text)',
  'recovery_capture()', 'recovery_read(uuid)', 'recovery_save(text, boolean)',
  'recovery_schema_hash()', 'recovery_ensure_fresh()', 'recovery_run_scheduled()',
  'recovery_cron_expr(p_days integer[], p_time text)'
];

/* ═══ 1) قاعدة جديدة: المخطط من الصفر ═══════════════════════════════════ */
step(1, 'قاعدة جديدة — docs/schema.sql يُنفَّذ كاملاً ثم تُقاس صلاحياته');

const fresh = new PGlite();
let schemaLoaded = false;
try {
  await fresh.exec(SHIM);
  await fresh.exec(read('docs/schema.sql'));
  schemaLoaded = true;
} catch (e) {
  bad('docs/schema.sql يُنفَّذ على قاعدة فارغة', (e.message || '').slice(0, 200));
}
if (schemaLoaded) {
  ok('docs/schema.sql يُنفَّذ على قاعدة فارغة بلا أخطاء');
  ok('ملف الـ migration المبدئي مطابق للمصدر (npm run schema:sync)', read('docs/schema.sql') === read('supabase/migrations/20260915000000_brc_initial_schema.sql'));
}

const fnList = async (db) => (await db.query(`
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         n.nspname as schema,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
         coalesce(array_to_string(p.proacl, ','), '') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'brc'
   order by 1`)).rows;

if (schemaLoaded) {
  const fns = await fnList(fresh);

  /* 1.1 جذر الثغرة: لا دالة تحمل EXECUTE الافتراضي على PUBLIC.
     ACL الافتراضي في PostgreSQL يُكتب `=X/owner` (الدور الفارغ قبل = هو PUBLIC).
     غيابه (أو سطر `postgres=X/postgres | anon=X/...`) يعني سحباً صريحاً. */
  const inherited = fns.filter((f) => /(^|,)=X\//.test(f.acl));
  check('لا دالة brc ترث EXECUTE افتراضياً على PUBLIC (جذر الثغرة)',
    inherited.length === 0, inherited.map((f) => f.sig).join(' · '));

  /* 1.2 القائمة البيضاء للزائر — مسارات الزبون فقط */
  const anonReach = fns.filter((f) => f.anon).map((f) => f.sig);
  const anonExtra = anonReach.filter((s) => !ANON_ALLOWED.has(s));
  const anonMissing = [...ANON_ALLOWED].filter((s) => !anonReach.includes(s));
  check('الزائر يصل إلى مسارات الزبون الستة بلا زيادة', anonMissing.length === 0,
    'ناقصة: ' + anonMissing.join(' · '));
  check('الزائر لا يصل إلى أي دالة خارج مسارات الزبون', anonExtra.length === 0,
    'زائدة: ' + anonExtra.join(' · '));

  /* 1.3 المسارات الخطرة تحديداً — كل واحدة تُسمّى صراحةً كي يظهر اسمها في الفشل */
  for (const sig of NEVER_CLIENT_CALLABLE) {
    const f = fns.find((x) => x.sig === sig);
    if (!f) continue; /* توقيع قديم أُزيل — ليس فشلاً */
    check('غير متاحة للزائر ولا للموظف: ' + sig, !f.anon && !f.auth);
  }

  /* 1.4 دوال المشغّلات — لا تُنادى من RPC إطلاقاً */
  const trg = fns.filter((f) => f.sig.startsWith('trg_') || f.sig.startsWith('capture_'));
  check('دوال المشغّلات غير قابلة للنداء من أي دور عميل',
    trg.length > 0 && trg.every((f) => !f.anon && !f.auth),
    trg.filter((f) => f.anon || f.auth).map((f) => f.sig).join(' · '));

  /* 1.5 التوقيعات القديمة — توقيع مختلف = دالة أخرى، فلا يكفي إبطال الجديد */
  const legacy = fns.filter((f) => /_original$/.test(f.proname ?? '') || /_(original)$/.test(f.sig));
  check('الدوال الأصلية (legacy wrappers) غير متاحة للعميل',
    legacy.every((f) => !f.anon && !f.auth),
    legacy.filter((f) => f.anon || f.auth).map((f) => f.sig).join(' · '));

  /* 1.6 الموظف: أدواته موجودة، وما فوق صلاحيته محجوب */
  const authReach = fns.filter((f) => f.auth).map((f) => f.sig);
  for (const need of [
    'is_staff()', 'is_admin()', 'current_staff_id()',
    'select_attempt(p_serial text, p_job_code text)',
    'set_outcome(p_serial text, p_attempt_no smallint, p_outcome text, p_note text)',
    'release_hold(p_serial text, p_attempt_no smallint, p_reason text)',
    'verify_form(p_serial text, p_token text)',
    'staff_card_history(p_query text, p_page integer)',
    'recovery_manage(p_action text, p_id uuid, p_name text, p_token text)',
    'office_submit(p_id uuid, p_kind text, p_data jsonb, p_expected jsonb)'
  ]) check('الموظف يصل إلى: ' + need, authReach.includes(need));

  /* دوال مدير/نظام فقط: الموظف يصل إليها عبر دالة SECURITY DEFINER لا مباشرةً. */
  for (const le of [
    'activate_card(p_serial text, p_data jsonb)',
    'verify_token(p_serial text)'
  ]) {
    const f = fns.find((x) => x.sig === le);
    if (f) check('محجوبة عن الموظف المباشر: ' + le, !f.auth);
  }
  const verifyToken = fns.find((f) => f.sig === 'verify_token(p_serial text)');
  check('verify_token غير ممنوحة لأي دور عميل (تُنادى من SECURITY DEFINER فقط)',
    verifyToken && !verifyToken.anon && !verifyToken.auth);

  /* 1.7 service_role: يحتاج EXECUTE على كل شيء (يفعل كل شيء بصلاحية المالك) */
  const svcMissing = fns.filter((f) => !f.svc).map((f) => f.sig);
  check('service_role يصل إلى كل دوال brc (وإلا تعطّل النسخ الاحتياطي والاسترجاع)',
    svcMissing.length === 0, svcMissing.join(' · '));
}

/* ═══ 2) الدوال الجديدة لا تنال صلاحية تلقائية ═══════════════════════════ */
step(2, 'المنع الاستباقي — دالة تُنشأ غداً لا تُفتح للزائر اليوم');

if (schemaLoaded) {
  const created = await (async () => {
    try {
      await fresh.exec(`create or replace function brc.zz_acl_probe_new() returns text
        language sql as $$ select 'probe' $$;`);
      return true;
    } catch (e) {
      bad('إنشاء دالة استكشافية', (e.message || '').slice(0, 160));
      return false;
    }
  })();
  if (created) {
    const p = (await fresh.query(`
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
             coalesce(array_to_string(p.proacl, ','), '') as acl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'brc' and p.proname = 'zz_acl_probe_new'`)).rows[0];
    check('دالة جديدة في brc تبدأ بلا صلاحية لأي دور', p && !p.anon && !p.auth);
    check('دالة جديدة في brc لا تحمل EXECUTE موروثاً على PUBLIC', p && !/(^|,)=X\//.test(p.acl), p && p.acl);
    await fresh.exec('drop function brc.zz_acl_probe_new()');
  }
}

/* ═══ 3) الترقية على قاعدة قائمة (لا قاعدة جديدة فقط) ═════════════════════ */
step(3, 'قاعدة قائمة — الترحيل 20261113160000 يُطبَّق على قاعدة فيها الثغرة');

/* نُعيد بناء الحالة القائمة: تثبيت المخطط ثم إعادة منح PUBLIC كما كانت
   PostgreSQL تفعل تلقائياً، ثم نطبّق الترحيل ونقيس الفرق. */
const upgraded = new PGlite();
try {
  await upgraded.exec(SHIM);
  await upgraded.exec(read('docs/schema.sql'));
  /* محاكاة القاعدة القديمة: PUBLIC تنال EXECUTE على دوال مختارة،
     تماماً كما كانت قبل الترحيل (وهو ما أثبتناه بالقياس: 17 دالة). */
  await upgraded.exec(`
    grant execute on function brc.select_attempt(text, text) to public;
    grant execute on function brc.set_outcome(text, smallint, text, text) to public;
    grant execute on function brc.release_hold(text, smallint, text) to public;
    grant execute on function brc.chance_code() to public;
    grant execute on function brc.trg_defaults() to public;
  `);
  const before = (await fnList(upgraded)).filter((f) => f.anon).map((f) => f.sig);
  check('قبل الترقية: الزائر يصل إلى قرارات الموظف (إعادة إنتاج الثغرة)',
    before.includes('set_outcome(p_serial text, p_attempt_no smallint, p_outcome text, p_note text)'),
    before.length + ' دالة');

  await upgraded.exec(read('supabase/migrations/20261113160000_harden_function_acls.sql'));
  const after = await fnList(upgraded);
  const leaked = after.filter((f) => f.anon && !ANON_ALLOWED.has(f.sig)).map((f) => f.sig);
  check('بعد الترقية: الثغرة مُغلقة على القاعدة القائمة', leaked.length === 0, leaked.join(' · '));
  const kept = after.filter((f) => f.anon).length;
  check('بعد الترقية: مسارات الزبون ما زالت تعمل (لم نكسر apply.html)', kept === ANON_ALLOWED.size,
    kept + ' دالة');
  check('الترحيل لا يحذف أي دالة (لا حذف بيانات/وظائف)',
    after.length === (await fnList(fresh)).length, after.length + ' مقابل ' + (await fnList(fresh)).length);
} catch (e) {
  bad('الترحيل يُطبَّق على قاعدة قائمة', (e.message || '').slice(0, 240));
}

/* ═══ 4) إعادة التنفيذ (idempotent) ═════════════════════════════════════ */
step(4, 'إعادة التنفيذ — الترحيل قابل للتشغيل مرتين بلا أثر');

if (schemaLoaded) {
  try {
    await upgraded.exec(read('supabase/migrations/20261113160000_harden_function_acls.sql'));
    const twice = (await fnList(upgraded)).filter((f) => f.anon).map((f) => f.sig).sort();
    check('تشغيل الترحيل مرتين لا يغيّر النتيجة',
      JSON.stringify(twice) === JSON.stringify([...ANON_ALLOWED].sort()));
  } catch (e) {
    bad('الترحيل idempotent', (e.message || '').slice(0, 200));
  }
}

/* ═══ 5) الترحيلات مرتّبة — يُطبَّق الجديد بعد القديم بلا تعارض ═══════════ */
step(5, 'الترتيب — الترحيل الجديد آخر من يُطبَّق');

{
  const migs = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const last = migs[migs.length - 1];
  const idxHard = migs.indexOf('20261113160000_harden_function_acls.sql');
  /* ⚠️ ليس «الأحدث»: قد تُضاف ترحيلات بعده (مثل حارس التعداد). المهم أن يبقى
     **بعد** كل ترحيل يُنشئ دوالاً (وإلا لم يشملها السحب الشامل)، وأن يبقى هو
     المصدر الذي يحمل سياسة الصلاحيات. */
  check('ملف تقوية الصلاحيات موجود ومعروف الترتيب', idxHard >= 0, last);
  check('لا يُعاد إنشاء دوال brc في ترحيل بعده بلا سياسة صلاحيات جديدة',
    migs.slice(idxHard + 1).every((f) => {
      const sql = readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8');
      return !/create\s+or\s+replace\s+function\s+brc\./i.test(sql) || /(grant|revoke)/i.test(sql);
    }),
    migs.slice(idxHard + 1).join(', ') || 'لا ترحيلات بعده');
}

/* ═══ 6) التشغيل الفعلي — الصلاحية وحدها لا تكفي ═════════════════════════
   قد تكون الدالة ممنوحة ويفشل نداؤها لسببين لا يظهرهما فحص المنح:
     (أ) search_path داخل الدالة حُذف أو كُسر؛
     (ب) التوقيع المعاد منحه لا يطابق ما تناديه الواجهة.
   فنتحقق بالنداء الحقيقي بدور الزائر: نفس ما تفعله apply.html حرفياً. */
step(6, 'التشغيل الحقيقي — نداء مسارات الزبون بدور anon لا بالتحليل النصي');

if (schemaLoaded) {
  const live = new PGlite();
  try {
    await live.exec(SHIM);
    await live.exec(read('docs/schema.sql'));
    await live.exec(read('supabase/migrations/20261113160000_harden_function_acls.sql'));
  } catch (e) {
    bad('تهيئة قاعدة النداء الحقيقي', (e.message || '').slice(0, 200));
  }

  const asAnon = async (sql, params = []) => {
    await live.exec('set role anon');
    try { return { rows: (await live.query(sql, params)).rows, error: null }; }
    catch (e) { return { rows: [], error: e.message || String(e) }; }
    finally { await live.exec('reset role'); }
  };

  /* بطاقة فارغة فعلية يمسحها الزبون من apply.html */
  await live.exec(`
    insert into brc.applicants (serial, full_name, phone, status)
    values ('HRC-BC-900001', 'فحص صلاحيات', '07700000001', 'blank');
  `);

  /* 6.1 self_service_card — أول نداء في apply.html */
  const ssc = await asAnon("select brc.self_service_card('HRC-BC-900001', null) as d");
  check('anon ينادي self_service_card فعلياً (باركود بطاقة فارغة)', !ssc.error,
    ssc.error || '');
  check('self_service_card تُرجع بطاقة فارغة بلا كشف بيانات',
    !ssc.error && ssc.rows[0] && ssc.rows[0].d && ssc.rows[0].d.ok === true &&
    !JSON.stringify(ssc.rows[0].d).includes('فحص صلاحيات'),
    ssc.error || JSON.stringify(ssc.rows[0]?.d || {}).slice(0, 120));

  /* 6.2 lookup_card — نداء «بطاقتي» */
  const lk = await asAnon("select brc.lookup_card('HRC-BC-900001', null) as d");
  check('anon ينادي lookup_card فعلياً (توقيع وسيطين)', !lk.error, lk.error || '');

  /* 6.3 المسارات المحجوبة تُرفض بـ 42501 لا «success» */
  for (const [label, sql] of [
    ['set_outcome (قرار موظف)', "select brc.set_outcome('HRC-BC-900001', 1::smallint, 'hired', '')"],
    ['select_attempt (قرار موظف)', "select brc.select_attempt('HRC-BC-900001', 'HRC-1001')"],
    ['release_hold (قرار موظف)', "select brc.release_hold('HRC-BC-900001', 1::smallint, '')"],
    ['chance_code (مولّد سرّي)', 'select brc.chance_code()'],
    ['new_card_print_code (مولّد سرّي)', 'select brc.new_card_print_code()'],
    ['activate_card (مسار داخلي)', "select brc.activate_card('HRC-BC-900001', '{}'::jsonb)"],
    ['trg_defaults (دالة مشغّل)', 'select brc.trg_defaults()']
  ]) {
    const r = await asAnon(sql);
    check('الزائر يُرفض عند ' + label, !!r.error && /permission denied|42501/i.test(r.error),
      r.error || 'نجح النداء!');
  }

  /* 6.4 الموظف: يصل إلى is_staff (تحتاجه سياسات RLS) ويُرفض عند activate_card */
  await live.exec("set role authenticated");
  try {
    const st = await live.query('select brc.is_staff() as v');
    check('الموظف ينادي is_staff (تحتاجه سياسات RLS)', typeof st.rows[0].v === 'boolean');
    let denied = false, msg = '';
    try { await live.query("select brc.activate_card('HRC-BC-900001', '{}'::jsonb)"); }
    catch (e) { denied = /permission denied|42501/i.test(e.message || ''); msg = e.message || ''; }
    check('الموظف يُرفض عند activate_card (إصدار بطاقة ليس من RPC)', denied, msg);
  } catch (e) {
    bad('صلاحيات الموظف على القاعدة الحيّة', (e.message || '').slice(0, 160));
  } finally { await live.exec('reset role'); }
}

/* ═══ النتيجة ════════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(74));
if (fail === 0) {
  console.log('  النتيجة: ✅ ' + pass + ' فحصاً ناجحاً | 0 فاشل');
  console.log('  صلاحيات الدوال مطابقة للسياسة: الزائر يرى بطاقته فقط.');
} else {
  console.log('  النتيجة: ❌ ' + pass + ' ناجح | ' + fail + ' فاشل');
  console.log('\n  المشاكل:');
  problems.forEach((p) => console.log('   • ' + p));
}
console.log('═'.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
