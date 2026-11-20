# دليل تشغيل الاسترجاع — نسخة 2026-11-19 على مشروع `tkxbmopxcftxpcoczweq`

> **اقرأ أولاً:** `RESTORE-RESULTS-AR.md` (‏§٩) يشرح لماذا التنفيذ يحتاج
> **أمراً واحداً من جهاز متصل بـSupabase**. كل ما تحتاجه هنا جاهز ومختبر:
> الملف، والترقيع، والمنفّذ، والتحقّق الآلي.
>
> ⛔ **ممنوع تماماً** توجيه أي أمر في هذا الدليل إلى المشروع
> `vqsvztudvfukyuerzcgx` (الإنتاج). الأداة ترفضه تلقائياً.

---

## ٠) قبل البدء — ثلاث دقائق تحقّق

| # | تحقّق | كيف |
|---|---|---|
| ١ | الملف سليم | `SHA-256 = a1cce0475ae8158cacb523e738cd1bbe34def36dd77787a2fee25763f84ec8ba` · 3,858,946 بايت |
| ٢ | الهدف فارغ من بيانات العمل | لوحة Supabase → SQL: `select count(*) from brc.applicants;` = 0 |
| ٣ | عندك كلمة مرور القاعدة | Dashboard → **Connect** → **Session pooler** (‏`aws-0-eu-west-1.pooler.supabase.com:5432`). لا تكتبها في المحادثة |

> المشروع في `eu-west-1` والاتصال المباشر `db.<ref>.supabase.co` يخرج IPv6 فقط؛
> لذلك استخدم **Session pooler** (منفذ 5432) كما في الأمثلة.

---

## الطريقة أ — أمر واحد (موصى بها، بلا psql)

على جهازك، من جذر المستودع:

```powershell
# 1) مرة واحدة فقط: سائق قاعدة البيانات
npm install pg --no-save

# 2) الاسترجاع + التحقّق (ضع كلمة المرور مكان PASSWORD — لا ترسلها لأحد)
# ملف منزّل قبل 2026-11-20 (البصمة معروفة):
node tools/restore-full-file.mjs "C:\path\to\HRC-FULL-2026-11-19.sql" `
  --dsn "postgresql://postgres.tkxbmopxcftxpcoczweq:PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" `
  --driver pg --yes
```

ماذا تفعل الأداة بالترتيب:

1. تطبع الحجم و`SHA-256` وعدد العبارات (400 عبارة + ذيل تعليقات) وتقارنها بالبصمة المعروفة.
2. **ترقّع** عقدتَي المشغّلات في نسخة مؤقتة (`03-restore-trigger-blocks.sql`) — بلا لمس الأصل.
3. تنفّذ الملف **كاملاً في معاملة واحدة** عبر بروتوكول PostgreSQL البسيط
   (‏فشل أي عبارة = تراجع كلي، لا صفوف نصف مسترجعة).
4. تشغّل استعلامات التحقّق وتطبع **16 قيمة** مقابل المتوقّع، و`✅ PASS` أو `❌ FAIL`
   مع رمز خروج غير صفري عند أي اختلاف.
5. تحفظ سجلاً `restore-<التاريخ>.log` (بلا كلمة مرور — تُقنَّع).

### إذا نزّلت نسخة **جديدة** بعد 2026-11-20

المولّد أُصلح: يُصدر `DISABLE/ENABLE TRIGGER <اسم>` بلا `TRIGGER ALL`، فتُنفَّذ بلا ترقيع.
لكن بصمتها مختلفة وأعدادها أحدث، فأضف `--allow-new`:

```bash
node tools/restore-full-file.mjs "C:\path\to\HRC-FULL-<الجديد>.sql" --dsn "..." --allow-new --yes
```

| بلا `--allow-new` | مع `--allow-new` |
|---|---|
| تتوقّف وتطلب تأكيداً صريحاً — لا تنفّذ ملفاً مجهول البصمة بصمت | تُقرأ الأعداد المتوقّعة من **ترويسة الملف** (`--  الأعداد : …`) بدل أرقام 2026-11-19 |
| | `printed` و`spent` تُعرض معلوماتية (الترويسة لا تذكرهما) |

وإن كان الملف نظيفاً أصلاً تطبع: «ترقيع: لا حاجة — الملف لا يحوي TRIGGER ALL».

### البديل: psql (الأدق، عبارة عبارة)

```bash
# ترقيع أولاً — لازم لملف نُزِّل قبل 2026-11-20 (يحمل TRIGGER ALL)
# المولّد في الموقع أُصلح اليوم، فأي تنزيل جديد لا يحتاج هذا الترقيع.
node tools/patch-restore-triggers.mjs HRC-FULL-2026-11-19.sql HRC-FULL-2026-11-19-patched.sql

# ثم التنفيذ (‏psql يسأل كلمة المرور بنفسه إن لم تضعها في الـDSN)
PGPASSWORD='...' psql "host=aws-0-eu-west-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.tkxbmopxcftxpcoczweq sslmode=require" \
  -v ON_ERROR_STOP=1 -f HRC-FULL-2026-11-19-patched.sql
```

أو نفس الشيء بالأداة: أضف `--driver psql` (تحتاج `psql` في `PATH`، أو `--psql "C:\Program Files\PostgreSQL\17\bin\psql.exe"`).

### ما يجب أن تراه في النهاية

```
✔ printed 422 · spent 46 · counter 176 · cards 726 · disabled_triggers 0
✔ staff 3 · applicants 726 · jobs 22 · job_attempts 1537 · issued_serials 770
✔ card_number_registry 176 · audit_log 3809 · settings 5
✔ recovery_chances 1537 · recovery_prints 726 · office_receipts 0
✅ PASS
```

**أي `❌ FAIL`:** توقّف. لا تشغّل الموقع. أرسل لي السجل (بلا كلمة المرور) —
ولا تُعِد التنفيذ قبل فحص حالة `brc` (قد تكون المعاملة تراجعت كلياً).

---

## الطريقة ب — أنفّذها أنا (تحتاج موافقتك + رفعاً واحداً منك)

إن أردت أن أُنفّذ الاسترجاع بنفسي:

1. لوحة Supabase → **Storage** → **New bucket** باسم `hrc-restore` (**Private**).
2. ارفع `HRC-FULL-2026-11-19.sql` داخله.
3. أخبرني — أُنشئ دالة Edge تقرأ الكائن بالمفتاح السري، وتنفّذ الملف على
   القاعدة، وتكتب سجل التقدّم في جدول أقرأه عبر الموصل. (أُعيد إنشاء دور
   تنفيذ مؤقت وأزيله بعدها.)

> هذه الطريقة أبطأ وأكثر نقاط فشل من الطريقة أ (‏الدالة تعمل «عمياء» ولا أرى
> مخرجاتها إلا عبر جدول سجل)، لكنها تعني أنني أُنفّذ كل شيء بعد رفعك للملف.

---

## بعد الاسترجاع — بالترتيب (كل خطوة لها تحقّق)

### ١) أوقف الجدولة مؤقتاً قبل أي اختبار كتابة

`brc-auto-release` يعمل **كل دقيقة** وقد يغيّر حالة `job_attempts` بعد الاسترجاع:

```sql
update cron.job set active = false where jobname in
 ('brc-auto-release','recovery-auto-backup','recovery-ensure-fresh','hrc-card-archive-daily');
-- أعدها true في نهاية الاختبارات
```

### ٢) اكشف سكيما `brc` لـPostgREST (وإلا الواجهة لا تعمل)

Dashboard → **Project Settings → API → Exposed schemas** → أضف `brc`
(‏القيمة الحالية لا تحتويها، والكود يستعلم `schema:'brc'`).

### ٣) `app.brc_secret` — سطر واحد، بلا تذكرة دعم

`ALTER DATABASE … SET app.brc_secret` **لا يعمل** على هذا المشروع (‏42501: دور `postgres`
ليس superuser). لذلك أُضيف بديل داخل القاعدة: جدول `brc.app_secrets` محمي بـRLS وبلا
سياسة، و`verify_token` تقرأ الإعداد أولاً ثم الجدول (نفس البصمة تماماً).

```sql
-- في SQL Editor لمشروع الهدف، بعد الاسترجاع:
insert into brc.app_secrets (name, value)
values ('brc_secret', '<مفتاح الإنتاج نفسه>')
on conflict (name) do update set value = excluded.value, updated_at = now();

-- تحقّق (يجب 64):
select length(brc.verify_token('HRC-BC-000120'));
```

* المفتاح نفسه (لا مفتاح جديد) ⇒ **بصمات البطاقات المطبوعة سابقاً تبقى صالحة**.
* تقرأه من الإنتاج بـ`select current_setting('app.brc_secret');` — قراءة فقط، ولا ترسله لأحد.
* إن أردت لاحقاً ضبط الإعداد على مستوى القاعدة (‏Custom Postgres Config)، سيأخذ
  `verify_token` الإعداد ويتجاهل الجدول تلقائياً — بلا أي تغيير في السلوك.

### ٤) الحسابات الثلاثة + الربط

Dashboard → **Authentication → Users → Add user** (‏Auto Confirm = مفعّل):

| Username | البريد المقترح | الدور في `brc.staff` |
|---|---|---|
| `admin` | `admin@brc-babil.local` | `admin` |
| `AliAhmed919` | `aliahmed919@brc-babil.local` | `admin` |
| `Mohammed` | `mohammed@brc-babil.local` | `staff` |

كلمات المرور تكتبها أنت في اللوحة (لا ترسلها). ثم الربط بعد الفحص (لا يطمس ربطاً قائماً):

```sql
-- فحص أولاً: يجب أن تكون كلها NULL
select username, auth_id from brc.staff order by username;

-- الربط بالبريد
update brc.staff s
   set auth_id = u.id
  from auth.users u
 where s.auth_id is null
   and lower(u.email) = lower(s.username || '@brc-babil.local');

-- تحقّق: 3 صفوف و3 روابط
select username, role, active, (auth_id is not null) as linked from brc.staff order by username;
```

> إن كانت أسماء الدخول في الواجهة تُطابق `username` لا البريد، فافحص أولاً
> `dashboard.html`/`assets/js/*` — الربط أعلاه مبني على البريد المقترح فقط.

### ٥) الصور

1. Storage → **New bucket** `job-images` (‏Private + سياسات القراءة كما في الإنتاج).
2. ارفع الملفات الخمس بنفس المسارات (`jobs/hrc-1043.jpg`, `hrc-1045`, `hrc-1046`,
   `hrc-1057`, `new.jpg`) — الروابط في `docs/rescue/MISSING-ITEMS.md` §٢.
3. تحقّق: `select count(*) from storage.objects where bucket_id='job-images';` = 5
4. بعدها فقط افحص `brc.jobs.image_url` ولا تستبدل أي رابط عشوائياً.

### ٦) الواجهة — في بيئة اختبار فقط

```bash
node tools/supabase-repoint.mjs --check         # أين يظهر معرّف الإنتاج حالياً
node tools/supabase-repoint.mjs <ref> <publishable-key>   # على نسخة اختبار، لا فرع النشر
npm run build && npm start                      # معاينة محلية
```

⚠️ لا تنشر على دومين الشركة ولا تغيّر إعدادات Cloudflare بلا موافقة صريحة.

### ٧) اختبارات

```bash
node tests/patch-restore-triggers.mjs   # 6/6 — تعمل بلا شبكة
npm test                                # تحتاج قاعدة حيّة وشبكة
```

---

## استرجاع الحال عند فشل

1. لا تُعِد التنفيذ فوراً — الملف يبدأ بـ`TRUNCATE`.
2. افحص: `select (select count(*) from brc.staff) s, (select count(*) from brc.applicants) a;`
   * كلها 0 ⇒ المعاملة تراجعت كلياً، والسبب في السجل (`ERROR:` + رقم السطر).
   * أعداد جزئية ⇒ لا يفترض أن يحدث مع سائق `pg` (معاملة واحدة)؛ مع `psql`
     راجع أي عبارة نجحت.
3. أرسل السجل لي (بلا كلمة مرور) — لا تحذف ولا تفرّغ شيئاً يدوياً.

---

## ملاحظات ويندوز و`CRLF`

* `tools/recovery/START-RECOVERY.bat` يجب أن يبقى **CRLF** (`.gitattributes` يفرضه) — لا تحوّله.
* PowerShell: ضع الـDSN بين علامتي اقتباس مفردتين `'` إن كانت كلمة المرور
  تحتوي `$` أو `&`، أو استعمل `--driver pg` وتجنّب طباعة الـDSN.
* لا تُشغّل أي أمر من هذا الدليل من داخل محرّر SQL في Supabase — المحرّر يقصّ
  الملف عند ~2000 سطر ويقول «Success».
