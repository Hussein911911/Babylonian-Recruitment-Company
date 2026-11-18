# برومت جاهز — استرجاع قاعدة BRC على مشروع Supabase جديد

> انسخ ما بين السطرين وأعطه لأي أجنت (Claude / ChatGPT / Cursor / Codex)
> مع الملف `HRC-FULL-2026-11-19.sql`. النص مكتوب ليمنع الأخطاء التي
> كلّفت صاحب المشروع بياناته مرة.

---

## ✂️ ابدأ النسخ

أنت مسؤول عن استرجاع قاعدة بيانات منصة توظيف عراقية إلى مشروع Supabase
**جديد وفارغ**. عندك ملف واحد: `HRC-FULL-2026-11-19.sql` (3,858,946 بايت،
13,209 سطراً، 401 عبارة SQL).

### القاعدة المطلقة — لا تكسرها مهما حدث

**الملف يبدأ بـ `TRUNCATE` على كل جداول `brc`.** مكتوب في الملف نفسه:

> «⚠ يبدأ بـ TRUNCATE: لا تُنفّذه على قاعدة فيها بيانات حقيقية.»

**إن كان المشروع المستهدف هو `vqsvztudvfukyuerzcgx` — توقّف فوراً ولا تنفّذ شيئاً.**
هذا مشروع الإنتاج الحي. المشروع الهدف يجب أن يكون **جديداً فارغاً**.

قبل أي تنفيذ، تحقّق وأخبرني:

```sql
select (select count(*) from brc.applicants) as applicants,
       (select count(*) from brc.jobs) as jobs;
```

إن أعطى أرقاً غير صفرية أو أخطأ بوجود الجداول مع بيانات — **توقّف واطلب تأكيداً**.

### البيئة المستهدفة

- مشروع Supabase مجاني جديد، منطقة `eu-central-1`
- PostgreSQL 17
- **ممنوع** استخدام SQL Editor للصق الملف كاملاً: المحرّر يقصّ عند ~2000
  سطر ويرفع «Success» رغم النقص. الملف 13209 سطراً وسيُبتر بصمت.
  استخدم `psql` أو `supabase db push` أو أي منفّذ ملفات كامل.

### قبل التنفيذ — إلزامي

فعّل الإضافتين من لوحة Supabase → Database → Extensions:

1. **`pgcrypto`** — دوال `gen_random_bytes` و`digest`. بدونها تفشل دوال التشفير.
2. **`pg_cron`** — الإفراج التلقائي عن الحجوزات كل دقيقة.

الملف محصّن (`exception` حول إنشائهما) فلا يتوقف إن غابتا — لكن بعض الدوال
تظهر معطّلة لاحقاً بلا رسالة واضحة.

### التنفيذ

```bash
psql "postgresql://postgres:<DB_PASSWORD>@db.<NEW_PROJECT_REF>.supabase.co:5432/postgres?sslmode=require" \
     -v ON_ERROR_STOP=1 \
     -f HRC-FULL-2026-11-19.sql
```

`ON_ERROR_STOP=1` مهم: بدونه يكمل psql بعد الفشل وتظن أن كل شيء نجح.

### التحقق — لا تعلن النجاح قبل هذه الخطوة

الملف يطبع جدول أعداد في نهايته. الأعداد **الصحيحة** هي:

| الجدول | العدد |
|---|---:|
| staff | 3 |
| applicants | 726 |
| jobs | 22 |
| job_attempts | 1537 |
| issued_serials | 770 |
| card_number_registry | **176** |
| audit_log | 3809 |
| settings | 5 |
| recovery_chances | **1537** |
| recovery_prints | **726** |
| office_receipts | 0 |

ثم نفّذ هذا التحقق الإضافي وأبلغني بالنتيجة:

```sql
select
  (select count(*) from brc.recovery_prints where printed) as printed,   -- 422
  (select count(*) from brc.recovery_chances where spent)  as spent,     -- 46
  (select last_number from brc.card_number_counter)        as counter,   -- 176
  (select count(*) from brc.recovery_prints)               as cards,     -- 726
  (select count(*) from pg_trigger t
     join pg_class c on c.oid=t.tgrelid
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='brc' and not t.tgisinternal and t.tgenabled<>'O') as disabled_triggers; -- 0
```

**أي رقم مختلف = الملف لم يُنفَّذ كاملاً. لا تبدأ العمل، أبلغني بالرقم المختلف.**

### لماذا هذه الأرقام تهمّ — لا تتجاوزها

`card_number_registry` = السجل الرسمي لأرقام البطاقات المطبوعة على ورق.
بدونه يبدأ العدّاد من صفر، فتأخذ أول بطاقة جديدة رقماً **مطبوعاً سابقاً** —
تكرار على وثيقة رسمية.

`recovery_chances.spent` = 46 فرصة استُهلكت فعلاً. بدونها تعود متاحة،
فالبطاقة ذات الفرصتين تعطي ثلاثاً — **خسارة مالية مباشرة**.

`recovery_prints.printed` = 422 بطاقة طُبعت. بدونها يمكن طباعة نفس البطاقة
مرتين — وثيقة مزدوجة.

### الحسابات — الخطوة الأخيرة، وهي التي تفشل عادةً

الملف يستورد **3 صفوف** في `brc.staff` لكن `auth_id` تُستورد **`NULL`** للثلاثة.
تحقّقت من ذلك تنفيذاً:

```
admin        | admin | auth_id = NULL
AliAhmed919  | admin | auth_id = NULL
Mohammed     | staff | auth_id = NULL
```

**معناه:** الأسماء والأدوار محفوظة، لكن **لا أحد يستطيع تسجيل الدخول**.
لأن الدخول يحتاج صفاً في `auth.users` بكلمة مرور — وهذا **غير موجود في الملف بقصد**:
كلمات المرور مفاتيح دخول حيّة ولا تُنقل بين المشاريع.

**لإكمالها:**

1. من اللوحة: Authentication → Users → Add user → Create new user
   أنشئ ثلاثة، **وفعّل «Auto Confirm User»** لكل واحد:

   | البريد | اسم المستخدم المرتبط |
   |---|---|
   | `admin@brc-babil.local` | `admin` |
   | `aliahmed919@brc-babil.local` | `AliAhmed919` |
   | `mohammed@brc-babil.local` | `Mohammed` |

   النطاق `.local` مقبول: لا يُرسل بريداً، والدخول باسم المستخدم لا بالبريد.

2. اربطهم بصفوف `brc.staff`:

```sql
update brc.staff s
   set auth_id = u.id
  from auth.users u
 where u.email = case s.username
                   when 'admin'       then 'admin@brc-babil.local'
                   when 'AliAhmed919' then 'aliahmed919@brc-babil.local'
                   when 'Mohammed'    then 'mohammed@brc-babil.local'
                 end
   and s.auth_id is null;

select count(*) as linked from brc.staff where auth_id is not null;  -- يجب 3
```

3. اختبر الدخول من `/dashboard`.

### الصور — خارج الملف

٥ صور، ٧٩٠ ك.ب، في Storage → bucket `job-images`. ليست في الملف لأنها خارج
القاعدة. ارفعها بنفس المسارات، وإلا ظهرت الوظائف برمز صورة مكسور.

### ما لا تفعله

- ❌ لا تنفّذ الملف على مشروع فيه بيانات
- ❌ لا تلصقه في SQL Editor
- ❌ لا تُنشئ `auth.users` بـ`insert` يدوي — استخدم اللوحة
- ❌ لا تعتبر «بلا أخطاء» دليلاً على النجاح — قارن الأعداد
- ❌ لا تخبرني «تمّ» قبل أن تُنفّذ استعلام التحقق وتُظهر الناتج

### ما تبلغني به

1. ناتج جدول الأعداد من نهاية الملف
2. ناتج استعلام التحقق الإضافي (5 قيم)
3. إن نجحت: عدد الحسابات المربوطة
4. إن فشل شيء: **رقم السطر ورسالة الخطأ حرفياً**، ولا تُكمل

---

## ✂️ انتهى النسخ

---

## ملاحظات لك (لا تُنسخ للأجنت)

**لماذا هذا البرومت أفضل من سؤال عام؟**

لأنه يجيب مسبقاً على الأسئلة الخمسة التي يخطئ فيها كل أجنت:

| الخطأ | كيف يمنعه البرومت |
|---|---|
| ينفّذ على الإنتاج | تحذير TRUNCATE + استعلام تحقّق قبل التنفيذ |
| يلصق في SQL Editor | تحذير صريح + البديل بالأمر |
| يعلن النجاح بلا تحقّق | جدول 11 رقماً + استعلام 5 قيم |
| ينسى الحسابات | شرح كامل + سكربت الربط |
| ينسى الإضافات | خطوة إلزامية قبل التنفيذ |

**إن أردت اختصاره**، الحد الأدنى الذي لا يجوز حذفه: تحذير TRUNCATE،
الأعداد الـ11، وخطوة `auth_id`.
