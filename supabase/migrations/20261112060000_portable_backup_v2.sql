-- ═══════════════════════════════════════════════════════════════════════════
--  2026-11-12 (ب) — تصدير محمول بحجم معقول (إصدار 2)
--  ---------------------------------------------------------------------------
--  السبب: تجربة المالك على الهاتف أعطت
--      «canceling statement due to statement timeout»
--
--  التشخيص على القاعدة الحقيقية:
--      recovery_export_full()  →  25 م.ب في 9.1 ثانية   (القاعدة سريعة)
--      audit_log               →  3,482 سجلاً · 22 م.ب
--      منها 38 سجلاً تحمل base64  →  20 م.ب من الـ22
--      jobs.image_url          →  4 وظائف تحمل data:image/... (أقصاها 542 ك.ب)
--
--  أي أن 80% من حجم النسخة = صور وظائف مكرّرة داخل سجل التدقيق، لأن كل
--  تعديل على الوظيفة ينسخ صفّها كاملاً (والصورة جزء منه) إلى diff.
--
--  الحل: تخطّي حقل diff وحده من سجلات التدقيق التي تحمل صوراً مضمّنة.
--      • كل سجل تدقيق يبقى (الاسم، الوقت، الإجراء، الكيان، التفاصيل).
--      • يُفقد حقل واحد في 38 سجلاً فقط — وهو صورة مكرّرة موجودة في jobs.
--      • الحجم بعد التصدير: ~5 م.ب بدل 25.
--
--  ⛔ حارس: is_admin() · search_path مثبّت.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function brc.recovery_export_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'brc', 'public'
as $function$
declare
  actor uuid := auth.uid();
  payload jsonb;
  trimmed int;
begin
  if not brc.is_admin() then
    raise exception 'تصدير النسخة الكاملة صلاحية المدير العام فقط';
  end if;

  select count(*) into trimmed
    from brc.audit_log
   where diff is not null and pg_column_size(diff) > 16384;

  payload := jsonb_build_object(
    'format', 2,
    'schema', brc.recovery_schema_hash(),
    'exportedAt', clock_timestamp(),
    'counts', jsonb_build_object(
      'jobs', (select count(*) from brc.jobs),
      'applicants', (select count(*) from brc.applicants),
      'attempts', (select count(*) from brc.job_attempts),
      'audit', (select count(*) from brc.audit_log),
      'serials', (select count(*) from brc.issued_serials),
      'diffTrimmed', trimmed
    ),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.id) from brc.jobs j), '[]'::jsonb),
    'applicants', coalesce((select jsonb_agg(to_jsonb(a) order by a.serial) from brc.applicants a), '[]'::jsonb),
    'job_attempts', coalesce((select jsonb_agg(to_jsonb(t) order by t.serial, t.attempt_no) from brc.job_attempts t), '[]'::jsonb),
    'settings', coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from brc.settings s), '[]'::jsonb),
    'employer_job_credentials', coalesce((select jsonb_agg(to_jsonb(c) order by c.job_id) from brc.employer_job_credentials c), '[]'::jsonb),
    'issued_serials', coalesce((select jsonb_agg(to_jsonb(i) order by i.serial) from brc.issued_serials i), '[]'::jsonb),
    /* ⚠ أرقام البطاقات: كانت تُسقط من النسخة. فالمشروع الجديد يبدأ العدّاد
       من صفر، وأول بطاقة جديدة تأخذ رقماً انطبع سابقاً على ورق فعلي —
       تكرار على وثيقة رسمية. نصدّر السجل والعدّاد معاً. */
    'card_number_registry', coalesce((select jsonb_agg(to_jsonb(r) order by r.card_number) from brc.card_number_registry r), '[]'::jsonb),
    'card_number_counter', coalesce((select jsonb_agg(to_jsonb(c)) from brc.card_number_counter c), '[]'::jsonb),
    'audit_log', coalesce((
      select jsonb_agg(
        case when l.diff is not null and pg_column_size(l.diff) > 16384
             then (to_jsonb(l) - 'diff') || jsonb_build_object('diffTrimmed', true)
             else to_jsonb(l)
        end order by l.id)
      from brc.audit_log l
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'username', s.username, 'full_name', s.full_name,
        'role', s.role, 'job_title', s.job_title, 'phone', s.phone,
        'active', s.active, 'created_at', s.created_at
      ) order by s.username)
      from brc.staff s
    ), '[]'::jsonb)
  );

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  select s.username, 'staff', 'تصدير نسخة كاملة للجهاز', 'backup', payload->>'schema',
         'تصدير تشغيلي + سجل تدقيق — ' ||
         (payload->'counts'->>'applicants') || ' بطاقة و' ||
         (payload->'counts'->>'audit') || ' سجل؛ استُبعد diff من ' ||
         trimmed || ' سجلاً لاحتوائه صوراً مضمّنة'
    from brc.staff s where s.auth_id = actor;

  return payload;
end
$function$;

comment on function brc.recovery_export_v2() is
  'تصدير محمول (إصدار 2): يحذف حقل diff فقط من سجلات التدقيق التي تحمل صوراً مضمّنة (>16KB). كل السجلات تبقى كاملة.';

revoke all on function brc.recovery_export_v2() from public;
revoke all on function brc.recovery_export_v2() from anon;
grant execute on function brc.recovery_export_v2() to authenticated;
