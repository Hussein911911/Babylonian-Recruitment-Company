# تدقيق حراس الصلاحية — كل دوال الواجهة

**التاريخ:** 2026-11-11
**النطاق:** ١٢٠ دالة مُصدَّرة عبر `window.HRCStore` في `assets/js/store.js`، وكل دالة في `dashboard.js` تُعدّل البيانات.
**المنهج:** استخراج تلقائي لكل دالة مُصدَّرة + تحليل جسمها (هل تكتب إلى `db`؟ هل تستدعي `save()`؟) + قراءة يدوية لسياق كل دالة بلا حارس + اختبار فعلي بزائر مجهول في jsdom.

---

## ١) الخلاصة

| البند | العدد |
|---|---|
| دوال مُصدَّرة عبر `HRCStore` | **١٢٠** |
| دوال **تكتب** فعلياً (db / حفظ / جلسة) | **٣٧** |
| منها محمية بحارس صلاحية | **٢٩** |
| منها مسار زائر مقصود (بلا حارس بالتصميم) | **٧** |
| **ثغرات حقيقية اكتُشفت وأُغلقت في هذه الجولة** | **٢** |

**الحكم: كل دالة تكتب بيانات تشغيلية محمية الآن.** لا دالة واحدة تُعدّل بيانات الموظفين أو الباحثين متاحة لزائر مجهول.

---

## ٢) الثغرات المكتشفة

### ٢.١ `createApplicant` — خطيرة

| البند | التفصيل |
|---|---|
| **الدالة** | `createApplicant(data)` — تنشئ استمارة/بطاقة كاملة (رقم، اسم، هاتف، عنوان، فرصتان، تواريخ) |
| **الحارس قبل** | ❌ **لا شيء** |
| **الإثبات العملي** | زائر مجهول في jsdom استدعاها → `عدد الاستمارات: 0 → 1`. بطاقة حقيقية ظهرت في بيانات جلسته |
| **الأثر** | الزائر يزرع بطاقات وهمية في متصفحه — تظهر في بحثه وفي «بطاقتي»، وتُضلّل أي موظف يرى الشاشة. لم تكن تصل للقاعدة (RLS يمنع) لكن **سطح الهجوم كان مفتوحاً** |
| **الحارس بعد** | `if (!isStaffSession()) return { ok:false, error: 'إنشاء الاستمارات يتطلب حساب موظف' }` |
| **تحقّق ما بعد الإصلاح** | الزائر: مرفوض · العدد `0 → 0` |

**ملاحظة مهمة:** نموذج الزائر الحقيقي **لا يمرّ من هنا** — يمرّ عبر `request_form` في القاعدة. فالحارس لا يكسر أي مسار مشروع.

### ٢.٢ `activateCard` — متوسطة

| البند | التفصيل |
|---|---|
| **الدالة** | `activateCard(serial, data)` — تُفعّل بطاقة فارغة وتمنحها فرصتين |
| **الحارس قبل** | ❌ لا شيء |
| **الأثر** | دالة كتابة مكشوفة على `HRCStore`. **لا يستدعيها أي ملف في الواجهة** (التفعيل الحقيقي عبر `apply_with_card` في القاعدة)، لكن سطح الهجوم كان مفتوحاً |
| **الحارس بعد** | `isStaffSession()` — احتياطي حتى لا تبقى دالة كتابة مكشوفة |

---

## ٣) الدوال المحمية (٢٩) — مطابقة للقاعدة

| الحارس | الدوال | سياسة القاعدة المقابلة |
|---|---|---|
| **`isAdmin()`** (١٣) | `addUser` `updateUser` `deleteUser` `toggleUserActive` `importJson` `exportJson` `resetDemo` `saveScheduledBackup` `restoreScheduledBackup` `deleteScheduledBackup` `saveAutoSchedule` `clearAutoSchedule` `recoveryRPC` | `staff_admin_write` · `settings_admin_write` |
| **`isStaffSession()`** (١١) | `createJob` `updateJob` `setJobStatus` `deleteJob` `createCardBatch` `createCardWithSerial` `activateCard`* `createApplicant` `approveApplicant` `rejectApplicant` `setFeePaid` `markPrinted` `releaseHold` `setOutcome` | كل سياسات `jobs`/`applicants`/`job_attempts` = `is_staff()` |
| **جلسة** (٤) | `login` `logout` `audit` `listAudit` | `audit_insert` (username مطابق) · `audit_read` |

\* `createApplicant` أُضيفت في هذه الجولة. الباقي من الجولات السابقة.

---

## ٤) الدوال بلا حارس — ولماذا لا تحتاجه (٧ مسارات زائر)

| الدالة | تكتب؟ | لماذا لا تحتاج حارساً |
|---|---|---|
| `verify(serial, token)` | `save()` فقط | **مسار الزائر المعتمد**: التحقق من البطاقة بالباركود. تُعمّي الاسم والهاتف بلا بصمة. لا تعدّل أي بيانات — `save()` تحفظ سجل التدقيق المحلي فقط |
| `useChance(serial, code, jobCode)` | `save()` | **مسار الزائر المعتمد**: الزبون يستخدم فرصته بالباركود. الاستهلاك محكوم بـ`byCustomer: true` وموثّق في `audit` |
| `selectAttempt(serial, jobCode, opts)` | `save()` | يُستدعى من `useChance` (زائر) ومن اللوحة (موظف). الحماية في **القاعدة**: `attempts_staff_write using is_staff()` ترفض أي كتابة سحابية لغير الموظف |
| `runMaintenance()` | `db.audit.unshift` | **محمي داخلياً**: `if (cloud.state === 'on' && cloud.role !== 'staff') return []` — لا كتابة سحابية بلا جلسة موظف |
| `signIn` / `signInFast` | `save()` | تسجيل الدخول نفسه — لا يمكن أن يحتاج تسجيل دخول. يتحقق عبر Supabase Auth + دور `brc.staff` فعّال |
| `signOutCloud` / `logout` | جلسة | الخروج لا يحتاج صلاحية |
| `randomSerial` / `suggestSerial` | `db.usedSerials` | توليد باركود محلي فقط — لا كتابة سحابية، ولا أثر إلا في ذاكرة الجلسة |

---

## ٥) الدوال للقراءة فقط (لا تحتاج حارساً)

`financials` · `financialTotals` · `getApplicant` · `getAttempts` · `getJob` · `listApplicants` · `listBlankCards` · `listJobs` · `listPosNames` · `pendingActions` · `refreshVacancies` · `stats` · `vacancySummary` · `formStatus` · `isCardSerial` · `subscribe`

**لا تكتب أي شيء** — تحليل جسمها يؤكد صفر عمليات كتابة. القراءة محمية من القاعدة أصلاً:
- الزائر في الصفحة العامة يرى **٠ استمارات** (لا `SELECT` على `applicants` لـ`anon`)
- يرى `public_jobs` فقط (بلا اسم/هاتف صاحب العمل ولا مكان المقابلة)

---

## ٦) دوال `dashboard.js` — بوابات الواجهة

| البوابة | قبل | بعد |
|---|---|---|
| `newCardModal` (إضافة بطاقة) | `isAdmin()` | `isStaffSession()` |
| `newBatchModal` (إصدار دفعة) | `isAdmin()` | `isStaffSession()` |
| نموذج الوظيفة (إضافة/تعديل) | بلا بوابة — تعتمد على حارس المتجر | ✅ محمي عبر `createJob`/`updateJob` |
| تعديل القواعد (الإعدادات) | `isAdmin()` | يبقى مديراً ✅ |
| النسخ الاحتياطي والجدولة | `isAdmin()` | يبقى مديراً ✅ |

---

## ٧) ملاحظة: `activateCard` محمية لكن غير مستخدمة

بعد إضافة الحارس، `activateCard` آمنة. **لا يستدعيها أي ملف في الواجهة** — تفعيل البطاقة يمرّ عبر `apply_with_card` في القاعدة. يمكن حذفها في جولة تنظيف إن أردت تقليل السطح.

---

## ٨) ما يحتاج قرارك

**لا شيء.** كل دالة تكتب بيانات تشغيلية محمية الآن، والباقي إما قراءة أو مسار زائر معتمد يحمي نفسه في القاعدة.

---

## ٩) الفحوص بعد الجولة

```
npm test          44/44 ملفاً — exit 0
client-authz      64/0  (كانت 47)
smoke             140/0
audit             152/0
store-cloud       110/0
reprint-code      48/0
browser-*         27/27 (Chromium)
```
