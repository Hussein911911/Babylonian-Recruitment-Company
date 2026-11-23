-- ===========================================================================
--  تخفيف حدّ المصدر: 40 ← 20 بطاقة مختلفة في الساعة (قرار الإدارة 2026-11-20)
--  ---------------------------------------------------------------------------
--  حدّ البطاقة الواحدة بقي 15 عرضاً/ساعة كما هو.
--  القياس على الإنتاج قبل التغيير: أعلى استعمال فعلي لجهاز واحد = 11 من 40،
--  وأعلى استعمال لبطاقة واحدة = 7 من 15 ⇒ لا زبون حقيقي يتأثّر بالحدّ الجديد.
--  الترحيل 20261113170000 يثبّت 40، فهذا الترحيل المتأخّر يثبّت 20 لينتهي
--  أي بناء جديد من الصفر على القيمة المعتمدة.
-- ===========================================================================

create or replace function brc.card_lookup_guard(p_serial text, p_source text default null::text)
returns jsonb language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
declare
  v_card_key text;
  v_src_key  text;
  v_used     integer;
  v_src_used integer;
  v_serial   text := upper(btrim(coalesce(p_serial, '')));
  v_src      text := nullif(btrim(coalesce(p_source, brc.card_request_source(), '')), '');
  c_card     constant integer := 15;
  c_source   constant integer := 20;   -- قرار الإدارة 2026-11-20: كان 40
begin
  if v_serial = '' then
    return jsonb_build_object('ok', false, 'error', 'أدخل رقم البطاقة');
  end if;

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
end $function$;

-- سياسة الصلاحيات صريحة ومطابقة للإنتاج: الحارس دالة داخلية لا يراها الزائر،
-- تُنادى فقط من داخل دوال security definer (فتعمل بصلاحية المالك).
-- create or replace يحافظ على الصلاحيات، وهذا السحب يثبّتها على أي بناء جديد.
revoke all on function brc.card_lookup_guard(text, text) from public;
