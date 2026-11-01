-- Update only the company's published address text; keep other settings intact.
update brc.settings
set value = jsonb_set(
  jsonb_set(coalesce(value, '{}'::jsonb), '{address}', to_jsonb('لا تحُدّنا جغرافيا.. متواجدون حيثما وُجدت الفرصة وطموح السعي.'::text)),
  '{addressShort}', to_jsonb('لا تحُدّنا جغرافيا.. متواجدون حيثما وُجدت الفرصة وطموح السعي.'::text)
)
where key = 'company';
