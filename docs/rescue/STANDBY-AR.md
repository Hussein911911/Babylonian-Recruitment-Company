# نسخة الطوارئ — استعادة المنظومة كاملة على مشروع جديد ومستودع جديد

> الغرض: لو توقّف المشروع الحالي لأي سبب، تُعيد المنظومة على مشروع Supabase
> جديد ومستودع جديد من هذه الحزمة وحدها.
> كل خطوة مُختبرة فعلياً على PostgreSQL حقيقي بدور غير superuser، وما لم يُختبر مذكور صراحةً.

**طرق الاسترجاع الثلاث** — الخطوات هنا هي الطريقة الأولى (بأداة على حاسوب):

| الطريق | يحتاج | متى |
|---|---|---|
| ١. أداة على حاسوب (`restore-full-file.mjs`) | Node | الافتراضي؛ مُختبَر أكثر من غيره |
| ٢. **دالة `hrc-restore` داخل Supabase** — `docs/rescue/RESTORE-VIA-EDGE-FUNCTION-AR.md` | متصفّح فقط (لا تثبيت) | لا حاسوب فيه Node، أو تريد كل شيء من اللوحة |
| ٣. Google Colab (‏Python في المتصفّح) | حساب Google | ملف أكبر أو تفضيل Python |

---

## ١) كيف تُبنى الحزمة

```bash
# ١. ضع ملف البيانات المنزَّل من صفحة النسخ الاحتياطي في جذر المستودع:
#    HRC-FULL-<التاريخ>.sql
# ٢. الصور (إن أردتها): storage/job-images/jobs/*.jpg  — تنزّلها من لوحة Supabase
# ٣. كلمة المرور: ضعها في ملف نصّي (لا تكتبها في سطر الأوامر)
printf '%s\n' 'عبارة مرور طويلة تختارها' > pw.txt

npm ci
node tools/build-rescue-kit.mjs --password-file pw.txt --secret-file brc_secret.txt
```

النتيجة: `rescue/rescue-kit.hrcbak` — ملف واحد مشفّر (scrypt + AES‑256‑GCM).
لا تُبقي نسخة غير مشفّرة بجانبه؛ السكربت يحذفها بنفسه.

**بصمة الحزمة** تُطبع في النهاية، وتُكتب أيضاً بـ`sha256sum rescue/rescue-kit.hrcbak`.
احفظ البصمة **خارج** الحزمة (مدير كلمات المرور أو ورقة في الخزنة). بصمة داخل
الملف لا تحمي الملف من التعديل — التي خارجها هي التي تُثبت.

## ٢) كيف تُفحص قبل الاعتماد عليها

```bash
node tools/verify-rescue-kit.mjs rescue/rescue-kit.hrcbak --password-file pw.txt
# ومع قاعدة اختبار جاهزة:
node tools/verify-rescue-kit.mjs rescue/rescue-kit.hrcbak --password-file pw.txt \
  --dsn "postgresql://hrc_owner:…@127.0.0.1:5432/hrc_test"
```

يفعل: يفكّ التشفير → يفكّ الضغط → يتحقّق من **كل** بصمة في `CHECKSUMS.sha256` →
يطابق `manifest.json` وبصمة ملف البيانات → (اختيارياً) يستعيد ويطلب `PASS`.
أي اختلاف = `❌ FAIL` ورمز خروج غير صفري.

## ٣) ماذا في الحزمة — وماذا **ليس** فيها

| داخل الحزمة | خارجها (احفظه بنفسك) |
|---|---|
| `database/HRC-FULL-*.sql` — الهيكل + كل البيانات | 👤 **كلمات مرور الحسابات** — لا تُصدَّر أبداً |
| `database/schema.sql` + الجرد + كتلتا الإصلاح 03/04 | ✉️ **البُرد الإلكترونية** — ليست في القاعدة أصلاً (لا عمود email في `brc.staff`) |
| `recovery-tools/` — منفّذ الملف + الترقيب + فكّ الحزمة + الفحص | 🔑 كلمة مرور الحزمة (إن نسيتها لا فكّ) |
| `source-code.zip` + `site-ready-to-deploy/` | 📌 بصمة الحزمة نفسها |
| `config/accounts.json` — المستخدمون والأدوار | |
| `config/project-settings.json` — ما يُضبط في لوحة المشروع | |
| `config/brc_secret.enc` — مفتاح البصمة **مشفّراً** | |
| `config/recreate-cron.sql` · `storage-restore.sql` | |
| `storage/job-images/jobs/*` — الصور (إن زوّدتها) | |
| `manifest.json` + `CHECKSUMS.sha256` | |

⚠️ الحزمة تحتوي بيانات شخصية (٧٢٦ متقدماً). لذلك تُشفَّر افتراضياً، ولا تدخل Git
(`*.hrcbak` و`*.enc` في `.gitignore`).

## ٤) يوم الحاجة — سبع خطوات

### ٠ — فكّ الحزمة
```bash
node tools/open-backup.mjs rescue-kit.hrcbak --password-file pw.txt
unzip rescue-kit.zip && cd rescue
sha256sum -c CHECKSUMS.sha256          # كلها OK وإلا توقّف
```

### ١ — مشروع Supabase جديد
أنشئ المشروع، واحفظ كلمة مرور القاعدة في مدير كلمات المرور.
(مشروع مجاني خامل يُوقَف بعد ~٩٠ يوماً — النسخة الحقيقية هي هذه الحزمة.)

### ٢ — استرجاع البيانات
```bash
node recovery-tools/restore-full-file.mjs database/HRC-FULL-*.sql \
  --dsn "postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres" \
  --yes
```
- ملف نُزّل قبل 2026‑11‑20 يُرقَّع تلقائياً؛ ملف أحدث من المثبّت يُنفَّذ بـ`--allow-new`.
- لا تلصقه في محرّر SQL (يقصّ عند ~٢٠٠٠ سطر ويقول Success).
- لا تكمل بلا `✅ PASS`.

### ٣ — مفتاح البصمة
فكّ `config/brc_secret.enc` بالأداة نفسها، ثم:
```sql
insert into brc.app_secrets (name, value) values ('brc_secret', '<القيمة>')
on conflict (name) do update set value = excluded.value, updated_at = now();
select length(brc.verify_token('HRC-BC-000120'));   -- 64
```

### ٤ — إعدادات المشروع
من `config/project-settings.json`: أضف `brc` إلى Exposed schemas · `site_url` و`uri_allow_list` ·
ونفّذ `config/recreate-cron.sql`.

### ٥ — الحسابات
من `config/accounts.json`: أنشئ المستخدمين ببُردهم، أعد تعيين كلمات المرور، ثم:
```sql
update brc.staff s set auth_id = u.id
from auth.users u where u.email = '<بريد>' and s.username = '<مستخدم>';
select count(*) from brc.staff where auth_id is not null;   -- 3
```

### ٦ — الصور
```sql
-- config/storage-restore.sql يعيد الوعاء وسياساته
```
ثم ارفع `storage/job-images/jobs/*` إلى bucket `job-images`.

### ٧ — الموقع
```bash
unzip source-code.zip -d site && cd site
npm ci && node tools/supabase-repoint.mjs <REF-الجديد> <PUBLISHABLE-KEY>
npm run dist
```
ارفع إلى مستودع GitHub جديد، واربطه بمشروع Cloudflare Pages جديد.
`site-ready-to-deploy/` صالح فقط للمشروع القديم (عنوانه ومفتاحه مدموجان فيه).

## ٥) تحقّق نهائي — «كل شي شغال» يعني هذه
- `select count(*) from brc.applicants;` = العدد في ترويسة الملف.
- `select count(*) from brc.staff where auth_id is not null;` = 3.
- الدخول بكل حساب يعمل والدور صحيح.
- بطاقة قديمة تُقرأ بالباركود بلا خطأ (يثبت صحة `brc_secret`).
- صورة وظيفة تظهر من `job-images`.
- `select * from cron.job;` أربع مهام نشطة.

## ٦) ما لم يُختبر
- استعادة على مشروع Supabase حقيقي عبر الشبكة (كل الاختبار محلي 16.2، والهدف 17.6.1).
- رفع الصور فعلياً إلى bucket.
- Cloudflare Pages والدومين.
