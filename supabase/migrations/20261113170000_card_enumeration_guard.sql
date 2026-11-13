-- ═══════════════════════════════════════════════════════════════════════════
--  إيقاف تعداد البطاقات + تقنين بيانات الباحثين — فحص أمني 2026-11-13
--  ---------------------------------------------------------------------------
--  ⚠️ الثغرة **مُثبتة بالتنفيذ** لا بالقراءة. بدور anon وبلا أي جلسة:
--
--      select brc.lookup_card('HRC-BC-900001'::text, null::text);
--      → {"ok":true,"fullName":"غيث حماد عبد الصاحب","phone":"07800977448",…}
--
--  وبـ 40 بطاقة متتالية (HRC-BC-9000xx): **40/40 انكشفت**، بلا رمز وبلا حدّ طلبات.
--
--  ⚠️ نقطتان تجعلان هذا خطيراً:
--    1) أرقام البطاقات شبه متسلسلة ومطبوعة، فالتعداد (enumeration) عملي.
--    2) المفتاح العام منشور في assets/js/supabase-config.js — أي زائر يملكه.
--
--  السبب الجذري: `lookup_card` تُرجع الاسم والهاتف **كاملين** متى كان
--  `card_print_code` فارغاً — وهو فارغ في كل البطاقات الحالية. و`mask_name`
--  و`mask_phone` مكتوبتان لهذا الغرض، لكن الشرط الذي يفعّلهما (وجود رمز طباعة)
--  لا يتحقق اليوم. و`card_gate` — فيها حدّ ٦٠ طلباً/دقيقة وقفل ١٠ دقائق —
--  **لا تُنادى من lookup_card إطلاقاً**.
--
--  ═══ الاستراتيجية: غلاف لا إعادة كتابة ═══
--  نُعيد تسمية الجسمين المجرَّبين إلى *_unguarded، ثم نضع غلافاً بالتوقيع
--  **نفسه** (text, text) — فالواجهة لا تتغيّر إطلاقاً، ولا نلمس منطقاً مُختبَراً:
--
--      الزبون ──> lookup_card(text,text)  ← الغلاف: حارس + تقنين
--                     └──> lookup_card_unguarded  ← الجسم القديم كما هو
--
--  ⚠️ ولا نضيف وسيطاً ثالثاً: توقيعان بنفس الاسم أحدهما بقيم افتراضية يجعل
--     النداء غامضاً (function is not unique) ويكسر apply.html بالكامل.
--
--  ═══ ما يفعله ═══
--   ١) حارس تعداد: ١٥ عرضاً/ساعة لكل بطاقة + ٤٠ بطاقة مختلفة/ساعة لكل مصدر.
--      المصدر يُقرأ من ترويسات الطلب (PostgREST) ويُخزَّن **بصمة md5 فقط** —
--      لا IP خام، ولا معرّف جهاز.
--   ٢) تقنين شخصي بلا رمز: «غيث ح.» و«0780••••48» بدل الاسم والهاتف الكاملين،
--      وإقفال الملف (profileLocked=true) كي لا يكتب زائر بياناته فوق بيانات
--      بطاقة غيره.
--   ٣) حماية السجل التدقيقي من حفظ البصمة.
--
--  ═══ ما لا يفعله ═══
--   لا DELETE · لا UPDATE على أي صف موجود · use_chance وapply_with_card
--   وcustomer_application_details لم تُمسّ · الرموز القديمة صالحة كما هي.
--
--  ⚠️ ولا نغيّر `v_ok := true` في docs/schema.sql للبطاقات بلا رمز: ذلك يُفرغ
--     card.profile في الاستمارة فيرى الزبون «غيث ح.» بدل اسمه فيكتب فوق
--     بياناته — تخريب بيانات حقيقي. الضمانة هي الحارس، لا إفساد مسار العرض.
--     (وقد قِيس هذا: جعلها false أسقط tests/card-identity.mjs فوراً.)
-- ═══════════════════════════════════════════════════════════════════════════

set search_path = brc, public;

-- ═══ 1) ميزانية العرض ══════════════════════════════════════════════════════
create table if not exists brc.card_lookup_budget (
  budget_key   text primary key,
  window_start timestamptz not null default now(),
  used         integer not null default 0
);

alter table brc.card_lookup_budget enable row level security;
revoke all on brc.card_lookup_budget from public, anon, authenticated;
grant all on brc.card_lookup_budget to service_role;

comment on table brc.card_lookup_budget is
  'ميزانية عرض البطاقات العامة — بيانات تشغيلية مؤقتة، بلا IP خام، تُصفَّر تلقائياً ولا تُنسخ احتياطياً.';

-- ═══ 2) مصدر الطلب (بصمة فقط) ═════════════════════════════════════════════
/* PostgREST يعرض ترويسات الطلب في current_setting('request.headers').
   نستخدم أول عنوان توجيه متاح، ثم نُرجع بصمته — لا نحتفظ بالقيمة. */
create or replace function brc.card_request_source()
returns text
language plpgsql stable security invoker
set search_path = brc, public, pg_temp
as $$
declare h jsonb; raw text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then h := null;
  end;
  if h is null then return null; end if;

  raw := coalesce(
    nullif(btrim(split_part(coalesce(h->>'cf-connecting-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(h->>'x-real-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), '')
  );
  if raw is null then return null; end if;
  /* البصمة فقط: لا يمكن استرجاع IP منها، وتكفي للمقارنة */
  return 'src:' || md5(raw);
end $$;

revoke all on function brc.card_request_source() from public, anon, authenticated;

-- ═══ 3) الحارس ═════════════════════════════════════════════════════════════
create or replace function brc.card_lookup_guard(p_serial text, p_source text default null)
returns jsonb
language plpgsql security definer
set search_path = brc, public, pg_temp
as $$
declare
  v_card_key text;
  v_src_key  text;
  v_used     integer;
  v_src_used integer;
  v_serial   text := upper(btrim(coalesce(p_serial, '')));
  v_src      text := nullif(btrim(coalesce(p_source, brc.card_request_source(), '')), '');
  c_card     constant integer := 15;   -- عرضاً لكل بطاقة في الساعة
  c_source   constant integer := 40;   -- بطاقة مختلفة لكل مصدر في الساعة
begin
  if v_serial = '' then
    return jsonb_build_object('ok', false, 'error', 'أدخل رقم البطاقة');
  end if;

  /* نافذة البطاقة */
  v_card_key := 'card:' || md5(v_serial);
  insert into brc.card_lookup_budget (budget_key) values (v_card_key)
    on conflict (budget_key) do nothing;
  update brc.card_lookup_budget
     set window_start = case when window_start < now() - interval '1 hour' then now() else window_start end,
         used         = case when window_start < now() - interval '1 hour' then 1 else used + 1 end
   where budget_key = v_card_key
  returning used into v_used;

  if v_used > c_card then
    return jsonb_build_object('ok', false,
      'error', 'عُرضت هذه البطاقة مرات كثيرة خلال ساعة. انتظر قليلاً ثم أعد المحاولة.');
  end if;

  /* نافذة المصدر — هي التي توقف التعداد الفعلي.
     تُتجاهل إن غاب المصدر (طلب داخلي) كي لا نعطّل أحداً. */
  if v_src is not null then
    v_src_key := 'source:' || md5(v_src);
    insert into brc.card_lookup_budget (budget_key) values (v_src_key)
      on conflict (budget_key) do nothing;
    update brc.card_lookup_budget
       set window_start = case when window_start < now() - interval '1 hour' then now() else window_start end,
           used         = case when window_start < now() - interval '1 hour' then 1 else used + 1 end
     where budget_key = v_src_key
    returning used into v_src_used;

    if v_src_used > c_source then
      return jsonb_build_object('ok', false,
        'error', 'تم عرض بطاقات كثيرة من هذا الجهاز خلال ساعة. توقّف قليلاً — البطاقة تخصّك وحدك.');
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function brc.card_lookup_guard(text, text) from public, anon, authenticated;

-- ═══ 4) التقنين: نقطة واحدة لكل المسارات ═══════════════════════════════════
create or replace function brc.card_public_name(p_name text, p_verified boolean)
returns text language sql immutable
set search_path = brc, public, pg_temp
as $$
  select case
    when p_verified then coalesce(p_name, '')
    when coalesce(btrim(p_name), '') = '' then ''
    else (regexp_split_to_array(btrim(p_name), '\s+'))[1]
         || coalesce(' ' || left((regexp_split_to_array(btrim(p_name), '\s+'))[2], 1) || '.', '')
  end
$$;

create or replace function brc.card_public_phone(p_phone text, p_verified boolean)
returns text language sql immutable
set search_path = brc, public, pg_temp
as $$
  select case
    when p_verified then coalesce(p_phone, '')
    when coalesce(btrim(p_phone), '') = '' then ''
    else left(btrim(p_phone), 4) || '••••' || right(btrim(p_phone), 2)
  end
$$;

revoke all on function brc.card_public_name(text, boolean) from public, anon, authenticated;
revoke all on function brc.card_public_phone(text, boolean) from public, anon, authenticated;
grant execute on function brc.card_public_name(text, boolean) to service_role;
grant execute on function brc.card_public_phone(text, boolean) to service_role;

-- ═══ 5) الأغلفة — نفس التوقيع تماماً ═══════════════════════════════════════

/* lookup_card: الجسم القديم يُعاد تسميته، ثم غلاف بالتوقيع نفسه */
do $$
begin
  if to_regprocedure('brc.lookup_card_unguarded(text, text)') is null
     and to_regprocedure('brc.lookup_card(text, text)') is not null then
    alter function brc.lookup_card(text, text) rename to lookup_card_unguarded;
  end if;
end $$;

create or replace function brc.lookup_card(p_serial text, p_code text default null)
returns jsonb
language plpgsql security definer
set search_path = brc, public, pg_temp
as $$
declare
  v_guard jsonb; v_body jsonb; v_ok boolean; v_stored text; v_code text;
  v_name text; v_phone text;
begin
  v_guard := brc.card_lookup_guard(p_serial, null);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then return v_guard; end if;

  v_body := brc.lookup_card_unguarded(p_serial, p_code);
  if v_body is null or coalesce((v_body->>'ok')::boolean, false) is not true then
    return v_body;
  end if;
  if (v_body->>'status') = 'blank' then return v_body; end if;   -- بلا بيانات شخصية

  /* ⚠️ نقرأ الاسم والهاتف من الجدول، لا من ردّ الجسم القديم: ذاك الرد يطبّق
     mask_name مسبقاً («غ••••••») فيصير تقنينه تقنيناً لنصٍّ مقنّع. */
  select upper(btrim(coalesce(card_print_code, ''))), full_name, phone
    into v_stored, v_name, v_phone
    from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  v_stored := coalesce(v_stored, '');
  v_code   := upper(btrim(coalesce(p_code, '')));
  v_ok := (v_stored <> '') and (
            v_stored = v_code
            or replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));

  if v_ok then
    /* صاحب البطاقة برمزها: بياناته كاملة كما كانت قبل هذا الترحيل */
    v_body := jsonb_set(v_body, '{fullName}', to_jsonb(coalesce(v_name, '')),   true);
    v_body := jsonb_set(v_body, '{phone}',    to_jsonb(coalesce(v_phone, '')),  true);
    v_body := jsonb_set(v_body, '{masked}',   'false'::jsonb, true);
    v_body := jsonb_set(v_body, '{verified}', 'true'::jsonb,  true);
  else
    v_body := jsonb_set(v_body, '{fullName}', to_jsonb(brc.card_public_name(v_name, false)),  true);
    v_body := jsonb_set(v_body, '{phone}',    to_jsonb(brc.card_public_phone(v_phone, false)), true);
    v_body := jsonb_set(v_body, '{masked}',   'true'::jsonb,  true);
    v_body := jsonb_set(v_body, '{verified}', 'false'::jsonb, true);
  end if;
  return v_body;
end $$;

revoke all on function brc.lookup_card(text, text) from public, anon, authenticated;
grant execute on function brc.lookup_card(text, text) to anon, authenticated;


/* self_service_card: نفس المبدأ — وهو أول نداء في apply.html.
   ⚠️ هنا لا يُقنَّع شيء. apply.html يعرض هذا الملف في الاستمارة، وتقنينه
   يعني أن يرى الزبون «علي ح.» بدل اسمه بعد أن قدّم — فيظن أن بياناته
   تلفت، وقد يكتب فوقها. حماية هذا المسار هي **الحارس وحده** (حدّ لكل بطاقة
   ولكل مصدر)، وهو ما يمنع التعداد. */
do $$
begin
  if to_regprocedure('brc.self_service_card_unguarded(text, text)') is null
     and to_regprocedure('brc.self_service_card(text, text)') is not null then
    alter function brc.self_service_card(text, text) rename to self_service_card_unguarded;
  end if;
end $$;

create or replace function brc.self_service_card(p_serial text, p_code text default null)
returns jsonb
language plpgsql security definer
set search_path = brc, public, pg_temp
as $$
declare
  v_guard jsonb; v_body jsonb; v_ok boolean; v_stored text; v_code text; v_code_ref text;
begin
  v_guard := brc.card_lookup_guard(p_serial, null);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then return v_guard; end if;

  v_body := brc.self_service_card_unguarded(p_serial, p_code);
  if v_body is null or coalesce((v_body->>'ok')::boolean, false) is not true then
    return v_body;
  end if;

  select upper(btrim(coalesce(card_print_code, ''))) into v_stored
    from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  v_stored := coalesce(v_stored, '');
  v_code   := upper(btrim(coalesce(p_code, '')));
  /* لا رمز مطبوع ⇒ لا إثبات ⇒ لا بيانات تعرّف. البطاقة الفارغة لا تحمل
     بيانات أصلاً، والبطاقة المستعملة ملفّها مقفل على الخادم (الهوية تُحفظ من
     أول تقديم فقط)، فالتقنين لا يُفسد شيئاً — يمنع فقط أن يقرأ زائرٌ بيانات
     زبونٍ آخر بمسح أرقام متتالية. */
  v_ok := (v_stored <> '') and (
            v_stored = v_code
            or replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));

  if not v_ok then
    /* بيانات تعرّف لا تخرج لزائر لا يملك الرمز — والملف يُعرض في الاستمارة.
       الإقفال يمنع الكتابة فوقها، والشيفرة في apply.html تعرض تنبيهاً يشرح
       أن البيانات محفوظة لدى الشركة عند `masked`. */
    v_body := jsonb_set(v_body, '{card,masked}',        'true'::jsonb,  true);
    v_body := jsonb_set(v_body, '{card,verified}',      'false'::jsonb, true);
    v_body := jsonb_set(v_body, '{card,profileLocked}', 'true'::jsonb,  true);
    if v_body #> '{card,profile,fullName}' is not null then
      v_body := jsonb_set(v_body, '{card,profile,fullName}', to_jsonb(
        brc.card_public_name(v_body #>> '{card,profile,fullName}', false)), true);
    end if;
    if v_body #> '{card,profile,phone}' is not null then
      v_body := jsonb_set(v_body, '{card,profile,phone}', to_jsonb(
        brc.card_public_phone(v_body #>> '{card,profile,phone}', false)), true);
    end if;
    if v_body #> '{card,profile,address}' is not null then
      v_body := jsonb_set(v_body, '{card,profile,address}', '""'::jsonb, true);
    end if;
    if v_body #> '{card,profile,dob}' is not null then
      v_body := jsonb_set(v_body, '{card,profile,dob}', 'null'::jsonb, true);
    end if;
  end if;
  return v_body;
end $$;

revoke all on function brc.self_service_card(text, text) from public, anon, authenticated;
grant execute on function brc.self_service_card(text, text) to anon, authenticated;

/* الأجسام القديمة محجوبة تماماً: لا تُنادى من العميل، فقط من الغلاف */
revoke all on function brc.lookup_card_unguarded(text, text) from public, anon, authenticated;
revoke all on function brc.self_service_card_unguarded(text, text) from public, anon, authenticated;

-- ═══ 6) السجل التدقيقي لا يحمل بصمات ═══════════════════════════════════════
create or replace function brc.trg_block_fingerprint_audit() returns trigger
language plpgsql security invoker
set search_path = brc, public
as $$
begin
  if new.details is not null and (
       new.details like 'lookup:%'
    or new.details like 'self_service:%'
    or new.details like 'fingerprint:%') then
    raise exception 'سطر تدقيق يحمل بصمة سرية — مرفوض' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_fingerprint_audit on brc.audit_log;
create trigger trg_block_fingerprint_audit
  before insert or update on brc.audit_log
  for each row execute function brc.trg_block_fingerprint_audit();

revoke all on function brc.trg_block_fingerprint_audit() from public, anon, authenticated;

-- ═══ 7) تنظيف الميزانية القديمة ════════════════════════════════════════════
delete from brc.card_lookup_budget where window_start < now() - interval '2 hours';

notify pgrst, 'reload schema';
