# حذف «المنطقة» وحذف رمز صاحب العمل نهائياً — 2026-10-25

ملف واحد يشرح التغييرين اللذين طلبهما المالك: **لا منطقة بعد اليوم (المحافظة وحدها)**،
و**لا رمز سري لصاحب العمل** — فمسار صاحب العمل كان قد حُذف أصلاً، وبقي رمزه بلا مستخدم.

---

## 1) «المنطقة» حُذفت من كل مكان — المحافظة هي المرجع الجغرافي الوحيد

| الموضع | قبل | بعد |
|---|---|---|
| بطاقة الوظيفة في الموقع العام | محافظة + منطقة | **محافظة** فقط |
| نافذة تفاصيل الوظيفة | صف «المنطقة» | صف «المحافظة» فقط |
| نموذج إضافة/تعديل وظيفة (اللوحة) | `#f-region` + `regionsList` | حُذف الحقل — يبقى `#f-governorate` |
| جدول الوظائف في اللوحة | عمود «المنطقة» | عمود «المحافظة» |
| نموذج «بيع وتعبئة بطاقة» (لوحة/نقطة البيع) | «منطقة السكن» `#n-region` | «المحافظة» `#n-gov` (١٩ محافظة) |
| متصفح الوظائف داخل استمارة نقطة البيع | فلتر منطقة | فلتر **محافظة** (`jobF.gov`) |
| صفحة التقديم `apply.html` | حقل القضاء/المنطقة `#f-dist` | حُذف — محافظة + أقرب نقطة دالة |
| شهادة التحقق / استمارة A4 / الملخصات | «المنطقة» | «المحافظة» |
| `HRC_CONFIG` | `regions: [...]` (١٣ منطقة) | حُذفت المصفوفة نهائياً |

- الحقل `region` بقي في **صف الوظيفة** كعمود تاريخي فارغ (`''`) حتى لا تنكسر
  الاسترجاعات والمزامنة، لكن لا واجهة تقرأه ولا تكتبه.
- «مكان العمل» في ردود القاعدة (`lookup_card` · `verify_form` · `verify_card_code` ·
  `activate_card`) صار `j.governorate` بدل `j.region`، وكذلك في المتجر والمزامنة
  (`attempt.location`).

---

## 2) رمز صاحب العمل (Employer PIN) حُذف نهائياً

المسار كان قد أُزيل من الموقع في جولة سابقة (2026-10-23)، وبقي رمزه في اللوحة
وفي القاعدة بلا أي مستخدم. الآن أُكمل الحذف:

**حُذفت ملفات:** `employer.html` · `assets/js/employer.js` · `assets/css/employer.css`
(وأُزيلت من قائمة كاش `sw.js`).

**حُذف من الكود:**
- `dashboard.js`: حقلَي «الرمز السري» و«تأكيده» (`#f-epin`, `#f-epin-confirm`)،
  مُطبِّع الإدخال، مسار `saveJobWithPin`، شارة `employerPinSet` في جدول الوظائف.
- `store.js`: `saveJobWithPin` · `employerView` · `employerDecide` ·
  `cardEmployerView` · `cardEmployerDecide`.
- `cloud.js`: `employerViewRpc` · `employerDecideRpc` وحقل `employerPinSet`.
- `booking.js`: بوابة الدور، مسار `?role=employer`، شاشات صاحب العمل، زر
  «أنا صاحب العمل». الرابط القديم يفتح الآن **بطاقة الزبون** مباشرة.

**في القاعدة** (`docs/schema.sql` + هجرة `20261026000000_remove_employer_pin_and_region.sql`):
- إسقاط `staff_save_job_pin` · `employer_pin_login` · `employer_pin_action` وكل
  `employer_otp_%`، وإسقاط العمود `jobs.employer_pin_set`.
- إبقاء **جداول الاعتماد القديمة فارغة** (`employer_job_credentials` ·
  `employer_login_budget`) لأن دوال الاسترجاع التشغيلي تلتقط لقطاتها — لا رمز فيها
  بعد اليوم وهي مسحوبة الصلاحيات عن المتصفح.

**الاختبارات المحذوفة:** `employer-otp.mjs` · `employer-pin.mjs` · `employer-entry.mjs`
(وأُخرجت من `test:all`). وأُضيف بديل صريح: فحص أن النموذج بلا رمز، وأن الرابط القديم
لا يفتح صفحة صاحب عمل.

---

## 3) إصلاح عَرَضي مهم أثناء الحذف

حذف صادرات صاحب العمل من `store.js` أخذ معه بالخطأ **`cardActivate`** من صادرات
`HRCStore`، فصار زر «إتمام» في استمارة نقطة البيع يرمي استثناءً متزامناً **قبل**
إعادة `busy = false` — أي أن النافذة تتجمّد بلا رسالة ولا نتيجة. أُعيد التصدير،
وأُضيف حارس: أي انكسار متزامن في `Store.cardActivate` يُحوَّل وعداً مرفوضاً فيصل
إلى `.catch` ويُفرِّغ `busy` ويعرض السبب داخل الشاشة (لا توستاً عابراً).

---

## 4) التحقق

| الحزمة | النتيجة |
|---|---|
| `tests/e2e.mjs` | ✅ 146 / 0 |
| `tests/smoke.mjs` | ✅ 138 / 0 (+٢ فحص جديد للمحافظة) |
| `tests/audit.mjs` | ✅ 151 / 0 |
| `tests/schema.mjs` | ✅ 93 / 0 |
| `tests/store-cloud.mjs` | ✅ 96 / 0 |
| `tests/cloud.mjs` | ✅ 102 / 0 |
| `tests/cloud-http.mjs` | ✅ 14 / 0 |
| `tests/perf.mjs` | ✅ 37 / 0 |
| `npm run test:all` | ✅ كل الحزم خضراء |

فحوص جديدة دائمة:
- نموذج «بيع وتعبئة بطاقة» يعرض «المحافظة» (`#n-gov` بـ١٩ محافظة) وبلا «المنطقة».
- `HRC_CONFIG` بلا مصفوفة `regions` إطلاقاً.

---

## 5) ما طُبِّق فعلاً على قاعدة الإنتاج (2026-10-25)

المشروع `vqsvztudvfukyuerzcgx` — نُفِّذت ثلاث هجرات وتم التحقق منها استعلامياً:

| الهجرة | الأثر المُتحقَّق |
|---|---|
| `retire_chance_codes` | `chance_code` صار بلا default وبلا NOT NULL، و`use_chance` تقبل الباركود وحده |
| `remove_employer_pin_and_region` | صفر دوال PIN/OTP، العمود `jobs.employer_pin_set` انحذف، `region` اختياري بقيمة `''`، والعرض `working_jobs` أُعيد إنشاؤه بالتعريف نفسه وبصلاحياته |
| `fix_verify_card_code_print_column` | إصلاح عطل حيّ (تحت) |
| `drop_dormant_employer_functions` | صفر دوال `employer%` على القاعدة (تحت) |

**عطل حيّ اكتُشف أثناء التطبيق:** قاعدة الإنتاج أُنشئت قبل الهجرة
`20261016090000` فليس فيها العمود `card_print_code`، وكانت `verify_card_code`
تقرأه مباشرةً (`f.card_print_code`) ⇒ **كل** نداءات «إعادة طباعة البطاقة» تفشل
بـ `42703`. صار الحقل يُقرأ عبر `to_jsonb(f)->>'card_print_code'` (يعيد NULL
بلا خطأ إن غاب العمود). **لم نُضف العمود** لأن أي تغيير في مخطّط `brc` يغيّر
`recovery_schema_hash()` فيُبطل نسخ الاسترجاع القديمة (`recovery_read` يرفضها).

**فحص وظيفي داخل معاملة تُلغى (rollback) — بلا أي أثر على البيانات:**
- إنشاء بطاقة اختبار ⇒ إنشاء فرصتين تلقائياً = 2 ✅
- `use_chance(serial, '', job)` = `ok:true` والفرصة الأولى `reserved` ✅
- `activate_card(...)` من نقطة البيع = `ok:true` والفرصة `reserved` و`chance_code` = NULL بلا خطأ ✅
- `lookup_card` ⇒ `location` = **المحافظة** (`بابل`) لا المنطقة ✅
- `verify_card_code(serial, '')` = `ok:true` مع فرصتين للطباعة ✅

بعد الفحص: `HRC-BC-TST%` = 0 صف (لا بيانات اختبار باقية)، وعدد البطاقات الحقيقية 440 كما هو.

## 5ب) حذف دوال صاحب العمل الميتة (2026-10-25)

بقيت ثلاث دوال على القاعدة بعد حذف المسار، ففحصناها قبل الحذف وثبت أنها بلا أي فائدة:

| الفحص | النتيجة |
|---|---|
| أي واجهة تنادي عليها (JS/HTML) | ❌ لا شيء |
| أي دالة أو عرض يعتمد عليها (`pg_depend` + مسح نصوص الدوال) | ❌ لا شيء |
| أي مهمة `pg_cron` تلمسها | ❌ لا شيء (المهام: `run_auto_release` · `recovery_weekly` · `archive_finished_cards`) |
| صلاحية النداء | `postgres` وحده — مسحوبة من `anon` و`authenticated` و`service_role` |

المحذوفة: `employer_view(text)` · `employer_decide(text,text)` ·
`employer_decide(text,text,text)` · `employer_decide_original(text,text)` (نسخة منسية)
و`employer_otp_issue/delivery/verify/action`.

**الجداول بقيت** (`employer_otp` · `employer_job_credentials` · `employer_login_budget`)
فارغة ومسحوبة الصلاحيات، لأن `recovery_save`/`recovery_restore` تلتقطها في نسخها.
نُظّفت أيضاً من **المصدر** `docs/schema.sql` (كان يعيد إنشاء دوال OTP في أي قاعدة جديدة)
وصار عدد تعريفات الدوال 49 (47 فعلية).

فحص وظيفي بعد الحذف (داخل معاملة أُلغيت — بلا أثر): `use_chance` ✅ ·
`lookup_card` ✅ (`location` = بابل) · `verify_card_code` ✅ · `recovery_save` ✅
(أنشأ نسخة سليمة) — والبطاقات 440 كما هي.

## 5ج) حذف مسار التحديث اليدوي القديم (2026-10-25)

`db-update.html` (157KB) كانت صفحة «انسخ والصق في SQL Editor» بسبعة أجزاء.
لم تكن جزءاً من `dist`، لكن المستودع نفسه هو ما يُنشر على Cloudflare Pages،
فالصفحة كانت **متاحة للعامة**. وخطرها حقيقي:

- أجزاء فيها (`sql3`, `sql4`, `sql6`) تُعيد إنشاء `brc.employer_view` و
  `brc.employer_decide` وتمنحهما `anon` — أي تُرجع مسار صاحب العمل الذي أُزيل.
- أجزاء أقدم تُعيد `chance_code` ورموز الفرص الملغاة.
- نصوصها منسوخة من مخطّط قديم، فتتضارب مع `docs/schema.sql` بلا أن يلاحظ أحد.

**ما نُفِّذ:** حُذفت الصفحة، وأُرشفت ملفات `docs/UPDATE-*.sql` العشرة في
`docs/archive/legacy-sql/` مع `README.md` يوضّح أنها تاريخية ولا تُنفَّذ،
وأُضيف تحويل في `_redirects` من `/db-update` و`/db-update.html` إلى الرئيسية
حتى لا يصطدم من يحفظ الرابط بـ404. وحُدِّثت الإشارات في
`README` · `deploy-cloudflare.md` · `pre-delivery-checklist.md` ·
`binding-status.md` · `مواصفات-بطاقة-التوظيف.md`.

**عطل كان قائماً واكتُشف هنا:** `tools/dist.mjs` كان ما زال يسرد
`employer.html` المحذوف، فكان `npm run dist` يفشل بـ«ملفات مفقودة من الجذر»
ويتوقف قبل بناء مجلد النشر. أُزيل من القائمة، والبناء الآن ينجح (71 ملفاً).

`tests/schema.mjs` صار يمنع الرجوع: لا صفحة `db-update.html` · لا ملف
`docs/UPDATE-*.sql` في مكانه · لا صفحة تشير إليه · وكل هجرات 2026-10-25
موجودة فعلاً.

## 6) خطوات مطلوبة على القاعدة الحيّة (لأي بيئة أخرى)

```bash
# 1) إلغاء رموز الفرص
#    supabase/migrations/20261025000000_retire_chance_codes.sql
# 2) حذف رمز صاحب العمل + تحرير عمود المنطقة + مكان العمل = المحافظة
#    supabase/migrations/20261026000000_remove_employer_pin_and_region.sql
# 3) إصلاح verify_card_code على قاعدة بلا card_print_code
#    supabase/migrations/20261026100000_fix_verify_card_code_print_column.sql
# 4) حذف دوال صاحب العمل الميتة (employer_view · employer_decide · employer_otp_*)
#    supabase/migrations/20261026110000_drop_dormant_employer_functions.sql
```

الهجرة آمنة للتكرار، وتُعدّل نص دوال القاعدة القائمة (`pg_get_functiondef` +
`replace`) بدل إعادة كتابة مئات الأسطر، فلا تُعاد الكتابة بعد أول تشغيل.
تُنفَّذ من SQL Editor في Supabase، وتنتهي بـ`notify pgrst, 'reload schema'`.

> ملاحظة: إعادة بناء الصفحات (`node tools/build.mjs` و`--light`) وكاش
> الخدمة `hrc-cache-v68` مطلوبان بعد هذا التغيير حتى لا يبقى HTML قديم عند الزوار.
