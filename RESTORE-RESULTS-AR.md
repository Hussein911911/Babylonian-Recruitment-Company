# نتائج الاسترجاع — تقرير فعلي (بلا أسرار)

> **التاريخ:** 2026-11-20 · **الفرع:** `arena/8f675cf5-babylonian-recruitment-company`
> **الملف:** `HRC-FULL-2026-11-19.sql` · **الهدف:** `tkxbmopxcftxpcoczweq`
> **الحالة بصراحة:** **لم يُنفَّذ الاسترجاع على الهدف بعد** — والعائق ليس صلاحية
> ولا موافقة، بل **قناة نقل**: بيئة التنفيذ هذه لا تستطيع إرسال ٣٫٩ م.ب إلى
> Supabase (التفاصيل §٩). كل ما دونه هنا **نُفِّذ وقيس فعلاً**، والباقي معلَّم
> صراحةً بأنه غير منفَّذ.

---

## ١) المصدر وهوية الهدف

| البند | القيمة |
|---|---|
| المستودع | `Hussein911911/Babylonian-Recruitment-Company` |
| الفرع | `arena/8f675cf5-babylonian-recruitment-company` |
| **commit الأساس** | `1f488d44e8b81680e123f26b0ab37a72d363d502` — 2026-11-19 03:08:34 +0300 (‏`Merge pull request #83`) |
| حالة الشجرة عند الفحص | نظيفة، بلا تغييرات معلّقة |
| المشروع المخوَّل (الهدف) | `tkxbmopxcftxpcoczweq` — `ACTIVE_HEALTHY` |
| المنطقة / الإصدار | `eu-west-1` / PostgreSQL **17.11** |
| الإضافات | `pgcrypto 1.3` ✓ · `pg_cron 1.6.4` ✓ · `pg_stat_statements` · `supabase_vault` · `uuid-ossp` |
| مشروع الإنتاج المحظور | `vqsvztudvfukyuerzcgx` — **لم يُلمس إطلاقاً**، ولا يظهر حتى في قائمة مشاريع الحساب المتاحة للموصل |

التحقق من الهوية جرى قبل أي استعلام آخر: `current_database() = postgres`،
`server_version = 17.11`، وسكيما `brc` هي المقصودة.

---

## ٢) فحص الملف وبصمته

| القياس | القيمة | الحكم |
|---|---|---|
| الحجم | 3,858,946 بايت | مطابق للمعلن |
| الأسطر | 13,209 (بلا سطر جديد ختامي) | مطابق |
| SHA-256 | `a1cce0475ae8158cacb523e738cd1bbe34def36dd77787a2fee25763f84ec8ba` | **مطابق** |
| العبارات | **401 مقطع = 400 عبارة فعلية + ذيل تعليقات (214 بايت)** | لا بتر |

### تفسير فرق 400 مقابل 401

المحلّل الذي يعدّ «المقاطع» يفصل عند كل `;` خارج الأقواس النصية و`$$`، فيُخرج
في النهاية **بقية النص بعد آخر `;`** إن لم تكن فراغاً. بقية هذا الملف
(السطر 13206 وما بعده) **تعليقات ختامية بلا عبارة**. فمن يعدّ المقاطع يرى
**401**، ومن يعدّ العبارات الفعلية (‏PostgreSQL أو `psql`) يرى **400**.

تحقّقتُ من ذلك بمحلّلين مستقلين: محلّل بايثون كُتب لهذا الفحص، و`splitStatements`
الموجود في المستودع (`tools/sql-split-core.mjs`) — كلاهما 401 مقطع، وأحدهما فقط
عبارة فعلية `0`؛ و`psql` نفّذ الملف كاملاً بنجاح. **لا نقص، ولا يجوز تعديل
الملف لمطابقة رقم.**

### بنية الملف (فحص كامل قبل أي تنفيذ)

| المرحلة | العبارات | الملاحظة |
|---|---|---|
| رأس | 1–2 | `SET client_encoding=UTF8` · `SET statement_timeout=0` |
| إضافات | 3–4 | `pgcrypto` و`pg_cron` ملفوفتان بـ`EXCEPTION` → لا تُسقطان السكربت |
| الهيكل | 5–379 | 227,485 بايت · جداول/دوال/مشغّلات/سياسات/منح · كله `if not exists` أو `create or replace` |
| **البيانات** | 380–399 | **3,629,996 بايت · `BEGIN` … `COMMIT` واحد** |
| التحقق الختامي | 400 | جدول أعداد 11 صفاً |

داخل معاملة البيانات:

| العبارة | السطر | ما تفعله |
|---|---|---|
| 382 | 3758 | **`TRUNCATE … RESTART IDENTITY CASCADE` ديناميكي** على كل جداول `brc` **ما عدا `staff`** |
| 383 | 3765 | `DISABLE TRIGGER ALL` على كل الجداول (ملفوفة بـ`EXCEPTION … THEN NULL`) |
| 384–396 | 3772–13167 | 12 عبارة `INSERT` للبيانات + ضبط العدّاد الداخلي |
| 397 | 13173 | `ENABLE TRIGGER ALL` — **بلا معالج استثناء** |
| 398 | 13182 | `setval` لتسلسل `audit_log` |
| 399 | 13187 | `COMMIT` |

فحوص إضافية: **لا `COPY … FROM stdin`** (كل البيانات `INSERT` صريحة، فيصلح
لأي منفّذ)، ولا `session_replication_role`، ولا `DROP SCHEMA`.
`ON CONFLICT` موجودة في موضعين فقط: `staff` (‏`ON CONFLICT (username) DO NOTHING`
— لا يطمس حساباً موجوداً) و`card_number_counter` (‏`GREATEST`). عبارة إعدادات
الهيكل (`settings`) فيها `ON CONFLICT (key) DO NOTHING`، وعبارة بيانات
`settings` تُنفَّذ بعد `TRUNCATE` فلا تصطدم.

---

## ٣) فحص الهدف قبل التنفيذ (بلا تغيير)

| الجدول | العدد | الحكم |
|---|---|---|
| applicants · jobs · staff · job_attempts | **0 · 0 · 0 · 0** | لا بيانات عمل جديدة |
| issued_serials · recovery_chances · recovery_prints | 0 | — |
| office_receipts · employer_job_credentials · recovery_tickets | 0 | — |
| settings | 3 (`rules`, `company`, `recovery_schedule`) | بيانات `brc` قديمة — داخلة في الموافقة |
| audit_log | 1 | داخلة في الموافقة |
| recovery_copies | 1 | داخلة في الموافقة |
| recovery_control | 1 | داخلة في الموافقة (لم يُذكر سابقاً — أُدرج هنا للشفافية) |

**قاعدة السلامة ٢ محقّقة:** لا `applicants` ولا `jobs` ولا `staff` ولا
`job_attempts` جديدة → لا سبب للتوقّف.

### فحص علاقات CASCADE (قاعدة ٤)

كل مفاتيح أجنبية تلمس `brc` هي:
`staff.auth_id → auth.users` (خارج brc: `auth`)، والباقي كله **داخل `brc`**:
`applicants.created_by→staff`, `jobs.reserved_by→applicants`, `jobs.created_by→staff`,
`job_attempts.serial→applicants`, `job_attempts.job_id→jobs`, `job_attempts.staff_id→staff`,
`audit_log.user_id→staff`, `settings.updated_by→staff`, `employer_otp.attempt_id→job_attempts`,
`employer_job_credentials.job_id→jobs`, `recovery_tickets.copy_id→recovery_copies`.

الاتجاه المهم: **لا جدول خارج `brc` يشير إلى جدول داخل `brc`** (الوحيد
`brc.staff → auth.users` وهو الاتجاه المعاكس، و`staff` مستثنى من `TRUNCATE`).
ولا **views** خارج `brc` تعتمد على جداولها. ⇒ `TRUNCATE … CASCADE` يبقى
داخل النطاق المصرّح به ولا يمسّ `auth` أو `storage`.

---

## ٤) العائق الحاسم: الملف لا يكتمل على هذا المشروع كما هو

دور `postgres` في هذا المشروع (وفي مشاريع Supabase الحديثة) **ليس superuser**:

```sql
-- قيس فعلياً على الهدف
select rolsuper from pg_roles where rolname = current_user;   -- false
alter table brc.settings disable trigger all;  -- ERROR 42501 permission denied: "RI_ConstraintTrigger…" is a system trigger
alter table brc.settings enable  trigger all;  -- ERROR 42501 نفسها
```

`… TRIGGER ALL` يمسّ مشغّلات القيود الداخلية، وهو مقصور على superuser.
النتيجة على هذا الملف:

1. **كتلة التعطيل (382):** تفشل، لكنها ملفوفة بـ`EXCEPTION … THEN NULL`
   → تُهمَل بصمت، والمشغّلات تبقى فعّالة أثناء التحميل.
2. **كتلة إعادة التفعيل (397):** تفشل **بلا** معالج → تُجهض معاملة البيانات
   كاملة → لا `COMMIT` → **لا يُثبَّت أي صف**.

أي أن التنفيذ «حرفياً كما هو» ينتهي بقاعدة فارغة ورسالة 42501.

**الإصلاح المطبَّق** (`docs/sql-parts/fixes/03-restore-trigger-blocks.sql`):
استبدال العبارتين فقط بنسخة تسمّي كل مشغّل صراحةً
(`DISABLE TRIGGER <name>` / `ENABLE TRIGGER <name>`) — مسموح لمالك الجدول بلا
superuser، ويكافئ `ALL` لكل المشغّلات غير الداخلية. **مكسب جانبي:** مشغّلات
المفاتيح الأجنبية تبقى فعّالة، فيتحقّق الاسترجاع من سلامة المراجع أثناء
التحميل بدل تجاوزها. بقية الملف تبقى بايتاً ببايت (تحقّق آلي).

### ٤.ب) العطب كان في **مولّد الملف**، لا في الاتصال ولا في البيانات — وأُصلح في الكود

الملف الذي نُزِّل من صفحة النسخ الاحتياطي ليس مكتوباً بيد: تولّده
`assets/js/restore-sql.js`. وموضع العطب فيه سطران:

| الموضع في المولّد | ما كان يُصدر | الأثر على مشروع ليس فيه superuser |
|---|---|---|
| كتلة التعطيل (كانت السطر 323) | `ALTER TABLE brc.%I DISABLE TRIGGER ALL` ملفوفة بـ`EXCEPTION … THEN NULL` | تفشل بـ42501 — **بصمت** |
| كتلة الإعادة (كانت السطر 426) | `… ENABLE TRIGGER ALL` **بلا** معالج | العبارة 397 في ملفك: 42501 ⇒ تُجهض معاملة البيانات ⇒ **صفر صف** |

أي أن الاتصال بالهدف بريء، والبيانات بريئة؛ الخلل في نصّ المولّد نفسه. ولذلك
يتكرر على **كل** مشروع Supabase حديث، لا على مشروعك وحده — والحلّ الجذري في
الكود لا في الترقيع بعد التنزيل.

**ما تغيّر الآن (2026-11-20):**

1. المولّد يُصدر عبارة مستقلة لكل مشغّل: `DISABLE TRIGGER %I` / `ENABLE TRIGGER %I`
   (دورة على `pg_trigger` للمشغّلات غير الداخلية)، والإعادة تقتصر على المعطّل
   فعلاً (`tgenabled <> 'O'`).
2. حارس البناء `assets/js/full-dump.js` كان يشترط وجود `DISABLE TRIGGER ALL`؛
   أصبح يشترط الشكل الجديد **ويرفض** `TRIGGER ALL` في الكود.
3. `tests/full-dump.mjs`: صار 21 فحصاً (كان 20)، منها فحص جديد
   «لا يستعمل TRIGGER ALL في الكود» (يتجاهل أسطر التعليق لأنها تشرح العطب).

**الإثبات — تنفيذ فعلي لا قراءة كود:**

| الاختبار | النتيجة |
|---|---|
| `tests/full-dump.mjs` — يبني ملفاً كاملاً وينفّذه من أوله لآخره | ✅ **21/21** |
| مخرَج المولّد الحقيقي: اقتطعت الكتلتين ولصقتهما في نسخة من ملفك **بلا مُرقّع**، ثم نفّذت الملف كاملاً على قاعدة محلية بدور **غير superuser** (`hrc_owner`) | `exit 0` · **0 ERROR** |
| الأعداد بعد ذلك التنفيذ (استعلامات `count(*)` مستقلة) | staff 3 · applicants 726 · jobs 22 · job_attempts 1537 · issued_serials 770 · card_number_registry 176 · audit_log 3809 · settings 5 · recovery_chances 1537 · recovery_prints 726 · office_receipts 0 · printed 422 · counter 176 · **مشغّلات معطّلة 0** |
| مقارنة نصّ المُرقّع بنصّ المولّد | فروق **تنسيق أسطر** فقط، لا فرق دلالي |

⚠️ **ملفك المُنزَّل يبقى كما هو:** البايتات التي نزّلتها تحمل `TRIGGER ALL`، لذا
يبقى `tools/patch-restore-triggers.mjs` (يستدعيه `tools/restore-full-file.mjs`
تلقائياً) لازماً **لهذا الملف تحديداً**. أي تنزيل جديد من الصفحة بعد هذا الإصلاح
لا يحتاج ترقيعاً.

---

## ٥) التأهيل الفعلي (‏rehearsal) — أُثبت أن الملف والترقيع يعطيان الأعداد

بيئة التأهيل: PostgreSQL 16.2 محلية (‏`pgserver`) مع بدائل لِـ`auth.users`,
`auth.sessions`, `storage.*`, `extensions.gen_random_bytes`, ودورَي `anon`/`authenticated`/`service_role`.

| المحاولة | الدور | الملف | النتيجة |
|---|---|---|---|
| أ | superuser | **الأصلي بلا تعديل** | `psql` رمز خروج **0** · 11/11 عدداً مطابقاً · 5/5 قيماً مطابقة |
| ب | **مالك غير superuser** (كحال الهدف) | **المرقَّع** | رمز خروج **0** · **16/16** قيمة مطابقة · `disabled_triggers = 0` |

قيم التحقق في المحاولة (ب) — نفس الاستعلام المطلوب حرفياً:

| printed | spent | counter | cards | disabled_triggers |
|---|---|---|---|---|
| **422** | **46** | **176** | **726** | **0** |

والأعداد الـ11: `staff 3` · `applicants 726` · `jobs 22` · `job_attempts 1537` ·
`issued_serials 770` · `card_number_registry 176` · `audit_log 3809` ·
`settings 5` · `recovery_chances 1537` · `recovery_prints 726` · `office_receipts 0`.
والموظفون الثلاثة دخلوا بـ`auth_id = NULL` كما هو متوقّع، و`settings` صارت
5 مفاتيح (`company, recovery_last_scheduled_at, recovery_retention, recovery_schedule, rules`).

**معنى هذا:** الملف كامل وغير مبتور، والترقيع لا يغيّر النتيجة، والفارق الوحيد
بين التأهيل والهدف هو قناة التنفيذ.

---

## ٦) أدوات الاسترجاع في المستودع — ما جاهز وما أُضيف

| الأداة | الحالة |
|---|---|
| `tools/recovery-server.mjs` · `tools/recovery-app.html` · `tools/recovery-core.mjs` · `tools/recovery/START-RECOVERY.bat` · `docs/RECOVERY-ONE-CLICK.md` | موجودة ومفحوصة، **لم تُعَد كتابتها** (نسخ الاسترجاع التشغيلي داخل الموقع، لا نقل مشروع) |
| `docs/schema.sql` §13 · `docs/sql-parts/fixes/02-restore-gap.sql` | الإصلاحات السابقة موجودة ومحترمة |
| **`docs/sql-parts/fixes/03-restore-trigger-blocks.sql`** | **جديد** — كتلتا المشغّلات البديلتان |
| **`tools/patch-restore-triggers.mjs`** | **جديد** — يرقّع العبارتين فقط، ويرفض الترقيع المزدوج |
| **`tools/restore-full-file.mjs`** | **جديد** — منفّذ كامل + تحقّق آلي + PASS/FAIL (سائق `psql` أو `pg`) |
| **`tests/patch-restore-triggers.mjs`** | **جديد** — 6 اختبارات، كلها ناجحة |
| **`docs/sql-parts/fixes/04-brc-secret-fallback.sql`** | **جديد** — بديل `app.brc_secret` بجدول محمي (بلا superuser) |
| **`tests/brc-secret-fallback.mjs`** | **جديد** — 7 اختبارات، كلها ناجحة |

لم أنشئ `profileLocked` ولا تقنيعاً، ولم أعد بناء أي أداة من الصفر، ولم أعتمد
أعداداً ثابتة في الواجهة (الأعداد داخل الأداة هي **معيار تحقّق** صريح لنسخة
2026-11-19 فقط).

---

## ٧) الحسابات (‏auth) — الوضع الفعلي

* `auth.users` في الهدف = **0** · `brc.staff` = **0** · `staff.auth_id` لا يوجد صف.
* الملف يُدرج 3 موظفين بلا `auth_id` (`admin` و`AliAhmed919` بدور admin،
  `Mohammed` بدور staff) و`ON CONFLICT (username) DO NOTHING`.
* **الموصل المتاح لا يوفّر إنشاء مستخدمي Auth** (لا Auth Admin API، ولا رفع كلمات مرور).
  ولذلك **لم أُنشئ أي حساب**، ولم أستخدم `INSERT` يدوياً في `auth.users` (ممنوع).
* إعدادات Auth الحالية: `site_url = http://localhost:3000` · `uri_allow_list = ""` ·
  `disable_signup = false` · `mailer_autoconfirm = false` · `password_min_length = 6`.
  ⇒ أنشئ الحسابات من اللوحة مع **Auto Confirm** كي لا يُرسَل أي بريد حقيقي.
* اختبار الدخول والصلاحيات: **لم يُنفَّذ** (لا حسابات بعد).

الخطوات المطلوبة منك (قصيرة): Authentication → Users → **Add user** ثلاث مرات
بالبريد المقترح (`admin@brc-babil.local`, `aliahmed919@brc-babil.local`,
`mohammed@brc-babil.local`) و**Auto Confirm User = مفعّل**، وكلمة مرور قوية
تكتبها أنت (لا ترسلها في المحادثة). ثم أربط أنا `auth_id` بصفوف `brc.staff`
بعد فحص أن الربط فارغ — بلا طمس أي ربط قائم.

---

## ٨) الصور والملفات

* `storage.buckets` في الهدف **فارغ تماماً** — لا bucket باسم `job-images`.
* الصور الخمس (‏≈790 ك.ب) **ليست في الملف** ولا في المستودع (المستودع فيه صور
  وظائف عامة `.webp` مختلفة في `assets/img/jobs/`).
* لم أدخل مشروع الإنتاج لجلبها. روابطها العامة موثّقة في
  `docs/rescue/MISSING-ITEMS.md` §٢، وتحتاج تنزيلاً من جهازك أو رفعاً مباشراً،
  ثم إنشاء bucket `job-images` وسياساته.
* `jobs.image_url` داخل النسخة قد يحمل روابط مطلقة للمشروع القديم: **لم أغيّرها**،
  وسيُفحص أثرها بعد الاسترجاع قبل أي تعديل.

---

## ٩) لماذا لم يُنفَّذ على الهدف؟ (العائق التقني بالتفصيل)

1. **الشبكة:** بيئة التنفيذ هذه مسموح لها فقط بـ`github.com`, `codeload.github.com`,
   `api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`.
   القياس: `psql`/`curl` إلى `db.tkxbmopxcftxpcoczweq.supabase.co` وإلى
   `aws-0-eu-west-1.pooler.supabase.com` يفشل عند مصافحة TLS
   (`SSL_ERROR_SYSCALL` / `errno=104`) — لا اتصال بقاعدة الهدف من هنا.
2. **الموصل الوحيد المتاح:** Management API `POST /database/query`. الإدخال فيه
   يجب أن أكتبه **أنا**، وحجم الملف 3.9 م.ب لا يمكن كتابته في رسائل. والإخراج
   مقصوص عند حجم صغير (‏ملاحظة الجلسة السابقة: ~50 ك.ب)، فلا يصلح لنقل البيانات.
3. **لذلك:** التنفيذ يحتاج قناة واحدة فقط: أن يصل الملف إلى القاعدة **من جهاز
   يملك اتصالاً بها**. الأدوات جاهزة ومختبرة، والأمر واحد (‏`RESTORE-GUIDE-AR.md`).

**ما لم أفعله:** لم أُنشئ أي مورد مدفوع، ولم ألمس الإنتاج أو DNS، ولم أنشر شيئاً،
ولم أُدخل أي سرّ في المحادثة، ولم أُنفّذ أي خطوة مدمّرة على الهدف.

---

## ١٠) تغييرات مؤقتة على الهدف — أُزيلت بالكامل

خلال التشخيص أُنشئت مؤقتاً: دور `hrc_restore` (بلا أي صلاحية)، وإضافة `pg_net`.
**أُزيل كلاهما**، وتحقّق الحال بعد الإزالة:

| الفحص | النتيجة |
|---|---|
| `pg_net` مثبّتة؟ | 0 |
| الدور `hrc_restore` موجود؟ | 0 |
| كل مشغّلات `brc` فعّالة (`tgenabled='O'`)؟ | نعم (0 معطّل) |
| applicants/jobs/staff/job_attempts | 0/0/0/0 — كما كانت |
| settings/audit_log/recovery_copies/recovery_control | 3/1/1/1 — كما كانت |

`app.brc_secret` **لم يُضبط** ولم يُولَّد (انظر أدناه).

---

## ١١) `app.brc_secret` — **حُلَّت من عندنا، بلا تذكرة دعم**

* `brc.verify_token(serial)` = `encode(hmac(serial, app.brc_secret, 'sha256'),'hex')`
  — بصمة تُطبع في كيو آر البطاقة وتُستخدم في `verify_form`.
* الدالة **ترفض العمل** إن لم يُضبط المفتاح (‏`22023`) — فلا سرّ مكتوب في المستودع.
* القيمة الحالية في الهدف: **غير مضبوطة**.
* محاولة الضبط الأصلية `ALTER DATABASE postgres SET app.brc_secret = …` **فشلت بـ42501**
  (‏البارامترات المخصّصة تحتاج superuser في PG15+، ودور `postgres` هنا ليس superuser).

**الحل المُنفَّذ في المستودع (‏2026-11-20):** مصدر ثانٍ داخل القاعدة —
جدول `brc.app_secrets` + `verify_token` تقرأ الإعداد أولاً ثم الجدول:

| البند | التفصيل |
|---|---|
| الجدول | `brc.app_secrets(name, value, updated_at)` — RLS مفعّلة **بلا أي سياسة** + `REVOKE` من `public, anon, authenticated, service_role` |
| الدالة | نفس التوقيع ونفس البصمة · الإعداد أولاً (سلوك الإنتاج محفوظ) ثم الجدول · تظل ترمي `22023` إن غاب المصدران |
| الملفات | `docs/sql-parts/fixes/04-brc-secret-fallback.sql` (للتنفيذ بعد الاسترجاع) · `docs/schema.sql` §2.7 + الدالة · ملف الـmigration مُزامن · `restore.html` أُعيد تضمينه |
| الاختبار | `node tests/brc-secret-fallback.mjs` — **7/7** · واختبار وظيفي حقيقي على القاعدة (أدناه) |

اختبار وظيفي فعلي (‏PostgreSQL محلي بعد استرجاع كامل):

| الحالة | النتيجة |
|---|---|
| بلا مفتاح في أي مصدر | `ERROR 22023` برسالة واضحة ✓ |
| بعد إدخال المفتاح في `brc.app_secrets` | بصمة **64 خانة** = نفس ناتج `hmac` المتوقّع ✓ |
| مع ضبط الإعداد في الجلسة | الإعداد **يتقدّم** على الجدول (سلوك الإنتاج) ✓ |
| `anon` / `authenticated` / `service_role` يقرأون الجدول | `permission denied` للثلاثة ✓ |
| `verify_token` لـ`anon`/`authenticated` | مبطَلة (‏`f`)، وممنوحة لـ`service_role` فقط ✓ |

**ما يلزمك:** سطر واحد بعد الاسترجاع (من SQL Editor في مشروع الهدف، بلا أي دعم):

```sql
insert into brc.app_secrets (name, value)
values ('brc_secret', '<مفتاح الإنتاج نفسه>')
on conflict (name) do update set value = excluded.value, updated_at = now();
```

تقرأ المفتاح من مشروع الإنتاج بـ`select current_setting('app.brc_secret');`
(قراءة فقط، ولا يُرسل في المحادثة). المفتاح نفسه يبقي بصمات البطاقات القديمة صالحة.

## ١٢) إعدادات لازمة بعد الاسترجاع (لم تُغيَّر — تحتاج موافقتك)

| البند | الحالة المقيسة | الأثر إن بقي |
|---|---|---|
| `pgrst.db_schemas` | غير مضبوط ⇒ PostgREST يكشف `public` فقط | **`brc` غير مكشوفة ⇒ كل استدعاءات الواجهة تفشل (PGRST106)**. يُضاف `brc` من Dashboard → API Settings → Exposed schemas |
| سكيما `brc` في الكود | `assets/js/supabase-config.js` يستعمل `schema:'brc'` | يؤكّد الحاجة أعلاه |
| `cron.job` | 4 وظائف فعّالة، منها `brc-auto-release` **كل دقيقة** | قد تغيّر حالة `job_attempts` بعد الاسترجاع مباشرة. اقرأ أعداد التحقّق **فوراً**، وأوقف الجدولة مؤقتاً أثناء الاختبار |
| معرّف المشروع في الواجهة | مثبّت على الإنتاج في `assets/js/supabase-config.js`, `_headers`, `sw.js`, و7 صفحات | لا تُشغّل الواجهة على الهدف قبل `node tools/supabase-repoint.mjs <ref> <publishable-key>` — و**لا تفعل ذلك على فرع النشر** بلا موافقتك |

---

## ١٣) الاختبارات والبناء

| البند | النتيجة |
|---|---|
| `node tests/patch-restore-triggers.mjs` | **6/6 ناجحة** |
| `node tests/full-dump.mjs` (بناء الملف وتنفيذه من أوله لآخره) | **21/21 ناجحة** |
| تنفيذ مخرَج المولّد الجديد بدور غير superuser، بلا ترقيع | **PASS** — 16/16 مطابقة |
| `tools/restore-full-file.mjs --allow-new` — ملف ببصمة مجهولة على قاعدة محلية | **PASS**: بلا العلم يرفض بوضوح (exit 2)، ومعه يرقّع وينفّذ ويتحقّق (14 قيمة + `printed`/`spent` معلوماتية) |
| ملف **نظيف** من المولّد الجديد (لا `TRIGGER ALL`) | **PASS**: «ترقيع: لا حاجة» ثم تنفيذ كامل وPASS |
| `tests/schema.mjs` · `tests/brc-secret-fallback.mjs` · 15 اختبار استرجاع/نسخ | **338/338 · 7/7 · كلها exit 0** |
| تنفيذ كامل على قاعدة تأهيل بدور مالك غير superuser (سائق `psql`) | **PASS** — 16/16 |
| تنفيذ كامل بالسائق `pg` (‏بديل psql على ويندوز) | **PASS** — 16/16 |
| حزمة `npm test` الكاملة | **لم تُشغَّل**: تحتاج قاعدة Supabase حيّة وشبكة (محجوبة هنا)، وكثير منها يخاطب الإنتاج |
| بناء الموقع `npm run build` | **لم يُشغَّل** بعد (لا تغيير في الكود يبرّره الآن) |
| اختبار ويندوز الحقيقي | **لم يُنفَّذ** — لا جهاز ويندوز هنا؛ ملف `START-RECOVERY.bat` يبقى CRLF كما يفرض `.gitattributes` |

---

## ١٤) النواقص والأعمال غير المختبرة — صريحة

1. **الاسترجاع على الهدف: غير منفَّذ** (§٩).
2. حسابات Auth الثلاثة: غير منشأة، والدخول والصلاحيات غير مختبَرين.
3. الصور الخمس وbucket `job-images`: غير موجودة في الهدف.
4. `app.brc_secret`: **حُلَّت** — يبقى سطر إدخال واحد بعد الاسترجاع (§١١).
5. `brc` غير مكشوفة في PostgREST.
6. `cron` الأربع تعمل: تحتاج ضبطاً أثناء الاختبار.
7. `code_hash` في `recovery_chances`/`recovery_prints` وصل من التصدير بصيغة
   `restored:<serial>` — رموز الاسترجاع القديمة لا تعمل؛ الحالة (مستهلك/مطبوع)
   محفوظة كما هي.
8. لم أختبر Cloudflare/النشر ولا أي تغيير على دومين الشركة.
9. الفحص على PostgreSQL **17.11** للهدف مقابل 16.2 للتأهيل — الفارق لا يمسّ
   أي عبارة في الملف، لكنه يبقى فارقاً أُعلنه.

---

## ١٥) نسخة 2026-11-21 — فُحصت واستُرجعت، وحُدِّثت الحزمة عليها

الملف الذي نزّله المالك بعد نشر المولّد المُصلَح (2026-11-20 22:37 UTC):

| البند | القيمة |
|---|---|
| الحجم | 3,864,629 بايت · 13,251 سطراً |
| العبارات | 404 مقطعاً (403 عبارة فعلية + ذيل تعليقات) |
| SHA-256 | `d47c50857bc1806793670b68d25ec8017a1a4a8158076827c5b9a4ada893aed8` |
| `TRIGGER ALL` في الكود | **صفر** — أول نسخة من المولّد المُصلَح |
| الترقيع | **لا حاجة** («ترقيع: لا حاجة» ثم تنفيذ مباشر) |
| أعداد الترويسة | staff 3 · applicants 726 · jobs 22 · job_attempts 1537 · issued_serials 770 · registry 176 · **audit_log 3814** · settings 5 · chances 1537 · prints 726 · receipts 0 · العدّاد 176 |
| أحدث صف تدقيق | 2026-11-20 22:31 UTC — أي لقطة اللحظة |
| الأسرار | `brc.app_secrets` موجود وفارغ · لا مفاتيح ولا توكنات |
| الاسترجاع (دور غير superuser، بلا ترقيع) | `✅ PASS` — ١٤ قيمة + `printed 422` · `spent 46` · `auth_linked 0` |
| جداول `brc` | 21 — مطابقة 21 في `docs/schema.sql` بالحرف |

**أُصلح خلال هذا الفحص (عطب حقيقي وجده الاختبار من داخل الحزمة):**

1. `CHECKSUMS.sha256` كان **مستثنى من الضغط**، فلا يمكن التحقّق من الحزمة بعد فكّها — صار يُضمَّن، و`sha256sum -c` يتحقّق من 127 ملفاً بلا فشل.
2. `--allow-new` على ملف **نظيف** كان يمرّ بلا مشكلة، لكن ملفاً نظيفاً **مثبّت البصمة** كان يفشل في خطوة الترقيع؛ صار «صفر كتل = نظيف» في كل الحالات، والنقص الجزئي يبقى خطأً.
3. بصمات النسخ صارت تحمل أعدادها: `KNOWN` تُخزّن `counts`/`extra` لكل نسخة، فلا تُقارن نسخة 2026-11-21 بأرقام 2026-11-19.

**الحزمة النهائية:** `rescue/rescue-kit.zip` — 63,165,358 بايت ·
`sha256 693febb1ee150025546d27d96bccb2f0fd63ce73374a493f6ce268f09994dfd7` ·
127 ملفاً · استُرجعت **من داخل الحزمة المفكوكة** بنجاح قبل تسليمها.
