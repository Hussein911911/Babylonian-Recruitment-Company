# حذف زر «الهامبرغر» الميت من الترويسة

**التاريخ:** 2026-11-07 · **الطلب:** «اريد هاي احذفه لان ما تعرض شي فهمتني بدون اخطاء وتتاكد كلشي تمام»
(لقطة شاشة لصفحة «المنظومة الداخلية / تسجيل الدخول» على الجوال مع دائرة حمراء حول زر القائمة أعلى يسار الترويسة).

## التشخيص (قبل أي تعديل)

| العنصر | الحقيقة |
| --- | --- |
| الزر المُشار إليه | `#nav-toggle` داخل الترويسة المشتركة `src/partials/header.html` — يظهر على الجوال (≤720px) في `dashboard.html` و`verify.html` و`404.html`. |
| لماذا «ما يعرض شي» | معالج النقر الوحيد كان في `assets/js/public.js`، وهذا الملف يُحمَّل **في `index.html` وحدها**. على `index.html` نفسه تُخفى الترويسة كاملةً على الجوال (`app-shell.css` ≤860px) ويستعمل الزائر شريط التبويب السفلي. النتيجة: الزر **نقرة ميتة** على كل صفحة يظهر فيها، ولا يملك معالجاً في أي صفحة. |
| تحقّق عملي قبل الإصلاح | Chromium بعرض 375px: الزر مرئي عند `(15, 9)` بحجم 42×38، وبعد النقر يبقى `#main-nav` بلا صنف `open` و`aria-expanded="false"` — لا يفتح شيئاً. |
| الزر الآخر | `#hamburger-btn` داخل `src/partials/dashboard.html` يخص **الشريط الجانبي للوحة بعد تسجيل الدخول**، وهو مخفي قبل الدخول ويعمل بعده. **لم يُحذف** — ليس هو المقصود بالدائرة الحمراء. |

## ما الذي تغيّر

1. `src/partials/header.html` — حُذف `<button id="nav-toggle">` وغلافه `.header-actions`، مع تعليق يوثّق السبب والتاريخ ويُفرّق بين الزرين. `#main-nav` وروابطه بقيت كما هي (لسطح المكتب وللقارئات).
2. `assets/js/public.js` — حُذف معالج «قائمة الجوال» الميت؛ `assets/js/nav.js` — حُذف إعادة ضبط `aria-expanded` لزر لم يعد موجوداً.
3. `assets/css/style.css` — حُذفت قواعد `.nav-toggle` و`.main-nav.open` و`.header-actions`، وبقيت `.main-nav { display:none }` على الجوال بلا زر يفتحها.
3ب. `src/partials/sprite.html` — حُذف رمز `i-menu` الذي لم يبقَ له مستخدم، كي يظلّ فحص «الأيقونات غير المستخدمة» في `npm run audit` نظيفاً (147/4/0 كما في الأساس).
4. أُعيد بناء الصفحات المُولَّدة: `index.html`، `verify.html`، `dashboard.html`، `404.html`، `hrc-standalone.html`، `hrc-light.html` — بصمة الأصول `55a1d0cf8b`.
5. `sw.js` → `hrc-cache-v154` حتى لا يحتفظ زائر سابق بنسخة قديمة من الترويسة أو `style.css` في الكاش. (رُفعت لاحقاً إلى `hrc-cache-v155` مع تعريب سجل التدقيق ثم إلى `hrc-cache-v156` و`v157` مع استعادة تصميم وظائف البطاقة وإحكام بطاقة الفرص — انظر `docs/audit-arabic-labels.md` و`docs/card-chances-redesign.md`).
6. **لم يُلمس** شيء من Supabase أو بيانات الإنتاج أو التقديم على الوظائف أو المفضلة أو اللوحة بعد الدخول.

## الفحوص

```bash
npm run build && npm run build:light
npm test                                  # 140 / 0
npm run test:jobs-show-more                # 45 / 45
npm run test:header-nav                    # 29 / 0  (جديد)
npm run test:header-nav-browser            # 56 / 0  (جديد، Chromium)
```

- `tests/header-no-dead-toggle.mjs` (jsdom + خادم محلي صغير): يتأكد من خلوّ **الصفحات الست المنشورة** من `#nav-toggle` / `.nav-toggle` / `.header-actions`، ومن بقاء الترويسة والعلامة وروابط التنقل، ومن عدم وجود أخطاء JavaScript عند تحميل `index/verify/dashboard/404` فعلياً، ومن سلامة شاشة الدخول (النموذج، رابط العودة، `#hamburger-btn`) وقسم 404. كما يمنع عودة القواعد/المعالجات الميتة في `style.css` و`public.js` و`nav.js`.
- `tests/header-no-dead-toggle-browser.mjs` (Chromium حقيقي، 375px و1440px على الصفحات الأربع): صفر أخطاء `pageerror`/`console`، لا زر ولا غلاف هامبرغر، لا تمرير أفقي، `#main-nav` مخفي على الجوال ومرئي على سطح المكتب، شاشة الدخول ظاهرة، وزر قائمة اللوحة موجود لكنه **غير مرئي قبل الدخول**.
- بقية الحزم: `npm test` 140/0 · `jobs-show-more` 45/45 · `e2e` · `brand-consistency` · `apply-flow` 117/0 · `job-filters` · `schema` 302/6 و`audit` 147/4 (نفس أرقام الأساس قبل التعديل، ليست انحداراً) · تسع حزم متصفح · `perf.mjs` 34/3 (نفس الأساس).

## ملاحظة النشر

الصفحات المُولَّدة مشمولة في Git كالمعتاد؛ بعد رفع التغيير إلى `main` ينشر Cloudflare Pages تلقائياً. إن نُشر يدوياً عبر `npm run dist` فارفع `CACHE_NAME` (وهو `hrc-cache-v157` الآن) مع الملفات.
