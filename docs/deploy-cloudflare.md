# 🚀 النشر على Cloudflare Pages — المنصّة الوحيدة المعتمدة

> **القرار:** الموقع يُنشر على **Cloudflare Pages** فقط. أُزيل إعداد Render و `render.yaml`
> من المستودع، فلا يبقى أي ربط ثانٍ ينتج رابطاً مكرّراً.
> الملفات التي تخصّ Cloudflare موجودة في الجذر: `_headers` و `_redirects` — يقرأها
> Cloudflare تلقائياً **بلا أي إعداد بناء** (المشروع ثابت بالكامل: HTML/CSS/JS).

---

## 1) إعداد المشروع في Cloudflare (مرة واحدة)

لوحة Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
اختر مستودع `Babylonian-Recruitment-Company`، ثم اضبط القيم التالية حرفياً:

| الحقل | القيمة |
|---|---|
| Production branch | `main` |
| Framework preset | `None` |
| Build command | **(اتركه فارغاً)** |
| Build output directory | `.` |
| Root directory | `/` |
| Environment variables | **لا شيء** — لا أسرار ولا مفاتيح في البناء |

> الشرط الوحيد للبناء هو `git clone` — لأن التابع `brc-standalone.html` و`brc-light.html`
> ملفّان ملتزمان في المستودع أصلاً (يُبنَيان محلياً بـ `node tools/build.mjs` قبل الدفع).

بعد الحفظ: أول نشر تلقائي يبدأ خلال دقيقة، ويصبح على
`https://<project-name>.pages.dev`.

---

## 2) معاينات الفروع والطلبات (بديل معاينات Render)

Cloudflare Pages يبني كل فرع غير إنتاجي تلقائياً إن كان الخيار مفعّلاً:

**Settings → Builds & deployments → Preview deployments → All non-Production branches**

فنحصل على رابط معاينة لكل فرع/طلب دمج بهيئة:

```
https://<branch-slug>.<project-name>.pages.dev
```

عملياً: أي شغل جديد أدفعه إلى فرع العمل يظهر فوراً على رابط معاينة — بلا حاجة إلى Render.

---

## 3) النطاق الرسمي

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

## 4) الترويسات والمسارات النظيفة (تلقائي بلا إعداد)

| الملف | ماذا يفعل |
|---|---|
| `_headers` | ترويسات أمنية (`nosniff` · `Referrer-Policy` · `X-Frame-Options`) + منع تخزين `sw.js` مؤقتاً + كاش طويل للخطوط والصور |
| `_redirects` | مسارات نظيفة بإعادة كتابة داخلية (200): `/verify` · `/dashboard` · `/standalone` · `/light` |

هذان الملفان **لا يحتاجان أي تشغيل**؛ Cloudflare يقرأهما من جذر مجلد النشر.
وهما البديل الحرفي لما كان في `render.yaml` (headers + routes).

---

## 4.1) تنظيف الملفات المنشورة (اختياري لكن مُستحسن)

بالإعداد الافتراضي (Output directory = `.`) يُنشر كل ما في المستودع — بما فيه
`tests/` و `docs/` و `src/` و `supabase/`. لا أسرار فيها (الأسرار كلها خارج الكود
بحكم التصميم)، لكن الأنظف ألّا تكون متاحة للتحميل من الموقع.

الحلّ بلا أدوات: اجعل مجلد النشر `dist` بأمر بناء من سطر واحد:

| الحقل | القيمة |
|---|---|
| Build command | `mkdir -p dist && cp -r index.html verify.html dashboard.html brc-standalone.html brc-light.html sw.js _headers _redirects assets dist/` |
| Build output directory | `dist` |

> 🔁 إذا أضفت يوماً صفحة أو ملفاً جديداً في الجذر فأضِفه إلى الأمر نفسه، وإلا لن يُنشر.
> وإذا لم ترغب بهذه المسؤولية الإضافية فاترك الإعداد الافتراضي (`Output = .`) — فالنشر
> الافتراضي صالح تماماً والملفات المكشوفة ليست حسّاسة.

---

## 5) إلغاء Render نهائياً (خطواتك أنت — لا تُنفَّذ من المستودع)

حذف `render.yaml` يمنع أي نشر تكويني جديد، لكن **الخدمة نفسها تبقى حيّة برابطها**
حتى تُحذف من لوحة Render:

1. [dashboard.render.com](https://dashboard.render.com) → الخدمة `babylonian-recruitment-company`
2. **Settings → Delete Service** (وإن أردت خطوة ألطف: **Settings → Disconnect** من GitHub ثم Delete)
3. تأكّد أن رابط `...onrender.com` صار `404` أو توقّف
4. امسح رابط onrender من أي مكان يُشارَك مع الناس (واتساب · ستوري · بطاقات · سيرة الشركة)

> 🔴 لا تترك الخدمة معلّقة بلا سبب: أي رابط منشور يبقى نسخةً ثانية من الموقع —
> وهذا بالضبط سبب إلغائها.

---

## 6) النشر بلا Git (اختياري — نشر مباشر)

```bash
npm i -g wrangler          # مرة واحدة
wrangler login             # يفتح المتصفح لتأكيد الحساب
wrangler pages deploy . --project-name babylonian-recruitment-company
```

مفيد للنشر السريع من جهازك بلا انتظار Git. أما النشر المعتاد فيبقى تلقائياً عند
كل دفعة إلى `main`.

---

## 7) بعد كل تحديث للواجهة — لا تنسَ

1. `node tools/build.mjs && node tools/build.mjs --light` (لتحديث `brc-standalone.html` و `brc-light.html`)
2. ارفع رقم الكاش في `sw.js` (`CACHE_NAME = 'brc-cache-v3'` → `v4` …)
   — بدونه تبقى أجهزة الموظفين على النسخة القديمة من الكاش
3. دفع إلى `main` → نشر تلقائي على Cloudflare
4. إن ظهرت نسخة قديمة للزائر: **Caching → Configuration → Purge Everything**

---

## 8) فحص سريع بعد النشر

- [ ] الصفحة الرئيسية تفتح: `https://<project>.pages.dev/`
- [ ] `/verify` **لا** تعرض بيانات استمارة للزائر — تعرض بوابة «خاص بموظفي الشركة والإدارة»
- [ ] `/dashboard` تعرض شاشة الدخول (وبجلسة موظف تفتح المنظومة)
- [ ] `/standalone` و `/light` يفتحان الملفّين المستقلَّين
- [ ] DevTools → Network → Header للاستجابة الأولى يحوي `x-content-type-options: nosniff`
- [ ] الـ Service Worker عندك صار `brc-cache-v3` (DevTools → Application → Cache Storage)
- [ ] الوظائف تظهر كما في قاعدة الشركة (Supabase) — إن ظهرت «0 وظيفة» فالقاعدة نفسها
      بلا وظائف مُدخلة، أضِفها من المنظومة الداخلية (`إضافة وظيفة`) أو من SQL Editor
