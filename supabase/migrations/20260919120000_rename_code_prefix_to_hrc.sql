-- ===========================================================================
--  تغيير بادئة الأكواد من BRC إلى HRC — شركة الهدف للتوظيف
--  ---------------------------------------------------------------------------
--  السبب: تغيّر اسم الشركة من «بابل» إلى «الهدف»، فبادئة BRC (اختصار
--  Babylonian Recruitment Company) لم تعد تطابق الاسم. الرمز الجديد HRC.
--
--  ⚠️ لماذا ملف ترحيل منفصل ولا يكفي تعديل 20260915000000_brc_initial_schema؟
--     لأن الترحيل الأول طُبِّق على القاعدة مسبقاً، وSupabase لا يعيد تشغيل
--     ترحيلاً منفّذاً. تعديله يغيّر المستودع فقط بينما تبقى الدالتان في
--     القاعدة تولّدان BRC-… — فتظهر أكواد قديمة رغم أن الكود يعرض HRC.
--
--  ما الذي يتغيّر؟ **مولّدا الأكواد فقط**:
--     next_job_code()    → HRC-1042
--     next_form_serial() → HRC-NO-000121
--
--  ما الذي لا يتغيّر عمداً؟
--     • اسم السكيما brc وكل الجداول والدوال — تغييرها يقطع الاتصال بالتطبيق
--       ويتطلب إعادة بناء المشروع كاملاً بلا فائدة تُذكر للمستخدم.
--     • السجلات القائمة: أي وظيفة أو استمارة رقمها BRC-… تبقى كما هي.
--       هذا مقصود: الاستمارة المطبوعة بيد الزبون تحمل رقمها القديم، وتغييره
--       في القاعدة يُبطل ورقته وكيو آر كودها. النظام يقرأ الرقم كنص فيتعامل
--       مع البادئتين معاً بلا مشكلة، والجديد وحده يأخذ HRC.
--     • العدّادات (job_code_seq / form_serial_seq) تكمل تسلسلها ولا تُصفَّر،
--       فلا يتكرر رقم بين الحقبتين.
--
--  التطبيق:  supabase db push   أو  نسخ محتواه في SQL Editor وتشغيله.
-- ===========================================================================

create or replace function brc.next_job_code() returns text
language plpgsql as $$
declare v text;
begin
  loop
    v := 'HRC-' || nextval('brc.job_code_seq')::text;
    /* نتحقق من البادئتين: لو وُجد كود قديم بنفس الرقم التسلسلي نتخطّاه،
       حتى لا يتصادم HRC-1042 مع BRC-1042 في الترقيم البشري. */
    exit when not exists (
      select 1 from brc.jobs
       where code = v
          or code = 'BRC-' || split_part(v, '-', 2)
    );
  end loop;
  return v;
end $$;

create or replace function brc.next_form_serial() returns text
language plpgsql as $$
declare v text;
begin
  loop
    v := 'HRC-NO-' || lpad(nextval('brc.form_serial_seq')::text, 6, '0');
    exit when not exists (
      select 1 from brc.applicants
       where serial = v
          or serial = 'BRC-NO-' || split_part(v, '-', 3)
    );
  end loop;
  return v;
end $$;

-- تسجيل التغيير في سجل التدقيق ليبقى أثره موثّقاً
-- (أعمدة audit_log: username / role / action / entity / entity_id / details)
insert into brc.audit_log (username, role, action, entity, entity_id, details)
values ('system', 'system', 'تغيير بادئة الأكواد', 'settings', '-',
        'بادئة الأكواد الجديدة HRC (كانت BRC) — السجلات القائمة لم تُمسّ');
