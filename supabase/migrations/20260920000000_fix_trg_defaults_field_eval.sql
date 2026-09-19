-- ===========================================================================
--  إصلاح عطل: 42703 record "new" has no field "code" عند إدراج أي استمارة
--  ---------------------------------------------------------------------------
--  العَرَض: كل INSERT في brc.applicants يفشل بالخطأ أعلاه، مُشيراً إلى
--           brc.trg_defaults() السطر 6. وهذا يعني عملياً أن **إصدار أي استمارة
--           جديدة كان متعذّراً** — لا في الموقع ولا من لوحة الموظف.
--
--  السبب: الدالة trg_defaults() مشتركة بين جدولين (jobs و applicants)، وكان
--         أول شرط فيها مكتوباً هكذا:
--
--             if tg_table_name = 'jobs' and coalesce(new.code, '') = '' then
--
--         و PL/pgSQL يُحلّل الحقول المشار إليها في التعبير قبل تنفيذه، ولا
--         يعتمد على التقييم القصير (short-circuit) لتفادي حقل غير موجود.
--         فعند الإدراج في applicants — وهو جدول بلا عمود code — ينفجر التعبير
--         رغم أن الشرط الأول كاذب.
--
--  الإصلاح: تعشيش الشرطين. لا يُقرأ new.code إلا بعد التأكد أننا في jobs.
--
--  أثر جانبي مهم: هذا العطل كان يمنع أيضاً إنشاء خانات المحاولات الخمس
--  (تُنشأ داخل نفس الدالة)، فأي استمارة كانت ستُصبح بلا محاولات.
--
--  التطبيق: Supabase ← SQL Editor ← الصق هذا الملف ← Run
-- ===========================================================================

create or replace function brc.trg_defaults() returns trigger
language plpgsql as $$
declare rules jsonb;
begin
  select value into rules from brc.settings where key = 'rules';

  /* ⚠️ لا تدمج الشرطين بـ and في سطر واحد — انظر شرح السبب أعلاه. */
  if tg_table_name = 'jobs' then
    if coalesce(new.code, '') = '' then
      new.code := brc.next_job_code();
    end if;
  end if;

  if tg_table_name = 'applicants' then
    if coalesce(new.serial, '') = '' then
      new.serial := brc.next_form_serial();
    end if;
    if new.attempt_limit is null or new.attempt_limit = 5 then
      new.attempt_limit := coalesce((rules->>'attempt_limit')::smallint, 5);
    end if;
    if new.fee_amount is null or new.fee_amount = 10000 then
      new.fee_amount := coalesce((rules->>'form_fee')::integer, 10000);
    end if;
    if new.expiry_date is null then
      new.expiry_date := new.issue_date + make_interval(days => coalesce((rules->>'validity_days')::int, 30));
    end if;
    -- إنشاء خانات المحاولات الخمس تلقائياً
    insert into brc.job_attempts (serial, attempt_no)
    select new.serial, gs from generate_series(1, new.attempt_limit) gs
    on conflict (serial, attempt_no) do nothing;
  end if;

  new.updated_at := now();
  return new;
end $$;
