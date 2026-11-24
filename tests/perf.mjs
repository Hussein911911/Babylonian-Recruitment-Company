#!/usr/bin/env node
/* ===========================================================================
 *  HRC — ميزانية الأداء ومسارات الزوار
 *  ---------------------------------------------------------------------------
 *  لماذا اختبار للأداء؟ لأن الوزن يزيد بصمت: كل ملف يُضاف إلى صفحة يُنزّله كل
 *  زائر إلى الأبد، ولا أحد يلاحظ. هنا نُثبّت سقفاً لكل صفحة، ونمنع تحديداً:
 *    • تحميل مكتبة سوبابيس الكاملة (213KB) في صفحة زائر — حدث فعلاً وكان ثلث
 *      ما ينزّله الزائر، حتى صار للصفحات العامة عميل مصغّر (cloud-http).
 *    • أكثر من طلب قاعدة واحد لكل زيارة عامة.
 *
 *  ونُثبت أيضاً أن مسار الزائر **يعمل** بالعميل المصغّر: نُقلع خادماً وهمياً
 *  يتكلم PostgREST (يتحقق من ترويسة السكيما والردود) ونفتح index.html عليه.
 *
 *  التشغيل:  node tests/perf.mjs
 * =========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
 *  ميزانية الوزن لكل صفحة (بالكيلوبايت خاماً — قابلة للقياس بلا شبكة)
 *  الأرقام أعلى قليلاً من المقيس عمداً: هامش صغير للتحديثات، لكنها تمنع القفزات
 *  الكبيرة (مثل إعادة مكتبة 213KB إلى صفحة عامة).
 * ------------------------------------------------------------------------- */
const BUDGET = {
  /* رُفعت السقوف 2026-09-27 مع إضافة نافذة الحجز الإلكتروني، ثم 2026-09-30 مع
     نظام بطاقة التوظيف (قالب بطاقة 111.8×70.2مم في voucher.js + شاشات بطاقتي)، ثم
     مجدداً 2026-09-30 مع الدفعات الفارغة (نافذتا الدفعة والتعبئة بالداشبورد) —
     بقي الغرض الأصلي قائماً: التقاط القفزات الكبيرة (مثل إعادة مكتبة سوبابيس
     213KB إلى صفحة زائر)، لا معاقبة إضافة ميزة موثّقة. */
  /* موديل 2026-10-01 (بيع نقطة البيع عبر الموقع + صفحة صاحب العمل + استمارة
     A4): نموَّت الميزانيات بقدر الميزات المضافة فعلاً — استمارة A4 كاملة
     بقالبها ونمط طباعتها، بوابة الدور واستمارة الزبون بـbooking، والدوال
     الثلاث في store/cloud. أي تضخم فوق هذا يحتاج تبريراً مثله. */
  /* 2026-10-01 (خمساً): معالج «خطوة لكل معلومة» لاستمارة الزبون (6 خطوات +
     شريط تقدم + رجوع خطوة خطوة)، ثم متصفح وظائف ببطاقات وفلاتر (بحث/
     منطقة/دوام) بخطوة الوظيفة بدل القائمة المنسدلة + أنماط .bk-pick —
     506KB/791KB خاماً بعد ضغط النصوص. */
  /* 2026-10-02: إصلاح عطل RPC المنشور (Accept-Profile مع Content-Profile في
     cloud-http.js + rpcCall في cloud.js) دفع index.html إلى 510KB بالضبط —
     سقف 515KB بهامش بسيط؛ جوهر الميزانية (منع القفزات الكبيرة) لم يتغير. */
  /* 2026-10-06 (الباركود وحده + فرصتان يختارهما صاحب البطاقة + صفحة صاحب
     العمل بقرار التوظيف/الرفض بالسبب): صفحة التقديم الذاتي apply.html صارت
     صفحة مستقلة، ونمت booking.js/cloud.js/store.js وداشبورد الموظف بمسار
     الحالة الحرجة (إرجاع متاحة أو حذف). الرفع هنا 15KB للأولى و15KB
     للثانية و15KB للثالثة — يبقى الغرض: التقاط القفزات الكبيرة فقط. */
  /* 2026-10-13: قياس عند 26aadcb (قبل أي تعديل في هذا الفرع) أظهر أن الصفحات
     الثلاث **كانت أصلاً فوق السقوف**: index 562KB / verify 462KB /
     dashboard 862KB بعد نمو 2026-10-10 (البطاقة والباركود والتقديم الذاتي)،
     ثم زاد هذا الفرع إدارة حسابات الموظفين من الإعدادات
     (cloud-auth.js + dashboard.js + store.js) فأصبحت 569/470/898.
     السقوف رُفعت بمقدار المقيس + هامش صغير 10KB، ويبقى الغرض الأصلي: التقاط
     القفزات الكبيرة (إعادة مكتبة سوبابيس 213KB إلى صفحة زائر مثلاً). */
  /* +30KB للأخيرة (2026-10-13): إدارة حسابات الموظفين عبر الدالة السحابية
     hrc-staff-admin — نداء الدوال في cloud-auth.js ومسارات staffWrite في
     dashboard.js (تُقاس مقيسةً: 940KB خاماً). تبقى الرسالة: منع القفزات. */
  /* 2026-10-23: +12KB (580→592) لميزة المسح الضوئي لبطاقة التوظيف في نافذة
     «بطاقتي»: نافذة مسح موحّدة في qr-scan.js (كاميرا + رفع صورة + تفاوض على
     صيغ الباركود) وشاشة إدخال الباركود بزرَّي «مسح» و«ابدأ التقديم» في booking.js.
     قابلة للقياس: 586KB. لا سكربت جديد ولا طلب قاعدة جديد للزائر (20 طلباً كما
     هي)، وبقيت بقية السقوف دون تغيير. الغرض باقٍ: التقاط القفزات الكبيرة. */
  /* 2026-10-23 (+26KB index / +20KB verify): شاشة «قدّم ببطاقتك» الجديدة —
     وجه بطاقة بصري، زر مسح كبير، إدخال يدوي، وأنماط `.bk-entry*` في style.css
     المشتركة، مع نافذة المسح الموحّدة. القياس بعد البناء: 607KB و490KB.
     بلا سكربت أو طلب قاعدة جديد للزائر (20 طلباً كما هي). */
  /* 2026-10-24: أُعيدت بطاقات الموقع العام إلى تصميمها السابق (التصميم الفاخر
     صار في صفحة التقديل فقط) — index 618KB وverify 479KB بعد القياس. */
  /* 2026-10-25: الهوية الجديدة (ترتيب التطبيق + شروط البطاقة + البانر) أضافت
     ~6KB من HTML فقط؛ السقف رُفع بهامش بسيط وبلا أي طلب شبكة جديد. */
  /* 2026-10-25: قسم البطاقة الحقيقي + نافذة التفاصيل الحيّة + الفلترة الموحّدة
     أضافت ~4KB HTML فقط، بلا أي طلب شبكة جديد. */
  /* 2026-10-25: قسم المفضلة + زر التصنيفات البطيّة أضافا ~5KB HTML فقط،
     بلا أي طلب شبكة جديد (المفضلة من localStorage). */
  /* 2026-10-25: شريط الصفحة ووسوم data-page أضافت ~2KB HTML فقط؛
     التنقّل كله داخلي بلا أي طلب شبكة إضافي. */
  /* 2026-10-25: تعديلات السجل/الفلاتر مسّت dashboard.css وstyle.css فقط؛
     index نما 1KB من تنسيقات مشتركة. */
  /* 2026-10-27: هيكل صفحة كاملة بلا كريمي + كحلي مزرق/أخضر نيون أضاف ~1KB
     (قواعد لونية + شريط صفحة بزرّي رجوع/رئيسية). القياس: 717KB. لا طلب جديد. */
  /* 2026-11-07: jsQR (251KB) خرج من التحميل الأول — صار يُطلب عند أول مسح فعلي
     فقط (qr-scan.js→loadLibrary). القياس: 767KB، فأُبقيت ميزانية 720KB كما هي
     لتظل حارسة: أي إضافة 251KB أخرى تفشل فوراً. */
  /* 2026-11-12 (د): +1KB من شروح سلاسة السحب في style.css (الهيدر، الخلفية،
     الظهور). الشروح تشرح سبب كل حذف كي لا يعيد أحد إضافة تمويه أو ظل ثقيل.
     القياس: 781KB. لا طلب شبكة جديد. */
  /* 2026-11-20: +2KB (790→792) لنظام حركة الظهور: دخول متتابع للواجهة
     (mkRiseIn في style.css) وتتالٍ لبطاقات أول رسم (is-first-paint في
     app-shell.css + public.js). القياس: 790.1KB خاماً، وgzip **لم يتغيّر**
     (216KB) لأن الزيادة أنماط صغيرة تتكرر — أي أن كلفة الزائر صفر.
     بقي الهامش 2KB فقط ليظل الحارس يلتقط أي قفزة حقيقية. */
  'index.html': { raw: 792, requests: 20 },
  /* 2026-11-07: القياس 532KB (كان 512). النمو من سمات البطاقة المشتركة
     (voucher.js) وصفحة التحقق الموحّدة. jsQR لا يُحمَّل هنا أصلاً. */
  /* 2026-11-12: +1KB من uploadJobImage المشتركة في store.js. */
  /* 2026-11-12 (د): +1KB من نفس شروح style.css (verify تستوردها). القياس: 543KB. */
  'verify.html': { raw: 552, requests: 20 },
  /* 2026-10-18: +24KB staff-only notification UI/model/style + Arabic layout fixes.
     No new public scripts or DB requests; public budgets and auth tests unchanged. */
  /* 2026-10-24: +8KB لمحرّر صورة الوظيفة (معاينة + تكبير/تصغير + سحب +
     تثبيت ما يراه الموظف) في ملف assets/css/image-editor.css الخاص باللوحة،
     مع كود canvas في dashboard.js. القياس: 971KB. لا طلب جديد. */
  /* 2026-10-27: شعار «منصة مكسب» الجديد أُضيف إلى السبرايت المشترك (رمز SVG
     بحلقة ذهبية + M + صح + سهم + رأس) — ~0.6KB لكل صفحة، واللوحة نمت 1KB
     فقط. لا سكربت ولا طلب شبكة جديد. القياس: 1001KB. */
  /* 2026-11-07: القياس 1040KB (كان 1010). اللوحة تحمّل كل وحداتها في ملف واحد
     متشابك (209 استخدام لـ Store) — تقسيمه مخاطرة بلا مكسب، والبوابة محمية
     بتسجيل دخول فلا يراها زائر عابر. السقف 1050 يظل حارساً ضد أي قفزة كبيرة. */
  /* 2026-11-12: +2KB لقسم «النسخة المحمولة» في بطاقة الاسترجاع (زر تنزيل +
     شرح + رابط أداة الاسترجاع). وحدة التشفير نفسها (9KB) **ليست** في
     الميزانية لأنها تُحمَّل عند الطلب فقط — على نفس نمط jsqr و card-archive.
     القياس: 1052KB. لا طلب شبكة جديد عند فتح الشاشة. */
  /* 2026-11-12 (ج): +2KB من رفع الصور إلى Storage (uploadJobImage في store.js
     تُحمَّل مع اللوحة لأنها جزء من دالة الحفظ). القياس: 1056KB. */
  /* 2026-11-12 (د): +2KB من قواعد سلاسة السحب في app-shell.css. القياس: 1059KB.
     2026-11-13: +1KB — p_code صار وسيطاً إلزامياً في lookup_card (cloud.js
     يُضمَّن كاملاً في اللوحة). القياس: 1060KB. */
  'dashboard.html': { raw: 1072, requests: 20 }
};

function payloadOf(page) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const files = [...new Set([...html.matchAll(/(?:src|href)="([^"]+?\.(?:js|css))(?:\?[^"]*)?"/g)].map((m) => m[1]))];
  let raw = Buffer.byteLength(html);
  const each = [];
  for (const f of files) {
    const abs = join(ROOT, f);
    if (!existsSync(abs)) continue;
    const b = readFileSync(abs);
    raw += b.length;
    each.push({ path: f, raw: b.length, gz: gzipSync(b).length, br: brotliCompressSync(b).length });
  }
  return { page, files, each, raw, requests: files.length + 1, html };
}

console.log('\n' + '═'.repeat(74));
console.log('  HRC — ميزانية الأداء ومسار الزائر');
console.log('═'.repeat(74));

step(1, 'ميزانية الوزن — لا صفحة تتجاوز سقفها');
{
  for (const page of Object.keys(BUDGET)) {
    const p = payloadOf(page);
    const gz = gzipSync(Buffer.from(p.html)).length + p.each.reduce((a, e) => a + e.gz, 0);
    const br = brotliCompressSync(Buffer.from(p.html)).length + p.each.reduce((a, e) => a + e.br, 0);
    const b = BUDGET[page];
    console.log('   ' + page.padEnd(17) + 'خام ' + (p.raw / 1024).toFixed(0).padStart(4) + 'KB' +
      '  ·  gzip ' + (gz / 1024).toFixed(0).padStart(3) + 'KB' +
      '  ·  brotli ' + (br / 1024).toFixed(0).padStart(3) + 'KB' +
      '  ·  ' + p.requests + ' طلباً');
    check(page + ': الحجم الخام داخل الميزانية (' + b.raw + 'KB)', p.raw <= b.raw * 1024,
      (p.raw / 1024).toFixed(0) + 'KB');
    check(page + ': عدد الطلبات داخل الميزانية (' + b.requests + ')', p.requests <= b.requests, String(p.requests));
  }
}

step(2, 'الصفحات العامة لا تُحمّل مكتبة سوبابيس الكاملة');
{
  for (const page of ['index.html', 'verify.html']) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    check(page + ': لا مرجع لـ vendor/supabase.js', !/vendor\/supabase\.js/.test(html));
    check(page + ': يستخدم العميل المصغّر cloud-http.js', /cloud-http\.js/.test(html));
  }
  const dash = readFileSync(join(ROOT, 'dashboard.html'), 'utf8');
  check('اللوحة تحتفظ بمكتبة سوبابيس الكاملة (تحتاج Auth و Realtime)', /vendor\/supabase\.js/.test(dash));
  check('اللوحة تُحمّل وحدات الدخول', /cloud-auth\.js/.test(dash));
  const mini = readFileSync(join(ROOT, 'assets/js/cloud-http.js'));
  check('العميل المصغّر أقل من 10KB خاماً (مقابل 213KB)', mini.length < 10 * 1024, (mini.length / 1024).toFixed(1) + 'KB');
}

step(3, 'ميزانية القاعدة — طلبات Supabase لكل زيارة');
{
  /* العدد مأخوذ من السلوك الفعلي (واختبار store-cloud يتحقق منه بعميل وهمي):
     الزائر = طلب واحد لـ public_jobs، والموظف = ست قراءات + لحظي + دفعات. */
  const cfgJs = readFileSync(join(ROOT, 'assets/js/store.js'), 'utf8');
  const cloudJs = readFileSync(join(ROOT, 'assets/js/cloud.js'), 'utf8');
  const tables = (cloudJs.match(/var TABLES = \[([^\]]+)\]/) || [])[1] || '';
  const count = tables.split(',').filter((x) => x.trim()).length;
  check('جداول الإقلاع للموظف ستة كما هو متوقّع', count === 6, String(count));
  check('الصفحات العامة لا تشترك في القناة اللحظية', !/subscribeAll/.test(readFileSync(join(ROOT, 'assets/js/public.js'), 'utf8')));
  check('مساعد القراءة العامة محصور بعرض public_jobs (صفحات عند كبر القائمة)',
    /readPages\(client, 'public_jobs', 100000, \{ count: false, cols: PUBLIC_JOB_COLS \}\)/.test(cloudJs) &&
    !/from\('jobs'\)[\s\S]{0,80}fetchPublicJobs/.test(cloudJs));
  /* 2026-10-24: أسباب التأخير التي أُصلحت — نمنع رجوعها */
  check('القراءة العامة بلا count=exact على public_jobs (العدّ أثقل استعلام)',
    /readPages\(client, 'public_jobs', 100000, \{ count: false, cols: PUBLIC_JOB_COLS \}\)/.test(cloudJs));
  check('صفحات القاعدة 1000 صف وبقية الصفحات متوازية (٤ معاً)',
    /var PAGE_SIZE = 1000/.test(cloudJs) && /PAGE_PARALLEL = 4/.test(cloudJs) &&
    /mapLimit\(ranges, PAGE_PARALLEL/.test(cloudJs));
  check('العدّ الدقيق يُطلب مرة واحدة في الأولى ومرة في الأخيرة فقط (لا لكل صفحة)',
    /var first = query\(wantCount\)/.test(cloudJs) &&
    /fetchRange\(r.from, r.to, wantCount && index === lastIndex\)/.test(cloudJs) &&
    !/fetchRange\(r.from, r.to, true\)/.test(cloudJs));
  check('preconnect إلى قاعدة الشركة في كل صفحة منشورة', (() => {
    const host = 'vqsvztudvfukyuerzcgx.supabase.co';
    return ['index.html', 'verify.html', 'dashboard.html', '404.html'].every((f) => {
      const html = readFileSync(join(ROOT, f), 'utf8');
      return new RegExp('rel="preconnect" href="https://' + host + '"').test(html) &&
        new RegExp('rel="dns-prefetch" href="https://' + host + '"').test(html);
    });
  })());
  check('إقلاع اللوحة لا ينتظر تقارير 800KB (deferReports + تحميل خلفي)', (() => {
    const storeJs = readFileSync(join(ROOT, 'assets/js/store.js'), 'utf8');
    return /deferReports:\s*true/.test(storeJs) && /loadReportsAfterBoot\(\)/.test(storeJs) &&
      /loadWorkspaceReports/.test(cloudJs) && /loadReportsAfterBoot/.test(storeJs);
  })());
  check('الصفحة العامة بلا أي رسالة انتظار (طلب صاحب الشركة 2026-10-25)', (() => {
    const pub = readFileSync(join(ROOT, 'assets/js/public.js'), 'utf8');
    const css = readFileSync(join(ROOT, 'assets/css/card-entry.css'), 'utf8');
    const page = readFileSync(join(ROOT, 'index.html'), 'utf8');
    return !/job-connecting|showConnecting|connectingTimer/.test(pub) &&
      !/\.job-connecting/.test(css) &&
      !/جارٍ الاتصال بقاعدة الشركة/.test(page);
  })());
  check('الوظائف العامة: أعمدة محدّدة (لا select *) وذاكرة عرض فورية ٥ دقائق', (() => {
    const cloud = readFileSync(join(ROOT, 'assets/js/cloud.js'), 'utf8');
    const store = readFileSync(join(ROOT, 'assets/js/store.js'), 'utf8');
    return /PUBLIC_JOB_COLS/.test(cloud) && /hrc_public_jobs_v1/.test(cloud) &&
      /PUB_CACHE_TTL = 5 \* 60 \* 1000/.test(cloud) &&
      /readPublicCache\(\)/.test(store) && /savePublicCache/.test(cloud);
  })());
  check('الإقلاع المتوازي: الجلسة ثم الملف والبيانات معاً (لا انتظار متتالٍ)', (() => {
    const store = readFileSync(join(ROOT, 'assets/js/store.js'), 'utf8');
    const auth = readFileSync(join(ROOT, 'assets/js/cloud-auth.js'), 'utf8');
    return /sessionOnly\(\)/.test(auth) && /profileFor: profileFor/.test(auth) &&
      /Promise\.all\(\[pProfile, pData\]\)/.test(store) && !/unusedRestoreThenLoadLegacy/.test(store);
  })());
  check('سجل التدقيق مؤجَّل عن الإقلاع ويُقرأ عند فتح شاشته', (() => {
    const store = readFileSync(join(ROOT, 'assets/js/store.js'), 'utf8');
    const cloud = readFileSync(join(ROOT, 'assets/js/cloud.js'), 'utf8');
    const dash = readFileSync(join(ROOT, 'assets/js/dashboard.js'), 'utf8');
    return /deferAudit:true/.test(store) && /function loadAuditLog/.test(cloud) &&
      /loadAuditLog/.test(store) && /auditPending/.test(dash);
  })());
  check('مهلة اتصال ومحاولة إعادة واحدة في عميل الزائر', (() => {
    const http = readFileSync(join(ROOT, 'assets/js/cloud-http.js'), 'utf8');
    return /TIMEOUT_MS/.test(http) && /AbortController/.test(http) &&
      /r\.network \|\| method !== 'GET'/.test(http);
  })());
  check('الإقلاع العام لا يقرأ جداول الموظفين (canReadStaffTables)', /canReadStaffTables/.test(cfgJs));
}

step(4, 'العميل المصغّر يعمل فعلاً — خادم PostgREST وهمي + index.html حقيقية');
{
  /* خادم يحاكي PostgREST: يتحقق من ترويسة السكيما ويخدم الواجهة العامة والدوال.
     الغرض: إثبات أن الزائر يرى وظائف القاعدة فعلاً بلا مكتبة سوبابيس، وأن عدد
     الطلبات المطلوب لذلك واحد — لا «ستة جداول مرفوضة» كما كان سيحدث. */
  const seen = [];
  const api = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, profile: req.headers['accept-profile'] || req.headers['content-profile'], apikey: !!req.headers.apikey });
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/rest/v1/public_jobs')) {
      if (req.headers['accept-profile'] !== 'brc') return json({ code: 'PGRST205', message: "Could not find the table 'public.public_jobs'" }, 404);
      return json([{ code: 'HRC-7777', title: 'وظيفة من الخادم الوهمي', category: 'خدمات', region: 'بابل',
        salary_min: 600000, salary_max: 800000, shift: 'صباحي', gender: 'لا فرق', vacancies: 2,
        requirements: ['خبرة'], status: 'available', description: 'وصف', image_url: '', created_at: '2026-01-01T00:00:00.000Z' }]);
    }
    if (req.url.startsWith('/rest/v1/rpc/verify_form')) {
      if (req.headers['content-profile'] !== 'brc') return json({ code: 'PGRST202', message: 'no function' }, 404);
      return json({ ok: false, error: 'لا توجد استمارة بهذا الرقم' });
    }
    if (req.url.startsWith('/rest/v1/rpc/lookup_card')) {
      return json({ ok: true, card: { serial: 'HRC-BC-900777', fullName: 'ع••• ••••', phone: '0770•••••', status: 'active', issueDate: '2026-09-30T00:00:00Z', expiryDate: '2026-10-30T00:00:00Z', chancesLeft: 2, chances: [], succeeded: false } });
    }
    return json({ code: 'PGRST205', message: 'not found' }, 404);
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const apiPort = api.address().port;

  /* خادم ملفات الصفحة نفسها */
  const PORT = Number(process.env.HRC_PERF_PORT || 4331);
  const fileServer = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://localhost:' + PORT + '/'); if (r.ok) break; } catch {} await wait(150); }

  class Loader extends ResourceLoader {
    fetch(url, options) {
      /* نُعيد توجيه ملف الإعداد إلى نسخة تشير للخادم الوهمي */
      if (url.includes('/assets/js/supabase-config.js')) {
        return Promise.resolve(Buffer.from(
          "window.HRCSupabaseConfig = { url: 'http://127.0.0.1:" + apiPort + "', publishableKey: 'sb_publishable_test', schema: 'brc', enabled: true, enforceAuth: false };",
          'utf8'));
      }
      return super.fetch(url, options);
    }
  }
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    const m = String(e && (e.detail || e.message || e));
    if (/Not implemented|Could not load|Failed to load resource|NetworkError|ERR_/.test(m)) return;
    errors.push(m.split('\n')[0]);
  });
  const dom = await JSDOM.fromURL('http://localhost:' + PORT + '/index.html', {
    runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      /* jsdom لا يوفّر fetch أصلاً. نُمرّر fetch الخاص بـ Node ليعمل العميل
         المصغّر — وبذلك يمر الطلب على الشبكة الحقيقية إلى الخادم الوهمي،
         فالاختبار يثبت السلوك لا يحاكيه. */
      window.fetch = (url, init) => fetch(url, init);
    }
  });
  await new Promise((r) => { dom.window.addEventListener('load', r); setTimeout(r, 6000); });
  await wait(600);

  const w = dom.window, doc = w.document;
  const st = w.HRCStore.cloudStatus();
  check('لا أخطاء JS في الموقع العام', errors.length === 0, errors.join(' | '));
  check('الزائر متصل بالقاعدة (عميل مصغّر)', st.state === 'on' && st.role === 'public', JSON.stringify(st));
  check('الوظيفة القادمة من القاعدة ظاهرة في الصفحة',
    /HRC-7777/.test(doc.getElementById('jobs-grid').textContent), doc.getElementById('jobs-grid').textContent.slice(0, 80));
  const reads = seen.filter((s) => s.method === 'GET' && s.url.startsWith('/rest/v1/'));
  check('قراءة واحدة فقط لكل زيارة عامة', reads.length === 1, JSON.stringify(seen.map((s) => s.method + ' ' + s.url)));
  check('السكيما تُعلَن في الترويسة (Accept-Profile: brc)', reads.every((s) => s.profile === 'brc'),
    JSON.stringify(reads.map((s) => s.profile)));
  check('المفتاح العام يُرسل في كل طلب', seen.every((s) => s.apikey));
  check('لا قراءة لجداول الموظفين من الزائر (jobs/applicants/staff/audit)',
    !seen.some((s) => /\/(jobs|applicants|job_attempts|staff|audit_log|settings)\b/.test(s.url)),
    JSON.stringify(seen.map((s) => s.url)));

  /* الدوال العامة: «بطاقتي» (lookup_card) والتحقق من نفس الصفحة/الصفحة المجاورة */
  const req = await w.HRCStore.cardLookup('HRC-BC-900777');
  check('«بطاقتي» يعمل بالعميل المصغّر (RPC عام)', req.ok && req.card.serial === 'HRC-BC-900777', JSON.stringify(req.error || req.card.serial));
  const vr = await w.HRCStore.verifyCloud('HRC-BC-000000', null);
  check('التحقق يعمل بالعميل المصغّر ويُرجع «لا توجد بطاقة»', vr.ok === false && /لا توجد استمارة|لا توجد بطاقة/.test(vr.error), JSON.stringify(vr));
  check('لا محاولة تسجيل دخول من صفحة عامة', (await w.HRCStore.signIn('admin', 'x')).code === 'no_auth');

  /* ── ملفات التسليم (PWA + محركات البحث) ───────────────────────────────── */
  {
    const { existsSync: ex, readFileSync: rf } = await import('node:fs');
    check('manifest.webmanifest موجود', ex('manifest.webmanifest'));
    check('robots.txt موجود', ex('robots.txt'));
    check('sitemap.xml موجود', ex('sitemap.xml'));
    check('أيقونة 192 موجودة', ex('assets/img/icon-192.png'));
    check('أيقونة 512 موجودة', ex('assets/img/icon-512.png'));
    check('أيقونة maskable موجودة', ex('assets/img/icon-maskable-512.png'));

    const man = JSON.parse(rf('manifest.webmanifest', 'utf8'));
    check('manifest: الاسم واللغة عربية', man.name && man.lang === 'ar' && man.dir === 'rtl', man.lang);
    check('manifest: display=standalone', man.display === 'standalone', man.display);
    check('manifest: start_url موجود', !!man.start_url, man.start_url);
    check('manifest: ٤ أيقونات أو أكثر', man.icons.length >= 4, String(man.icons.length));
    check('manifest: أيقونة maskable', man.icons.some((i) => (i.purpose || '').includes('maskable')));
    check('manifest: theme_color كحلي', man.theme_color === '#0b1a3a', man.theme_color);

    const pages = ['index.html', 'apply.html', '404.html', 'verify.html', 'hrc-standalone.html', 'hrc-light.html'];
    pages.forEach((f) => {
      const h = rf(f, 'utf8');
      check(f + ': مرتبطة بالـmanifest', /rel="manifest"/.test(h));
      check(f + ': أيقونة iOS', /rel="apple-touch-icon"/.test(h));
    });
    check('dashboard.html: بلا manifest (لوحة داخلية)', !/rel="manifest"/.test(rf('dashboard.html', 'utf8')));

    check('robots.txt: يحجب اللوحة', /Disallow: \/dashboard/.test(rf('robots.txt', 'utf8')));
    check('robots.txt: يشير للـsitemap على النطاق الرسمي',
    /Sitemap: https:\/\/babylonian-recruitment-company\.pages\.dev\/sitemap\.xml/.test(rf('robots.txt', 'utf8')));
    /* ٦ روابط: أربع صفحات عامة + الصفحتان القانونيتان (2026-11-24) */
    check('sitemap.xml: ٦ روابط', (rf('sitemap.xml', 'utf8').match(/<url>/g) || []).length === 6);
  }

  api.close();
  fileServer.kill('SIGTERM');
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
console.log('═'.repeat(74) + '\n');
if (problems.length) { console.log('  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); console.log(); }
process.exit(fail ? 1 : 0);
