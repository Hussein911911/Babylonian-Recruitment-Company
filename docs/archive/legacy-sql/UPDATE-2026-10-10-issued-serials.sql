-- ===========================================================================
--  إصلاح 2026-10-10 — جدول سجل الباركودات brc.issued_serials غير موجود
--  ---------------------------------------------------------------------------
--  الدالة brc.next_form_serial تعتمد على هذا الجدول (سجل دائم يمنع عودة أي
--  باركود). إذا كان مفقوداً من القاعدة يفشل توليد الباركود بخطأ 42P01.
--  الملف آمن للتكرار، ينشئ الجدول والمشغّل المرتبط ببطاقات brc.applicants.
--
--  التشغيل: الصقه في SQL Editor ثم نفّذه، وبعدها:
--           notify pgrst, 'reload schema';
-- ===========================================================================

create table if not exists brc.issued_serials (
  serial    text primary key,
  issued_at timestamptz not null default now(),
  note      text default ''
);
alter table brc.issued_serials enable row level security;
create index if not exists issued_serials_serial_idx on brc.issued_serials (serial);

create or replace function brc.trg_log_issued_serial() returns trigger
language plpgsql security definer
set search_path = brc, public
as $$
begin
  insert into brc.issued_serials (serial) values (new.serial)
    on conflict (serial) do nothing;
  return new;
end $$;

drop trigger if exists trg_applicants_log_serial on brc.applicants;
create trigger trg_applicants_log_serial after insert or update of serial on brc.applicants
  for each row execute function brc.trg_log_issued_serial();

-- سجّل الباركودات الموجودة فعلاً بالبطاقات حتى لا يُعاد استعمالها أبداً
insert into brc.issued_serials (serial)
select serial from brc.applicants
on conflict (serial) do nothing;
