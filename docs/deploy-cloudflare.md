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
| الرابط الحي | `https://babylonian-recruitment-company.pages.dev` |
| نوع المشروع | **مربوط بـ Git (Connect to Git)** — Production branch: `main` |
| النشر التلقائي | ✅ **يعمل**: كل دفعة إلى `main` تُبنى وتُنشر تلقائياً، وكل PR يحصل على رابط معاينة |
| Render | 🗑️ **محذوف** — رابط `onrender.com` صار `Not Found` |

> الدليل على الربط بـ Git: كل كومِت على `main` يحمل فحص **Cloudflare Pages** من تطبيق
> `cloudflare-workers-and-pages` على GitHub — وهذا الفحص لا يظهر إلا في المشاريع
> المربوطة بـ Git، وآخر نشرات `main` كلها ناجحة (✅).
>
> ⚠️ نسخة سابقة من هذا الملف قالت إن المشروع «Direct Upload غير مربوط بـ Git» —
> **كان تشخيصاً خاطئاً**. تحقّق دائماً من فحص الكومِت نفسه لا من الوثائق.

**كيف تتحقق بنفسك؟** من صفحة المستودع على GitHub: أي كومِت على `main` يعرض بجانبه
✅ Cloudflare Pages. أو من لوحة Cloudflare: Workers & Pages → المشروع → Deployments.

---

## 2) التحديث المعتاد: ادفع إلى `main` فقط (لا شيء آخر)

1. ادمج التغييرات في `main` (أو ادمج PR فيها).
2. Cloudflare يبني وينشر تلقائياً خلال دقيقة تقريباً على نفس الرابط.
3. راقب فحص `Cloudflare Pages` على الكومِت حتى يصير ✅ — ثم افتح الرابط.

هذا هو الطريق الوحيد المعتاد. **لا تضف** `.github/workflows/deploy-cloudflare.yml` ولا
`CLOUDFLARE_API_TOKEN` في أسرار GitHub: الربط بـ Git قائم فعلاً، وإضافة workflow
تعني نشرين لنفس الموقع ومصدرَين للحقيقة. (الملفان `docs/deploy-cloudflare-workflow.yml`
و `docs/ci-workflow.yml` داخل مجلد التوثيق **معطّلان** — مجرد نصوص لا ينفّذها أحد.)

---

## 3) إعدادات المشروع في لوحة Cloudflare (Settings → Builds & deployments)

| الحفل | القيمة |
|---|---|
| Production branch | `main` |
| Build command | **(فارغ)** — الملفات المبنية (`index.html` · `brc-standalone.html` …) مودَعة في Git أصلاً |
| Build output directory | `.` |
| Preview deployments | All non-Production branches — كل PR يحصل على `<slug>.babylonian-recruitment-company.pages.dev` |

> إن وُجد أمر بناء قديم فاحذفه: نشر المستودع من جذر محفوظ في Git أبسط وأسرع،
> ولا معنى لإعادة بناء ملفات مبنية أصلاً. وإن اضطررت لضبط أمر بناء يوماً فليكن:
> `npm ci && npm run build && npm run build:light && npm run dist` مع Output = `dist`.

---

## 4) رفع يدوي للطوارئ فقط (Create deployment)

لحالة يتعذّر فيها Git مؤقتاً فقط:

1. `npm run build && npm run build:light && npm run dist` → يتكوّن مجلد **`dist/`**
   (40 ملفاً · ‎5.5 ميجابايت — ملفات الموقع فقط، بلا `tests/` ولا `src/` ولا `docs/`).
2. في Cloudflare: **Workers & Pages → babylonian-recruitment-company → Create deployment**.
3. **اسحب مجلد `dist`** أو ملف ZIP له إلى منطقة الرفع → Deploy.

> ⚠️ هذا الاستثناء يُنتج نشراً غير مربوط بكومِت فيظهر في اللوحة بلا رسالة — اجعله
> لحالة الضرورة فقط، ثم عد إلى النشر من Git في أول دفعة تالية.
> والملفات المبنية (`brc-standalone.html` و `brc-light.html`) تُبنى محلياً —
> لا تُعدَّل يدوياً ولا تُبنى على Cloudflare.

مثلها تماماً النشر المباشر بـ wrangler من جهازك (للطوارئ أيضاً):

```bash
npm i -g wrangler          # مرة واحدة
wrangler login             # يفتح المتصفح لتأكيد الحساب
npm run build && npm run build:light && npm run dist
wrangler pages deploy dist --project-name babylonian-recruitment-company
```

---

## 5) النطاق الرسمي — `brc-babil.com` غير مسجَّل بعد ⚠️

استعلام DNS للنطاق يرجع **NXDOMAIN** (لا سجل A ولا NS — النطاق غير مسجَّل أصلاً)،
فلا تضفه في Custom domains ولن يعمل قبل تسجيله وامتلاكه.

- الرابط الحي الفعلي هو نطاق `pages.dev`، وهو نفسه **رابط الكيو آر الاحتياطي**
  في `assets/js/config.js` (`verifyBase`) — فاستمارات اليوم المطبوعة تفتح دائماً.
- `autoVerifyBase: true` يجعل الرابط المطبوع يتبع نطاق النشر تلقائياً؛ فمتى سجّلت
  النطاق وربطته في **Custom domains → Set up a custom domain**
  (`brc-babil.com` + `www.brc-babil.com`) انتقلت الاستمارات الجديدة إليه بلا أي
  تعديل في الكود.
- **لا تطبع استمارات على النطاق قبل تسجيله وربطه فعلاً** — وإلا صار كيو آر الورقة
  رابطاً ميتاً. والاستمارات المطبوعة على نطاق قديم تعمل ما دام النطاق يعمل؛ لا تُغلق
  نطاقاً قديماً قبل انتهاء صلاحية كل استماراته (30 يوماً).

---

## 6) الترويسات والمسارات النظيفة (تلقائي بلا إعداد)

| الملف | ماذا يفعل |
|---|---|
| `_headers` | ترويسات أمنية (`nosniff` · `Referrer-Policy` · `X-Frame-Options`) + منع تخزين `sw.js` مؤقتاً + كاش طويل للخطوط والصور |
| `_redirects` | مسارات نظيفة بإعادة كتابة داخلية (200): `/verify` · `/dashboard` · `/standalone` · `/light` |

هذان الملفان **لا يحتاجان أي تشغيل**؛ Cloudflare يقرأهما من جذر مجلد النشر.
وهما البديل الحرفي لما كان في `render.yaml` (headers + routes).

---

## 7) ما يُنشر وما لا يُنشر — `dist/`

`npm run dist` يبني مجلد نشر نظيفاً بلا أدوات ولا اختبارات (يُستعمل للرفع اليدوي
الاستثنائي فقط — النشر من Git ينشر جذر المستودع كاملاً بلا حاجة إليه):

| يُنشر | لا يُنشر |
|---|---|
| `index.html` · `verify.html` · `dashboard.html` | `tests/` · `src/` · `docs/` · `tools/` · `supabase/` |
| `brc-standalone.html` · `brc-light.html` · `supabase-check.html` | `package.json` · `package-lock.json` · `README.md` |
| `sw.js` · `_headers` · `_redirects` · `assets/**` | `node_modules/` · `dist/` نفسه |

والسكربت يفحص نفسه: يفشل إن كان أي ملف يطلبه المتصفح غير موجود في `dist/`
(صورة، خط، سكربت) — فلا يُنشر موقع بأصل ناقص بصمت.

---

## 8) إلغاء Render — تم ✅

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

## 9) بعد كل تحديث للواجهة — لا تنسَ

1. `node tools/build.mjs && node tools/build.mjs --light` (لتحديث `brc-standalone.html` و `brc-light.html`)
2. ارفع رقم الكاش في `sw.js` (`CACHE_NAME = 'brc-cache-v4'` → `v5` …)
   — بدونه تبقى أجهزة الموظفين على النسخة القديمة من الكاش
3. دفع إلى `main` → نشر تلقائي على Cloudflare Pages
4. إن ظهرت نسخة قديمة للزائر: **Caching → Configuration → Purge Everything**

---

## 10) فحص سريع بعد النشر

- [ ] فحص `Cloudflare Pages` على الكومِت المدموج في `main` أصبح ✅
- [ ] الصفحة الرئيسية تفتح: `https://babylonian-recruitment-company.pages.dev/`
- [ ] زر «دخول الموظفين» ظاهر في ترويسة الصفحة الرئيسية ويفتح `/dashboard`
- [ ] الوظائف تُقرأ من قاعدة الشركة (skeleton لحظة الفتح ثم المعلن، لا بيانات تجريبية)
- [ ] `/verify` **لا** تعرض بيانات استمارة للزائر — تعرض بوابة «خاص بموظفي الشركة والإدارة»
- [ ] `/dashboard` تعرض شاشة الدخول (وبجلسة موظف تفتح المنظومة)
- [ ] `/standalone` و `/light` يفتحان الملفّين المستقلَّين
- [ ] DevTools → Network → Header للاستجابة الأولى يحوي `x-content-type-options: nosniff`
- [ ] الـ Service Worker عندك صار `brc-cache-v4` (DevTools → Application → Cache Storage)
- [ ] إن كانت القاعدة بلا وظائف معلنة تظهر «لا توجد وظائف معروضة حالياً» — أضِف
      الوظائف من المنظومة الداخلية (`إضافة وظيفة`) أو من SQL Editor
