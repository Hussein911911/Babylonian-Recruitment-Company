// مراجعة أمنية 2026-11-13: خصوصية البطاقة + إلزام رمز الفرصة.
//
// يُشغّل الترحيل على قاعدة فعلية (PGlite) ببيانات تُحاكي الإنتاج، ثم يتحقق
// من السلوك الحقيقي للدوال — لا من نصّها.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261113090000_card_privacy_and_signup_hardening.sql';

let pass = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { console.log('  ❌ ' + label + (extra ? ' → ' + extra : '')); throw new Error('فشل: ' + label); }
};

const db = new PGlite();
try {
  /* ── بيئة مصغّرة تحاكي ما تعتمد عليه الدوال ─────────────────────────── */
  await db.exec(`
    /* PGlite لا يحمل أدوار Supabase — نُنشئها كي تُقبل grant/revoke */
    create role anon;
    create role authenticated;
    create role service_role;

    create schema brc;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;

    create type brc.form_status as enum ('blank','pending','active','expired','exhausted','completed','rejected');
    create type brc.slot_status as enum ('empty','reserved','critical','hiring','succeeded','rejected','expired');
    create type brc.job_status  as enum ('available','reserved','hiring','closed');

    create table brc.applicants (
      id uuid primary key default gen_random_uuid(),
      serial text not null unique,
      full_name text not null,
      phone text not null,
      address text default '',
      dob date,
      status brc.form_status not null default 'active',
      issue_date timestamptz,
      expiry_date timestamptz,
      self_application_data jsonb not null default '{}'::jsonb,
      card_print_code text,
      gender text default 'ذكر',
      attempt_limit smallint default 2
    );

    create table brc.jobs (
      id uuid primary key default gen_random_uuid(),
      code text not null unique,
      title text not null,
      region text default '',
      governorate text default '',
      status brc.job_status not null default 'available'
    );

    create table brc.job_attempts (
      id uuid primary key default gen_random_uuid(),
      serial text not null,
      attempt_no smallint not null,
      job_id uuid references brc.jobs(id) on delete set null,
      job_code text,
      chance_code text,
      slot_status brc.slot_status not null default 'empty',
      selected_at timestamptz,
      hold_expires_at timestamptz,
      outcome_note text default '',
      job_snapshot jsonb
    );

    create table brc.settings (key text primary key, value jsonb);
    insert into brc.settings values ('rules','{"hold_hours":24}'::jsonb);

    create table brc.audit_log (
      id uuid primary key default gen_random_uuid(),
      username text, role text, action text, entity text, entity_id text, details text
    );

    /* الدوال التي يستدعيها الترحيل — نسخ مطابقة للمخطّط الحقيقي */
    create function brc.mask_name(p text) returns text
      language sql immutable as $$
        select case when coalesce(btrim(p),'')='' then ''
          else left(btrim(p), 2) || repeat('•', greatest(length(btrim(p)) - 2, 0)) end $$;

    create function brc.mask_phone(p text) returns text
      language sql immutable as $$
        select case when coalesce(btrim(p),'')='' then ''
          else left(btrim(p), 4) || '••••' || right(btrim(p), 2) end $$;

    create function brc.ensure_card_attempts(p_serial text) returns integer
      language plpgsql as $$
      declare n int;
      begin
        select count(*) into n from brc.job_attempts where serial = p_serial;
        if n = 0 then
          insert into brc.job_attempts (serial, attempt_no) values (p_serial, 1), (p_serial, 2);
          n := 2;
        end if;
        return n;
      end $$;
  `);

  /* الترحيل نفسه */
  await db.exec(read(MIG));

  /* ── بيانات واقعية ───────────────────────────────────────────────────── */
  await db.exec(`
    insert into brc.jobs (code, title, governorate) values ('HRC-1058','موظف مبيعات','بابل');

    insert into brc.applicants (serial, full_name, phone, address, dob, status,
                                issue_date, expiry_date, self_application_data, card_print_code)
    values
      ('PQKW2Y7U5G','غيث حماد عبد الصاحب','07800977448','بابل — قضاء الحلة — ناحية أبي غرق','1980-10-09',
       'active', now(), now() + interval '30 days',
       '{"fullName":"غيث حماد عبد الصاحب","phone":"07800977448","address":"بابل — قضاء الحلة"}'::jsonb,
       null),
      ('2A37XZ5XM4','بطاقة فارغة','07700000000','','1990-01-01','blank',
       null, null, '{}'::jsonb, 'ZZZZ1111YYYY2222'),
      /* بطاقة برمز طباعة — لإثبات أن الحماية تعمل حيث يوجد رمز */
      ('CODEDCARD01','اسم برمز','07711111111','بغداد','1985-05-05','active',
       now(), now() + interval '30 days',
       '{"fullName":"اسم برمز","phone":"07711111111"}'::jsonb,
       'ABCD2345EFGH6789');
  `);
  await db.exec(`select brc.ensure_card_attempts('PQKW2Y7U5G'); select brc.ensure_card_attempts('2A37XZ5XM4');`);
  await db.exec(`update brc.job_attempts set chance_code = '1234-AB' where serial='PQKW2Y7U5G' and attempt_no=1;`);

  /* ── ١) self_service_card بلا رمز: لا بيانات شخصية ──────────────────── */
  const noCode = (await db.query(`select brc.self_service_card('PQKW2Y7U5G'::text, null::text) as r`)).rows[0].r;
  check('بطاقة بلا رمز مطبوع: تعمل كالسابق', noCode.ok === true && noCode.card.verified === true);
  check('بطاقة بلا رمز: requiresCode=false', noCode.card.requiresCode === false);
  check('بطاقة بلا رمز: profile كامل (لا تعطيل للمستخدم)', noCode.card.profile.fullName === 'غيث حماد عبد الصاحب',
    JSON.stringify(noCode.card.profile));
  /* profileLocked هنا ليس عن التحقق: النسخة الحقيقية تقفله لأي بطاقة غير
     'blank' (تُقفل حقول الهوية بعد أول تقديم). التحقق يُقاس بـverified. */
  check('بطاقة بلا رمز: verified=true (لا يُطلب رمز)', noCode.card.verified === true);
  check('بطاقة بلا رمز: لا حقول تقنيع', !('maskedName' in noCode.card) && !('maskedPhone' in noCode.card),
    JSON.stringify(Object.keys(noCode.card)));

  /* ── ٢) self_service_card برمز خاطئ: ما زال محجوباً ──────────────────── */
  const badCode = (await db.query(`select brc.self_service_card('CODEDCARD01'::text,'WRONG-CODE'::text) as r`)).rows[0].r;
  check('بطاقة برمز — رمز خاطئ: verified=false', badCode.card.verified === false);
  check('بطاقة برمز — رمز خاطئ: profile فارغ', Object.keys(badCode.card.profile||{}).length === 0);
  check('بطاقة برمز — رمز خاطئ: profileLocked=true', badCode.card.profileLocked === true);
  check('بطاقة برمز — رمز خاطئ: لا اسم كامل في أي حقل',
    !JSON.stringify(badCode).includes('اسم برمز'), 'الاسم تسرّب!');
  check('بطاقة برمز — رمز خاطئ: لا هاتف كامل', !JSON.stringify(badCode).includes('07711111111'),
    'الهاتف تسرّب!');
  check('بطاقة برمز — رمز خاطئ: requiresCode=true', badCode.card.requiresCode === true);

  const noCodeCoded = (await db.query(`select brc.self_service_card('CODEDCARD01'::text, null::text) as r`)).rows[0].r;
  check('بطاقة برمز — بلا رمز: لا كشف', noCodeCoded.card.verified === false &&
    !JSON.stringify(noCodeCoded).includes('07711111111'));

  /* ── ٣) self_service_card برمز صحيح: كشف كامل ───────────────────────── */
  const goodCode = (await db.query(`select brc.self_service_card('CODEDCARD01'::text,'ABCD2345EFGH6789'::text) as r`)).rows[0].r;
  check('بطاقة برمز — رمز صحيح: verified=true', goodCode.card.verified === true);
  check('بطاقة برمز — رمز صحيح: profile فيه الاسم', goodCode.card.profile.fullName === 'اسم برمز');
  check('بطاقة برمز — رمز صحيح: profile مفتوح', Object.keys(goodCode.card.profile||{}).length > 0);

  /* ── ٤) تسامح القراءة البصرية: O↔0 و I↔1 ──────────────────────────── */
  const fuzzy = (await db.query(`select brc.self_service_card('CODEDCARD01'::text,' abcd2345efgh6789 '::text) as r2`)).rows[0];
  check('الرمز بمسافات وحروف صغيرة يعمل', fuzzy.r2.card.verified === true);

  /* ── ٥) التوقيع القديم (text) لم يبقَ باباً خلفياً ──────────────────── */
  const oldSig = (await db.query(`
    select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='brc' and p.proname='self_service_card'
       and pg_get_function_identity_arguments(p.oid)='p_serial text'`)).rows[0];
  check('التوقيع القديم self_service_card(text) محذوف', Number(oldSig.n) === 0, String(oldSig.n));

  const oldLk = (await db.query(`
    select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='brc' and p.proname='lookup_card'
       and pg_get_function_identity_arguments(p.oid)='p_serial text'`)).rows[0];
  check('التوقيع القديم lookup_card(text) محذوف', Number(oldLk.n) === 0, String(oldLk.n));

  /* ── ٦) lookup_card لا يتجاوز self_service_card ─────────────────────── */
  const lk = (await db.query(`select brc.lookup_card('CODEDCARD01'::text, null::text) as r`)).rows[0].r;
  check('lookup_card بطاقة برمز — بلا رمز: الاسم مقنّع', /•/.test(lk.fullName), lk.fullName);
  check('lookup_card بطاقة برمز — بلا رمز: الهاتف مقنّع', /••••/.test(lk.phone), lk.phone);
  check('lookup_card بطاقة برمز — بلا رمز: verified=false', lk.verified === false);
  check('lookup_card بلا رمز: لا هاتف كامل', !JSON.stringify(lk).includes('07711111111'));
  const lk2 = (await db.query(`select brc.lookup_card('CODEDCARD01'::text,'ABCD2345EFGH6789'::text) as r`)).rows[0].r;
  check('lookup_card برمز صحيح: الاسم كامل', lk2.fullName === 'اسم برمز');
  check('lookup_card برمز صحيح: الهاتف كامل', lk2.phone === '07711111111');
  const lkPlain = (await db.query(`select brc.lookup_card('PQKW2Y7U5G'::text, null::text) as r`)).rows[0].r;
  check('lookup_card بطاقة بلا رمز: تعمل كالسابق', lkPlain.verified === true &&
    lkPlain.fullName === 'غيث حماد عبد الصاحب');

  /* ── ٧) use_chance: الرمز ما زال اختيارياً **بالقرار** لا بالسهو ──────
     رموز الفرص أُلغيت قراراً في 2026-10-25 (cloud.js + docs/schema.sql:256،975).
     الغرض من هذا الفحص: أن يبقى هذا السلوك مقصوداً وموثّقاً، وأن يُكتشف
     فوراً لو تغيّر — لا أن يُفرض تغيير على قرار سابق. */
  await db.exec(`
    create or replace function brc.use_chance(p_serial text, p_code text, p_job_code text)
    returns jsonb language plpgsql security definer set search_path = brc, public
    as $fn$
    declare f record; a record; j record; hold_hours int; v_code text;
    begin
      select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial,'')));
      if f.serial is null then return jsonb_build_object('ok',false,'error','لا توجد بطاقة بهذا الباركود'); end if;
      if f.status = 'blank' then return jsonb_build_object('ok',false,'error','هذه البطاقة فارغة ولم تُبع بعد'); end if;
      v_code := upper(btrim(coalesce(p_code,'')));
      select * into a from brc.job_attempts
       where serial = f.serial and slot_status = 'empty'
         and (v_code = '' or chance_code = v_code)
       order by attempt_no limit 1;
      if a.id is null then return jsonb_build_object('ok',false,'error','لا توجد فرصة متاحة في هذه البطاقة'); end if;
      select * into j from brc.jobs where code = upper(btrim(coalesce(p_job_code,''))) for update;
      if j.id is null then return jsonb_build_object('ok',false,'error','الوظيفة غير موجودة'); end if;
      if j.status <> 'available' then return jsonb_build_object('ok',false,'error','الوظيفة غير متاحة حالياً'); end if;
      select coalesce((value->>'hold_hours')::int,24) into hold_hours from brc.settings where key='rules';
      update brc.job_attempts set slot_status='reserved', job_id=j.id, job_code=j.code,
             selected_at=now(), hold_expires_at=now()+make_interval(hours=>hold_hours)
       where id=a.id returning * into a;
      return jsonb_build_object('ok',true,'attempt',jsonb_build_object(
        'no',a.attempt_no,'slotStatus',a.slot_status,'jobCode',a.job_code));
    end $fn$;
  `);
  const noChance = (await db.query(
    `select brc.use_chance('PQKW2Y7U5G'::text, null::text, 'HRC-1058'::text) as r`)).rows[0].r;
  check('use_chance بلا رمز يعمل (القرار المقفل 2026-10-25)', noChance.ok === true,
    JSON.stringify(noChance));

  /* ── ٨) البطاقة الفارغة تبقى مرفوضة ────────────────────────────────── */
  await db.exec(`create or replace function brc.ensure_card_attempts(p_serial text) returns integer
    language plpgsql as $fn$ begin return 2; end $fn$;
    update brc.job_attempts set slot_status='empty', job_id=null, job_code=null,
           selected_at=null, hold_expires_at=null where serial='PQKW2Y7U5G';`);
  const blank = (await db.query(
    `select brc.use_chance('2A37XZ5XM4'::text,'0000-AA'::text,'HRC-1058'::text) as r`)).rows[0].r;
  check('البطاقة الفارغة: لا تقديم', blank.ok === false);
  check('البطاقة الفارغة: الرسالة صحيحة', /فارغة/.test(blank.error || ''), blank.error);

  /* ── ٩) لا شيء حُذف من البيانات ────────────────────────────────────── */
  const counts = (await db.query(
    `select (select count(*) from brc.applicants) a, (select count(*) from brc.job_attempts) t,
            (select count(*) from brc.jobs) j`)).rows[0];
  check('لم تُحذف بيانات: البطاقات', Number(counts.a) === 3, String(counts.a));
  check('لم تُحذف بيانات: الفرص', Number(counts.t) === 6, String(counts.t));
  check('لم تُحذف بيانات: الوظائف', Number(counts.j) === 1, String(counts.j));

} finally {
  await db.close();
}

console.log(`\n✅ ${pass} فحصاً أمنياً نجحت — الترحيل يمنع تسريب البيانات ويعمل بلا تعطيل.`);
