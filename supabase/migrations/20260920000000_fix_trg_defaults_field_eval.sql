-- ===========================================================================
--  إصلاح عطلين يمنعان إصدار أي استمارة — brc.trg_defaults()
--  ---------------------------------------------------------------------------
--  كلا العطلين كان يجعل **إصدار أي استمارة جديدة متعذّراً** على القاعدة، من
--  لوحة الموظف ومن الموقع على السواء — لا في بيانات العرض وحدها.
--
--  ── العطل الأول: 42703 record "new" has no field "code" ───────────────────
--  كان أول شرط في الدالة:
--      if tg_table_name = 'jobs' and coalesce(new.code, '') = '' then
--  والدالة مشتركة بين jobs و applicants. و PL/pgSQL يُحلّل الحقول المشار
--  إليها في التعبير قبل تنفيذه ولا يعتمد على التقييم القصير لتفادي حقل غير
--  موجود — فعند الإدراج في applicants (بلا عمود code) ينفجر التعبير رغم أن
--  الشرط الأول كاذب.
--  الإصلاح: تعشيش الشرطين، فلا يُقرأ new.code إلا داخل فرع jobs.
--
--  ── العطل الثاني: 23503 violates foreign key "job_attempts_serial_fkey" ───
--  بعد إصلاح الأول ظهر هذا: الدالة كانت تُنشئ خانات المحاولات الخمس داخل
--  مُشغِّل BEFORE INSERT — أي قبل كتابة صف الاستمارة في الجدول. و
--  job_attempts.serial مفتاح أجنبي يشير إلى applicants(serial)، فالإدراج
--  يشير إلى استمارة لا وجود لها بعدُ ويُرفض.
--  الإصلاح: نقل إنشاء المحاولات إلى مُشغِّل AFTER INSERT منفصل، يعمل بعد
--  كتابة الاستمارة فعلاً.
--
--  أثر مستتر كان سيبقى لولا ذلك: خانات المحاولات تُنشأ في نفس الموضع، فأي
--  استمارة كانت ستُصبح بلا محاولات حتى لو نجح إدراجها.
--
--  التطبيق: Supabase ← SQL Editor ← الصق هذا الملف كاملاً ← Run
-- ===========================================================================

-- ── 1) الدالة بعد تعشيش الشرط ونزع إنشاء المحاولات منها ────────────────────
create or replace function brc.trg_defaults() returns trigger
language plpgsql as $$
declare rules jsonb;
begin
  select value into rules from brc.settings where key = 'rules';

  /* ⚠️ لا تدمج الشرطين بـ and في سطر واحد — انظر «العطل الأول» أعلاه. */
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
    /* ⚠️ لا تُنشأ خانات المحاولات هنا — انظر «العطل الثاني» أعلاه. */
  end if;

  new.updated_at := now();
  return new;
end $$;

-- ── 2) إنشاء خانات المحاولات بعد كتابة الاستمارة فعلاً ─────────────────────
create or replace function brc.trg_make_attempts() returns trigger
language plpgsql as $$
begin
  insert into brc.job_attempts (serial, attempt_no)
  select new.serial, gs from generate_series(1, new.attempt_limit) gs
  on conflict (serial, attempt_no) do nothing;
  return null;
end $$;

drop trigger if exists trg_applicants_attempts on brc.applicants;
create trigger trg_applicants_attempts after insert on brc.applicants
  for each row execute function brc.trg_make_attempts();

-- ── 3) ترميم: استمارات قائمة بلا خانات محاولات (إن وُجدت) ──────────────────
--  أي استمارة أُدرجت أثناء وجود العطل قد تكون بلا محاولات؛ نستكملها هنا.
insert into brc.job_attempts (serial, attempt_no)
select a.serial, gs
  from brc.applicants a
 cross join generate_series(1, a.attempt_limit) gs
on conflict (serial, attempt_no) do nothing;
