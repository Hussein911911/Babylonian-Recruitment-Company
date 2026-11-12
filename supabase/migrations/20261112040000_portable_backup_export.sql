-- ═══════════════════════════════════════════════════════════════════════════
--  2026-11-12 — نسخة محمولة تنزل للجهاز ويُسترجع منها بلا القاعدة
--  ---------------------------------------------------------------------------
--  طلب المالك: «اريد نسخة تنزل للجهاز نختارلها مسار... نكدر نسترجعها مستقلة».
--
--  المشكلة في النظام القائم: brc.recovery_copies تُشفَّر بـ
--  pgp_sym_encrypt بمفتاح مخزّن في brc.recovery_control داخل **نفس القاعدة**.
--  لو ضاعت القاعدة أو المشروع، ضاع المفتاح وضاعت كل النسخ معه. النسخ
--  الحالية لا تحمي من السيناريو الذي وُجدت لأجله.
--
--  الحل: دالة تصدير تُرجع البيانات **خاماً** (JSONB) إلى المدير فقط. المتصفح
--  هو من يشفّرها بـ AES-256-GCM بمفتاح مُشتق من كلمة مرور يختارها المالك
--  (PBKDF2-SHA256، ٣١٠٠٠٠ دورة) — والمفتاح لا يُرسَل إلى القاعدة أبداً.
--
--  ماذا تشمل: applicants · jobs · job_attempts · settings(rules) ·
--  employer_job_credentials · audit_log · issued_serials · staff (بلا
--  auth_id/بصمات كلمات المرور).
--
--  ⛔ حارس: is_admin() — الواجهة تُظهر الزر للمدير فقط، وهذه الطبقة تفرضه.
--  ⛔ search_path مثبّت (نمط المتحقق في بقية الدوال).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function brc.recovery_export_full()
returns jsonb
language plpgsql
security definer
set search_path to 'brc', 'public'
as $function$
declare
  actor uuid := auth.uid();
  payload jsonb;
begin
  if not brc.is_admin() then
    raise exception 'تصدير النسخة الكاملة صلاحية المدير العام فقط';
  end if;

  payload := jsonb_build_object(
    'format', 1,
    'schema', brc.recovery_schema_hash(),
    'exportedAt', clock_timestamp(),
    'counts', jsonb_build_object(
      'jobs', (select count(*) from brc.jobs),
      'applicants', (select count(*) from brc.applicants),
      'attempts', (select count(*) from brc.job_attempts),
      'audit', (select count(*) from brc.audit_log),
      'serials', (select count(*) from brc.issued_serials)
    ),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.id) from brc.jobs j), '[]'::jsonb),
    'applicants', coalesce((select jsonb_agg(to_jsonb(a) order by a.serial) from brc.applicants a), '[]'::jsonb),
    'job_attempts', coalesce((select jsonb_agg(to_jsonb(t) order by t.serial, t.attempt_no) from brc.job_attempts t), '[]'::jsonb),
    'settings', coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from brc.settings s), '[]'::jsonb),
    'employer_job_credentials', coalesce((select jsonb_agg(to_jsonb(c) order by c.job_id) from brc.employer_job_credentials c), '[]'::jsonb),
    'issued_serials', coalesce((select jsonb_agg(to_jsonb(i) order by i.serial) from brc.issued_serials i), '[]'::jsonb),
    'audit_log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from brc.audit_log l), '[]'::jsonb),
    /* الحسابات بلا أسرار الدخول: auth_id يربط بـ auth.users (لا نُصدّره)،
       ولا كلمات مرور في brc.staff أصلاً (Supabase Auth يخزّنها في auth). */
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
         'تصدير كل البيانات التشغيلية وسجل التدقيق — ' ||
         (payload->'counts'->>'applicants') || ' بطاقة و' ||
         (payload->'counts'->>'audit') || ' سجل تدقيق'
    from brc.staff s where s.auth_id = actor;

  return payload;
end
$function$;

comment on function brc.recovery_export_full() is
  'تصدير كل البيانات JSONB للمدير ليُشفّرها المتصفح بكلمة مرور المالك. المفتاح لا يمرّ بالقاعدة — النسخة قابلة للاسترجاع بعد فقدان المشروع.';

-- ⛔ لا يُمنح لـ anon ولا لـ authenticated عامةً؛ الحارس داخل الدالة إضافةً.
revoke all on function brc.recovery_export_full() from public;
revoke all on function brc.recovery_export_full() from anon;
grant execute on function brc.recovery_export_full() to authenticated;
