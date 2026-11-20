# نسخة الطوارئ — استعادة المنظومة على مشروع جديد (بلا هذا المستودع)

> الغرض: لو توقّف المشروع الحالي لأي سبب، تُعيد المنظومة كاملة على مشروع
> Supabase جديد ومستودع جديد من هذه الحزمة وحدها — بلا إنترنت إلا للتنزيل والنشر.
> كل خطوة هنا مُختبرة فعلياً على قاعدة PostgreSQL حقيقية، وما لم يُختبر مذكور.

---

## ١) ماذا في الحزمة — وماذا **ليس** فيها

| داخل الحزمة | خارجها (يجب أن تحفظه بنفسك) |
|---|---|
| `database/HRC-FULL-*.sql` — الهيكل + كل البيانات (نسخة 2026-11-21، بصمتها مثبّتة في الأداة) | 🔑 **قيمة `brc_secret`** — مفتاح بصمة البطاقات |
| `database/schema.sql` + `schema-live-inventory.json` | 👤 **كلمات مرور الحسابات الثلاثة** (لا تُصدَّر أبداً) |
| `database/03-…sql` · `04-…sql` — كتلتا المشغّلات + مفتاح البصمة | 🖼️ **ملفات الصور** — تُرفع من `storage/job-images/jobs/` |
| `config/recreate-cron.sql` · `storage-restore.sql` · `auth-settings.md` | 📌 نسخة من هذه الحزمة في مكانين مختلفين على الأقل |
| `recovery-tools/` — منفّذ الملف الكامل + الترقيب + قارئ الترويسة | |
| `source-code.zip` — الكود كاملاً عند commit البناء | |
| `site-ready-to-deploy/` — الموقع مبنيّاً (يشير إلى المشروع **القديم**) | |
| `CHECKSUMS.sha256` — بصمة كل ملف | |

⚠️ **الحزمة تحتوي بيانات شخصية** (أسماء وهواتف أصحاب البطاقات). لا ترفعها إلى
Git ولا إلى قرص مشترك. احفظها مشفّرة أو على وسيط خاص.

⚠️ ملف الـSQL **لا يحمل** الصور ولا الحسابات ولا المفتاح — هذه الثلاثة هي
أكثر ما يُنسى، وبفقدانها يفشل «كل شي شغال» يوم الحاجة.

---

## ٢) يوم الحاجة — بالترتيب

### الخطوة ٠ — تحقّق من سلامة الحزمة أولاً
```bash
unzip rescue-kit.zip && cd rescue
sha256sum -c CHECKSUMS.sha256        # يجب أن تكون كلها OK
```

### الخطوة ١ — مشروع Supabase جديد
- أنشئ المشروع، واحفظ كلمة مرور قاعدة البيانات في مدير كلمات المرور.
- **غير مجاني:** مشروع مجاني خامل يُوقَف بعد ~٩٠ يوماً — النسخة الاحتياطية
  الحقيقية هي هذه الحزمة، لا المشروع الفارغ.

### الخطوة ٢ — استرجاع البيانات (الخطوة الحاسمة)
```bash
node recovery-tools/restore-full-file.mjs database/HRC-FULL-*.sql \
  --dsn "postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres" \
  --yes
```
- نسخة 2026-11-21 بصمتها معروفة للأداة: تُنفَّذ بلا أي علم إضافي.
- أي ملف أحدث منها: أضف `--allow-new` (تُقرأ الأعداد من ترويسته).
- أي ملف نُزّل قبل 2026-11-20: يُرقَّع تلقائياً بلا تدخّل.
- لا تلصق الملف في محرّر SQL: يقصّ عند ~٢٠٠٠ سطر ويقول Success وهو ناقص.
- النهاية المطلوبة: `✅ PASS` مع أعداد مطابقة. بلا PASS لا تكمل.

### الخطوة ٣ — مفتاح البصمة (سطر واحد)
```sql
insert into brc.app_secrets (name, value)
values ('brc_secret', '<القيمة من مدير كلمات المرور>')
on conflict (name) do update set value = excluded.value, updated_at = now();

select length(brc.verify_token('HRC-BC-000120'));   -- يجب 64
```

### الخطوة ٤ — إعدادات المشروع (لوحة Supabase)
1. `Project Settings → API → Exposed schemas`: أضف **`brc`**.
2. `Authentication → URL Configuration`: `site_url` = رابط الموقع الجديد،
   وأضف الرابط إلى `uri_allow_list`.
3. نفّذ `config/recreate-cron.sql` (الإفراج التلقائي + النسخ الأسبوعي).

### الخطوة ٥ — الصور
```sql
-- في محرّر SQL: config/storage-restore.sql  (يعيد الوعاء وسياساته)
```
ثم ارفع ملفات `storage/job-images/jobs/*` إلى bucket **`job-images`**.

### الخطوة ٦ — الحسابات الثلاثة
أنشئها في `Authentication → Users` (كلمات مرور جديدة، لا القديمة)، ثم:
```sql
update brc.staff s set auth_id = u.id
from auth.users u where u.email = '<بريد الموظف>' and s.username = '<اسم المستخدم>';
```
تحقّق: `select count(*) from brc.staff where auth_id is not null;` → 3

### الخطوة ٧ — الموقع على مستودع جديد
```bash
unzip source-code.zip -d site && cd site
npm ci
node tools/supabase-repoint.mjs <REF-الجديد> <PUBLISHABLE-KEY>
npm run dist
```
- أنشئ مستودعاً جديداً وارفع إليه هذا المجلد، ثم مشروع Cloudflare Pages جديد
  مربوطاً به (لا تغيّر الدومين القديم قبل أن يعمل الجديد).
- `site-ready-to-deploy/` صالح للنشر الفوري **فقط** على المشروع القديم، لأن
  عنوانه ومفتاحه مدموجان فيه.

---

## ٣) تحقّق نهائي — «كل شي شغال» يعني هذه
- `select count(*) from brc.applicants;` = العدد المكتوب في ترويسة الملف.
- `select count(*) from brc.staff where auth_id is not null;` = 3.
- دخول كل حساب يعمل، والدور صحيح.
- صفحة التحقّق تقرأ بطاقة قديمة (QR) بلا خطأ — وهذا يثبت أن `brc_secret` صحيح.
- صورة وظيفة واحدة على الأقل تظهر من `job-images`.
- الإفراج التلقائي يعمل: `select * from cron.job;` → أربع مهام نشطة.

---

## ٤) ما لم يُختبر هنا
- استعادة على مشروع Supabase **حقيقي** عبر الشبكة — كل الاختبار تم على
  PostgreSQL محلي (16.2) بدور غير superuser، والهدف إصداره 17.11.
- رفع الصور فعلياً إلى bucket (لا يوجد مشروع حقيقي في بيئة الاختبار).
- Cloudflare Pages والنشر والدومين.
