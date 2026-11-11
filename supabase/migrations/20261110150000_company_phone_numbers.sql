-- Update only the company's published phone numbers; keep every other
-- company field (branding, legal name, address, hours, email) intact.
-- 2026-11-10: أرقام خدمة العملاء الجديدة وفق طلب الإدارة.
--   07763999907  (الأول — رقم البطاقة وواتساب خدمة العملاء)
--   07863999907  (الثاني — يظهر في التحقق والتذييل)
update brc.settings
set value = jsonb_set(
  coalesce(value, '{}'::jsonb),
  '{phones}',
  to_jsonb(array['07763999907', '07863999907']::text[])
)
where key = 'company';
