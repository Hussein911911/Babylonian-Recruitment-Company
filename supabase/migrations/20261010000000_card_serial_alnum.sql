-- ===========================================================================
--  تحديث 2026-10-10 — صيغة باركود البطاقة الجديدة
--  ---------------------------------------------------------------------------
--  قبل: HRC-BC-###### (بادئة + شرطة + 6 أرقام)
--  بعد: 10 خانات من حروف إنجليزية كبيرة وأرقام مختلطة — بلا بادئة وبلا شرطة.
--       الأشكال المتشابهة (0/O و1/I/L) مستبعدة من الأبجدية.
--  الباركودات القديمة المطبوعة تبقى صالحة (الواجهة تقبل الصيغتين).
--
--  التشغيل: الصقه في SQL Editor ثم نفّذه مرة واحدة. آمن للتكرار.
--  ثم نفّذ:  notify pgrst, 'reload schema';
-- ===========================================================================

create or replace function brc.next_form_serial() returns text
language plpgsql
set search_path = brc, public
as $$
declare
  v        text;
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  i        int;
begin
  loop
    v := '';
    for i in 1..10 loop
      v := v || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    -- مختلط: من 3 إلى 7 أرقام (والباقي أحرف) — ويقبل الفحص الصيغة الجديدة فقط
    exit when v ~ '^[2-9A-HJKMNP-Z]{10}$'
          and length(regexp_replace(v, '[^2-9]', '', 'g')) between 3 and 7
          and not exists (select 1 from brc.issued_serials s where s.serial = v)
          and not exists (select 1 from brc.applicants a where a.serial = v);
  end loop;
  insert into brc.issued_serials (serial) values (v)
    on conflict (serial) do nothing;
  return v;
end $$;
