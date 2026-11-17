-- ===========================================================================
--  HRC — سدّ فرق الاسترجاع (2026-11-17)
--  ---------------------------------------------------------------------------
--  ⚠️ لماذا هذا الملف موجود؟
--
--  قِيس الفرق بين ما يبنيه `docs/schema.sql` وبين قاعدة الإنتاج الحيّة، فظهر
--  أن الاسترجاع من ملف الهيكل وحده يُنتج قاعدة **تعمل** لكنها **ليست مطابقة**:
--
--    جداول:     ٣ ناقصة   (card_lookup_budget + لقطتان تاريخيتان)
--    دوال:      ٩ ناقصة
--    مشغّلات:   ١ ناقص
--    فهارس:     ١ ناقص   (attempts_chance_code_uidx)
--
--  هذا الملف يسدّ **كل ما يؤثر في التشغيل**، ويترك ثلاثة أشياء موثّقة صراحة
--  في نهاية الملف لأنها ليست جزءاً من مسار العمل اليومي.
--
--  ⛔ لا يُطبَّق على الإنتاج: كل ما فيه موجود هناك أصلاً. غايته أن يُضاف إلى
--     ملف الاسترجاع (`HRC-FULL.sql`) كي تعمل القاعدة الجديدة عمل الإنتاج.
--     وكل عبارة هنا idempotent (`if not exists` / `create or replace`).
--
--  المصدر: `pg_get_functiondef` من القاعدة الحيّة نفسها — لا إعادة كتابة.
-- ===========================================================================

-- ===========================================================================
--  ١) جدول ميزانية عرض البطاقات — تعتمد عليه card_lookup_guard
-- ===========================================================================
create table if not exists brc.card_lookup_budget (
  budget_key   text primary key,
  window_start timestamptz not null default now(),
  used         integer not null default 0
);
alter table brc.card_lookup_budget enable row level security;
revoke all on brc.card_lookup_budget from public, anon, authenticated;

-- ===========================================================================
--  ٢) مصدر الطلب (بصمة IP) — يقرأ ترويسات PostgREST
-- ===========================================================================
create or replace function brc.card_request_source()
returns text language plpgsql stable
set search_path = brc, public, pg_temp
as $function$
declare h jsonb; raw text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then h := null;
  end;
  if h is null then return null; end if;
  raw := coalesce(
    nullif(btrim(split_part(coalesce(h->>'cf-connecting-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(h->>'x-real-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), '')
  );
  if raw is null then return null; end if;
  return 'src:' || md5(raw);
end $function$;

-- ===========================================================================
--  ٣) حراسة تعداد البطاقات (١٥ عرضاً/ساعة لكل بطاقة، ٤٠ بطاقة/ساعة لكل مصدر)
--     ⚠️ لا تُنادى من lookup_card بعد الآن (قرار 2026-11-13) لكنها موجودة
--     في الإنتاج وتُستعمل داخلياً.
-- ===========================================================================
create or replace function brc.card_lookup_guard(p_serial text, p_source text default null::text)
returns jsonb language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
declare
  v_card_key text;
  v_src_key  text;
  v_used     integer;
  v_src_used integer;
  v_serial   text := upper(btrim(coalesce(p_serial, '')));
  v_src      text := nullif(btrim(coalesce(p_source, brc.card_request_source(), '')), '');
  c_card     constant integer := 15;
  c_source   constant integer := 40;
begin
  if v_serial = '' then
    return jsonb_build_object('ok', false, 'error', 'أدخل رقم البطاقة');
  end if;

  v_card_key := 'card:' || md5(v_serial);
  insert into brc.card_lookup_budget (budget_key) values (v_card_key)
    on conflict (budget_key) do nothing;
  update brc.card_lookup_budget
     set window_start = case when window_start < now() - interval '1 hour' then now() else window_start end,
         used         = case when window_start < now() - interval '1 hour' then 1 else used + 1 end
   where budget_key = v_card_key
  returning used into v_used;

  if v_used > c_card then
    return jsonb_build_object('ok', false,
      'error', 'عُرضت هذه البطاقة مرات كثيرة خلال ساعة. انتظر قليلاً ثم أعد المحاولة.');
  end if;

  if v_src is not null then
    v_src_key := 'source:' || md5(v_src);
    insert into brc.card_lookup_budget (budget_key) values (v_src_key)
      on conflict (budget_key) do nothing;
    update brc.card_lookup_budget
       set window_start = case when window_start < now() - interval '1 hour' then now() else window_start end,
           used         = case when window_start < now() - interval '1 hour' then 1 else used + 1 end
     where budget_key = v_src_key
    returning used into v_src_used;

    if v_src_used > c_source then
      return jsonb_build_object('ok', false,
        'error', 'تم عرض بطاقات كثيرة من هذا الجهاز خلال ساعة. توقّف قليلاً — البطاقة تخصّك وحدك.');
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $function$;

-- ===========================================================================
--  ٤) نسختا العرض بلا حراسة — تستدعيهما الدوال المُحصّنة أعلاه/أدناه
-- ===========================================================================
create or replace function brc.lookup_card_unguarded(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  f record; v_ok boolean; v_stored text; v_code text;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

  v_stored := upper(btrim(coalesce(to_jsonb(f)->>'card_print_code', '')));
  v_code   := upper(btrim(coalesce(p_code, '')));

  if v_stored = '' then
    v_ok := true;
  else
    v_ok := (v_stored = v_code)
         or (replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));
  end if;

  return jsonb_build_object(
    'ok', true,
    'serial', f.serial,
    'status', f.status::text,
    'issueDate', f.issue_date,
    'expiryDate', f.expiry_date,
    'succeeded', f.status = 'completed',
    'chancesLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
    'usesCardPrintCode', (v_stored <> ''),
    'requiresCode', (v_stored <> ''),
    'fullName', case when v_ok then f.full_name else brc.mask_name(f.full_name) end,
    'phone',    case when v_ok then f.phone else left(f.phone, 4) || '••••' || right(f.phone, 2) end,
    'verified', v_ok,
    'chances', (select coalesce(jsonb_agg(jsonb_build_object(
        'no', a.attempt_no, 'slotStatus', a.slot_status::text, 'note', coalesce(a.outcome_note, ''),
        'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.governorate,
        'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at
      ) order by a.attempt_no), '[]'::jsonb)
      from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
      where a.serial = f.serial)
  );
end $function$;

create or replace function brc.self_service_card_unguarded(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  f record; v_ok boolean; v_stored text; v_code text;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

  perform brc.ensure_card_attempts(f.serial);

  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

  v_stored := upper(btrim(coalesce(to_jsonb(f)->>'card_print_code', '')));
  v_code   := upper(btrim(coalesce(p_code, '')));

  if v_stored = '' then
    v_ok := true;
  else
    v_ok := (v_stored = v_code)
         or (replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));
  end if;

  return jsonb_build_object(
    'ok', true,
    'card', jsonb_build_object(
      'serial', f.serial,
      'status', f.status::text,
      'chancesLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
      'profile', case when v_ok then coalesce(f.self_application_data, '{}'::jsonb) else '{}'::jsonb end,
      'profileLocked', not v_ok,
      'requiresCode', (v_stored <> ''),
      'maskedName', case when v_ok then null else brc.mask_name(f.full_name) end,
      'maskedPhone', case when v_ok then null else left(f.phone, 4) || '••••' || right(f.phone, 2) end,
      'verified', v_ok,
      'chances', (select coalesce(jsonb_agg(jsonb_build_object(
          'no', a.attempt_no, 'slotStatus', a.slot_status::text,
          'jobCode', a.job_code, 'jobTitle', j.title
        ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
        where a.serial = f.serial)
    )
  );
end $function$;

-- ===========================================================================
--  ٥) مشغّل منع بصمات التدقيق الحسّاسة (src/md5/fingerprint/lookup/budget)
-- ===========================================================================
create or replace function brc.trg_block_fingerprint_audit()
returns trigger language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
begin
  if coalesce(new.details, '') ~* '(src|md5|fingerprint|lookup:|budget:)' then
    return null;
  end if;
  return new;
end $function$;

drop trigger if exists trg_block_fingerprint_audit on brc.audit_log;
create trigger trg_block_fingerprint_audit
  before insert on brc.audit_log
  for each row execute function brc.trg_block_fingerprint_audit();

-- ===========================================================================
--  ٦) نقل صور الوظائف من data:URL إلى Storage
--     ⚠️ الرابط الأساسي مثبّت على المشروع الحالي بقصد في الإنتاج. هنا نجعله
--     يقرأ من إعداد المشروع إن وُجد، وإلا يبقى كسلاً — لأن قاعدة جديدة تعني
--     معرّف مشروع جديد.
-- ===========================================================================
create or replace function brc.relocate_job_images(p_bucket text default 'job-images'::text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  j record; raw bytea; b64 text; mime text; ext text; object_path text; public_url text; obj_id uuid;
  moved int := 0; failed int := 0; errs jsonb := '[]'::jsonb; ok_list jsonb := '[]'::jsonb;
  base_url text := coalesce(
    nullif(coalesce(current_setting('app.supabase_url', true), ''), ''),
    'https://vqsvztudvfukyuerzcgx.supabase.co');
begin
  if not brc.is_admin() then raise exception 'نقل صور الوظائف صلاحية المدير العام فقط'; end if;
  if to_regclass('storage.buckets') is null then
    raise exception 'مخطط التخزين storage غير موجود على هذه القاعدة';
  end if;
  if not exists (select 1 from storage.buckets where id = p_bucket) then
    raise exception 'الخزنة % غير موجودة', p_bucket;
  end if;

  for j in select id, code, image_url from brc.jobs where image_url like 'data:image/%' order by length(image_url) desc loop
    begin
      mime := substring(j.image_url from 'data:(image/[a-z+]+);base64,');
      b64  := substring(j.image_url from 'base64,(.*)$');
      if mime is null or b64 is null then raise exception 'صيغة data URL غير مفهومة'; end if;
      ext := case mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' when 'image/gif' then 'gif' else null end;
      if ext is null then raise exception 'صيغة صورة غير مدعومة: %', mime; end if;
      raw := decode(b64, 'base64');
      if raw is null then raise exception 'فك الترميز أعطى نتيجة فارغة'; end if;
      if length(raw) < 512 then raise exception 'الصورة صغيرة جداً (% بايت)', length(raw); end if;
      if not (
           (ext='jpg'  and substring(raw from 1 for 3) = '\xFFD8FF'::bytea)
        or (ext='png'  and substring(raw from 1 for 8) = '\x89504E470D0A1A0A'::bytea)
        or (ext='webp' and substring(raw from 1 for 4) = 'RIFF'::bytea and substring(raw from 9 for 4) = 'WEBP'::bytea)
        or (ext='gif'  and substring(raw from 1 for 3) = 'GIF'::bytea)
      ) then raise exception 'البايتات لا تطابق بصمة %', ext; end if;

      object_path := 'jobs/' || lower(j.code) || '.' || ext;
      public_url  := base_url || '/storage/v1/object/public/' || p_bucket || '/' || object_path;

      if p_dry_run then
        ok_list := ok_list || jsonb_build_object('code', j.code, 'path', object_path, 'bytes', length(raw), 'url', public_url);
        moved := moved + 1; continue;
      end if;

      select id into obj_id from storage.objects where bucket_id = p_bucket and name = object_path limit 1;
      if obj_id is null then
        insert into storage.objects (bucket_id, name, owner, metadata, created_at, updated_at)
        values (p_bucket, object_path, auth.uid(),
                jsonb_build_object('mimetype', mime, 'size', length(raw), 'cacheControl','31536000'), now(), now())
        returning id into obj_id;
      else
        update storage.objects
           set metadata = jsonb_build_object('mimetype', mime, 'size', length(raw), 'cacheControl','31536000'),
               updated_at = now()
         where id = obj_id;
      end if;

      if obj_id is null then raise exception 'لم يُكتب الملف في الخزنة'; end if;

      update brc.jobs set image_url = public_url, updated_at = now() where id = j.id;
      insert into brc.audit_log (username, role, action, entity, entity_id, details)
      select s.username, 'staff', 'نقل صورة الوظيفة إلى التخزين', 'job', j.code,
             'حُوِّلت الصورة المضمّنة (' || pg_size_pretty(length(raw)::bigint) || ') إلى ' || object_path
        from brc.staff s where s.auth_id = auth.uid();
      moved := moved + 1;
    exception when others then
      failed := failed + 1; errs := errs || jsonb_build_object('code', j.code, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('ok', failed = 0, 'dryRun', p_dry_run, 'moved', moved,
                            'failed', failed, 'errors', errs, 'plan', ok_list);
end $function$;

revoke all on function brc.relocate_job_images(text, boolean) from public, anon;
grant execute on function brc.relocate_job_images(text, boolean) to authenticated;

-- ===========================================================================
--  ٧) تصديرا النسخة الكاملة (v1 و v2) — يعتمدان على recovery_schema_hash
-- ===========================================================================
create or replace function brc.recovery_export_full()
returns jsonb language plpgsql security definer
set search_path = brc, public
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
end $function$;

create or replace function brc.recovery_export_v2()
returns jsonb language plpgsql security definer
set search_path = brc, public
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
end $function$;

-- ===========================================================================
--  ٨) الفهرسة الفريدة على رمز الفرصة
--     ⚠️ تُنشأ فقط إن كان الجدول خالياً من التكرار — وإلا تُترك مع تنبيه، لأن
--     الفشل هنا يجب ألا يُسقط الملف كله.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from brc.job_attempts
                  where chance_code is not null
                  group by chance_code having count(*) > 1) then
    execute 'create unique index if not exists attempts_chance_code_uidx on brc.job_attempts (chance_code)';
  else
    raise notice 'تخطّي attempts_chance_code_uidx — يوجد رمز فرصة مكرّر في البيانات';
  end if;
end $$;

-- ===========================================================================
----  13.٥) إلغاء التقنين في البطاقة الذاتية (قرار المالك — موجود في الإنتاج)
-- ===========================================================================
--  ⚠️ هذا القسم أُضيف 2026-11-17 بعد مقارنة تعريفات الدوال بالإنتاج الحيّ:
--     الإنتاج **لا يُقنّع** ولا يقفل ملف صاحب البطاقة، أما هذا الملف فكان
--     ما زال يُقنّع ويقفل. أي أن بناء قاعدة من هذا الملف كان **يُعيد سلوكاً
--     رفضه صاحب العمل صراحةً** — وهذا أخطر من نقص جدول.
--
--  البنية في الإنتاج (كما هي، بلا إعادة كتابة):
--     lookup_card        = card_lookup_guard ← lookup_card_unguarded + فتح الاسم/الهاتف
--     self_service_card  = card_lookup_guard ← self_service_card_unguarded + فتح الملف
--  ويبقى `verify_form` يُقنّع بلا بصمة — لأن رابطه العام يمكن تخمينه بالتسلسل.

create or replace function brc.lookup_card(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
declare
  v_guard jsonb; v_body jsonb; v_name text; v_phone text;
begin
  v_guard := brc.card_lookup_guard(p_serial, null);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then return v_guard; end if;

  v_body := brc.lookup_card_unguarded(p_serial, p_code);
  if v_body is null or coalesce((v_body->>'ok')::boolean, false) is not true then
    return v_body;
  end if;
  if (v_body->>'status') = 'blank' then return v_body; end if;

  select full_name, phone into v_name, v_phone
    from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));

  v_body := jsonb_set(v_body, '{fullName}', to_jsonb(coalesce(v_name, '')),   true);
  v_body := jsonb_set(v_body, '{phone}',    to_jsonb(coalesce(v_phone, '')),  true);
  v_body := jsonb_set(v_body, '{masked}',   'false'::jsonb, true);
  v_body := jsonb_set(v_body, '{verified}', 'true'::jsonb,  true);
  return v_body;
end $function$;

create or replace function brc.self_service_card(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
declare
  v_guard jsonb; v_body jsonb;
begin
  v_guard := brc.card_lookup_guard(p_serial, null);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then return v_guard; end if;

  v_body := brc.self_service_card_unguarded(p_serial, p_code);
  if v_body is null or coalesce((v_body->>'ok')::boolean, false) is not true then
    return v_body;
  end if;

  v_body := jsonb_set(v_body, '{card,masked}',        'false'::jsonb, true);
  v_body := jsonb_set(v_body, '{card,verified}',      'true'::jsonb,  true);
  v_body := jsonb_set(v_body, '{card,profileLocked}', 'false'::jsonb, true);
  return v_body;
end $function$;

-- ⚠️ الجسمان القديمان بعد إعادة التسمية يرثان صلاحية PUBLIC — وهذا هو
-- جذر الثغرة الأصلي. الإنتاج يسحبها صراحةً على `_unguarded`، ولا يجوز أن
-- يبقى مسار مباشر إلى الدالة الداخلية من الزائر.
revoke all on function brc.lookup_card_unguarded(text, text) from public, anon, authenticated;
revoke all on function brc.self_service_card_unguarded(text, text) from public, anon, authenticated;

revoke all on function brc.lookup_card(text, text) from public;
revoke all on function brc.self_service_card(text, text) from public;
grant execute on function brc.lookup_card(text, text) to anon, authenticated;
grant execute on function brc.self_service_card(text, text) to anon, authenticated;

-- ===========================================================================
--  ما لا يدخل في هذا الملف — بقصد، ومعلوم
--  ---------------------------------------------------------------------------
--  • `brc.security_audit()` — تقرير تدقيق أمني للقراءة فقط (~٦.٧ ك.ب). لا
--    تعتمد عليه أي واجهة في مسار العمل اليومي.
--  • `brc.applicants_no_backup_20261011` و`brc.jobs_image_url_rollback_20261112`
--    — لقطتان يدويتان من عمليات صيانة سابقة، ليستا جزءاً من النظام.
--  ===========================================================================
