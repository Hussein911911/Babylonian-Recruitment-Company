#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص تعداد البطاقات وتسريب بيانات الباحثين
 *  ---------------------------------------------------------------------------
 *  ⚠ لماذا هذا الملف؟
 *
 *  لأن الثغرة التي يمنعها **لم تكن خطأً في الكود**: كل سطر كان يعمل كما صُمّم.
 *  `lookup_card` تُرجع الاسم والهاتف كاملين، و`card_gate` فيها حدّ طلبات لكنها
 *  لم تُستدعَ، و`mask_name` مكتوبة لكن شرط تفعيلها لا يتحقق. فحص نصّي لا يرى
 *  هذا إطلاقاً — لا بدّ من تنفيذ الهجوم.
 *
 *  هذا الملف ينفّذ الهجوم الحقيقي بدور `anon` وبلا جلسة:
 *      أ) يقرأ بطاقة واحدة بلا رمز → يجب ألّا يرى الاسم والهاتف كاملين.
 *      ب) يعدّد 40 بطاقة متتالية → يجب أن يُحجب قبل استنفادها.
 *      ج) يحاول ضخّ بصمة في السجل التدقيقي → يجب أن تُرفض.
 *
 *  ويُثبت أيضاً أن **صاحب البطاقة الحقيقي لم يخسر شيئاً**:
 *      د) بالرمز الصحيح → الاسم والهاتف كاملان كما قبل الترحيل.
 *      هـ) بطاقة فارغة → تُعرض لصاحبها بلا تغيير.
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
  /* ── بيانات واقعية: 40 بطاقة برقم متسلسل (كما في الإنتاج) ─────────────── */
  for (let i = 1; i <= 40; i++) {
    await db.query(
      `insert into brc.applicants (serial, full_name, phone, status, fee_amount, fee_paid, card_print_code)
       values ($1, $2, $3, 'active', 10000, true, $4)`,
      [`HRC-BC-9000${String(i).padStart(2, '0')}`, FULL_NAME, FULL_PHONE,
       i === 1 ? 'ABCD1234EFGH5678' : null]
    );
  }
  await db.query(`insert into brc.applicants (serial, full_name, phone, status, fee_amount, fee_paid)
    values ('HRC-BC-999999', '', '', 'blank', 10000, true)`);

  /* ═══ 1) البطاقة الواحدة بلا رمز ═══════════════════════════════════════ */
  step(1, 'بطاقة واحدة بلا رمز — الزائر لا يرى اسم الباحث ولا هاتفه');

  const one = await asAnon(`select brc.lookup_card($1::text, null::text) d`, ['HRC-BC-900002']);
  const j1 = JSON.stringify(one.d || {});
  check('lookup_card تعمل وتُرجع البطاقة', one.ok && one.d?.ok === true, one.e || '');
  check('لا اسم كامل', !j1.includes('عبد الصاحب'), j1.slice(0, 120));
  check('لا هاتف كامل', !j1.includes(FULL_PHONE), j1.slice(0, 120));
  check('الاسم مقنّع بصيغة «الأول + حرف الأب»', one.d?.fullName === 'غيث ح.', one.d?.fullName);
  check('الهاتف مقنّع (أول ٤ وآخر رقمين)', one.d?.phone === '0780••••48', one.d?.phone);
  check('العلم masked=true و verified=false', one.d?.masked === true && one.d?.verified === false);

  const svc = await asAnon(`select brc.self_service_card($1::text, null::text) d`, ['HRC-BC-900003']);
  const j2 = JSON.stringify(svc.d || {});
  check('self_service_card لا تسرّب الاسم أو الهاتف (في أي حقل)', !j2.includes('عبد الصاحب') && !j2.includes(FULL_PHONE), j2.slice(0, 140));
  /* ⚠️ الملف **لا** يُفرَّغ: apply.html يفتح الحقول عند profileLocked=false
     فيعبّئها المستخدم باسمه فوق بيانات بطاقة غيره. المطلوب إقفالها. */
  check('self_service_card تقفل الملف بلا رمز (profileLocked=true)', svc.d?.card?.profileLocked === true,
    String(svc.d?.card?.profileLocked));
  check('الملف (card.profile) مقنّع هو الآخر', 
    (svc.d?.card?.profile?.fullName ?? '') === 'غيث ح.' &&
    (svc.d?.card?.profile?.phone ?? '') === '0780••••48',
    JSON.stringify(svc.d?.card?.profile || {}).slice(0, 120));
  check('العنوان والميلاد محجوبان (بيانات تعرّف)', 
    (svc.d?.card?.profile?.address ?? '') === '' && (svc.d?.card?.profile?.dob ?? null) === null,
    JSON.stringify(svc.d?.card?.profile || {}).slice(0, 120));

  /* ═══ 2) التعداد — الهجوم الحقيقي ═════════════════════════════════════ */
  step(2, 'تعداد 40 بطاقة متتالية — يُحجب قبل استنفادها');

  let leaked = 0, masked = 0, blocked = 0;
  for (let i = 10; i <= 40; i++) {
    const r = await asAnon(`select brc.lookup_card($1::text, null::text) d`,
      [`HRC-BC-9000${String(i).padStart(2, '0')}`]);
    const j = JSON.stringify(r.d || {});
    if (j.includes(FULL_PHONE)) leaked++;
    else if (r.d?.ok === false) blocked++;
    else masked++;
  }
  check('صفر تسريب في 40 محاولة تعداد', leaked === 0, leaked + '/40 تسرّبت');
  check('كل المحاولات إمّا مقنّعة أو محجوبة — لا شيء بينهما', masked + blocked === 31, masked + ' مقنّعة · ' + blocked + ' محجوبة');

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

  /* ═══ 3) صاحب البطاقة لم يخسر شيئاً ════════════════════════════════════ */
  step(3, 'صاحب البطاقة بالرمز الصحيح — بياناته كاملة كما قبل الترحيل');

  const owner = await asAnon(`select brc.lookup_card($1::text, $2::text) d`, ['HRC-BC-900001', 'ABCD1234EFGH5678']);
  check('الرمز الصحيح يُرجع الاسم الكامل', owner.d?.fullName === FULL_NAME, owner.d?.fullName);
  check('الرمز الصحيح يُرجع الهاتف الكامل', owner.d?.phone === FULL_PHONE, owner.d?.phone);
  check('verified=true و masked=false', owner.d?.verified === true && owner.d?.masked === false);

  const wrong = await asAnon(`select brc.lookup_card($1::text, $2::text) d`, ['HRC-BC-900001', 'WRONGCODE123456']);
  check('الرمز الخاطئ لا يكشف شيئاً', wrong.d?.verified === false && wrong.d?.phone === '0780••••48', wrong.d?.phone);

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
  check('التقنين باقٍ بعد إعادة التطبيق', again.d?.phone === '0780••••48', again.d?.phone);
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
  console.log('  تعداد البطاقات مسدود · بيانات الباحثين مقنّنة · صاحب البطاقة لم يخسر شيئاً.');
} else {
  console.log('  النتيجة: ❌ ' + pass + ' ناجح | ' + fail + ' فاشل');
  console.log('\n  المشاكل:');
  problems.forEach((p) => console.log('   • ' + p));
}
console.log('═'.repeat(74) + '\n');
process.exit(fail === 0 ? 0 : 1);
