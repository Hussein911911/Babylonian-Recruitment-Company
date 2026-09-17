# 🚀 النشر على Cloudflare Pages — المنصّة الوحيدة المعتمدة

> **القرار:** الموقع يُنشر على **Cloudflare Pages** فقط. أُزيل إعداد Render و `render.yaml`
> من المستودع، فلا يبقى أي ربط ثانٍ ينتج رابطاً مكرّراً.
> الملفات التي تخصّ Cloudflare موجودة في الجذر: `_headers` و `_redirects` — يقرأها
> Cloudflare تلقائياً **بلا أي إعداد بناء** (المشروع ثابت بالكامل: HTML/CSS/JS).

---

## 1) حالة النشر الحالية (اقرأ هذا أولاً)

| الحقيقة | التفصيل |
|---|---|
| منصّة النشر | **Cloudflare Pages** — مشروع `babylonian-recruitment-company` |
| الرابط | `https://babylonian-recruitment-company.pages.dev` |
| نوع المشروع | **Direct Upload** (غير مربوط بـ Git) — لا يتحدّث تلقائياً |
| Render | 🗑️ **محذوف** — رابط `onrender.com` صار `Not Found` |
| النتيجة | أي تحديث للموقع يحتاج إحدى الطرق الثلاث أسفله |

> كيف عرفنا أنه Direct Upload؟ سجل النشر على GitHub يحوي عمليات Render فقط
> (`... - babylonian-recruitment-company PR #7`) ولا يحوي أي عملية من Cloudflare —
> ولو كان مربوطاً بـ Git لظهرت عمليات نشر باسم المشروع عند كل دفعة.

---

## 2) الطريق أ — تحديث فوري بملف جاهز (بلا مفاتيح ولا انتظار)

1. `npm run build && npm run build:light && npm run dist` → يتكوّن مجلد **`dist/`**
   (41 ملفاً · ‎5.5 ميجابايت — ملفات الموقع فقط، بلا `tests/` ولا `src/` ولا `docs/`).
2. في Cloudflare: **Workers & Pages → babylonian-recruitment-company → Create deployment**.
3. **اسحب مجلد `dist`** أو ملف ZIP له إلى منطقة الرفع → Deploy.
4. بعد ثوانٍ الرابط نفسه يعرض النسخة الجديدة.

> ⚠️ الملفات المبنية (`brc-standalone.html` و `brc-light.html`) تُبنى محلياً ثم تُرفع —
> لا تُعدَّل يدوياً ولا تُبنى على Cloudflare.

---

## 3) الطريق ب — نشر آلي على **نفس الرابط** (موصى به)

الملف **`docs/deploy-cloudflare-workflow.yml`** جاهز: يبني، يفحص (`npm run audit`)،
يجمّع `dist/`، ثم ينشر بمفتاح Cloudflare عند كل دفعة إلى `main`.

**تفعيله (نقرتان):** GitHub → Add file → Create new file → اكتب المسار
`.github/workflows/deploy-cloudflare.yml` → انسخ محتوى الملف (من سطر الفصل) والصقه → Commit.
> لماذا لم يكن الملف في مكانه مباشرة؟ لأن ربط GitHub في هذه الجلسة لا يملك صلاحية
> كتابة ملفات الـ workflows — فالتفعيل يدوي مرة واحدة (نفس أسلوب `docs/ci-workflow.yml`).

الخطوات (مرة واحدة):

1. Cloudflare → **My Profile → API Tokens → Create Token**
   - القالب الجاهز: **Edit Cloudflare Workers** (يغطّي Pages)، أو صلاحية مخصّصة:
     `Account → Cloudflare Pages → Edit`
   - انسخ المفتاح (يظهر مرة واحدة).
2. من Cloudflare احتفظ بـ **Account ID**: Workers & Pages → يمين الصفحة.
3. GitHub → المستودع → **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. ادمج PR في `main` (أو شغّل الـ Action يدوياً من تبويب Actions: **Run workflow**).

بعد ذلك: كل دفع إلى `main` = نشر تلقائي على نفس نطاق `pages.dev`.
وإن حذفت المفاتيح يتوقف النشر الآلي بصمت (الملف يبني ويفحص ثم يتخطّى خطوة النشر).

---

## 4) الطريق ج — أتمتة كاملة بمشروع مربوط بـ Git

ميزة: بلا مفاتيح API وبلا أي ملف إضافي. الثمن: مشروع جديد ⇒ رابط `pages.dev`
جديد، فتنقل إليه النطاق الرسمي (والروابط القديمة تبقى تعمل حتى تُطفأ).

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → اختر المستودع.
2. الإعدادات:

   | الحقل | القيمة |
   |---|---|---|
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | **(اتركه فارغاً)** |
   | Build output directory | `.` |
   | Environment variables | لا شيء |

3. **Custom domains** → أضف `brc-babil.com` إلى المشروع الجديد.
4. أوقف النشر الآلي القديم: احذف `.github/workflows/deploy-cloudflare.yml` (المفعَّل)
   أو اتركه (لن يضرّ، لكن سيصير نشران لنفس الموقع — الأنظف حذفه).
5. بعد التأكد من عمل المشروع الجديد: احذف مشروع Direct Upload القديم.

---

## 5) معاينات الفروع (بديل معاينات Render)

في الطريق ج: **Settings → Builds & deployments → Preview deployments →
All non-Production branches**، فيحصل كل فرع على رابط
`https://<branch-slug>.<project>.pages.dev`.
وفي الطريق ب: أزل التعليق عن الخطوة الأخيرة داخل الملف لنشر معاينة لكل فرع.

## 6) النطاق الرسمي

**Custom domains → Set up a custom domain →** أضف:

- `brc-babil.com`
- `www.brc-babil.com`

Cloudflare يضيف سجلات DNS بنفسه (عندما يكون النطاق على Cloudflare أصلاً). بعد الربط
لا نحتاج أي تعديل بالكود: الرابط المطبوع في كيو آر كود الاستمارات يتبع نطاق النشر
تلقائياً (`autoVerifyBase` في `assets/js/config.js`)، فيتحوّل من `pages.dev` إلى
`brc-babil.com/verify` وحده.

> ⚠️ الاستمارات المطبوعة على نطاق قديم تبقى تعمل ما دام ذلك النطاق مفتوحاً.
> لا تُغلق نطاقاً قديماً قبل أن تنتهي صلاحية كل الاستمارات المطبوعة عليه (30 يوماً).

---

## 7) الترويسات والمسارات النظيفة (تلقائي بلا إعداد)

| الملف | ماذا يفعل |
|---|---|
| `_headers` | ترويسات أمنية (`nosniff` · `Referrer-Policy` · `X-Frame-Options`) + منع تخزين `sw.js` مؤقتاً + كاش طويل للخطوط والصور |
| `_redirects` | مسارات نظيفة بإعادة كتابة داخلية (200): `/verify` · `/dashboard` · `/standalone` · `/light` |

هذان الملفان **لا يحتاجان أي تشغيل**؛ Cloudflare يقرأهما من جذر مجلد النشر.
وهما البديل الحرفي لما كان في `render.yaml` (headers + routes).

---

## 8) ما يُنشر وما لا يُنشر — `dist/`

`npm run dist` يبني مجلد نشر نظيفاً بلا أدوات ولا اختبارات:

| يُنشر | لا يُنشر |
|---|---|
| `index.html` · `verify.html` · `dashboard.html` | `tests/` · `src/` · `docs/` · `tools/` · `supabase/` |
| `brc-standalone.html` · `brc-light.html` · `supabase-check.html` | `package.json` · `package-lock.json` · `README.md` |
| `sw.js` · `_headers` · `_redirects` · `assets/**` | `node_modules/` · `dist/` نفسه |

والسكربت يفحص نفسه: يفشل إن كان أي ملف يطلبه المتصفح غير موجود في `dist/`
(صورة، خط، سكربت) — فلا يُنشر موقع بأصل ناقص بصمت.

> في الطريق ج (مشروع مربوط بـ Git) اضبط **Build command**:
> `npm ci && npm run build && npm run build:light && npm run dist`
> و **Build output directory**: `dist`.

---

## 9) إلغاء Render — تم ✅

- `render.yaml` حُذف من المستودع، وسُجّل ذلك في `tests/audit.mjs` (يفشل الاختبار
  تلقائياً لو عاد ملف إعداد لمنصّة نشر ثانية).
- خدمة Render حُذفت من لوحة Render **وتحقّقنا**: رابط
  `babylonian-recruitment-company.onrender.com` يعيد **Not Found**.
- وما زال عليك (دقيقتان): امسح رابط `onrender.com` من أي مكان يُشارَك مع الناس
  (واتساب · ستوري · بطاقة · توقيع بريد) — لأنه لم يبقَ يعمل.

> ⚠️ إذا كان الرابط القديم مطبوعاً في كيو آر كود استمارات صادرة، فالمسح لا يزال
> يعمل من الاستمارات الورقية طالما الرابط المطبوع كان النطاق الرسمي. وإن كنت
> طبعت استمارات على رابط onrender تحديداً، أعد طباعتها بالرقم التسلسلي نفسه.

---

## 10) النشر المباشر من جهازك (wrangler)

```bash
npm i -g wrangler          # مرة واحدة
wrangler login             # يفتح المتصفح لتأكيد الحساب
npm run build && npm run build:light && npm run dist
wrangler pages deploy dist --project-name babylonian-recruitment-company
```

مفيد للنشر السريع من جهازك بلا انتظار Git. أما النشر المعتاد فيبقى تلقائياً عند
كل دفعة إلى `main`.

---

## 11) بعد كل تحديث للواجهة — لا تنسَ

1. `node tools/build.mjs && node tools/build.mjs --light` (لتحديث `brc-standalone.html` و `brc-light.html`)
2. ارفع رقم الكاش في `sw.js` (`CACHE_NAME = 'brc-cache-v3'` → `v4` …)
   — بدونه تبقى أجهزة الموظفين على النسخة القديمة من الكاش
3. دفع إلى `main` → نشر تلقائي على Cloudflare
4. إن ظهرت نسخة قديمة للزائر: **Caching → Configuration → Purge Everything**

---

## 12) فحص سريع بعد النشر

- [ ] الصفحة الرئيسية تفتح: `https://<project>.pages.dev/`
- [ ] `/verify` **لا** تعرض بيانات استمارة للزائر — تعرض بوابة «خاص بموظفي الشركة والإدارة»
- [ ] `/dashboard` تعرض شاشة الدخول (وبجلسة موظف تفتح المنظومة)
- [ ] `/standalone` و `/light` يفتحان الملفّين المستقلَّين
- [ ] DevTools → Network → Header للاستجابة الأولى يحوي `x-content-type-options: nosniff`
- [ ] الـ Service Worker عندك صار `brc-cache-v3` (DevTools → Application → Cache Storage)
- [ ] الوظائف تظهر كما في قاعدة الشركة (Supabase) — إن ظهرت «0 وظيفة» فالقاعدة نفسها
      بلا وظائف مُدخلة، أضِفها من المنظومة الداخلية (`إضافة وظيفة`) أو من SQL Editor
