-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — جدولة النسخ الاحتياطي يحددها المدير من الإعدادات
--  ---------------------------------------------------------------------------
--  قبل هذا الملف كانت النسخة التلقائية موعدها ثابتاً في pg_cron
--  (كل جمعة 20:00 UTC = 23:00 بغداد) ولا يستطيع المدير تغييرها.
--
--  الآن: brc.recovery_schedule_get() يقرأ الجدولة، و
--        brc.recovery_schedule_set(p_days, p_time) يحفظها ويُعيد ضبط مهمة cron.
--
--  • الأيام: مصفوفة 0..6 بنفس اصطلاح المتصفح (0 = الأحد … 6 = السبت).
--  • الوقت: 'HH:MM' بتوقيت بغداد (UTC+3 بلا توقيت صيفي في العراق).
--  • الحفظ في brc.settings بالمفتاح 'recovery_schedule' (مرئي للوحة).
--  • إعادة الجدولة فورية عند الحفظ، ولا تُنشأ نسخة الآن.
--  • الوظيفة للمدير فقط (brc.is_admin) وتُسجَّل في سجل التدقيق.
--  • إيقاف الجدولة: p_days فارغة ⇒ تُزال مهمة cron ويبقى آخر إعداد محفوظاً.
--
--  نسخة الأمان التلقائية عند تغيّر شكل المخطط (recovery_ensure_fresh) تبقى
--  مهمة داخلية منفصلة: لا تُنشئ نسخة إلا إذا لم تبقَ أي نسخة صالحة.
--
--  آمن للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

/* ── الترجمة من بغداد (UTC+3) إلى تعبير cron بـUTC ──
   لو الوقت المحلي قبل 03:00 فالساعة UTC تقع في اليوم السابق.
   تُرجع null إذا لم تصلح الأيام أو الوقت. */
create or replace function brc.recovery_cron_expr(p_days int[], p_time text)
returns text language plpgsql immutable set search_path=brc,public as $$
declare h int; m int; utc_h int; shift int; d int; dows int[] := '{}'; expr text;
begin
  if p_days is null or coalesce(array_length(p_days,1),0)=0 then return null; end if;
  if coalesce(p_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  h := split_part(p_time,':',1)::int;
  m := split_part(p_time,':',2)::int;
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
revoke all on function brc.recovery_cron_expr(int[], text) from public, anon, authenticated;

/* ── قراءة الجدولة الحالية (المدير وحده) ── */
create or replace function brc.recovery_schedule_get()
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare v jsonb; job record; next_run timestamptz;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'هذه الجدولة للمدير فقط');
  end if;
  select value into v from brc.settings where key='recovery_schedule';
  select jobid, schedule, active into job from cron.job where jobname='recovery-auto-backup';
  select max(start_time) into next_run from cron.job_run_details d where d.jobid = job.jobid and d.status='succeeded';
  return jsonb_build_object(
    'ok', true,
    'days', coalesce(v->'days','[]'::jsonb),
    'time', coalesce(v->>'time','23:00'),
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'timezone', 'Asia/Baghdad',
    'cron', job.schedule,
    'active', coalesce(job.active, false),
    'lastRun', next_run,
    'updatedAt', (select updated_at from brc.settings where key='recovery_schedule'));
end $$;
revoke all on function brc.recovery_schedule_get() from public, anon, authenticated;
grant execute on function brc.recovery_schedule_get() to authenticated;

/* ── حفظ الجدولة وإعادة ضبط المهمة ── */
create or replace function brc.recovery_schedule_set(p_days int[], p_time text)
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare expr text; on_off boolean; job_id bigint; clean int[];
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'تعديل الجدولة من صلاحيات المدير فقط');
  end if;
  /* تنقية: بلا تكرار وبلا قيم خارج 0..6 */
  select coalesce(array_agg(distinct d order by d), '{}') into clean
    from unnest(coalesce(p_days,'{}')) d where d between 0 and 6;
  on_off := coalesce(array_length(clean,1),0) > 0;
  if on_off then
    expr := brc.recovery_cron_expr(clean, p_time);
    if expr is null then
      return jsonb_build_object('ok', false, 'error', 'وقت غير صالح — الصيغة HH:MM (24 ساعة)');
    end if;
  end if;

  insert into brc.settings(key, value, updated_at, updated_by)
  values ('recovery_schedule', jsonb_build_object(
            'days', to_jsonb(clean), 'time', coalesce(p_time,'23:00'),
            'enabled', on_off, 'timezone','Asia/Baghdad',
            'cron', expr, 'updatedAt', now()), now(), (select id from brc.staff where auth_id = auth.uid()))
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
          case when on_off then 'الأيام: ' || array_to_string(clean, ',') || ' — الساعة ' || p_time ||
            ' بتوقيت بغداد (cron: ' || expr || ' UTC)'
          else 'أُوقفت الجدولة — لا نسخة تلقائية حتى يُعاد تفعيلها' end);

  return brc.recovery_schedule_get();
end $$;
revoke all on function brc.recovery_schedule_set(int[], text) from public, anon, authenticated;
grant execute on function brc.recovery_schedule_set(int[], text) to authenticated;

/* ── ما تناديه مهمة cron: نسخة كاملة واحدة بنفس ضمانات recovery_weekly
      (نسخة + فك تشفيرها والتحقق منها **قبل** حذف أي نسخة أقدم). ── */
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
  -- التحقق قبل الحذف: نسخة تالفة لا تُعتمد أبداً
  if brc.recovery_read(result) is distinct from p then
    raise exception 'فشل التحقق من النسخة المجدولة';
  end if;
  delete from brc.recovery_tickets where copy_id<>result;
  delete from brc.recovery_copies where id<>result;
  return result;
end $$;
revoke all on function brc.recovery_run_scheduled() from public, anon, authenticated;

/* ── تحويل المهمة الثابتة القديمة إلى المهمة القابلة للضبط ──
   الإعداد الافتراضي هو نفسه ما كان: الجمعة 23:00 بغداد (0 = الأحد … 5 = الجمعة). */
do $$
declare old_id bigint; new_id bigint; v jsonb;
begin
  select jobid into old_id from cron.job where jobname='hrc-weekly-recovery';
  if old_id is not null then perform cron.unschedule(old_id); end if;

  select value into v from brc.settings where key='recovery_schedule';
  if v is null then
    insert into brc.settings(key, value, updated_at)
    values ('recovery_schedule', jsonb_build_object(
      'days', to_jsonb(array[5]), 'time', '23:00', 'enabled', true,
      'timezone','Asia/Baghdad', 'cron','0 20 * * 5', 'updatedAt', now()), now())
    on conflict (key) do nothing;
    v := (select value from brc.settings where key='recovery_schedule');
  end if;

  if coalesce((v->>'enabled')::boolean, true) then
    select jobid into new_id from cron.job where jobname='recovery-auto-backup';
    if new_id is null then
      perform cron.schedule('recovery-auto-backup',
        coalesce(v->>'cron','0 20 * * 5'), 'select brc.recovery_run_scheduled();');
    else
      perform cron.alter_job(new_id, schedule := coalesce(v->>'cron','0 20 * * 5'),
        command := 'select brc.recovery_run_scheduled();', active := true);
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
