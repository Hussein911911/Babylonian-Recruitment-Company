# النسخ الاحتياطي — USB فقط + نسخة داخل الموقع

> **قرار المدير (2026-11-15):**
> - **النسخة ١ — داخل الموقع:** تلقائية في القاعدة، آخر ٣ نسخ محفوظة.
> - **النسخة ٢ — على فلاش USB:** تُنسخ من الحاسبة.
> - **Google Drive خارج النطاق.** لا حساب، لا تنزيل برامج مزامنة.
> - الموبايل خارج النطاق.

---

## الفكرة في سطرين

| | النسخة ١: داخل الموقع | النسخة ٢: USB |
|---|---|---|
| من يأخذها | القاعدة نفسها تلقائياً | الحاسبة، بأمر |
| متى | حسب الجدولة (الآن: كل جمعة ٢٣:٠٠) | بعد كل نسخة |
| كم نسخة | آخر ٣ | آخر ٣ |
| تحمي من حذف بطاقة بالخطأ | ✅ | ✅ |
| تحمي من حذف مشروع Supabase | ❌ **تموت معه** | ✅ **تبقى** |

**لهذا الاثنان معاً.** أحدهما لا يكفي وحده.

---

## ما تحتاجه

| # | شنو | من وين | الزمن |
|---|---|---|---|
| ١ | فلاش USB (٨ جيجا أو أكثر) | أي محل | ٥ دقائق |
| ٢ | Node.js | nodejs.org | ٥ دقائق |
| ٣ | أدوات PostgreSQL (`pg_dump` فقط) | postgresql.org/download/windows/ | ١٠ دقائق |
| ٤ | المشروع | GitHub | ٥ دقائق |

> **ملاحظة عن USB:** ٨ جيجا أكثر من كافٍ. النسخة الواحدة ≈ ١١٥ كيلوبايت،
> و٣ نسخ ≈ ٣٤٥ كيلوبايت. الباقي مساحة فارغة لسنوات.

---

## المرحلة ١: Node.js

**من `nodejs.org`** ← اضغط الزر الأخضر **LTS** (وليس Current) ← نزّل `.msi` ← اضغط عليه ← Next ×٤ ← Install ← Finish.

> ⚠️ **أغلق PowerShell وأعد فتحه** بعد التثبيت — وإلا `node` لن يُعرف.

**التحقق:**
```powershell
node --version
```
لازم يطلع `v22.x` أو أعلى.

---

## المرحلة ٢: أدوات PostgreSQL

**من `postgresql.org/download/windows/`** ← Download the installer ← أحدث نسخة Windows x86-64.

في شاشة **Select Components**:

```
☐ PostgreSQL Server       ← أزل العلامة (ما نحتاجه)
☐ pgAdmin 4               ← أزل العلامة
☐ Stack Builder           ← أزل العلامة
☑ Command Line Tools      ← اترك هذه وحدها
```

ثم Next ← كلمة مرور (أي شي، احفظها) ← Port 5432 ← Install.

**التحقق:**
```powershell
pg_dump --version
```
لازم يطلع `pg_dump (PostgreSQL) 17.x`

**إن لم يظهر:**
```powershell
$env:Path += ";C:\Program Files\PostgreSQL\17\bin"
```
> مؤقت. الحل الدائم أدناه في قسم «حل مشكلة المسار».

---

## المرحلة ٣: المشروع

من GitHub ← زر أخضر **Code** ← **Download ZIP** ← فكّ الضغط ← انقل المجلد إلى:

```
C:\HRC\Babylonian-Recruitment-Company
```

ثم في PowerShell:
```powershell
cd C:\HRC\Babylonian-Recruitment-Company
npm install
```
> يأخذ ٣-٥ دقائق. يطلع `added N packages` عند النجاح.

---

## المرحلة ٤: مجلد USB

**١. وصّل الـUSB**

**٢. اعرف حرفه.** افتح مستكشف الملفات ← **This PC** ← شوف الحروف:
```
Local Disk (C:)     ← القرص
DVD Drive (D:)      ← لا
USB Drive (E:)      ← هذا
```

**٣. سوِّ عليه مجلد** باسم `HRC-Backups`
> نقر يمين في المساحة الفارغة ← New ← Folder ← اكتب `HRC-Backups`

**٤. انسخ مساره.** النتيجة مثل: `E:\HRC-Backups`

---

## المرحلة ٥: الإعداد — بـ٣ أوامر

### ١. ضبط هدف USB

```powershell
node tools/setup-drive.mjs "E:\HRC-Backups"
```

> ⚠️ **علامات التنصيص ضرورية.** والحرف `E` غيّره لحرف USB عندك.

**الأداة تفحص:** هل المجلد موجود؟ هل يمكن الكتابة؟ وفيه نسخ قديمة؟
ثم تكتب الإعداد **بصيغة آمنة** (شرطة مائلة `/` بدل `\`).

> **لماذا أداة لا تحرير يدوي؟** لأن مسار ويندوز مكتوباً بـ`\` منفردة في JSON
> **يُتلف الملف كله**، ويفشل الوكيل بخطأ صياغة لا علاقة له بـUSB — فتضيع
> وقتك في المكان الخطأ. أثبتناه باختبار.

### ٢. النسخة داخل الموقع — مُعدّة سابقاً ✅

لا شيء تفعله. القاعدة تحفظ آخر ٣ نسخ تلقائياً.

**للتأكد:**
- ادخل لوحة المدير ← «النسخ الاحتياطي والاسترجاع»
- لازم تشوف: **«تُحفظ آخر ٣ نسخ مجدولة تلقائياً»**
- والجدولة: **الجمعة ٢٣:٠٠** (أو ما يختاره المدير)

**تغيير الجدولة:** من نفس اللوحة ← اختار النمط:
```
○ كل عدد ساعات     ← ١، ٢، ٣، ٤، ٦، ٨، ١٢، ٢٤
○ كل يوم           ← ساعة محددة
○ كل عدد أيام      ← ١ إلى ٩٠
○ أيام محدّدة      ← نوّر الأيام
```

### ٣. المفاتيح

```powershell
node office/backup-agent.mjs keygen
```

> يحتاج ملف كلمة سر أولاً — انظر «ملف الإعداد» أدناه.

---

## ملف الإعداد — `backup-config.json`

الأداة تضبط **هدف USB**. لكن النسخة نفسها تحتاج إعداد القاعدة.

**مكان الملف:** `<مجلد المشروع>\.office\backup-config.json`
> إن لم يكن موجوداً، انسخ من `office\backup-config.example.json`

```json
{
  "databaseUrl": "postgresql://مستخدم_قراءة_فقط@المضيف:5432/postgres?sslmode=verify-full",
  "pgpassFile": "C:/HRC-Private/database.pgpass",
  "pgBin": "C:/Program Files/PostgreSQL/17/bin",
  "destination": "D:/HRC-Database-Backups",
  "recipientPublicKey": "C:/HRC-Private/backup-public.pem",
  "recipientPrivateKey": "C:/HRC-Recovery/backup.private.pem",
  "privateKeyPasswordFile": "C:/HRC-Recovery/recovery-password.txt",
  "keep": 1,
  "mirrorTargets": [{ "name": "USB", "path": "E:/HRC-Backups" }],
  "mirrorKeep": 3
}
```

> **عن `databaseUrl`:** كلمة السر **لا** تُكتب هنا. توضع في `pgpassFile`
> بملف منفصل. هذا إعداد PostgreSQL القياسي.

> **عن `keep: 1`:** كم نسخة تبقى في `destination` (القرص). واحدة كافية،
> لأن USB يحفظ ٣ و`mirrorKeep` يضبطها.

> **⚠️ لماذا `destination` على الملاذ الرئيسي؟** لأن النسخة تُكتب هناك
> **أولاً** وتُتحقق، ثم تُنسخ للـUSB. لو فُصل USB، النسخة الأصلية سليمة.

---

## ⚠️ ثلاث قواعد أمنية

### ١. المفتاح الخاص ليس على الـUSB

```
recipientPrivateKey  →  C:/HRC-Recovery/   ← قرص الحاسبة
mirrorTargets        →  E:/HRC-Backups/    ← USB
```

**لماذا؟** لو سرق أحد الـUSB ومعه المفتاح، يقرأ كل بيانات الشركة.
الفصل يعني: سرقة الـUSB وحدها لا تكفي.

### ٢. ملف كلمة السر ليس مع المفتاح

المفتاح في `HRC-Recovery`، وكلمة سره في ملف آخر. سرقة واحدة لا تكفي.

### ٣. قيّد صلاحيات مجلد المفاتيح

```powershell
.\office\windows\Protect-Office.ps1 -PrivateDirectory "C:\HRC-Recovery"
```
> ينزع صلاحيات كل المستخدمين ويبقي حسابك و SYSTEM فقط.

---

## ⚠️ ملاحظتان عن USB — بصراحة

### ١. لازم يكون موصولاً وقت النسخة

```
النسخة الساعة ٢٣:٠٠
الـUSB مفصول  ← لا نسخة USB تلك الليلة
```

**لكن لا يضيع شي:** النسخة الأصلية في `destination` سليمة، وتُنسخ للـUSB
عند أول وصْل.

**الحل:** اضبط الجدولة على ساعة أنت موجود فيها، أو اترك الـUSB موصولاً.

**تحقق في أي وقت:**
```powershell
node office/backup-agent.mjs mirror-status
```
```
✓ موصول  USB  →  E:/HRC-Backups  (3 نسخة, الأحدث hrc-2026-11-15...)
```
أو
```
✗ مفصول  USB  →  E:/HRC-Backups
```

### ٢. الفلاش الرخيص يفشل بصمت

الذاكرة الفلاشية **تفقد بياناتها** إذا بقيت مفصولة سنوات بلا كهرباء. والرخيص أسوأ.

**لذلك:**
- **لا تشترِ الأرخص.** SanDisk أو Samsung.
- **جرّب الاسترجاع كل ٣ أشهر** — لا تكتفِ بالعدد.
- **USB ثانٍ في مكان آخر** أفضل من الأول المحسّن.

> **نسخة لم تُجرَّب ليست نسخة.**

---

## جرّب نسخة حقيقية

```powershell
node office/backup-agent.mjs backup
```

ما يحدث بالترتيب:

1. يتصل بالقاعدة ويأخذ نسخة (**قراءة فقط** — لا يكتب شيئاً).
2. يُشفّرها بالمفتاح العام.
3. **يقرأها من جديد ويتحقق** أنها تُفك. إن فشلت ← **لا يحدث شيء بعدها**.
4. ينسخها إلى USB.
5. **يقرأ النسخة من USB ويقارن بصمتها بالأصل.** بايت مختلف ← تُحذف.
6. **يتأكد أن الملف على القرص فعلاً** لا مجرد إشارة.
7. بعد النجاح فقط: يُبقي آخر ٣ على USB.
8. يُسجّل النتيجة.

**افحص:**
```powershell
node office/backup-agent.mjs mirror-status
```

---

## فحص شامل في أي وقت

```powershell
node tools/doctor.mjs
```

يفحص: Node · pg_dump · الإعداد · المفتاحين · USB (بالكتابة الفعلية).
كل سطر يقول المشكلة **وكيف تُصلح**.

---

## الاسترجاع — يوم الحاجة

### ١. تحقّق أن النسخة سليمة

```powershell
node office/backup-agent.mjs verify "E:\HRC-Backups\hrc-2026-11-15T09-00-00Z.hrcdb"
```
> يتحقق من البصمة ويفكّ التشفير **بلا كتابة على أي قاعدة**.

### ٢. استرجاع إلى قاعدة معزولة فقط

```powershell
node office/backup-agent.mjs restore-drill "E:\HRC-Backups\hrc-....hrcdb" ISOLATED-ONLY
```

- الهدف يجب أن يكون `127.0.0.1` أو `localhost`.
- اسم القاعدة يجب أن يبدأ بـ`brc_restore_drill_`.
- كلمة `ISOLATED-ONLY` إجبارية.

> ⚠️ **لا يوجد أمر يسترجع على الإنتاج تلقائياً.**
> مقصود: الاسترجاع على الإنتاج يحتاج قراراً بشرياً.

---

## حل مشكلة المسار (إن لم يُعرف `pg_dump`)

```powershell
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path","Machine") + ";C:\Program Files\PostgreSQL\17\bin",
  "Machine")
```
> يحتاج PowerShell **كمسؤول**. ثم أغلق وأعد فتح PowerShell.

---

## ملخص الأوامر

| الأمر | ماذا يفعل |
|---|---|
| `node tools/doctor.mjs` | فحص شامل: شنو ناقص |
| `node tools/setup-drive.mjs "E:\HRC-Backups"` | يضبط هدف USB |
| `node tools/setup-drive.mjs --check` | يفحص الأهداف الآن |
| `node office/backup-agent.mjs keygen` | يولّد المفاتيح (مرة واحدة) |
| `node office/backup-agent.mjs backup` | يأخذ نسخة الآن |
| `node office/backup-agent.mjs mirror-status` | حالة USB |
| `node office/backup-agent.mjs verify "ملف"` | يتحقق من نسخة |
| `node office/backup-agent.mjs restore-drill "ملف" ISOLATED-ONLY` | استرجاع معزول |
| `.\office\windows\Protect-Office.ps1 -PrivateDirectory "C:\HRC-Recovery"` | يقيّد مجلد المفاتيح |

---

## راقب هذه كل شهر

1. `node office/backup-agent.mjs mirror-status` ← هل USB **موصول**؟
2. افتح الـUSB ← هل فيه ٣ ملفات `.hrcdb` حديثة؟
3. لوحة المدير ← هل النسخ التلقائية تعمل؟
4. **كل ٣ أشهر:** `restore-drill` على قاعدة معزولة.
