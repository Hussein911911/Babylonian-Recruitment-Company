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
  mode text := coalesce(nullif(btrim(p_mode), ''), 'days');
begin
  /* الدقائق تُؤخذ من الوقت المختار وتبقى ثابتة في كل الأنماط */
  h := split_part(coalesce(p_time, ''), ':', 1)::int;
  m := split_part(coalesce(p_time, ''), ':', 2)::int;

  /* ── النمط الدوري ─────────────────────────────────────────────────────── */
  if mode = 'interval' then
    if p_hours is null or p_hours < 1 or p_hours > 24 then return null; end if;
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    if p_hours = 24 then return m::text || ' ' || utc_h::text || ' * * *'; end if;
    if p_hours = 1  then return m::text || ' * * * *'; end if;
    /* `h/N` = ابدأ من الساعة h ثم كل N ساعة. الصيغة `*​/N` تتجاهل h —
       فيختار المدير ٦ صباحاً فينفَّذ ٣ فجراً بلا أن يعرف. */
    return m::text || ' ' || utc_h::text || '/' || p_hours::text || ' * * *';
  end if;

  /* ── كل يوم ───────────────────────────────────────────────────────────── */
  if mode = 'daily' then
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    return m::text || ' ' || utc_h::text || ' * * *';
  end if;

  /* ── كل N يوم ────────────────────────────────────────────────────────────
     كرون لا يستطيع التعبير عن «كل N يوم» بصدق (لا عدّاد فيه). نُشغّل الفحص
     يومياً، ودالة التنفيذ تسأل brc.recovery_due_now() هل مضى N يوم.
     الساعة هنا مهمة: هي لحظة الفحص اليومي. */
  if mode = 'every_days' then
    if p_hours is null or p_hours < 1 or p_hours > 365 then return null; end if;
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    return m::text || ' ' || utc_h::text || ' * * *';
  end if;

  /* ── الأيام المحددة من الأسبوع ──────────────────────────────────────────── */
  if p_days is null or coalesce(array_length(p_days,1),0) = 0 then return null; end if;
  if coalesce(p_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  utc_h := h - 3;
  shift := 0;
  if utc_h < 0 then utc_h := utc_h + 24; shift := -1; end if;
  foreach d in array p_days loop
    if d is null or d < 0 or d > 6 then return null; end if;
    /* إن نزح الوقت للخلف يوماً في UTC، ينزح اليوم كذلك */
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

-- ═══ 2ب) بوابة الاستحقاق — «كل N يوم» بصدق ════════════════════════════════
/* كرون لا يملك عدّاداً، فلا يعبّر عن «كل ٣ أيام». الحل: كرون يفحص يومياً،
   وهذه الدالة تقول «نعم» أو «لا». الحالة تُقرأ من الإعدادات لا من جدول
   النسخ — لأن نسخة أمان يدوية كانت ستؤجّل النمط بلا سبب. */
create or replace function brc.recovery_due_now()
returns boolean
language plpgsql stable security definer set search_path = brc, public, pg_temp
as $$
declare v jsonb; mode text; n int; last_at timestamptz;
begin
  select value into v from brc.settings where key = 'recovery_schedule';
  /* لا جدولة مضبوطة ⇒ لا قيد ⇒ لا نمنع شيئاً. (كان return false، وهو خطأ:
     يمنع كل نسخة إن غاب الإعداد — مثلاً بعد استرجاع قاعدة قديمة.) */
  if v is null then return true; end if;
  mode := coalesce(v->>'mode', 'days');
  if mode <> 'every_days' then return true; end if;
  n := coalesce((v->>'hours')::int, 0);
  if n < 1 then return false; end if;
  select (value #>> '{}')::timestamptz into last_at
    from brc.settings where key = 'recovery_last_scheduled_at';
  if last_at is null then return true; end if;
  return now() >= last_at + (n || ' days')::interval;
end $$;

revoke all on function brc.recovery_due_now() from public, anon, authenticated, service_role;

-- ═══ 3) قراءة الجدولة — تُرجع النمط والإعدادات معاً ════════════════════════
create or replace function brc.recovery_schedule_get()
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare v jsonb; job record; last_run timestamptz;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'هذه الجدولة للمدير فقط');
  end if;
  select value into v from brc.settings where key='recovery_schedule';
  select jobid, schedule, active into job from cron.job where jobname='recovery-auto-backup';
  select max(start_time) into last_run from cron.job_run_details d where d.jobid = job.jobid and d.status='succeeded';
  return jsonb_build_object(
    'ok', true,
    'mode', coalesce(v->>'mode','days'),
    'hours', coalesce((v->>'hours')::int, 0),
    'days', coalesce(v->'days','[]'::jsonb),
    'time', coalesce(v->>'time','23:00'),
    'keep', brc.recovery_retention_keep(),
    'dueNow', brc.recovery_due_now(),
    'lastScheduled', (select value #>> '{}' from brc.settings where key='recovery_last_scheduled_at'),
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'timezone', 'Asia/Baghdad',
    'cron', job.schedule,
    'active', coalesce(job.active, false),
    'lastRun', last_run,
    'updatedAt', (select updated_at from brc.settings where key='recovery_schedule'));
end $$;

-- ═══ 4) ضبط الجدولة — نمطان ═══════════════════════════════════════════════
create or replace function brc.recovery_schedule_set(
  p_mode text, p_hours int, p_days int[], p_time text
) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare
  expr text; on_off boolean := true; job_id bigint; clean int[] := '{}';
  v_mode text; v_hours int; v_time text;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'تعديل الجدولة من صلاحيات المدير فقط');
  end if;

  v_mode := coalesce(nullif(btrim(p_mode), ''), 'days');
  if v_mode not in ('interval', 'daily', 'every_days', 'days') then
    return jsonb_build_object('ok', false, 'error', 'نمط جدولة غير معروف');
  end if;
  v_time := coalesce(nullif(btrim(p_time), ''), '23:00');
  v_hours := coalesce(p_hours, 0);

  if v_mode = 'interval' then
    if v_hours < 1 or v_hours > 24 then
      return jsonb_build_object('ok', false, 'error', 'عدد الساعات يجب أن يكون بين ١ و٢٤');
    end if;

  elsif v_mode = 'every_days' then
    if v_hours < 1 or v_hours > 365 then
      return jsonb_build_object('ok', false, 'error', 'عدد الأيام يجب أن يكون بين ١ و٣٦٥');
    end if;

  elsif v_mode = 'daily' then
    v_hours := 1;

  else  -- 'days'
    select coalesce(array_agg(distinct d order by d), '{}') into clean
      from unnest(coalesce(p_days, '{}')) d where d between 0 and 6;
    on_off := coalesce(array_length(clean, 1), 0) > 0;
    v_hours := 0;
    /* لا أيام = إيقاف الجدولة، وهذا سلوك مقصود لا خطأ */
    if not on_off then
      delete from cron.job where jobname = 'recovery-auto-backup';
      insert into brc.settings(key, value, updated_at, updated_by)
      values ('recovery_schedule', jsonb_build_object(
                'mode','days','hours',0,'days','[]'::jsonb,'time',v_time,
                'enabled',false,'timezone','Asia/Baghdad','cron',null,'updatedAt',now()), now(),
              (select id from brc.staff where auth_id = auth.uid()))
      on conflict (key) do update set value = excluded.value, updated_at = now(),
        updated_by = excluded.updated_by;
      return brc.recovery_schedule_get();
    end if;
  end if;

  if v_mode <> 'days' then
    expr := brc.recovery_cron_expr(v_mode, v_hours, null, v_time);
  else
    expr := brc.recovery_cron_expr('days', null, clean, v_time);
  end if;
  if expr is null then
    return jsonb_build_object('ok', false, 'error', 'وقت غير صالح — الصيغة HH:MM (24 ساعة)');
  end if;

  insert into brc.settings(key, value, updated_at, updated_by)
  values ('recovery_schedule', jsonb_build_object(
            'mode', v_mode, 'hours', v_hours,
            'days', to_jsonb(clean), 'time', v_time,
            'enabled', true, 'timezone','Asia/Baghdad',
            'cron', expr, 'updatedAt', now()), now(),
          (select id from brc.staff where auth_id = auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;

  select jobid into job_id from cron.job where jobname='recovery-auto-backup';
  if job_id is null then
    perform cron.schedule('recovery-auto-backup', expr, 'select brc.recovery_run_scheduled();');
  else
    perform cron.alter_job(job_id, schedule := expr, command := 'select brc.recovery_run_scheduled();', active := true);
  end if;

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
returns integer language plpgsql security definer set search_path=brc,public as $$
declare v_keep int := coalesce(p_keep, brc.recovery_retention_keep());
        v_deleted int := 0; v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    /* الترتيب المزدوج ضروري: نسخ كثيرة قد تُنشأ في نفس الثانية، وcreated_at
       وحده لا يحدد الأقدم. id مُشتق من البيانات وقت الإدراج فيعطي ترتيباً
       ثابتاً، ومع ذلك نُبقي created_at أولاً كي يبقى المعنى الزمني. */
    select id from brc.recovery_copies where safety = false
     order by created_at desc, id desc offset greatest(1, v_keep)) old;
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
  /* بوابة الاستحقاق — للنمط «كل N يوم» فقط. غيره يرجع true دائماً.
     بدونها يعمل cron يومياً ويأخذ نسخة كل يوم مهما اختار المدير. */
  if not brc.recovery_due_now() then return null; end if;
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
  /* نسجّل وقت آخر نسخة مجدولة — تعتمد عليه recovery_due_now للنمط «كل N يوم».
     لا نقرأه من جدول النسخ لأن نسخة أمان يدوية قد تُربك الحساب. */
  insert into brc.settings(key, value, updated_at)
  values ('recovery_last_scheduled_at', to_jsonb(now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

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
