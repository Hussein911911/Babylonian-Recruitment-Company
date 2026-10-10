-- =====================================================================
-- إزالة حقل «الناحية» (subdistrict) من شرط إلزامية السكن في التقديم
-- =====================================================================
-- الواجهة (apply.html) ما عاد فيها حقل الناحية، فالدالة لازم ما تطلبه.
-- السكربت يقرأ تعريف brc.apply_with_card الحالي من القاعدة، ويشيل شرط
-- «subdistrict إجباري» فقط، ويعيد إنشاء الدالة. آمن ويمكن إعادة تشغيله.
-- بعد التشغيل: الناحية تُحفظ فارغة (null) ولا تُرفض الاستمارة بسببها.
-- =====================================================================

do $$
declare
  d   text;
  nd  text;
  n   int;
begin
  d := pg_get_functiondef('brc.apply_with_card(text, text, jsonb)'::regprocedure);

  nd := regexp_replace(
          d,
          $re$\s*or coalesce\(p_data->>'subdistrict', ''\) = ''$re$,
          '',
          'g');

  n := (length(d) - length(replace(d, 'subdistrict', ''))) - (length(nd) - length(replace(nd, 'subdistrict', '')));
  raise notice 'تم حذف % شرط/إشارة للناحية من الدالة', n;

  if nd = d then
    raise exception 'لم يُعثر على شرط الناحية في الدالة — لم يُغيَّر شيء';
  end if;

  execute nd;
end
$$;

-- ---------- تحقّق ----------
select
  case when pg_get_functiondef('brc.apply_with_card(text, text, jsonb)'::regprocedure)
            ~ $re$coalesce\(p_data->>'subdistrict', ''\) = ''$re$
       then 'ما زال الشرط موجوداً — راجع'
       else 'تم: الناحية لم تعد إلزامية' end as result;
