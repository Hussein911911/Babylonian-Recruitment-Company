-- Update display branding without changing the registered legal name or other settings.
update brc.settings
set value = jsonb_set(
  jsonb_set(coalesce(value, '{}'::jsonb), '{nameAr}', to_jsonb('منصة مكسب للتوظيف'::text)),
  '{nameEn}', to_jsonb('Makseb Employment Platform'::text)
)
where key = 'company';
