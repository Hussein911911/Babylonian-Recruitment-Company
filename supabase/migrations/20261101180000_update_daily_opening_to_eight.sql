-- Change only opening hours; keep all other company settings untouched.
update brc.settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{hours}', to_jsonb('يومياً من 8:00 صباحاً حتى 10:00 مساءً'::text))
where key = 'company';
