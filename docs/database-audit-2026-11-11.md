# فحص شامل لقاعدة البيانات ومطابقة السياسات للواجهة

**التاريخ:** 2026-11-11
**المشروع:** `vqsvztudvfukyuerzcgx` (brc) — سكيما `brc`
**المنهج:** جرد كامل من `pg_catalog` + استدعاءات فعلية بدور `anon` + مطابقة كل سياسة مع حراسة `store.js` والواجهة.

---

## ١) الخلاصة التنفيذية

| البند | النتيجة |
|---|---|
| جداول السكيما | ٢٠ — **كلها RLS مفعّل** |
| سياسات RLS | ١٨ على ٦ جداول؛ ١٤ جدولاً بلا سياسة = **بلا أي صلاحية للمتصفح** |
| صلاحيات `anon` | **صفر** على كل الجداول العشرين (SELECT/INSERT/UPDATE/DELETE) |
| دوال `SECURITY DEFINER` | ٤٤ — **كلها** بلا استثناء تحمل `search_path` مثبّتاً |
| `service_role` أو كلمة مرور في المستودع | **لا شيء** — المفتاح العام فقط |
| مشاهد تتجاوز RLS | `public_jobs` عمداً — أعمدة صاحب العمل غائبة تماماً |
| مخزون ملفات (Storage) | صفر bucket — لا سطح هجوم |

**الحكم: لا توجد ثغرة حرجة أو عالية.** وجدت **ملاحظتين متوسطتين** وثلاث ملاحظات منخفضة، مفصّلة أدناه.

---

## ٢) مطابقة السياسات للواجهة — الجدول الكامل

| الجدول | العملية | السياسة | الشرط | الواجهة | متطابقة؟ |
|---|---|---|---|---|---|
| `jobs` | SELECT | `jobs_staff_all` | `is_staff()` | `listJobs` للموظف، و`public_jobs` للزائر | ✅ |
| `jobs` | INSERT | `jobs_staff_write` | `is_staff()` | `createJob` → `isAdmin()` | ⚠️ م١ |
| `jobs` | UPDATE | `jobs_staff_update` | `is_staff()` | `updateJob`/`setJobStatus` → `isAdmin()` | ⚠️ م١ |
| `jobs` | **DELETE** | `jobs_staff_delete` | `is_staff()` | `deleteJob` → `isStaffSession()` | ✅ **مطابقة تامة** |
| `applicants` | SELECT | `applicants_staff_read` | `is_staff()` | `listApplicants` | ✅ |
| `applicants` | INSERT | `applicants_staff_insert` | `is_staff()` | `createCardBatch` → `isAdmin()` | ⚠️ م١ |
| `applicants` | UPDATE | `applicants_staff_update` | `is_staff()` | `approve/rejectApplicant`, `setFeePaid`, `markPrinted` → `isStaffSession()` | ✅ |
| `applicants` | DELETE | `applicants_admin_delete` | `is_admin()` | **الواجهة لا تحذف إطلاقاً** (أرشفة فقط) | ✅ لا تعارض |
| `job_attempts` | ALL | `attempts_staff_write` | `is_staff()` | `releaseHold`, `setOutcome` → `isStaffSession()` | ✅ |
| `job_attempts` | SELECT | `attempts_staff_read` | `is_staff()` | `getAttempts` | ✅ |
| `audit_log` | SELECT | `audit_read` | `is_admin()` أو صفوفه فقط | اللوحة تعرض سجل الموظف | ✅ |
| `audit_log` | INSERT | `audit_insert` | `is_staff()` + `username` مطابق | `audit()` | ✅ |
| `audit_log` | UPDATE/DELETE | `audit_no_update`/`audit_no_delete` | `false` | لا تعديل ولا حذف — **سجل غير قابل للعبث** | ✅ |
| `staff` | SELECT | `staff_self_read` | نفسه أو المدير | اللوحة | ✅ |
| `staff` | ALL | `staff_admin_write` | `is_admin()` | `deleteUser`/`toggleUserActive` → `isAdmin()` | ✅ |
| `settings` | SELECT | `settings_read` | `is_staff()` | اللوحة | ✅ |
| `settings` | ALL | `settings_admin_write` | `is_admin()` | `importJson` → `isAdmin()` | ✅ |

---

## ٣) الملاحظات

### م١ — ✅ حُلَّت (قرار المالك 2026-11-11): الموظف يدير الوظائف والبطاقات كاملة

**قرار المالك:** «اريد القاعده والواجهة تسمح للموضف ... مثل انشاء بطاقات ووظائف وتعديلهن».

**الواجهة — `store.js`:** خمس دوال حارسها صار `isStaffSession()`:

| الدالة | قبل |
|---|---|
| `createJob` | `isAdmin()` |
| `updateJob` | **بلا أي حارس إطلاقاً** |
| `setJobStatus` | `isAdmin()` |
| `createCardBatch` | `isAdmin()` |
| `createCardWithSerial` | `isAdmin()` |

**الواجهة — `dashboard.js`:** بوابة نافذتي إضافة البطاقة وإصدار الدفعة → `Store.isStaffSession()`.

**القاعدة — migration `staff_full_operations`:** `applicants_admin_delete` → `applicants_staff_delete using brc.is_staff()`.

**النتيجة: ٨ سياسات من ٨ على `is_staff()`**

| الجدول | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `jobs` | is_staff | is_staff | is_staff | is_staff |
| `applicants` | is_staff | is_staff | is_staff | is_staff |
| `job_attempts` | is_staff | is_staff | is_staff | is_staff |

**إثبات على القاعدة الحقيقية** بدور محمد (`is_staff=true, is_admin=false`) داخل معاملة أُلغيت: الإدراج + التعديل + الحذف نجحت كلها، وبعد الـrollback ٢١ وظيفة وصفر بقايا. وبدور `anon`: `permission denied for table jobs`.

**⚠️ ثغرة أُغلقت:** `updateJob` كانت **بلا أي حارس** — أي زائر في الصفحة العامة كان يستطيع تعديل أي وظيفة من وحدة التحكم. لم يرصدها تدقيق 2026-11-09. أُغلقت الآن.

### م٢ — ✅ قرار المالك: سلوك مقصود، لا تغيير

**قرار المالك:** «اعرف كل شخص او زائر يمتلك باركود البطاقه يكدر يدخل يشوف تفاصيلها وهذا هو سير نضامنا».

أي أن كشف تفاصيل البطاقة — بما فيها بيانات صاحب العمل ومكان المقابلة — لمن يملك الباركود هو **سير النظام المعتمد**، لا ثغرة. الباركود نفسه هو إثبات الحيازة، ورقمه عشوائي ١٠ خانات من أبجدية ٣١ حرفاً (≈ ٨×١٠¹⁴ احتمالاً). **أُبقي السلوك كما هو.**

### م٣ (منخفضة) — `self_service_card` ترجع الملف الشخصي كاملاً بلا تعمية

ترجع `profile` = `self_application_data` (الاسم، الهاتف، العنوان، تاريخ الميلاد) لأي زائر يعرف رقم البطاقة. **لا ترجع بيانات صاحب العمل.**

رقم البطاقة عشوائي ١٠ خانات، فالمخاطرة عملية التخمين صفر. لكن نفس ملاحظة م٢: من يرى البطاقة يحصل على بيانات صاحبها.

---

### م٤ (منخفضة) — ثلاث دوال بـ`GRANT` صريح لـ`anon` لكنها ترفض داخلياً

`release_hold` و`set_outcome` و`select_attempt` كانت تُظهر `anon` فقط لأن ACL يحوي `authenticated` لا `anon`. تحققت من الكود: **كلها تبدأ بـ`if not brc.is_staff() then return ... 'غير مصرّح'`**. أي أنها محمية مرتين (الصلاحية + الحارس الداخلي). **لا إجراء مطلوب.**

---

### م٥ (منخفضة) — `employer_*` جداول يتيمة بلا سياسات ولا صلاحيات

`employer_job_credentials`, `employer_login_budget`, `employer_otp` تحتوي `pin_hash`/`code_hash`/`session_hash`. **لا سياسات، ولا صلاحيات لأي دور متصفح، ولا وصول للزائر.** بوابة واتساب القديمة متقاعدة وفق `docs/employer-job-pin.md`. **آمنة لكنها مساحة ميتة.**

**التوصية النهائية قبل التسليم:** إبقاؤها لا يضر (صفر صلاحيات). حذفها في جولة تنظيف منفصلة إن أردت تقليل سطح الهجوم البصري.

---

## ٤) ما تحقّق أنه سليم

| الفحص | النتيجة |
|---|---|
| RLS مفعّل على كل جدول | ✅ ٢٠/٢٠ |
| `anon` يقرأ جداول الموظفين | ❌ صفر صلاحية — لا SELECT على أي جدول |
| `public_jobs` تكشف اسم/هاتف صاحب العمل | ❌ الأعمدة غائبة تماماً من تعريف المشهد |
| `public_jobs` تكشف مكان المقابلة | ❌ غائب |
| `verify_form` بلا بصمة | ✅ تُعمّي الاسم والهاتف (`ح•••••••••` / `0771•••••34`) |
| `verify_form` ترجع `chance_code` بلا بصمة | ❌ `null` |
| `lookup_card` | ✅ تُعمّي الاسم والهاتف |
| `audit_log` قابل للتعديل أو الحذف | ❌ سياستا `false` — سجل غير قابل للعبث |
| دوال `SECURITY DEFINER` بلا `search_path` | ❌ **صفر** — كل الـ٤٤ مثبّتة (يصدّ هجوم schema hijacking) |
| `service_role` في المستودع | ❌ المفتاح العام فقط |
| كلمة مرور قاعدة في المستودع | ❌ |
| Storage buckets | ❌ صفر |
| `_redirects`/`_headers` تكشف مسارات داخلية | ✅ لا |

---

## ٥) أرقام القاعدة الحالية

| البند | العدد |
|---|---|
| الوظائف | ٢١ |
| الاستمارات | ٦٥٠ |
| الموظفون | ٣ (مديران + موظف) |
| سجل التدقيق | ٣٤٥٩ |
| الـmigrations | ٢٧ (آخرها `jobs_staff_delete`) |

---

## ٦) ما يحتاج قرارك

1. **م١** — الموظف: هل يضيف/يعدّل وظائف بنفسه (توسيع الواجهة)، أم نمنعه في القاعدة (تشديد)؟ **حالياً: الواجهة تمنعه والقاعدة تسمح.**
2. **م٢** — `customer_application_details`: هل نضيف بصمة ظهر البطاقة، أم نبقيها مفتوحة (الزائر يحتاجها للمقابلة)؟

الباقي (م٣، م٤، م٥) لا يحتاج إجراءً للتسليم.

---

## ١٠) تحديث 2026-11-11 (ثانٍ) — إصدار البطاقات حصرياً للمدير

**قرار المالك:** «اريد اصدار البطاقات فقط حصريا من المدير».

### عدم تطابق وُجد وأُصلح

| الطبقة | قبل | بعد |
|---|---|---|
| `newCardModal` / `newBatchModal` | `isStaffSession()` | ✅ `isAdmin()` |
| `createCardBatch` / `createCardWithSerial` | `isStaffSession()` | ✅ `isAdmin()` |
| زرّا الإصدار في الواجهة | ظاهران للموظف | ✅ `data-admin-only` |
| **`applicants_staff_insert` (القاعدة)** | **`is_staff()`** | ✅ **`applicants_admin_insert using is_admin()`** |

**الإثبات على القاعدة الحقيقية** بدور محمد (`is_admin=false`):
```sql
insert into brc.applicants(serial,full_name,phone,status) values ('ZZ-CARD-01',…);
→ inserted_by_staff = 1     ← نجح قبل الإصلاح ⚠️
rollback;
```
بعد الـmigration: `ERROR 42501: new row violates row-level security policy`. وبدور المدير: نجح ✅.

### ما بقي للموظف (لم يتغيّر)

`SELECT` · `UPDATE` (اعتماد/رفض/رسوم/طباعة) · `DELETE` — كلها `is_staff()`.
**الفرق الوحيد: لا يستطيع إصدار بطاقة جديدة.**

### الحالة النهائية لسياسات `applicants`

| العملية | السياسة | الطبقة |
|---|---|---|
| SELECT | `applicants_staff_read` | `is_staff()` — موظف + مدير |
| INSERT | `applicants_admin_insert` | **`is_admin()` — مدير فقط** |
| UPDATE | `applicants_staff_update` | `is_staff()` — موظف + مدير |
| DELETE | `applicants_staff_delete` | `is_staff()` — موظف + مدير |
