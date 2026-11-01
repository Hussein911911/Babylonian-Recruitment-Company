-- Keep company contact settings consistent with the published opening hours.
-- Preserve every unrelated company field.
update brc.settings
set value = jsonb_set(
  jsonb_set(coalesce(value, '{}'::jsonb), '{hours}', to_jsonb('يومياً: 9:00 صباحاً – 10:00 مساءً'::text)),
  '{holiday}', to_jsonb('طوال أيام الأسبوع'::text)
)
where key = 'company';
