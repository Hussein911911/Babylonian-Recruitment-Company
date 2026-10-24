-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — ضمان وجود نسخة قابلة للاسترجاع دائماً + وضوح حالتها في اللوحة
--  ---------------------------------------------------------------------------
--  المشكلة التي ظهرت فعلاً: نسخة الاسترجاع تحمل «بصمة شكل المخطط»
--  (recovery_schema_hash: أعمدة applicants · jobs · job_attempts · settings ·
--  employer_job_credentials). أي هجرة تضيف/تحذف عموداً في أحدها تجعل كل نسخة
--  أقدم **غير قابلة للاسترجاع** (recovery_read يرفضها قبل أي كتابة، فلا خطر
--  على البيانات — لكن المستخدم يبقى بلا نسخة صالحة حتى الجمعة القادمة، لأن
--  recovery_weekly يحتفظ بنسخة واحدة فقط ويحذف ما عداها).
--
--  الحل هنا من شقّين:
--    1) الدالة recovery_ensure_fresh(): إن لم توجد نسخة ببصمة المخطط الحالية
--       تُنشئ واحدة فوراً. تُشغَّل يومياً عبر pg_cron، فالفجوة القصوى يوم واحد
--       بدل أسبوع.
--    2) action='list' في recovery_manage صار يُرجع 'restorable' لكل نسخة حتى
--       تُظهر اللوحة «غير قابلة للاسترجاع — شكل قاعدة أقدم» بدل أن يكتشفها
--       المدير عند الضغط فقط.
--
--  آمن للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) نسخة تلقائية عند تغيّر شكل المخطط
create or replace function brc.recovery_ensure_fresh() returns uuid
language plpgsql security definer set search_path=brc,public as $$
declare last_name text; result uuid;
begin
  -- نسخة صالحة موجودة بالفعل: لا نفعل شيئاً (لا نستهلك قرصاً بلا داعٍ)
  if exists (select 1 from brc.recovery_copies where schema_hash = brc.recovery_schema_hash()) then
    return null;
  end if;
  last_name := 'نسخة تلقائية — تغيّر شكل قاعدة البيانات ' ||
    to_char(clock_timestamp() at time zone 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI');
  result := brc.recovery_save(last_name, false);
  insert into brc.audit_log(username, role, action, entity, entity_id, details)
  values ('system', 'system', 'نسخة أمان تلقائية', 'recovery', result::text,
          'شكل قاعدة البيانات تغيّر (هجرة أعمدة) ولم تبقَ نسخة صالحة — أُنشئت نسخة جديدة تلقائياً.');
  return result;
end $$;
revoke all on function brc.recovery_ensure_fresh() from public, anon, authenticated;

-- 2) مهمة يومية (04:10 بتوقيت بغداد) — تُشغَّل بعد مهمة الأرشيف
do $$
begin
  if exists (select 1 from cron.job where command ilike '%recovery_ensure_fresh%') then
    return;
  end if;
  perform cron.schedule('recovery-ensure-fresh', '10 1 * * *', 'select brc.recovery_ensure_fresh();');
end $$;

-- 3) action='list' يُرجع حالة كل نسخة (قابلة للاسترجاع أو لا)
do $$
declare src text; fixed text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'brc' and p.proname = 'recovery_manage';
  if src is null or src like '%''restorable''%' then
    return;   -- غير موجودة أو مُرقَّعة سابقاً
  end if;
  fixed := replace(src, '''counts'',counts)', '''counts'',counts,''restorable'',(schema_hash=brc.recovery_schema_hash()))');
  if fixed = src then
    raise exception 'تعذّر ترقيع قائمة النسخ — تغيّر نص الدالة';
  end if;
  execute fixed;
end $$;

notify pgrst, 'reload schema';
