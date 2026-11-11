-- ═══════════════════════════════════════════════════════════════════════════
--  2026-11-11 — قرار المالك: حذف الوظيفة متاح للمدير **وللموظف**
--  ---------------------------------------------------------------------------
--  كان: jobs_admin_delete using brc.is_admin()  → الموظف يرى «تم الحذف»
--        في الواجهة بينما ترفض القاعدة بصمت.
--  صار: jobs_staff_delete  using brc.is_staff() → الدوران يحذفان، والقاعدة
--        توافق الواجهة بدل أن تخالفها.
--
--  ⚠️ الواجهة العامة تحمّل store.js، فالحماية الحقيقية هي هذه السياسة:
--     brc.is_staff() يقرأ الجلسة (auth.uid) — الزائر المجهول لا يملكها.
--
--  لا تُفعّل DELETE على anon في أي حال.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists jobs_admin_delete on brc.jobs;
drop policy if exists jobs_staff_delete on brc.jobs;

create policy jobs_staff_delete on brc.jobs
  for delete using (brc.is_staff());

comment on policy jobs_staff_delete on brc.jobs is
  'حذف الإعلانات: للموظف والمدير معاً (قرار المالك 2026-11-11). الزائر المجهول لا يملك جلسة موظف.';
