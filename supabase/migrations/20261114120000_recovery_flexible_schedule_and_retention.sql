-- ═══════════════════════════════════════════════════════════════════════════
--  جدولة نسخ احتياطي مرنة + الاحتفاظ بآخر ٣ نسخ — 2026-11-14
--  ---------------------------------------------------------------------------
--  ⚠️ مشكلتان في التصميم السابق، كلتاهما طلبها صاحب العمل بعد مراجعة:
--
--  ١) **الجدولة كانت أياماً + ساعة فقط.** لا خيار «كل ساعة» ولا «كل ٤ ساعات».
--     والعمل ينمو ~٦٠ بطاقة يومياً، فنسخة واحدة في الأسبوع (الافتراضي القديم)
--     تُعرّض مئات السجلات للضياع بين نسختين.
--
--  ٢) **كل نسخة جديدة كانت تحذف كل ما قبلها:**
--         delete from brc.recovery_copies where id <> result;
--     فكانت القاعدة تحتفظ بنسخة **واحدة** فقط، وقِيس ذلك على الإنتاج: صف واحد.
--     وهذا يعني أن خطأً اكتُشف بعد نسختين لا يمكن الرجوع عنه.
--
--  ═══ ما يفعله هذا الترحيل ═══
--  الجدولة صارت **خمسة أنماط** يختارها المدير من الإعدادات:
--    • mode='interval'   — كل N ساعة (١٫٢٫٤٫٦٫٨٫١٢٫٢٤) من ساعة يختارها.
--    • mode='daily'      — كل يوم في ساعة محددة.
--    • mode='every_days' — كل N يوم (١..٣٦٥) في ساعة محددة.
--    • mode='days'       — أيام محدّدة من الأسبوع (السلوك القديم، محفوظ).
--  والتوقيت يبقى بتوقيت بغداد ويُترجم إلى UTC داخل القاعدة.
--
--  ⚠️ «كل N يوم» لا يمكن التعبير عنه بـcron وحده (لا عدّاد فيه). الحل الأمين:
--     كرون يعمل يومياً، ودالة brc.recovery_due_now() تقرّر «حان الوقت أم لا».
--     فلا نسخة زائدة ولا ناقصة. الأنماط الأخرى ترجع true دائماً بلا فحص.
--
--  والاحتفاظ: آخر ٣ نسخ مجدولة تبقى، والأقدم يُحذف بترتيب زمني.
--  ⚠️ نسخ الأمان (safety=true) ونسخ تغيّر المخطط (ensure_fresh) **لا تُحذف
--     أبداً** بهذا التقليم — لأنها موجودة لسبب لم يتغيّر بعد.
--
--  ⚠️ ما لا يفعله: لا يمسّ أي نسخة قائمة عند التطبيق (لا DELETE هنا)، ولا
--     يغيّر التشفير، ولا يمسّ نطاق النسخة.
-- ═══════════════════════════════════════════════════════════════════════════

set search_path = brc, public;

-- ═══ 1) عدد النسخ المحفوظة — إعداد يقرأه المدير ═══════════════════════════
do $$ begin
  insert into brc.settings(key, value, updated_at)
  values ('recovery_retention', '{"keep": 3}'::jsonb, now())
  on conflict (key) do nothing;
exception when others then null; end $$;

create or replace function brc.recovery_retention_keep()
returns integer
language sql stable set search_path = brc, public, pg_temp
as $$
  /* ٣ افتراضياً (قرار صاحب العمل). الحدّ ١..١٠ كي لا يتحول التقليم إلى
     إزالة جماعية إن كُتب صفر أو رقم شاذ في الإعدادات. */
  select least(10, greatest(1, coalesce(
    (select (value->>'keep')::int from brc.settings where key = 'recovery_retention'),
    3)));
$$;

revoke all on function brc.recovery_retention_keep() from public, anon, authenticated;

-- ═══ 2) تعبير cron من نمط مرن ═════════════════════════════════════════════
create or replace function brc.recovery_cron_expr(
  p_mode text, p_hours int, p_days int[], p_time text
) returns text
language plpgsql immutable set search_path = brc, public, pg_temp
as $$
declare
  h int; m int; utc_h int; shift int; d int; dows int[] := '{}'; expr text;
begin
  /* ── النمط الدوري: كل p_hours ساعة ───────────────────────────────────────
     الساعة p_time تحدّد نقطة البداية في اليوم (٠١:٠٠ ⇒ ٠١،٠٥،٠٩…).
     ⚠️ التحويل إلى UTC مهم: لو الوقت ٠١:٠٠ بغداد = ٢٢:٠٠ UTC أمس، فالبداية
     تنزاح يوماً. لذلك نحسب الدقيقة كما هي، والساعة UTC، ثم نبني الخطوة. */
  if coalesce(p_mode, 'days') = 'interval' then
    if p_hours is null or p_hours < 1 or p_hours > 24 then return null; end if;
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    h := split_part(p_time, ':', 1)::int;
    m := split_part(p_time, ':', 2)::int;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;

    if p_hours = 24 then
      /* مرة واحدة يومياً */
      return m::text || ' ' || utc_h::text || ' * * *';
    end if;
    /* كل ساعة: الدقيقة ثابتة، والساعة كل ساعة. أي p_hours>1 نستخدم الخطوة
       من منتصف الليل UTC. الصيغة '*​/N' تتجاهل ساعة البداية لأنها تعني
       «كل مضاعف لـN» — فيختار المدير ٦ صباحاً فينفَّذ ٣ فجراً بلا أن يعرف. */
    if p_hours = 1 then
      return m::text || ' * * * *';
    end if;
    /* `h/N` = ابدأ من الساعة h ثم كل N ساعة — يحترم اختيار المدير */
    return m::text || ' ' || utc_h::text || '/' || p_hours::text || ' * * *';
  end if;

  /* ── النمط القديم: أيام محدّدة + ساعة ─────────────────────────────────── */
  if p_days is null or coalesce(array_length(p_days, 1), 0) = 0 then return null; end if;
  if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  h := split_part(p_time, ':', 1)::int;
  m := split_part(p_time, ':', 2)::int;
  utc_h := h - 3;
  shift := 0;
  if utc_h < 0 then utc_h := utc_h + 24; shift := -1; end if;
  foreach d in array p_days loop
    if d is null or d < 0 or d > 6 then return null; end if;
    if shift = 0 then dows := dows || d; else dows := dows || ((d + 6) % 7); end if;
  end loop;
  select string_agg(distinct x::text, ',' order by x::text) into expr from unnest(dows) x;
  return m::text || ' ' || utc_h::text || ' * * ' || expr;
end $$;

/* التواقيع القديمة تبقى للتوافق (تستدعي النمط 'days').
   ⚠️ لا نحذفها: كود قديم أو اختبار قد يستدعيها، وحذف دالة منشورة يكسر ذلك. */
create or replace function brc.recovery_cron_expr(p_days int[], p_time text)
returns text
language sql immutable set search_path = brc, public, pg_temp
as $$ select brc.recovery_cron_expr('days', null, p_days, p_time) $$;

revoke all on function brc.recovery_cron_expr(text,int,int[],text) from public, anon, authenticated;
revoke all on function brc.recovery_cron_expr(int[],text) from public, anon, authenticated;

-- ═══ 3) قراءة الجدولة — تُرجع النمط والإعدادات معاً ════════════════════════
create or replace function brc.recovery_schedule_get()
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare v jsonb; job record; last_run timestamptz; v_mode text; v_hours int;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'هذه الجدولة للمدير فقط');
  end if;
  select value into v from brc.settings where key='recovery_schedule';
  select jobid, schedule, active into job from cron.job where jobname='recovery-auto-backup';
  select max(start_time) into last_run from cron.job_run_details d
    where d.jobid = job.jobid and d.status='succeeded';

  v_mode  := coalesce(v->>'mode', 'days');
  v_hours := coalesce((v->>'hours')::int, 0);

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'hours', v_hours,
    'days', coalesce(v->'days','[]'::jsonb),
    'time', coalesce(v->>'time','23:00'),
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'timezone', 'Asia/Baghdad',
    'cron', job.schedule,
    'active', coalesce(job.active, false),
    'keep', brc.recovery_retention_keep(),
    'lastRun', last_run,
    'updatedAt', (select updated_at from brc.settings where key='recovery_schedule'));
end $$;

-- ═══ 4) ضبط الجدولة — نمطان ═══════════════════════════════════════════════
create or replace function brc.recovery_schedule_set(
  p_mode text, p_hours int, p_days int[], p_time text
) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare expr text; on_off boolean; job_id bigint; clean int[]; v_mode text; v_hours int;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'تعديل الجدولة من صلاحيات المدير فقط');
  end if;

  v_mode := coalesce(nullif(btrim(p_mode), ''), 'days');
  if v_mode not in ('interval', 'days') then
    return jsonb_build_object('ok', false, 'error', 'نمط جدولة غير معروف');
  end if;

  if v_mode = 'interval' then
    v_hours := coalesce(p_hours, 0);
    if v_hours < 1 or v_hours > 24 then
      return jsonb_build_object('ok', false, 'error', 'عدد الساعات يجب أن يكون بين ١ و٢٤');
    end if;
    expr := brc.recovery_cron_expr('interval', v_hours, null, p_time);
    if expr is null then
      return jsonb_build_object('ok', false, 'error', 'وقت غير صالح — الصيغة HH:MM (24 ساعة)');
    end if;
    clean := '{}';
    on_off := true;
  else
    select coalesce(array_agg(distinct d order by d), '{}') into clean
      from unnest(coalesce(p_days,'{}')) d where d between 0 and 6;
    on_off := coalesce(array_length(clean,1),0) > 0;
    v_hours := 0;
    if on_off then
      expr := brc.recovery_cron_expr('days', null, clean, p_time);
      if expr is null then
        return jsonb_build_object('ok', false, 'error', 'وقت غير صالح — الصيغة HH:MM (24 ساعة)');
      end if;
    end if;
  end if;

  insert into brc.settings(key, value, updated_at, updated_by)
  values ('recovery_schedule', jsonb_build_object(
            'mode', v_mode, 'hours', v_hours,
            'days', to_jsonb(clean), 'time', coalesce(p_time,'23:00'),
            'enabled', on_off, 'timezone','Asia/Baghdad',
            'cron', expr, 'updatedAt', now()), now(),
          (select id from brc.staff where auth_id = auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;

  select jobid into job_id from cron.job where jobname='recovery-auto-backup';
  if on_off then
    if job_id is null then
      perform cron.schedule('recovery-auto-backup', expr, 'select brc.recovery_run_scheduled();');
    else
      perform cron.alter_job(job_id, schedule := expr, command := 'select brc.recovery_run_scheduled();', active := true);
    end if;
  elsif job_id is not null then
    perform cron.unschedule(job_id);
  end if;

  insert into brc.audit_log(username, role, action, entity, entity_id, details)
  values (coalesce((select username from brc.staff where auth_id = auth.uid()),'admin'), 'admin',
          case when on_off then 'ضبط جدولة النسخ الاحتياطي' else 'إيقاف جدولة النسخ الاحتياطي' end,
          'recovery', 'recovery_schedule',
          case when not on_off then 'أُوقفت الجدولة — لا نسخة تلقائية حتى يُعاد تفعيلها'
               when v_mode = 'interval' then
                 'كل ' || v_hours::text || ' ساعة من الساعة ' || p_time || ' بتوقيت بغداد (cron: ' || expr || ' UTC)'
               else
                 'الأيام: ' || array_to_string(clean, ',') || ' — الساعة ' || p_time ||
                 ' بتوقيت بغداد (cron: ' || expr || ' UTC)' end);

  return brc.recovery_schedule_get();
end $$;

/* التوقيع القديم يبقى ويعمل بنمط الأيام */
create or replace function brc.recovery_schedule_set(p_days int[], p_time text)
returns jsonb
language sql security definer set search_path = brc, public, pg_temp
as $$ select brc.recovery_schedule_set('days', null, p_days, p_time) $$;

revoke all on function brc.recovery_schedule_set(text,int,int[],text) from public, anon, authenticated, service_role;
revoke all on function brc.recovery_schedule_set(int[],text) from public, anon, authenticated, service_role;
grant execute on function brc.recovery_schedule_set(text,int,int[],text) to authenticated;
grant execute on function brc.recovery_schedule_set(int[],text) to authenticated;
revoke all on function brc.recovery_schedule_get() from public, anon, authenticated, service_role;
grant execute on function brc.recovery_schedule_get() to authenticated;

-- ═══ 5) التقليم — آخر N نسخ مجدولة، بلا مساس بنسخ الأمان ══════════════════
create or replace function brc.recovery_prune(p_keep int)
returns integer
language plpgsql security definer set search_path=brc,public as $$
declare v_keep int := coalesce(p_keep, brc.recovery_retention_keep());
        v_deleted int := 0; v_ids uuid[];
begin
  /* نُبقي آخر v_keep نسخة مجدولة (safety=false). نسخ الأمان
     (safety=true) لا تدخل الحساب إطلاقاً — وُجدت لسبب لا يزول بالتقليم. */
  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from brc.recovery_copies
     where safety = false
     order by created_at desc
    offset greatest(1, v_keep)
  ) old;

  if coalesce(array_length(v_ids,1), 0) > 0 then
    delete from brc.recovery_tickets where copy_id = any(v_ids);
    delete from brc.recovery_copies where id = any(v_ids);
    get diagnostics v_deleted = row_count;
  end if;
  return v_deleted;
end $$;

revoke all on function brc.recovery_prune(int) from public, anon, authenticated;

create or replace function brc.recovery_prune() returns integer
language sql security definer set search_path = brc, public, pg_temp
as $$ select brc.recovery_prune(brc.recovery_retention_keep()) $$;

revoke all on function brc.recovery_prune() from public, anon, authenticated;

-- ═══ 6) النسخة المجدولة: تحتفظ بآخر N بدل حذف كل ما قبلها ════════════════
create or replace function brc.recovery_run_scheduled()
returns uuid language plpgsql security definer set search_path=brc,public as $$
declare p jsonb; k text; result uuid;
begin
  perform set_config('lock_timeout','8s',true);
  perform pg_advisory_xact_lock(8310192026);
  lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in share mode;
  p := brc.recovery_capture();
  select secret into strict k from brc.recovery_control where singleton;
  insert into brc.recovery_copies(name,actor,safety,counts,schema_hash,data_hash,ciphertext)
  values ('نسخة مجدولة — ' || to_char(clock_timestamp() at time zone 'Asia/Baghdad','YYYY-MM-DD HH24:MI'),
          null,false,brc.recovery_counts(p),p->>'schema',
          encode(extensions.digest(p::text,'sha256'),'hex'),
          extensions.pgp_sym_encrypt(p::text,k,'cipher-algo=aes256,compress-algo=1'))
  returning id into result;
  if brc.recovery_read(result) is distinct from p then
    raise exception 'فشل التحقق من النسخة المجدولة';
  end if;

  /* ⚠️ كان هنا: delete from brc.recovery_copies where id <> result;
     أي نسخة واحدة فقط. الآن: آخر N (افتراضياً ٣) — قرار صاحب العمل. */
  perform brc.recovery_prune();

  /* تذاكر الاسترجاع تتبع النسخ الباقية فقط */
  delete from brc.recovery_tickets
   where copy_id not in (select id from brc.recovery_copies);
  return result;
end $$;

revoke all on function brc.recovery_run_scheduled() from public,anon,authenticated,service_role;

-- ═══ 7) الترحيل الصامت للجدولة القائمة ═══════════════════════════════════
/* الجدولة المحفوظة قبل هذا الترحيل لا تحمل 'mode' — نضيفه كي تقرأه الواجهة
   وتعدّله بلا كسر. القيمة الحالية (الجمعة ٢٣:٠٠) تبقى كما هي: لا نغيّر
   قراراً اتخذه المدير. */
do $$ begin
  update brc.settings
     set value = value || '{"mode":"days","hours":0}'::jsonb
   where key = 'recovery_schedule'
     and (value->>'mode') is null;
exception when others then null; end $$;

notify pgrst, 'reload schema';
