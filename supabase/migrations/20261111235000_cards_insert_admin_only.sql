-- ═══════════════════════════════════════════════════════════════════════════
--  2026-11-11 — قرار المالك: إصدار البطاقات حصرياً للمدير العام
--  ---------------------------------------------------------------------------
--  الواجهة تمنع الموظف من الإصدار:
--    • newCardModal / newBatchModal  → isAdmin()
--    • createCardBatch / createCardWithSerial → isAdmin()
--    • issue_numbered_cards (RPC)    → isAdmin() داخلياً
--
--  لكن السياسة كانت applicants_staff_insert using is_staff() — تسمح
--  للموظف بالإدراج المباشر (= إصدار بطاقة فارغة) من عميل PostgREST.
--  أثبتُّه عملياً: موظف (is_admin=false) أدرج صفاً في brc.applicants.
--
--  صار: applicants_admin_insert using brc.is_admin()
--
--  ما يبقى للموظف: SELECT · UPDATE (اعتماد/رفض/رسوم/طباعة) · DELETE.
--  ما يبقى للزائر: request_form (RPC) فقط — لا إدراج مباشر.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists applicants_staff_insert on brc.applicants;
drop policy if exists applicants_admin_insert on brc.applicants;

create policy applicants_admin_insert on brc.applicants
  for insert with check (brc.is_admin());

comment on policy applicants_admin_insert on brc.applicants is
  'إصدار البطاقات (إدراج استمارة) حصرياً للمدير العام — قرار المالك 2026-11-11. طلب الزائر يمرّ عبر RPC request_form لا من هنا.';
