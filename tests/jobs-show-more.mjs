#!/usr/bin/env node
/* ===========================================================================
 *  HRC — «عرض المزيد / عرض أقل» في لوحة الوظائف العامة
 *  ---------------------------------------------------------------------------
 *  DOM حقيقي (jsdom) + نصوص الموقع الفعلية (index.html وكل سكربتاته)، ببيانات
 *  وهمية تُحقن عبر __HRC_TEST_SEED__ وبتعطيل السحابة — بلا أي طلب شبكة وبلا
 *  لمس قاعدة الإنتاج. يفحص: أول 10 فقط ← الكل ← أول 10، ثبات الترتيب،
 *  إعادة الطيّ عند تغيير الفلاتر، إخفاء الزر حين لا يوجد المزيد، إتاحة الوصول،
 *  وتزامن الملفات المبنية (index/standalone/light) مع المصدر.
 *
 *  التشغيل: npm run test:jobs-show-more
 * =========================================================================== */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = resolve(ROOT, 'index.html');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

let checks = 0;
function check(label, condition) {
  assert.ok(condition, label);
  console.log('  ✓ ' + label);
  checks++;
}

/* 22 وظيفة وهمية: أول 12 صباحي والباقي مسائي، لفحص الفلاتر والطيّ معاً.
   ترتيب المخزن: المتاحة أولاً ثم الأحدث (createdAt)، أي HRC-9001 … HRC-9022. */
const JOBS = Array.from({ length: 22 }, (_, i) => ({
  code: 'HRC-' + (9001 + i),
  title: 'وظيفة ' + (i + 1),
  category: i % 2 ? 'تقني' : 'خدمات',
  region: 'الحلة',
  governorate: 'بابل',
  salaryMin: 600000,
  salaryMax: 800000,
  shift: i < 12 ? 'صباحي' : 'مسائي',
  gender: 'لا فرق',
  requirements: [],
  imageUrl: ''
}));
const SEED = { ...DEMO_SEED, jobs: JOBS, jobsExtras: {}, applicants: [], attempts: [] };

/* إعداد الاتصال يُستبدل في الاختبار وحده: لا سحابة، لا طلبات، لا مفاتيح. */
class TestLoader extends ResourceLoader {
  fetch(url, options) {
    if (/supabase-config\.js/.test(String(url))) {
      return Promise.resolve(Buffer.from('window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'));
    }
    return super.fetch(url, options);
  }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const m = String(e && (e.detail || e.message || e));
  if (/Not implemented|Could not load|Failed to load resource/.test(m)) return;
  errors.push(m.split('\n')[0]);
});
vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

const dom = await JSDOM.fromFile(PAGE, {
  url: pathToFileURL(PAGE).href,
  runScripts: 'dangerously', resources: new TestLoader(), pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) { window.__HRC_TEST_SEED__ = JSON.parse(JSON.stringify(SEED)); }
});
const w = dom.window, doc = w.document;
w.HTMLElement.prototype.scrollIntoView = function () { };
w.scrollTo = function () { };
await new Promise((r) => {
  if (doc.readyState === 'complete') return r();
  let timer;
  const done = () => { clearTimeout(timer); r(); };
  timer = setTimeout(done, 5000);
  w.addEventListener('load', done, { once: true });
});

const $ = (id) => doc.getElementById(id);
const cards = () => [...doc.querySelectorAll('#jobs-grid .job-card')];
const codes = () => cards().map((c) => c.querySelector('.job-code').textContent.trim());
const label = () => $('jobs-more').querySelector('.jobs-more-label').textContent.trim();
const badge = () => $('jobs-more').querySelector('.jobs-more-count');
const progress = () => $('jobs-more-wrap').style.getPropertyValue('--jobs-progress');
const revealed = () => [...doc.querySelectorAll('#jobs-grid .job-card.is-revealed')];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const setSelect = (id, value) => { const el = $(id); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
/* البحث Immediate-ish: الواجهة تؤجّله 220ms (UI.debounce) فننتظره */
const setInput = async (id, value) => {
  const el = $(id);
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 280));
};
const FIRST_TEN = JOBS.slice(0, 10).map((j) => j.code);
const ALL_CODES = JOBS.map((j) => j.code);

try {
  check('لا أخطاء JavaScript أثناء تحميل الصفحة العامة', errors.length === 0, errors.join(' | '));
  check('البذرة الوهمية وصلت إلى المخزن (22 وظيفة)', w.HRCStore.listJobs({}).length === 22);

  /* 1) الحالة الابتدائية */
  check('يُعرض أول 10 وظائف فقط عند فتح الصفحة', cards().length === 10);
  check('الوظائف المعروضة هي أول 10 بالترتيب الصحيح', codes().join(',') === FIRST_TEN.join(','));
  check('العدّاد يعرض كل النتائج المطابقة لا المعروض منها فقط', $('jobs-count').textContent === '22');
  check('زر «عرض المزيد» ظاهر ويحمل التسمية الصحيحة', !$('jobs-more-wrap').hidden && !$('jobs-more').hidden && label() === 'عرض المزيد');
  check('ملاحظة العرض توضّح المعروض من أصل النتائج', /10 من 22/.test($('jobs-more-note').textContent));
  check('الزر مُعلّم لإتاحة الوصول (aria-expanded / aria-controls)',
    $('jobs-more').getAttribute('aria-expanded') === 'false' &&
    $('jobs-more').getAttribute('aria-controls') === 'jobs-grid' &&
    $('jobs-more-note').getAttribute('aria-live') === 'polite');
  check('ستايل الموقع: زر حبّة كحلي-ذهبي مع أيقونة وعدّاد',
    $('jobs-more').classList.contains('jobs-more-btn') &&
    !!$('jobs-more').querySelector('.jobs-more-ic .ic') &&
    !!$('jobs-more-wrap').querySelector('.jobs-more-meter-fill') &&
    badge().textContent === '+12' && !badge().hidden);
  check('شريط التقدّم يعكس نسبة المعروض (10 من 22)', progress() === '45%');
  check('المجموعة تدخل بحركة ظهور عند أول ظهور', $('jobs-more-wrap').classList.contains('is-in'));

  /* 2) عرض المزيد */
  click($('jobs-more'));
  check('«عرض المزيد» يُظهر كل الوظائف (22 بطاقة)', cards().length === 22);
  check('التوسيع يحافظ على ترتيب أول 10 في مقدمة الشبكة', codes().join(',') === ALL_CODES.join(','));
  check('الزر يتحوّل إلى «عرض أقل» وتتحدّث حالته', label() === 'عرض أقل' &&
    $('jobs-more').getAttribute('aria-expanded') === 'true' &&
    $('jobs-more').classList.contains('is-expanded'));
  check('ملاحظة العرض تُعلن أن كل النتائج ظاهرة', /كل النتائج: 22/.test($('jobs-more-note').textContent));
  check('رابط «عرض الكل» يُخفى حين تكون كل الوظائف ظاهرة', $('jobs-show-all').hidden === true);
  check('عدّاد «+N» يُخفى عند «عرض أقل» وشريط التقدّم يكتمل', badge().hidden === true && progress() === '100%');
  check('البطاقات الجديدة وحدها تظهر بتتابع متدرّج',
    revealed().length === 12 && !cards()[9].classList.contains('is-revealed') &&
    cards()[10].classList.contains('is-revealed') &&
    /\d+ms/.test(cards()[10].getAttribute('style')) &&
    cards()[21].getAttribute('style').includes('360ms'));

  /* 3) عرض أقل */
  click($('jobs-more'));
  check('«عرض أقل» يعيد أول 10 وظائف فقط', cards().length === 10);
  check('الطيّ يعيد نفس الوظائف ونفس الترتيب', codes().join(',') === FIRST_TEN.join(','));
  check('الزر يعود إلى «عرض المزيد»', label() === 'عرض المزيد' && $('jobs-more').getAttribute('aria-expanded') === 'false');
  check('رابط «عرض الكل» يعود للظهور', $('jobs-show-all').hidden === false);
  check('الطيّ يُعيد عدّاد «+12» ونسبة التقدّم ولا حركة على البطاقات',
    !badge().hidden && badge().textContent === '+12' && progress() === '45%' && revealed().length === 0);

  /* 4) رابط رأس القسم صار فعّالاً */
  click($('jobs-show-all'));
  check('«عرض الكل» في رأس القسم يُظهر كل النتائج فعلاً', cards().length === 22 && label() === 'عرض أقل');
  click($('jobs-more'));
  check('يمكن الطيّ مجدداً بعد «عرض الكل»', cards().length === 10);

  /* 5) الفلاتر تُعيد الطيّ تلقائياً ولا تُخفي نتائج البحث */
  click($('jobs-more'));
  check('توسيع تمهيداً لتغيير الفلتر', cards().length === 22);
  await setInput('filter-q', 'HRC-9020');
  check('البحث عن وظيفة كانت مخفية يعرضها فوراً', cards().length === 1 && codes()[0] === 'HRC-9020');
  check('العدّاد يعكس نتيجة البحث', $('jobs-count').textContent === '1');
  check('زر العرض التدريجي يُخفى حين لا تتجاوز النتائج 10', $('jobs-more-wrap').hidden === true);
  click($('filter-reset'));
  check('تصفير الفلاتر يعيد العرض المطويّ (10 لا 22)', cards().length === 10 && !$('jobs-more-wrap').hidden);
  check('تصفير الفلاتر يعيد العدّاد الكلي', $('jobs-count').textContent === '22');

  click($('jobs-more'));
  setSelect('filter-shift', 'مسائي');
  check('تغيير فلتر الدوام يطوي القائمة ويعرض نتائجه العشر', cards().length === 10 && $('jobs-count').textContent === '10');
  check('لا زر «المزيد» حين يساوي عدد النتائج حدّ العرض', $('jobs-more-wrap').hidden === true);
  click($('filter-reset'));
  check('العودة إلى كل الدوامات تعيد 10 بطاقات مع زر «عرض المزيد»', cards().length === 10 && !$('jobs-more-wrap').hidden && label() === 'عرض المزيد');

  /* 6) تحديث البيانات وحده لا يطوي قائمة موسّعة (بصمة الفلاتر، لا كل إعادة رسم) */
  click($('jobs-more'));
  w.HRCStore.emit();
  check('تحديث بيانات بلا تغيير فلتر يُبقي القائمة موسّعة', cards().length === 22 && label() === 'عرض أقل');
  check('تحديث البيانات لا يُعيد تشغيل حركة ظهور البطاقات', revealed().length === 0);

  /* 7) الملفات المبنية متزامنة مع المصدر (index + النسخة المستقلة + الخفيفة) */
  const pubJs = read('assets/js/public.js');
  check('public.js يحمل حدّ العرض 10 وحالتي الزر',
    /var JOBS_PAGE_SIZE = 10/.test(pubJs) && /عرض المزيد/.test(pubJs) && /عرض أقل/.test(pubJs));
  ['index.html', 'hrc-standalone.html', 'hrc-light.html'].forEach((f) => {
    const html = read(f);
    check(f + ' يحمل عناصر العرض التدريجي',
      /id="jobs-more"/.test(html) && /id="jobs-more-wrap"/.test(html) && /id="jobs-show-all"/.test(html));
    if (f !== 'index.html') {
      check(f + ' يحمل المنطق والأنماط المدمجة (عرض أقل + حد 10)',
        /JOBS_PAGE_SIZE = 10/.test(html) && /عرض أقل/.test(html) &&
        /\.jobs-more-wrap\[hidden\]/.test(html) && /@keyframes jobsMoreIn/.test(html));
    }
  });
  const appCss = read('assets/css/app-shell.css');
  check('ستايل الموقع + حركات احترافية في CSS (لمعان/نبض/تتابع/تقدّم)',
    /\.jobs-more-wrap\[hidden\]/.test(appCss) && /@keyframes jobsMoreIn/.test(appCss) &&
    /@keyframes jobsCardIn/.test(appCss) && /@keyframes jobsMorePulse/.test(appCss) &&
    /\.jobs-more-btn::after/.test(appCss) && /\.jobs-more-meter-fill/.test(appCss));
  check('تقليل الحركة يُلغي كل الانتقالات صراحةً',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,500}animation: none !important/.test(appCss));
  check('هيكل التحميل ورسالة فشل الاتصال يُخفيان زر العرض التدريجي',
    /function renderSkeleton\(\)[\s\S]{0,160}hideJobsMore\(\)/.test(pubJs) &&
    /function renderCloudError\(\)[\s\S]{0,160}hideJobsMore\(\)/.test(pubJs));

  console.log(`\nعرض المزيد/عرض أقل: ${checks} فحصاً ناجحاً.`);
} finally {
  dom.window.close();
}
