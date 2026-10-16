-- Corrective privacy migration: keep reprint secrets out of automatic audit diffs.
begin;

create or replace function brc.trg_audit() returns trigger
language plpgsql security definer
set search_path = brc, public
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  hdrs   jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  uname  text  := coalesce(claims->>'email', claims->>'sub', 'system');
  rname  text  := coalesce(nullif(current_setting('app.brc_role', true), ''), 'staff');
  before_row jsonb;
  after_row  jsonb;
begin
  if tg_op = 'INSERT' then before_row := null; after_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then before_row := to_jsonb(old); after_row := to_jsonb(new);
  else before_row := to_jsonb(old); after_row := null;
  end if;

  -- Reprint secrets must never become exportable audit history.
  before_row := before_row - 'card_print_code' - 'chance_code';
  after_row := after_row - 'card_print_code' - 'chance_code';

  insert into brc.audit_log (username, role, ip, action, entity, entity_id, details, diff)
  values (
    uname, rname,
    coalesce(split_part(coalesce(hdrs->>'x-forwarded-for', hdrs->>'x-real-ip', ''), ',', 1), ''),
    case tg_op when 'INSERT' then 'إضافة' when 'UPDATE' then 'تعديل' else 'حذف' end || ' ' || tg_table_name,
    tg_table_name,
    coalesce(after_row->>'code', after_row->>'serial', before_row->>'code', before_row->>'serial', ''),
    'تغيير في ' || tg_table_name,
    jsonb_build_object('before', before_row, 'after', after_row)
  );
  return coalesce(new, old);
end $$;

-- Remove only secret keys from existing before/after diffs; preserve all other evidence.
update brc.audit_log
   set diff = diff #- '{before,card_print_code}' #- '{after,card_print_code}'
                   #- '{before,chance_code}' #- '{after,chance_code}'
 where (diff->'before') ?| array['card_print_code','chance_code']
    or (diff->'after') ?| array['card_print_code','chance_code'];

notify pgrst, 'reload schema';
commit;
