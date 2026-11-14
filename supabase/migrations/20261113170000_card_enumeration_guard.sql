-- ═══════════════════════════════════════════════════════════════════════════
--  إيقاف تعداد البطاقات — بلا تقنين وبلا مساس بمسار الزبون (2026-11-13)
--  ---------------------------------------------------------------------------
--  ⚠️ الثغرة كانت **مُثبتة بالتنفيذ**: بدور anon وبلا جلسة،
--      select brc.lookup_card('HRC-BC-900001'::text, null::text);
--     يُرجع الاسم والهاتف كاملين. وبـ 40 بطاقة: 40/40 انكشفت.
--     السبب: `card_gate` فيها حدّ طلبات لكنها **لا تُنادى من lookup_card**.
--
--  ═══ ما يفعله هذا الترحيل ═══
--   ١) card_lookup_guard — ميزانية طلبات:
--        ١٥ عرضاً/ساعة لكل بطاقة + ٤٠ بطاقة مختلفة/ساعة لكل مصدر.
--        المصدر يُقرأ من ترويسات الطلب ويُخزَّن **بصمة md5 فقط** — لا IP خام.
--      النطاق 777,600 احتمال (100000–999999 عشوائي لا متسلسل)، فـ40/ساعة
--      ⇒ تعداد كامل يحتاج ~338 يوماً متصلاً من مصدر واحد.
--   ٢) غلافان بالتوقيع نفسه (text,text) حول lookup_card و self_service_card:
--      الحارس ثم الجسم القديم المُعاد تسميته (*_unguarded). الواجهة لا تتغيّر.
--      ⚠️ لا وسيط ثالث: توقيعان بقيم افتراضية = function is not unique.
--   ٣) حماية السجل التدقيقي من حفظ بصمة.
--
--  ═══ ما لا يفعله (وهذا مقصود) ═══
--   **لا تقنين ولا إقفال ملف.** البطاقة المفعّلة تُعرض كاملة لصاحبها:
--   بياناته ووظائفه وبيانات صاحب العمل لكل وظيفة كي يتصل به.
--
--   كان هنا تقنين «غيث ح.» و«0780••••48» وإقفال الحقول (profileLocked=true)،
--   وقد **أُلغي** بعد توضيح صاحب العمل لدورة العمل:
--
--     المكتب يُصدر بطاقات **فارغة** ويبيعها كاشاً → الزبون يقرأ الباركود
--     ويدخل بياناته ويختار وظيفته → تُفعَّل → يمسح الباركود ثانياً فيرى
--     بياناته ووظائفه وبيانات صاحب العمل.
--
--   و`card_print_code` غير مستعمل في هذه الدورة إطلاقاً (فارغ في 723/723
--   بطاقة). فاشتراطه كان يُقنّع **كل** زبون عن نفسه ويقفل حقوله فلا يصحّح
--   هاتفه — حماية صفر مقابل كسر كل مسار.
--
--   وما يحمي البيانات فعلاً ترابط الدورة: من يقدّم ببطاقة غيره تكتب
--   `apply_with_card` **اسمه** فوقها (update ... set full_name=v_name)،
--   فيقارن صاحب العمل الاسم بالهوية الوطنية ويكشفه.
--
--  ═══ ما لا يلمسه ═══
--   لا DELETE · لا UPDATE على أي صف · use_chance وapply_with_card
--   وcustomer_application_details كما هي.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  ⚠️ حارس إعادة التطبيق (2026-11-13)
--  ---------------------------------------------------------------------------
--  هذا الترحيل طُبِّق يدوياً على قاعدة الإنتاج قبل الدمج (بصمة
--  20261114005652 · card_lookup_guard_no_masking). وعند الدمج تُطبِّقه تكاملة
--  GitHub مرة أخرى بالبصمة 20261113170000. فبدون هذا الحارس يُنفَّذ مرتين.
--
--  التطبيق الثاني ليس خطراً بذاته (create or replace، واسمحة إعادة التسمية
--  محروسة بـto_regprocedure)، لكن تكرار التنفيذ على قاعدة إنتاج بلا ضرورة
--  مرفوض: يفتح نافذة سباق تستطيع خلالها كتابةُ بطاقة أن تفشل.
--
--  لذلك: إن كان card_lookup_guard موجوداً **ومعه** lookup_card_unguarded،
--  فكل شيء منشور — نخرج بهدوء (NOTICE) بلا لمس أي دالة.
--  ولا نتخطّى الترحيل في ملفات لم تُطبَّق أصلاً: الشرطان معاً لا يتحققان إلا
--  بعد نجاح تطبيق كامل.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regprocedure('brc.lookup_card_unguarded(text, text)') is not null
     and to_regprocedure('brc.card_lookup_guard(text, text)') is not null
     and to_regprocedure('brc.self_service_card_unguarded(text, text)') is not null then
    raise notice 'card_enumeration_guard: مطبَّق مسبقاً — لا إعادة تنفيذ.';
    return;
  end if;
end $$;

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
  v_guard jsonb; v_body jsonb; v_name text; v_phone text; v_stored text;
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
  select full_name, phone into v_name, v_phone
    from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));

  /* ═══ سياسة العرض (2026-11-13، بعد توضيح صاحب العمل) ═══════════════════
     دورة العمل الفعلية: المكتب يُصدر بطاقات **فارغة** ويبيعها كاشاً. البطاقة
     الفارغة لا تحمل أي بيانات تعرّف، فلا شيء يُسرَّب منها. والمفعّلة بياناتها
     كتبها صاحبها بنفسه، و`card_print_code` غير مستعمل في هذه الدورة (فارغ في
     كل البطاقات) — فاشتراط رمز مطبوع كان يُقنّع كل زبون عن نفسه بلا مقابل.

     ما يحمي البيانات فعلاً ليس الرمز، بل ترابط الدورة:
       • من يقدّم ببطاقة غيره **يكتب اسمه فوقها** (apply_with_card)، فيقارن
         صاحب العمل الاسم بالهوية الوطنية ويرفض ويكشف الأمر.
       • التعداد (مسح أرقام متتالية) يوقفه `card_lookup_guard` أعلاه بالميزانية،
         لا بالتقنين — فالميزانية تحمي الجميع بلا أن تمسّ أحداً.

     لذلك: البطاقة المفعّلة تُعرض كاملة (بياناتها + وظائفها + بيانات صاحب العمل
     لكل وظيفة، كي يتصل به). والبطاقة الفارغة تُعرض بلا بيانات أصلاً.
     نُبقي `masked=false, verified=true` صراحةً كي لا تعتمد الواجهة على قيم
     افتراضية. */
  v_body := jsonb_set(v_body, '{fullName}', to_jsonb(coalesce(v_name, '')),   true);
  v_body := jsonb_set(v_body, '{phone}',    to_jsonb(coalesce(v_phone, '')),  true);
  v_body := jsonb_set(v_body, '{masked}',   'false'::jsonb, true);
  v_body := jsonb_set(v_body, '{verified}', 'true'::jsonb,  true);
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
  v_guard jsonb; v_body jsonb;
begin
  v_guard := brc.card_lookup_guard(p_serial, null);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then return v_guard; end if;

  v_body := brc.self_service_card_unguarded(p_serial, p_code);
  if v_body is null or coalesce((v_body->>'ok')::boolean, false) is not true then
    return v_body;
  end if;

  /* لا تقنين ولا إقفال — لنفس سبب lookup_card أعلاه. البطاقة الفارغة لا تحمل
     بيانات، والمفعّلة بياناتها يراها صاحبها (من يمسك الباركود هو من دفع ثمنها).
     كان هذا الفرع يُقنّع كل زبون عن نفسه ويقفل حقوله، فيعيد كتابة بياناته أو
     يظن أنها ضاعت. والإقفال كان يمنع الزبون من تصحيح رقم هاتفه عند تغييره. */
  v_body := jsonb_set(v_body, '{card,masked}',        'false'::jsonb, true);
  v_body := jsonb_set(v_body, '{card,verified}',      'true'::jsonb,  true);
  v_body := jsonb_set(v_body, '{card,profileLocked}', 'false'::jsonb, true);
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
