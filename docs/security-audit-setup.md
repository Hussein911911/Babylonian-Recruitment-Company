# تقوية أمن Supabase ومراقبة السياسات — 2026-11-13

> **الحالة:** مطبَّق ومُختبَر على الريبو (49 فحص صلاحيات + 334 فحص مخطط + بناء).
> **العائق:** `.github/workflows/security-audit.yml` مرفوض من GitHub App لنقص صلاحية `workflows`.

---

## 1) الثغرة التي أُغلقت — مقيسة لا مفترضة

نفّذنا المخطط كاملاً على قاعدة نظيفة (PGlite) ثم سألنا PostgreSQL نفسه:

```sql
select has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p ...
```

**النتيجة قبل الإصلاح: 17 دالة يستطيع الزائر نداءها** عبر `POST /rest/v1/rpc/<name>`،
مع أن 6 فقط مسموحة بالسياسة:

| الدالة | لماذا كانت خطرة |
|---|---|
| `set_outcome` · `select_attempt` · `release_hold` | قرارات الموظف على فرص الباحثين |
| `trg_defaults` · `trg_make_attempts` · `trg_audit` · `trg_attempt_hold` · `trg_no_duplicate_job` · `trg_log_issued_serial` | دوال مشغّلات — لا تُنادى من RPC إطلاقاً |
| `chance_code` · `new_card_print_code` | مولّدا الرموز السرية |
| `apply_with_card(text,text,jsonb)` | **توقيع قديم** ما زال حيّاً؛ إبطال التوقيع الجديد وحده لا يغطيه |

**السبب الجذري:** PostgreSQL يمنح `EXECUTE` على كل دالة جديدة لدور `PUBLIC`
تلقائياً، وكل الأدوار أعضاء في `PUBLIC`. والمخطط كان يعتمد **قائمة يدوية** من
`REVOKE` — فكل دالة تُضاف لاحقاً وتُنسى تبقى مفتوحة.

**لماذا لم يكتشفها الفحص القديم؟** `tests/schema.mjs` كان يفحص توقيعات
**غير موجودة**: `self_service_card(text)` و`apply_with_card(text,text,jsonb)`،
بينما المخطط الفعلي يعرّف `self_service_card(text,text)` و`apply_with_card(text,text,jsonb)`
للتوقيع القديم. فالفحص كان يمرّ على نصوص لا تطابق أي دالة.

---

## 2) ما تغيّر

### `supabase/migrations/20261113160000_harden_function_acls.sql` (جديد)

1. **سحب شامل** لـ `EXECUTE` من `PUBLIC` عن **كل** دوال `brc` — بمرور على
   `pg_proc` لا بقائمة يدوية، فلا تُنسى دالة.
2. **`ALTER DEFAULT PRIVILEGES`** يمنع أن تُمنح أي دالة جديدة لـ `PUBLIC` تلقائياً.
3. **إعادة منح صريحة** لمسارات الزبون الستة (`apply.html` + «بطاقتي») — كما كانت.
4. **إعادة منح صريحة** لأدوات الموظف (`authenticated`).
5. **`service_role`:** منح كل الدوال (كان يعتمد على وراثة `PUBLIC`، فكان سيتعطّل
   النسخ الاحتياطي والاسترجاع ووظائف الحافة).
6. تثبيت `search_path` على `chance_code()` — كانت الدالة الوحيدة بلا تثبيت.

كل شيء داخل `to_regprocedure(...)` → **idempotent** ويُطبَّق على قواعد بأعمار مختلفة بلا خطأ.

### `docs/schema.sql` (+ نظيره المولَّد بالمزامنة)

- إضافة السحب الشامل والافتراضيات داخل قسم الصلاحيات.
- **إصلاح ثلاثة أسطر كانت تكسر المخطط من الصفر:**
  `grant … brc.lookup_card(text)` و`revoke/grant … brc.self_service_card(text)`
  يشيرون إلى توقيعات غير موجودة → `function brc.lookup_card(text) does not exist`
  وتوقّف تنفيذ المخطط بالكامل. صارت `(text, text)`.
- `grant usage on schema brc` و`grant execute on all functions` لـ `service_role`
  في **آخر** الملف (السطر يشمل ما هو مُعرَّف حتى لحظة تنفيذه فقط).

### `tests/function-acl-audit.mjs` (جديد — 49 فحصاً)

يقيس **السلوك** لا النصّ، على قاعدة حقيقية:

- 0 دالة ترث `EXECUTE` من `PUBLIC`.
- `anon` يصل إلى 6 دوال بالضبط، وكلها مسارات زبون.
- دوال المشغّلات والتوقيعات القديمة محجوبة عن الجميع.
- `service_role` يصل إلى الكل (حماية النسخ الاحتياطي).
- دالة تُنشأ **الآن** تبدأ بلا صلاحية (اختبار المنع الاستباقي).
- الترحيل يُطبَّق على قاعدة **فيها الثغرة** ويغلقها (محاكاة ترقية حقيقية).
- **نداءات فعلية بدور `anon`**: `self_service_card` و`lookup_card` تنجح،
  و`set_outcome`/`select_attempt`/`chance_code`/`activate_card`/`trg_defaults`
  تُرفض بـ `42501`.

### `tools/security-monitor.mjs` (جديد)

أداة مراقبة بثلاثة أوضاع، وسياسة الأمان مكتوبة صراحةً داخل الملف:

```bash
node tools/security-monitor.mjs --capture          # تحديث docs/security-baseline.json
node tools/security-monitor.mjs --compare          # يفشل عند أي انحراف
node tools/security-monitor.mjs --verify live.json # قاعدة حيّة
```

تصنّف الانحراف: `⛔ حرج` (منح زائد · `PUBLIC` عاد · `search_path` مفقود) مقابل
`⚠️ تحذير` (منح مسحوب قد يكسر مساراً) مقابل `ℹ️ معلومات`.

### `docs/security-audit.sql` (جديد) — 8 فحوص قراءة فقط

آمن على الإنتاج (لا `INSERT`/`UPDATE`/`DELETE`/DDL). يُرجع جدولاً بكل دالة
وكل دور، وملخّصاً من 8 أسطر (`PUBLIC` الموروث · منح زائد للزائر · مسارات
الزبون الستة · `search_path` · دوال المشغّلات · جداول بلا RLS · سياسات
`using true` · views تتجاوز RLS)، ثم JSON جاهزاً لـ `--verify`.

### `tools/security-audit.sh` + `.github/workflows/security-audit.yml`

كل المنطق في السكربت (صلاحيات → سياسة → مخطط → بناء). الـ workflow غلاف
جدولة يومي (03:15 بغداد) فقط.

---

## 3) العائق: صلاحية `workflows`

```
! [remote rejected] (refusing to allow a GitHub App to create or update
   workflow `.github/workflows/security-audit.yml` without `workflows` permission)
```

هذا رفض **من مستوى المنصة** عند استقبال الـ ref — يحدث قبل أي فحص للمحتوى.
لا يُعالج بإعادة الربط، ولا بتراجع عن الملف، ولا بحساب جديد: البصمة التي
يوقّعها GitHub App لا تحمل النطاق `workflows`، والخادم يرفض الـ push كاملاً
(بما فيه الترحيل الأمني نفسه).

### الحل: أمر واحد للمالك

**Settings → Applications → تكامل GitHub → Permissions → Workflows: Read & write**

أو من رابط التثبيت: `https://github.com/settings/installations` → اختر التكامل
→ **Configure** → **Workflows: Read and write** → **Save**.

بعدها يُرفع كل شيء بأمر واحد (بدون قوة دفع ولا تحايل):

```bash
git push origin arena/b0022962-babylonian-recruitment-company
```

### حتى تُمنح الصلاحية

لا شيء معطَّل. المنطق كله يعمل الآن محلياً:

```bash
npm run security:audit    # 4 مراحل، كاملة
npm run test:acl          # 49 فحص صلاحيات
```

وبعد الرفع، **الملف الوحيد المرفوض** هو `.github/workflows/security-audit.yml`.
إن أردت رفع الباقي فوراً، ارفعه بلا هذا الملف عبر:

```bash
git rm --cached .github/workflows/security-audit.yml
git commit -m "أمن: تقوية صلاحيات الدوال (الـworkflow يُضاف بعد منح الصلاحية)"
git push origin arena/b0022962-babylonian-recruitment-company
```

الملف محفوظ في الريبو المحلي ويعود بأمر `git add` واحد بعد منح الصلاحية.

---

## 4) ما لم يُلمس (طلب صريح)

| القيد | الحالة |
|---|---|
| لا حذف/تعديل بيانات العملاء | الترحيل لا يحوي `DELETE`/`UPDATE`/`TRUNCATE` — فحص في `function-acl-audit` |
| `apply.html` وخدمة البطاقة الذاتية | المسارات الستة تعمل — يثبته **نداء فعلي** بدور `anon` لا قراءة نصّ |
| الرموز القديمة (440 بطاقة/880 محاولة) | لم تُمسّ؛ لم يُنشأ رمز ولم يُبطَل رمز |
| قاعدة Supabase الحيّة | لم يُطبَّق عليها شيء من هذه الجلسة |

⚠️ **الملاحظة الوحيدة على الحيّة:** الترحيل `20261113160000` سيُطبَّق تلقائياً
عند الدمج في `main` (تكامل GitHub في Supabase). وهو آمن عليك لأن السحب الشامل
**يعيد المنح فوراً في نفس الملف**، لكن بعده يجب أن يعمل التحقق الحيّ:

```bash
# نفّذ الكتلة (ج) في docs/security-audit.sql على القاعدة الحيّة → live.json
node tools/security-monitor.mjs --verify live.json
```

يجب أن تكون النتيجة `✅ لا انحراف` مع 6 مسارات زبون. إن ظهر `⛔` فأرجِع الدمج فوراً.

---

## 5) حدود التحقق في هذه البيئة

| ادّعاء | الحالة الحقيقية |
|---|---|
| `npm test` | ❌ **يفشل** عند `tests/portable-viewer.mjs` و`tests/two-file-restore.mjs`: الحزمة `playwright-core` غير مثبّتة ولا موجودة في `package-lock.json`. **فشل موجود قبل هذه التعديلات** (تحققنا عليه على `1c4d766` بعد إخفاء التعديلات). كل الاختبارات الأخرى — ومنها 12 اختبار شبكة/قاعدة — تمرّ. |
| `npm run build` | ✅ نجح |
| التدقيق المرجعي 34/34 | لا يوجد أثر لهذا الرقم في الريبو. البديل المُنشأ هنا: `test:acl` **49/49** + `test:schema` **334/334**. |
| تدقيق Supabase الحيّ 13/13 | ❌ غير مُتحقَّق منه: لا وصول لـ `*.supabase.co` من هذه البيئة (قائمة نطاقات مسموحة). بديله `docs/security-audit.sql` جاهز للتنفيذ عندك. |
