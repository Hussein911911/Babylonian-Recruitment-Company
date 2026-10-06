-- حماية صفحة صاحب العمل: لا تكشف بيانات المتقدم قبل رمز الشركة.
alter function brc.employer_view(text) rename to employer_view_original;

create or replace function brc.employer_view(p_serial text, p_code text)
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare g jsonb;
begin
  g := brc.card_gate(p_serial,p_code,'employer',false);
  if not coalesce((g->>'ok')::boolean,false) then return g; end if;
  return brc.employer_view_original(p_serial);
end $$;

create or replace function brc.employer_view(p_serial text)
returns jsonb language sql security definer set search_path=brc,public as $$
  select jsonb_build_object('ok',false,'error','رمز صاحب العمل مطلوب قبل عرض بيانات المتقدم')
$$;

revoke all on function brc.employer_view_original(text) from public;
grant execute on function brc.employer_view(text,text),brc.employer_view(text) to anon,authenticated;
