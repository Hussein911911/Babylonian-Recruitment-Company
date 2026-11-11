-- Permanent mapping is separate from operational backups: restoring an old
-- snapshot never rewinds the counter or changes a card's printed identity.
create table if not exists brc.card_number_counter (singleton boolean primary key default true check (singleton), last_number bigint not null check (last_number >= 0));
insert into brc.card_number_counter values (true,0) on conflict do nothing;
create table if not exists brc.card_number_registry (serial text primary key, card_number bigint not null unique check (card_number > 0));
create table if not exists brc.card_issue_requests (id uuid primary key, actor uuid not null, params jsonb not null, serials text[] not null);
alter table brc.card_number_counter enable row level security;
alter table brc.card_number_registry enable row level security;
alter table brc.card_issue_requests enable row level security;
revoke all on brc.card_number_counter, brc.card_number_registry, brc.card_issue_requests from public, anon, authenticated;

create or replace function brc.card_number_for(p_serial text) returns bigint
language sql stable security definer set search_path=brc,public as $$
 select r.card_number from brc.card_number_registry r where r.serial=p_serial and brc.is_staff()
$$;
revoke all on function brc.card_number_for(text) from public,anon;
grant execute on function brc.card_number_for(text) to authenticated;
-- select * is deliberate: no applicants column is added, keeping old backups compatible.
create or replace view brc.working_applicants with(security_invoker=true) as
 select a.*, brc.card_number_for(a.serial) as card_number from brc.applicants a where a.archived_at is null;

-- Also protects concurrent/older clients. Number allocation and insertion share
-- one transaction and row lock; a failed insert rolls the counter back.
create or replace function brc.assign_card_number() returns trigger
language plpgsql security definer set search_path=brc,public as $$
declare n bigint;
begin
 if new.status <> 'blank' then return new; end if;
 update brc.card_number_counter set last_number=last_number+1 where singleton returning last_number into n;
 if exists(select 1 from brc.issued_serials where serial=new.serial) or exists(select 1 from brc.card_number_registry where serial=new.serial) then
  raise exception 'كود البطاقة مستخدم سابقاً' using errcode='23505';
 end if;
 insert into brc.card_number_registry(serial,card_number) values(new.serial,n);
 return new;
end $$;
revoke all on function brc.assign_card_number() from public,anon,authenticated;
drop trigger if exists trg_assign_card_number on brc.applicants;
create trigger trg_assign_card_number before insert on brc.applicants for each row execute function brc.assign_card_number();

create or replace function brc.issue_numbered_cards(p_request uuid,p_count integer,p_serial text default null,p_notes text default '') returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare actor uuid:=auth.uid(); old_request brc.card_issue_requests%rowtype; args jsonb; codes text[]:='{}'; code text; n integer; j integer; bytes bytea; alphabet constant text:='23456789ABCDEFGHJKMNPQRSTUVWXYZ'; results jsonb;
begin
 if actor is null or not brc.is_admin() then raise exception 'الإصدار للمدير الفعال فقط' using errcode='42501'; end if;
 -- قرار 2026-11-11: أي عدد من 1 إلى 60 مسموح في الدفعات (لا قيد المضاعفات).
 -- القيد السابق (مضاعفات 4 فقط) كان يرفض أعداداً يطلبها العمل اليومي.
 -- البطاقات يتيمة آخر ورقة تُطبع كما هي؛ التقسيم إلى أوراق في الواجهة.
 -- استثناء قائم: إصدار بطاقة واحدة بكود محدَّد (p_serial) يبقى p_count=1.
 if p_request is null or p_count is null or length(coalesce(p_notes,''))>1000
    or p_count<1 or p_count>60
    or (p_serial is not null and p_count<>1)
 then raise exception 'بيانات الإصدار غير صالحة'; end if;
 p_serial:=nullif(upper(btrim(coalesce(p_serial,''))),'');
 if p_serial is not null and p_serial !~ '^([2-9A-HJKMNP-Z]{10}|HRC-BC-[0-9]{6})$' then raise exception 'كود البطاقة غير صالح'; end if;
 args:=jsonb_build_object('count',p_count,'serial',p_serial,'notes',coalesce(p_notes,''));
 -- Same lock as recovery: neither an issuance nor its retry can overlap restore.
 perform pg_advisory_xact_lock(8310192026);
 if not brc.is_admin() then raise exception 'تغيرت صلاحية الحساب' using errcode='42501'; end if;
 select * into old_request from brc.card_issue_requests where id=p_request;
 if found then
  if old_request.actor<>actor or old_request.params<>args then raise exception 'طلب الإصدار لا يطابق الطلب الأصلي' using errcode='42501'; end if;
  codes:=old_request.serials;
 else
  for n in 1..p_count loop
   if p_serial is not null then code:=p_serial;
   else
    loop
     bytes:=extensions.gen_random_bytes(10); code:='';
     for j in 0..9 loop code:=code||substr(alphabet,1+(get_byte(bytes,j)%length(alphabet)),1); end loop;
     exit when code ~ '[2-9].*[2-9].*[2-9]' and length(regexp_replace(code,'[2-9]','','g'))>=3
       and not exists(select 1 from brc.issued_serials where serial=code) and not exists(select 1 from brc.applicants where serial=code);
    end loop;
   end if;
   insert into brc.applicants(serial,full_name,phone,address,status,fee_paid,notes,created_by)
   values(code,'','','','blank',false,coalesce(p_notes,''),(select id from brc.staff where auth_id=actor limit 1));
   codes:=array_append(codes,code);
  end loop;
  insert into brc.card_issue_requests(id,actor,params,serials) values(p_request,actor,args,codes);
 end if;
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('card_number',r.card_number) order by x.ordinality),'[]'::jsonb)
 into results from unnest(codes) with ordinality x(serial,ordinality)
 join brc.applicants a on a.serial=x.serial join brc.card_number_registry r on r.serial=x.serial;
 if jsonb_array_length(results)<>cardinality(codes) then raise exception 'البطاقات الصادرة غير موجودة حالياً؛ راجع السجل ولا تعيد الإصدار'; end if;
 return jsonb_build_object('cards',results,'attempts',coalesce((select jsonb_agg(to_jsonb(t) order by t.serial,t.attempt_no) from brc.job_attempts t where t.serial=any(codes)),'[]'::jsonb));
end $$;
revoke all on function brc.issue_numbered_cards(uuid,integer,text,text) from public,anon;
grant execute on function brc.issue_numbered_cards(uuid,integer,text,text) to authenticated;
notify pgrst,'reload schema';
