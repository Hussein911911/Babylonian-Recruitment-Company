#!/usr/bin/env node
// Synthetic cross-device transfer: inject fixtures in test memory, NOT through
// the restore API (now admin-only). Production Auth/security checks stay intact.
function injectFixture(store,json){const db=store.db();for(const k of Object.keys(db))delete db[k];Object.assign(db,JSON.parse(json));store.emit();}
/* ===========================================================================
 *  HRC — اختبارات دخانية وظيفية (jsdom)
 *  ---------------------------------------------------------------------------
 *  تُشغّل الصفحات فعلياً في DOM حقيقي وتتحقق من:
 *   • عدم وجود أخطاء JavaScript
 *   • عرض الوظائف والفلاتر والبحث السريع في الموقع العام
 *   • إصدار بطاقة توظيف (بيع كاش عند نقطة بيع)، طباعة قالب 86×54مم، الباركود
 *   • منطق فرصتي البطاقة، الحجز 24 ساعة، الحالة الحرجة وقراراتها الثلاثة
 *   • صفحة التحقق (QR) والمنظومة الداخلية (دخول، جدولة، سجل تدقيق، مالية)
 *   • عمل النسخة المستقلة بالكامل عبر الرابط الهاشي
 *
 *  التشغيل:
 *      npm i jsdom            # مرة واحدة
 *      node tests/smoke.mjs
 *  أو: NODE_PATH=/path/to/node_modules node tests/smoke.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const failures = [];

function ok(name) { pass++; console.log('  ✅ ' + name); }
function bad(name, detail) { fail++; failures.push(name + ' — ' + detail); console.log('  ❌ ' + name + ' :: ' + detail); }
function check(name, fn) {
  try { const r = fn(); if (r === true || r === undefined) ok(name); else bad(name, String(r)); }
  catch (e) { bad(name, e.message); }
}
function eq(actual, expected, name) {
  if (actual === expected) ok(name + ' (' + JSON.stringify(actual) + ')');
  else bad(name, 'متوقع ' + JSON.stringify(expected) + ' وحصلنا ' + JSON.stringify(actual));
}


/* أدوات مساعدة: آخر نافذة مفتوحة + إغلاق كل النوافذ */
function lastModal(doc) {
  const all = doc.querySelectorAll('.modal-backdrop .modal');
  return all.length ? all[all.length - 1] : null;
}
function closeAllModals(doc) {
  doc.querySelectorAll('.modal-backdrop').forEach((b) => {
    const c = b.querySelector('[data-close]');
    if (c) c.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    else b.remove();
  });
}

const STAFF_SESSION = { username: 'staff', name: 'موظف فحص', role: 'staff', title: 'موظف توظيف', at: new Date().toISOString() };

async function load(file, { hash = '', search = '', waitMs = 260, session = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    // أخطاء تحميل الموارد غير المحلية (خطوط/صور) متوقعة داخل jsdom
    if (/Could not load|Error: Not implemented/.test(String(e.message))) return;
    errors.push(e.message);
  });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const url = pathToFileURL(resolve(ROOT, file)).href + (search || '') + (hash || '');
  const dom = await JSDOM.fromFile(resolve(ROOT, file), {
    url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    /* jsdom لا يوفّر sessionStorage لأصول file:// — نزرع جلسة الموظف عبر واجهة تخزين بديلة */
    beforeParse(window) {
      /* بذرة العرض للاختبارات فقط — الإنتاج ببذرة فارغة (انظر
         tests/fixtures/demo-seed.mjs). تُوضع قبل تنفيذ config.js. */
      window.__HRC_TEST_SEED__ = JSON.parse(JSON.stringify(DEMO_SEED));
      if (!session) return;
      const m = new Map([['hrc_session_v2', JSON.stringify({ ...session, cloud: true })]]);
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
          setItem: (k, v) => m.set(String(k), String(v)),
          removeItem: (k) => m.delete(String(k)),
          clear: () => m.clear(),
          key: (i) => Array.from(m.keys())[i] || null,
          get length() { return m.size; }
        }
      });
    }
  });
  const { window } = dom;
  // تضبيط ما لا توفره jsdom
  Object.defineProperty(window, 'print', {
    configurable: true, writable: true,
    value: () => { window.__printed = (window.__printed || 0) + 1; }
  });
  window.__printed = 0;
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:test';
  await new Promise((r) => setTimeout(r, waitMs));
  // This loader is the explicitly offline UI fixture; cloud fixtures use loadCloudSite.
  if (window.HRCSupabaseConfig) window.HRCSupabaseConfig.enabled = false;
  if (window.location.hash !== hash && hash) window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 120));
  return { dom, window, doc: window.document, errors };
}

/* Content cleanup must not remove safety information or reintroduce stale setup copy. */
check('نصوص التشغيل لا تدّعي أن النظام محلي أو غير مربوط', () => {
  const partial = readFileSync(resolve(ROOT, 'src/partials/dashboard.html'), 'utf8');
  return !/نظام محلي يعمل داخل المتصفح|جاهز للربط بـ|للحفظ الدائم على السيرفر راجع/.test(partial);
});
check('الاختصار يحافظ على شروط الحجز وحقوق البطاقة والتنبيه القانوني', () => {
  const home = readFileSync(resolve(ROOT, 'src/partials/public.html'), 'utf8');
  const footer = readFileSync(resolve(ROOT, 'src/partials/footer.html'), 'utf8');
  const verifyCopy = readFileSync(resolve(ROOT, 'src/partials/verify.html'), 'utf8');
  /* 2026-10-25: حُذف بانر البطاقة المرسوم من الصفحة الرئيسية (لا شكل بطاقة على
     الموقع)، فبقيت الشروط في قسم آلية العمل و«الفرص وتفاصيلها» في صفحة بطاقتي.
     نتحقق أنها ما زالت مكتوبة فعلاً في الموقع (لا حذفاً صامتاً للحقوق). */
  const cardPage = readFileSync(resolve(ROOT, 'assets/js/public.js'), 'utf8');
  return /24 ساعة/.test(home || cardPage) && /حرجة/.test(home || cardPage) &&
    /30 يوماً/.test(home || cardPage) &&
    /الفرصة المستهلكة لا تعود/.test(home + cardPage) &&
    /الدفع كاش/.test(home || cardPage) && /الفرص المتبقية/.test(cardPage) &&
    /الناحية الفنية والتخصصية فقط وليس الأمنية/.test(footer) && /للموظفين والإدارة فقط/.test(verifyCopy);
});

/* ======================= 1) الموقع العام ======================= */
console.log('\n=== 1) الموقع العام (index.html) ===');
const site = await load('index.html');
check('لا أخطاء JavaScript في الصفحة العامة', () => site.errors.length === 0 || site.errors.join(' | '));
check('تم تحميل مكتبة الكيو آر كود والإعدادات والمخزن', () =>
  Boolean(site.window.HRCQR && site.window.HRC_CONFIG && site.window.HRCStore && site.window.HRCVoucher) ||
  'بعض الوحدات لم تُحمّل');
check('الوظائف التجريبية ظهرت كبطاقات', () => {
  const cards = site.doc.querySelectorAll('#jobs-grid .job-card').length;
  return cards >= 8 || 'عدد البطاقات: ' + cards;
});
check('إحصاءات الواجهة (شريط الأرقام) ظهرت', () => {
  /* 2026-10-25: الشريط انتقل إلى نمط التطبيق (.app-stat) بنفس المعرّف #hero-stats */
  const n = site.doc.querySelectorAll('#hero-stats .app-stat').length;
  return n === 4 || 'عدد الإحصاءات: ' + n;
});
check('أيقونة/شعار الشركة موجود داخل الرموز (Sprite)', () =>
  !!site.doc.getElementById('i-emblem') || 'رمز الشعار غير موجود');
check('صورة المدينة في الواجهة وصورتا التوظيف والمتابعة في الأقسام', () => {
  const bg = site.window.getComputedStyle(site.doc.querySelector('.hero.hero-app .hero-bg')).backgroundImage || '';
  const imgs = Array.from(site.doc.querySelectorAll('.lion-frame img')).map(img => img.getAttribute('src'));
  return (/hero-skyline\.webp/.test(bg) && imgs.includes('assets/img/recruitment-team.webp') && imgs.includes('assets/img/recruitment-digital.webp') && imgs.every(p => existsSync(join(ROOT,p)))) || 'صور التوظيف أو الخلفية غير متوفرة';
});
check('رسالة التواصل تعرض النص المحدّث مع أزرار البطاقة وواتساب', () => {
  const section = site.doc.querySelector('#contact');
  return !!section && section.textContent.includes('جاهز للبدء؟ احصل على بطاقتك الآن') &&
    section.textContent.includes('احصل على بطاقة التوظيف من أقرب نقطة بيع مباشر، وابدأ بالتقديم ومتابعة طلباتك فوراً عبر المنصة.') &&
    !!section.querySelector('[data-action="open-booking"]') && !!section.querySelector('a[href^="https://wa.me/"]');
});
check('قسم عن المنصة يعرض التعريف الجديد', () => {
  const about = site.doc.querySelector('#about');
  return !!about && ['عن المنصة','منصة مكسب للتوظيف','حلول التوظيف الشاملة','نربط بين أصحاب العمل والباحثين عن وظائف في كافة المجالات والقطاعات على مستوى العراق.'].every(t=>about.textContent.includes(t)) && !about.textContent.includes('شركة الهدف للتوظيف');
});
check('التصفية بالحالة تعمل', () => {
  const sel = site.doc.getElementById('filter-status');
  sel.value = 'available';
  sel.dispatchEvent(new site.window.Event('change'));
  const n = site.doc.querySelectorAll('#jobs-grid .job-card').length;
  const shown = Number(site.doc.getElementById('jobs-count').textContent);
  return (n === shown && n > 0 && n < 8) || ('بطاقات ' + n + ' / عدّاد ' + shown);
});
const fq = site.doc.getElementById('filter-q');
fq.value = 'HRC-1042';
fq.dispatchEvent(new site.window.Event('input'));
await new Promise((r) => setTimeout(r, 340));
check('نتيجة البحث بالكود = وظيفة واحدة', () => {
  const n = site.doc.querySelectorAll('#jobs-grid .job-card').length;
  const codeEl = site.doc.querySelector('#jobs-grid .job-code');
  return (n === 1 && codeEl.textContent.includes('HRC-1042')) || ('عدد: ' + n);
});
check('بيانات صاحب العمل لا تظهر في بطاقة الوظيفة العامة', () => {
  const html = site.doc.getElementById('jobs-grid').innerHTML;
  return !html.includes('07701234567') || 'ظهر رقم هاتف صاحب العمل في العرض العام!';
});

/* فتح تفاصيل الوظيفة */
check('نافذة تفاصيل الوظيفة تُفتح وتعرض تحذير الخصوصية', () => {
  const btn = site.doc.querySelector('[data-action="job-details"]');
  btn.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  const modal = lastModal(site.doc);
  return (modal && modal.textContent.includes('خصوصية البيانات')) || 'لم تُفتح النافذة أو لا تحذير خصوصية';
});
check('إغلاق النافذة يعمل', () => {
  const close = lastModal(site.doc).querySelector('[data-close]');
  close.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  return site.doc.querySelector('.modal-backdrop') === null || 'النافذة لم تُغلق';
});

/* ═══ سياسة الشركة: الزائر لا يقدّم طلباً ولا يتحقق — للعرض والتواصل فقط ═══ */
check('الموقع العام بلا أي زر تقديم أو طلب استمارة', () => {
  const bad = site.doc.getElementById('btn-request-form') || site.doc.getElementById('btn-request-form-2') ||
    site.doc.getElementById('req-form') || site.doc.querySelector('[data-action="request-form"]');
  return !bad || 'ما زال هناك عنصر طلب استمارة موجّه للزائر';
});
check('الموقع العام بلا واجهة تحقق للزائر', () => {
  const bad = site.doc.getElementById('verify-quick') || site.doc.getElementById('verify-serial') ||
    site.doc.querySelector('[data-action="verify"]');
  return !bad || 'ما زالت واجهة التحقق ظاهرة للزائر';
});
/* ═══ نافذة «بطاقتي»: مسار الزبون الكامل بنظام البطاقة ═══ */
check('بطاقة الوظيفة تعرض زر «قدّم ببطاقتك» يفتح نافذة «بطاقتي»', () => {
  site.doc.getElementById('filter-reset') && site.doc.getElementById('filter-reset')
    .dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  const a = site.doc.querySelector('#jobs-grid .job-card [data-action="open-booking"]');
  if (!a) return 'لا يوجد زر تقديم في بطاقة الوظيفة';
  const code = a.getAttribute('data-code');
  if (!/^HRC-\d{3,}$/.test(code || '')) return 'الزر لا يحمل كود الوظيفة: ' + code;
  a.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  const modal = lastModal(site.doc);
  return (modal && !!modal.querySelector('#bk-serial') && modal.textContent.includes('بطاقتي')) ||
    'لم تُفتح نافذة بطاقتي على شاشة إدخال الباركود';
});
check('بطاقتي: باركود بصيغة خاطئة يُرفض فوراً', () => {
  const inp = lastModal(site.doc).querySelector('#bk-serial');
  inp.value = 'HRC-XX-123';
  inp.dispatchEvent(new site.window.Event('input', { bubbles: true }));
  lastModal(site.doc).querySelector('#bk-lookup').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  const err = lastModal(site.doc).querySelector('[data-bk-err="serial"]');
  return (err && err.textContent.trim().length > 3) || 'مرّ باركود خاطئ بلا اعتراض';
});
await (async () => {
  const name = 'بطاقتي: باركود غير موجود يعطي رسالة واضحة';
  try {
    const inp = lastModal(site.doc).querySelector('#bk-serial');
    inp.value = 'HRC-BC-999999';
    inp.dispatchEvent(new site.window.Event('input', { bubbles: true }));
    lastModal(site.doc).querySelector('#bk-lookup').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 140));
    const err = lastModal(site.doc).querySelector('[data-bk-err="serial"]');
    if (!err || !/لا توجد بطاقة/.test(err.textContent)) return bad(name, 'رسالة الرفض: ' + (err && err.textContent));
    return ok(name);
  } catch (e) { bad(name, e.message); }
})();
await (async () => {
  const name = 'بطاقتي: باركود صحيح يعرض الحالة ببيانات مقنّعة وبلا رموز الفرص';
  try {
    const inp = lastModal(site.doc).querySelector('#bk-serial');
    inp.value = 'HRC-BC-000117';
    inp.dispatchEvent(new site.window.Event('input', { bubbles: true }));
    lastModal(site.doc).querySelector('#bk-lookup').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 160));
    const txt = lastModal(site.doc).textContent;
    const st = site.window.HRCBooking.state();
    if (st.view !== 'status') return bad(name, 'الشاشة: ' + st.view);
    if (!txt.includes('HRC-BC-000117')) return bad(name, 'الباركود غير ظاهر');
    if (txt.includes('علي حسين محمد')) return bad(name, '⚠️ الاسم الكامل ظهر بلا تقنيع');
    if (txt.includes('07701112233')) return bad(name, '⚠️ الهاتف الكامل ظهر بلا تقنيع');
    const codes = site.window.HRCStore.getAttempts('HRC-BC-000117').map((t) => t.code).filter(Boolean);
    const leaked = codes.length ? codes.some((c) => txt.includes(c)) : false;
    if (leaked) return bad(name, '⚠️ رمز فرصة ظهر في شاشة الحالة');
    if (/رمز الفرصة/.test(txt)) return bad(name, '⚠️ ما زالت الشاشة تعرض «رمز الفرصة»');
    if (!/فرصة متاحة|الفرص|فرصت/.test(txt)) return bad(name, 'حالة الفرص غير ظاهرة');
    return ok(name);
  } catch (e) { bad(name, e.message); }
})();

/* ═══ الفلاتر: المحافظة وحدها (لا مناطق) — قرار 2026-10-24 ═══ */
check('الموقع العام: لا فلتر مناطق، وفلتر المحافظة يحمل كل المحافظات', () => {
  if (site.doc.getElementById('filter-region')) return 'ما زال فلتر المناطق موجوداً';
  const gov = site.doc.getElementById('filter-governorate');
  const qsGov = site.doc.getElementById('qs-governorate');
  if (!gov || !qsGov) return 'خانة المحافظة أو خانة البحث السريع مفقودة';
  const list = [...gov.options].map((o) => o.value).filter((v) => v !== 'all');
  const cfg = site.window.HRC_CONFIG.governorates;
  if (list.length !== cfg.length) return 'عدد المحافظات ' + list.length + ' والمتوقع ' + cfg.length;
  if (new Set(list).size !== list.length) return 'تكرار في قائمة المحافظات';
  if (!cfg.every((g) => list.includes(g))) return 'محافظة ناقصة: ' + cfg.filter((g) => !list.includes(g)).join(', ');
  if (!list.includes('القادسية') || !list.includes('حلبجة')) return 'القادسية/حلبجة ناقصة';
  const qsList = [...qsGov.options].map((o) => o.value).filter((v) => v !== 'all');
  return (qsList.length === list.length) || 'قائمة البحث السريع مختلفة: ' + qsList.length;
});
check('فلتر المحافظة يطابق الأسماء البديلة (الديوانية = القادسية · اربيل = أربيل)', () => {
  const S = site.window.HRCStore;
  if (typeof S.govKey !== 'function') return 'دالة تطبيع المحافظة غير مُصدَّرة';
  return (S.govKey('الديوانية') === S.govKey('القادسية') &&
    S.govKey('اربيل') === S.govKey('أربيل') &&
    S.govKey('حلبجه') === S.govKey('حلبجة')) || 'تطبيع الأسماء لا يعمل';
});

await (async () => {
  const name = 'صفحة بطاقتي: بعد المسح تعرض خيار التفاصيل أو التقديم';
  const w = site.window, originalScan = w.HRCQRScan, originalLookup = w.HRCStore.cardLookup;
  let options, lookedUp = '';
  w.HRCQRScan = Object.assign({}, originalScan, { open: (opts) => { options = opts; return true; } });
  w.HRCStore.cardLookup = (serial) => { lookedUp = serial; return Promise.resolve({ ok: false, error: 'اختبار' }); };
  try {
    site.doc.getElementById('cp-scan').click();
    const text = 'https://example.com/apply.html?form=HRC-BC-000117';
    if (!options || !options.validate(text) || options.validate('https://example.com/not-a-card')) return bad(name, 'تحقق رمز QR غير صحيح');
    options.onResult(text);
    const choice = lastModal(site.doc);
    const apply = choice && choice.querySelector('#cp-choice-apply');
    const details = choice && choice.querySelector('#cp-choice-details');
    if (!choice || !apply || !details || lookedUp || site.doc.getElementById('cp-serial').value !== 'HRC-BC-000117') return bad(name, 'لم تظهر الخيارات المنبثقة بعد قراءة الرقم');
    if (choice.getAttribute('role') !== 'dialog' || !(apply.compareDocumentPosition(details) & w.Node.DOCUMENT_POSITION_FOLLOWING)) return bad(name, 'الترتيب أو نافذة الحوار غير صحيحة');
    if (!apply.getAttribute('href').endsWith('apply.html?form=HRC-BC-000117')) return bad(name, 'رابط التقديم لا يحمل رقم البطاقة');
    // On file://, application is blocked and the message stays in the dialog.
    apply.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    if (choice.querySelector('#cp-choice-error').hidden) return bad(name, 'لا يوجد تنبيه في النسخة المستقلة');
    details.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (lookedUp !== 'HRC-BC-000117' || site.doc.contains(choice)) return bad(name, 'لم تُغلق النافذة أو لم يُبحث عن البطاقة');
    return ok(name);
  } finally { w.HRCQRScan = originalScan; w.HRCStore.cardLookup = originalLookup; }
})();

/* ═══ المسح الضوئي للبطاقة وفتح صفحة التقديم (طلب صاحب الشركة 2026-10-23) ═══ */
await (async () => {
  const jobBtn = [...site.doc.querySelectorAll('#jobs-grid .job-card [data-action="open-booking"]')]
    .find((b) => /^HRC-\d{3,}$/.test(b.getAttribute('data-code') || ''));
  const jobCode = jobBtn ? jobBtn.getAttribute('data-code') : '';
  site.window.HRCBooking.close();
  if (jobBtn) jobBtn.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  const modal = lastModal(site.doc);

  check('بطاقتي: مبدّل واحد «مسح الباركود ⟷ كتابة الرقم» ولوحة واحدة ظاهرة', () => {
    const sheet = modal && modal.querySelector('.bk-sheet');
    if (!sheet) return 'الشاشة الجديدة (.bk-sheet) غير موجودة';
    const scanTab = sheet.querySelector('#bk-tab-scan');
    const manTab = sheet.querySelector('#bk-manual-toggle');
    if (!scanTab || !manTab) return 'التبويبان غير موجودين';
    if (!/مسح الباركود/.test(scanTab.textContent) || !/كتابة الرقم/.test(manTab.textContent)) {
      return 'نصوص التبويبين: ' + scanTab.textContent + ' / ' + manTab.textContent;
    }
    const openPanels = [...sheet.querySelectorAll('.bk-panel')].filter((p) => p.classList.contains('is-open'));
    if (openPanels.length !== 1) return 'لوحات ظاهرة: ' + openPanels.length;
    /* زر رئيسي واحد فقط في اللوحة الظاهرة */
    const ctas = [...openPanels[0].querySelectorAll('.btn')];
    if (ctas.length !== 1) return 'أزرار رئيسية في اللوحة: ' + ctas.length;
    return true;
  });
  check('بطاقتي: بلا دعم مسح تبدأ الشاشة على «كتابة الرقم» (لا طريق مسدود)', () => {
    if (site.window.HRCQRScan.supported()) return true;   /* مدعوم: لا حاجة */
    const man = modal.querySelector('#bk-manual');
    const tog = modal.querySelector('#bk-manual-toggle');
    if (!man.classList.contains('is-open')) return 'لوحة الكتابة غير مفتوحة في متصفح لا يقرأ الباركود';
    if (tog.getAttribute('aria-selected') !== 'true') return 'التبويب النشط ليس الكتابة';
    return true;
  });
  check('بطاقتي: باركود حقيقي (SVG) في شريط البطاقة يتغيّر مع الرقم', () => {
    const bcEl = modal.querySelector('.bk-card-bc');
    if (!bcEl) return 'شريط البطاقة بلا باركود';
    const uriOf = (el) => (el.getAttribute('style') || '');
    const isSvg = (t) => /data:image\/svg\+xml/.test(t);
    if (!isSvg(uriOf(bcEl))) return 'الباركود ليس صورة SVG';
    const before = uriOf(bcEl);
    const inp = modal.querySelector('#bk-serial');
    inp.value = 'HRC-BC-000117';
    inp.dispatchEvent(new site.window.Event('input', { bubbles: true }));
    return (before !== uriOf(modal.querySelector('.bk-card-bc'))) || 'الباركود لا يتغيّر مع الرقم';
  });
  check('بطاقتي: منصّة مسح بكاميرا حيّة داخل الشاشة (بلا مربّع QR توضيحي)', () => {
    const cam = modal.querySelector('#bk-cam');
    if (!cam) return 'منصّة الكاميرا غير موجودة';
    if (modal.querySelector('.bk-slip') || modal.querySelector('.bk-loupe')) {
      return 'ما زال المربّع التوضيحي/العدسة موجودين — يوهمان الزبون بمسح الشاشة';
    }
    if (!modal.querySelector('#bk-cam video')) return 'عنصر الفيديو غير موجود';
    if (!/الكاميرا متوقفة/.test(cam.textContent)) return 'لا شرح قبل التشغيل';
    if (cam.getAttribute('data-state') !== 'idle') return 'الحالة الابتدائية: ' + cam.getAttribute('data-state');
    if (modal.querySelectorAll('.bk-corner').length !== 4) return 'زوايا الإطار ناقصة';
    const toggle = modal.querySelector('#bk-cam-toggle');
    if (!toggle || !/تشغيل الكاميرا/.test(toggle.textContent)) return 'زر التشغيل غير موجود';
    return true;
  });
  check('بطاقتي: بدائل المسح ظاهرة معه (رفع صورة + كتابة الرقم)', () => {
    const box = modal;
    return (!!box.querySelector('#bk-scan-file') && !!box.querySelector('#bk-cam-manual')) ||
      'بديل رفع الصورة أو الكتابة مفقود';
  });
  check('بطاقتي: شكل البطاقة البصرية يعكس الرقم المكتوب فوراً', () => {
    const inp = modal.querySelector('#bk-serial');
    inp.value = ' 7kq4-m9tr2x ';
    inp.dispatchEvent(new site.window.Event('input', { bubbles: true }));
    const num = modal.querySelector('.bk-card-num');
    const face = modal.querySelector('.bk-card');
    if (!num || !face) return 'وجه البطاقة غير موجود';
    if (!/7KQ4M9TR2X/.test(num.textContent)) return 'الرقم في وجه البطاقة: ' + num.textContent;
    if (!face.classList.contains('has-code')) return 'البطاقة لم تتفعّل بصرياً';
    const ready = modal.querySelector('#bk-apply').classList.contains('is-ready');
    inp.value = '';
    inp.dispatchEvent(new site.window.Event('input', { bubbles: true }));
    return ready || 'زر التقديم لم يتوهّج عند اكتمال الصيغة';
  });
  check('بطاقتي: النافذة تعرف كود الوظيفة الذي جاءت منه', () =>
    (site.window.HRCBooking.state().job === jobCode) ||
    'كود الوظيفة في النافذة: ' + site.window.HRCBooking.state().job + ' والمتوقع ' + jobCode);
  check('بطاقتي: زر «ابدأ التقديم» يُنتج رابط صفحة التقديم بالباركود وكود الوظيفة', () => {
    if (!modal || !modal.querySelector('#bk-apply')) return 'زر «ابدأ التقديم» غير موجود';
    const url = site.window.HRCBooking.applyUrl('7kq4m9tr2x');
    if (!/^apply\.html\?form=7KQ4M9TR2X/.test(url)) return 'الرابط: ' + url;
    if (!url.includes('&job=' + jobCode)) return 'الرابط بلا كود وظيفة: ' + url;
    return true;
  });
  check('حارس صفحة التقديم: لا انتقال إلى apply.html من القرص (الملف المستقل)', () => {
    const isFile = /^file:/.test(site.window.location.protocol);
    const can = site.window.HRCBooking.canApply();
    if (isFile && can) return 'يُسمح بالانتقال من file:// فتقع الصفحة المفقودة';
    if (!isFile && !can) return 'الانتقال معطّل على الويب';
    return true;
  });
  check('بطاقتي: رقم مُلصق بشكل مختلف (شرطة/مسافات/صيغة قديمة ملتصقة) يُطبَّع ويُقبل', () => {
  const f = site.window.HRCBooking.normalize;
  if (typeof f !== 'function') return 'دالة التطبيع غير مُصدَّرة';
  const cases = [['hrc-bc-000117', 'HRC-BC-000117'], ['HRCBC000117', 'HRC-BC-000117'],
    ['000117', 'HRC-BC-000117'], [' 7kq4-m9tr2x ', '7KQ4M9TR2X']];
  for (const [inp, want] of cases) {
    const got = f(inp);
    if (got !== want) return '«' + inp + '» ⇒ ' + got + ' والمتوقع ' + want;
  }
  return true;
});
check('مُحلّل الباركود الممسوح: رابط apply · باركود مجرد · بطاقة قديمة · نص غريب', () => {
    const f = site.window.HRCQRScan && site.window.HRCQRScan.serialFrom;
    if (typeof f !== 'function') return 'دالة serialFrom غير موجودة';
    const cases = [
      ['https://hrc.example/apply.html?form=7KQ4M9TR2X', '7KQ4M9TR2X'],
      ['7kq4m9tr2x', '7KQ4M9TR2X'],
      ['HRC-BC-000117', 'HRC-BC-000117'],
      ['HRC-BC-123456', 'HRC-BC-123456'],
      ['كلام غير مفهوم', '']
    ];
    for (const [inp, want] of cases) {
      const got = f(inp);
      if (got !== want) return '«' + inp + '» ⇒ ' + (got || '(فارغ)') + ' والمتوقع ' + (want || '(فارغ)');
    }
    return true;
  });
  await (async () => {
    const name = 'زر تشغيل الكاميرا بلا دعم أو بلا إذن: رسالة عربية ولا انتقال لشاشة أخرى';
    const btn = modal && modal.querySelector('#bk-cam-toggle');
    if (!btn) return bad(name, 'زر تشغيل الكاميرا غير موجود');
    btn.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const cam = modal.querySelector('#bk-cam');
    const state = cam && cam.getAttribute('data-state');
    /* إمّا فتح نافذة المسح (دعم كامل) أو رسالة خطأ واضحة داخل المنصّة */
    const okState = state === 'error' || state === 'starting' || state === 'live' ||
      site.window.HRCBooking.state().view === 'entry';
    return okState ? ok(name) : bad(name, 'حالة غير متوقعة: ' + state);
  })();

  /* ═══ الكاميرا المضمّنة: تشغيل، قراءة، تحويل إلى شاشة الحالة ═══ */
  const realScan = site.window.HRCQRScan;
  const realMedia = site.window.navigator.mediaDevices;
  const fakeTrack = { stop: () => { fakeTrack.stopped = true; } };
  site.window.navigator.mediaDevices = Object.assign({}, realMedia, {
    getUserMedia: () => Promise.resolve({ getTracks: () => [fakeTrack] })
  });
  let tickCount = 0;
  site.window.HRCQRScan = Object.assign({}, realScan, {
    supported: () => true,
    detectVideoFrame: () => { tickCount++; return Promise.resolve(['https://hrc.example/apply.html?form=hrc-bc-000117']); }
  });
  site.window.HRCBooking.close();
  await (async () => {
    const name = 'بطاقتي (كاميرا حيّة): التشغيل يقرأ الباركود ويحوّله لشاشة الحالة';
    const a = site.doc.querySelector('#jobs-grid .job-card [data-action="open-booking"]');
    a.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    const box = lastModal(site.doc);
    if (box.querySelector('#bk-manual').classList.contains('is-open')) return bad(name, 'لوحة الكتابة مفتوحة رغم دعم المسح');
    if (box.querySelector('#bk-tab-scan').getAttribute('aria-selected') !== 'true') return bad(name, 'تبويب المسح غير نشط');
    box.querySelector('#bk-cam-toggle').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const st = site.window.HRCBooking.state();
    if (!fakeTrack.stopped) return bad(name, 'الكاميرا لم تُوقف بعد القراءة | serial=' + st.serial + ' | view=' + st.view);
    if (st.serial !== 'HRC-BC-000117') return bad(name, 'الرقم المقروء: ' + st.serial);
    if (st.view !== 'status') return bad(name, 'الشاشة بعد المسح: ' + st.view);
    return ok(name);
  })();
  await (async () => {
    const name = 'بطاقتي: رمز ليس باركود بطاقة يُرفض داخل المنصّة والكاميرا تبقى تعمل';
    site.window.HRCQRScan = Object.assign({}, realScan, {
      supported: () => true,
      detectVideoFrame: () => Promise.resolve(['HRC-1042'])
    });
    site.window.HRCBooking.close();
    site.window.HRCBooking.open({ code: 'HRC-1042' });
    await new Promise((r) => setTimeout(r, 80));
    const box = lastModal(site.doc);
    box.querySelector('#bk-cam-toggle').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 220));
    const cam = box.querySelector('#bk-cam');
    const st = site.window.HRCBooking.state();
    if (st.view !== 'entry') return bad(name, 'انتقلت الشاشة إلى ' + st.view + ' برمز غير صالح');
    if (!/ليس باركود بطاقة/.test(cam.textContent)) return bad(name, 'لا رسالة توضيحية داخل المنصّة');
    return ok(name);
  })();
  site.window.navigator.mediaDevices = realMedia;
  await (async () => {
    const name = 'بطاقتي: «ارفع صورة» يقرأ الباركود بنفس المحرّك ويملأ الرقم';
    site.window.HRCBooking.close();
    site.window.HRCQRScan = Object.assign({}, realScan, {
      supported: () => true,
      detectImage: () => Promise.resolve(['9TRX2KQ4M7'])
    });
    site.window.HRCBooking.open({ code: 'HRC-1042' });
    const box = lastModal(site.doc);
    const file = box.querySelector('#bk-scan-file');
    if (!file) return bad(name, 'حقل الصورة غير موجود');
    Object.defineProperty(file, 'files', {
      value: [new site.window.File(['x'], 'card.png', { type: 'image/png' })], configurable: true
    });
    file.dispatchEvent(new site.window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const got = site.window.HRCBooking.state().serial;
    if (got !== '9TRX2KQ4M7') return bad(name, 'الحالة: ' + got);
    return ok(name);
  })();
  check('بطاقتي: التبديل بين «مسح» و«كتابة» يبدّل اللوحة والتبويب معاً', () => {
    const box = lastModal(site.doc);
    const scanTab = box.querySelector('#bk-tab-scan');
    const manTab = box.querySelector('#bk-manual-toggle');
    const scanPanel = box.querySelector('#bk-panel-scan');
    const manPanel = box.querySelector('#bk-manual');
    const click = (el) => el.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    click(manTab);
    if (!manPanel.classList.contains('is-open') || scanPanel.classList.contains('is-open')) return 'لوحة الكتابة لم تُفتح';
    if (manTab.getAttribute('aria-selected') !== 'true' || scanTab.getAttribute('aria-selected') !== 'false') return 'حالة التبويبين غير صحيحة';
    click(scanTab);
    if (!scanPanel.classList.contains('is-open') || manPanel.classList.contains('is-open')) return 'لم تُفتح لوحة المسح';
    if (scanTab.getAttribute('aria-selected') !== 'true') return 'تبويب المسح غير نشط بعد الرجوع';
    return true;
  });
  check('بطاقتي: «حالة بطاقتي» بلا رقم تُرشد للحقل ولا تغادر الشاشة', () => {
    const box = lastModal(site.doc);
    const inp = box.querySelector('#bk-serial');
    inp.value = ''; inp.dispatchEvent(new site.window.Event('input', { bubbles: true }));
    box.querySelector('#bk-lookup').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    const err = box.querySelector('[data-bk-err="serial"]');
    return (/اكتب رقم البطاقة/.test((err && err.textContent) || '') && site.window.HRCBooking.state().view === 'entry') ||
      ('الرسالة: ' + (err && err.textContent) + ' | الشاشة: ' + site.window.HRCBooking.state().view);
  });
  site.window.HRCQRScan = realScan;

  /* إعادة النافذة إلى شاشة الحالة حتى تكمل الاختبارات التالية مسارها */
  site.window.HRCBooking.close();
  site.window.HRCBooking.open({ serial: 'HRC-BC-000117' });
  await new Promise((r) => setTimeout(r, 180));
})();

await (async () => {
  const name = 'بطاقتي: استخدام فرصة بالباركود وحده (بلا أي رمز)';
  try {
    lastModal(site.doc).querySelector('#bk-use').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const sel = lastModal(site.doc).querySelector('#bk-job');
    if (!sel) return bad(name, 'قائمة الوظائف المتاحة غير ظاهرة');
    if (lastModal(site.doc).querySelector('#bk-code')) return bad(name, 'ما زال حقل رمز الفرصة موجوداً');
    sel.value = 'HRC-1046';
    sel.dispatchEvent(new site.window.Event('change', { bubbles: true }));
    lastModal(site.doc).querySelector('#bk-confirm').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 260));
    const job = site.window.HRCStore.getJob('HRC-1046');
    const slot = site.window.HRCStore.getAttempts('HRC-BC-000117').find((t) => t.jobCode === 'HRC-1046');
    if (job.status !== 'reserved' || !slot || slot.slotStatus !== 'reserved')
      return bad(name, 'التقديم لم يثبّت: job=' + job.status + ' slot=' + (slot && slot.slotStatus));
    return ok(name);
  } catch (e) { bad(name, e.message); }
})();
await (async () => {
  const name = 'بطاقتي: إعادة الطباعة بالباركود (بلا أي رمز)';
  try {
    closeAllModals(site.doc);
    site.window.HRCBooking.open({ serial: 'HRC-BC-000117' });
    await new Promise((r) => setTimeout(r, 160));
    lastModal(site.doc).querySelector('#bk-reprint').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const rc = lastModal(site.doc).querySelector('#bk-rcode');
    /* بعد إلغاء رموز الفرص: البطاقة بلا رمز → تعود شاشة الحالة مباشرة (لا رمز) */
    if (!rc) return ok(name + ' — البطاقة بلا رمز فلا يُطلب أي رمز');
    const real = site.window.HRCStore.getAttempts('HRC-BC-000117')[0].code;
    rc.value = real;
    rc.dispatchEvent(new site.window.Event('input', { bubbles: true }));
    const printsBefore = site.window.__printed;
    lastModal(site.doc).querySelector('#bk-print-form').dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    if (site.window.__printed <= printsBefore) return bad(name, 'لم تُستدعَ الطباعة برمز صحيح');
    const html = site.doc.getElementById('print-root').innerHTML;
    if (!html.includes('HRC-BC-000117')) return bad(name, 'حاوية الطباعة لا تحمل البطاقة');
    return ok(name);
  } catch (e) { bad(name, e.message); }
})();
await (async () => {
  const name = 'رابط QR القديم ‎#card= يحوّل إلى صفحة الترحيب بالتقديم';
  try {
    const source = readFileSync(resolve(ROOT, 'assets/js/booking.js'), 'utf8');
    if (!/location\.replace\('apply\.html\?form='\s*\+\s*encodeURIComponent\(s\)\)/.test(source))
      return bad(name, 'رابط الباركود القديم لا يوجّه إلى صفحة التقديم');
    return ok(name);
  } catch (e) { bad(name, e.message); }
})();
closeAllModals(site.doc);

/* مسار الطلب يبقى داخلياً: الموظف يسجّل الطلب (كما لو استقبله المكتب) ثم يعتمده */
check('تسجيل طلب قيد المراجعة من المنظومة الداخلية', () => {
  const before = site.window.HRCStore.stats().pendingForms;
  const app = site.window.HRCStore.createApplicant({
    fullName: 'اختبار آلي', phone: '07700000000', address: 'الحلة - بابل',
    requestedCode: 'HRC-1043', pending: true
  });
  const after = site.window.HRCStore.stats().pendingForms;
  const valid = app && app.status === 'pending' && !app.expiryDate && app.requestedCode === 'HRC-1043';
  return (after === before + 1 && valid) || 'لم يُسجَّل الطلب: ' + JSON.stringify(app);
});
check('قبول طلب قيد المراجعة يحوّله لبطاقة سارية بفرصتين', () => {
  const apps = site.window.HRCStore.listApplicants({ q: 'اختبار آلي' });
  if (!apps.length) return 'لا يوجد طلب للاختبار';
  const serial = apps[0].serial;
  const res = site.window.HRCStore.approveApplicant(serial);
  const app = site.window.HRCStore.getApplicant(serial);
  const valid = res.ok === true && app.status === 'active' && !!app.expiryDate && site.window.HRCStore.attemptsLeft(serial) === 2;
  return valid || 'فشل القبول: ' + JSON.stringify({ res: res, app: app && { status: app.status, expiry: app.expiryDate } });
});
check('رفض طلب قيد المراجعة يعلّم الطلب كمرفوض', () => {
  const r = site.window.HRCStore.createApplicant({ fullName: 'رفض آلي', phone: '07700000009', pending: true });
  const res = site.window.HRCStore.rejectApplicant(r.serial, 'بيانات ناقصة');
  const app = site.window.HRCStore.getApplicant(r.serial);
  const valid = res.ok === true && app.status === 'rejected' && app.rejectReason === 'بيانات ناقصة';
  return valid || 'فشل الرفض: ' + JSON.stringify({ res: res, app: app && app.status });
});

/* ======================= 2) قالب الاستمارة المطبوعة ======================= */
console.log('\n=== 2) قالب بطاقة التوظيف (86×54مم) + الباركود ===');
check('قالب البطاقة يحوي الوجهين وكل بياناتها المطلوبة', () => {
  const app = site.window.HRCStore.getApplicant('HRC-BC-000120');
  const html = site.window.HRCVoucher.buildHtml(app);
  const needed = [
    'منصة مكسب', 'فرصتك تبدأ من هنا',
    '07760058007',
    'HRC-BC-000120',
    'كود البطاقة',
    'hrc-card', '<svg', 'فرص للتقديم'
  ];
  const missing = needed.filter((x) => !html.includes(x));
  if (missing.length) return 'ناقص: ' + missing.join(' , ');
  /* سياسة 2026-10-01: البطاقة الورقية لا تحمل بيانات زبون أبداً */
  if (html.includes('حسين كاظم عبد الله')) return 'البطاقة تحمل اسم الزبون — البيانات لاستمارة A4 فقط';
  const faces = (html.match(/class="hrc-card[" ]/g) || []).length;
  return faces === 2 || 'عدد الأوجه: ' + faces;
});
check('تصميم البطاقة يعرض رمز تحقق واحداً مستقلاً عن عدد الفرص', () => {
  for (const count of [1, 2, 3, 6, 10]) {
    const app = { serial: 'DEMO-ONLY', status: 'blank', cardPrintCode: '7A2C9E4B1D8F6C03', fullName: 'اسم لا يُطبع', phone: '07700000099' };
    const attempts = Array.from({ length: count }, (_, i) => ({ no: i + 1, code: (1234 + i) + '-AB', slotStatus: 'empty' }));
    const fragment = JSDOM.fragment(site.window.HRCVoucher.buildHtml(app, attempts));
    if (fragment.querySelectorAll('.hrc-card').length !== 2 || fragment.querySelectorAll('.code').length !== 1) return 'رموز ناقصة للعدد ' + count;
    if (attempts.some((t) => fragment.textContent.includes(t.code)) || !fragment.textContent.includes('7A2C-9E4B-1D8F-6C03')) return 'تسرّب رمز فرصة أو تغيّر رمز التحقق';
    if (/اسم لا يُطبع|07700000099/.test(fragment.textContent)) return 'تسربت بيانات الزبون للبطاقة';
    if (!fragment.querySelector('.mk-serial') || !fragment.textContent.includes('إصدار البطاقة')) return 'تسلسل الهوية والتواريخ ناقص';
    const model = site.window.HRCQR.encode(site.window.HRCStore.cardUrl(app.serial), 'M');
    const svg = fragment.querySelector('.hrc-qr-slot svg');
    const modules = model.size || model.moduleCount || model.matrix.length;
    if (!svg || svg.getAttribute('viewBox') !== '0 0 ' + (modules + 8) + ' ' + (modules + 8)) return 'الهامش الأبيض للباركود غير كافٍ';
  }
  const style = site.doc.getElementById('hrc-card-style').textContent;
  return (/box-sizing:border-box;width:54mm;height:86mm/.test(style) && /size:A4 portrait/.test(style) && /zoom:1\.1/.test(style)) || 'مقاس البطاقة أو تكبيرها للطباعة على A4 غير مضبوط';
});
check('البطاقة الأصلية تُطبع بلا أي رمز فرصة مع حفظ الشروط', () => {
  const app = site.window.HRCStore.getApplicant('HRC-BC-000120');
  const html = site.window.HRCVoucher.buildHtml(app);
  if (/رمز الفرصة/.test(html)) return 'ما زال الظهر يطبع «رمز الفرصة»';
  if (/\b\d{4}-[A-HJ-NP-Z]{2}\b/.test(html)) return 'ظهر البطاقة يحمل رمزاً بصيغة رمز الفرصة';
  const rules = ['فرص مستقلة حسب البطاقة', '24 ساعة', 'ولا تعود', 'مكتب استنساخ'];
  const miss = rules.filter((r) => !html.includes(r));
  return miss.length === 0 || 'تعليمات ناقصة بالظهر: ' + miss.join(' , ');
});
check('باركود الوجه الأمامي يفتح صفحة الترحيب بالتقديم مع رقم البطاقة', () => {
  const url = site.window.HRCStore.cardUrl('HRC-BC-000120');
  return /apply\.html\?form=HRC-BC-000120$/.test(url) || url;
});
check('التقديم الذاتي يحفظ بيانات المتقدم ويتيح المحاولة الثانية بنفس البطاقة', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  const migration = readFileSync(resolve(ROOT, 'supabase/migrations/20261006000000_self_service_card_application.sql'), 'utf8');
  return page.includes("rpc('self_service_card'") && page.includes("rpc('apply_with_card'") &&
    page.includes('G.go(6)') && migration.includes('self_application_data') &&
    migration.includes("'employer_phone'") || 'مسار حفظ الملف الشخصي/إعادة المحاولة غير مكتمل';
});
/* 2026-10-28: التفاصيل الكاملة انتقلت من داخل الكارت إلى نافذة منبثقة
   تُفتح بالضغط على الوظيفة (وصف + متطلبات + أزرار فتح/إغلاق). */
check('تفاصيل الوظيفة تشمل الوصف والمتطلبات داخل نافذة تُفتح/تُغلق', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  return page.includes('j.description') && page.includes('job.requirements') &&
    page.includes('G.openJob') && page.includes('G.closeJob') &&
    page.includes('job-modal') || 'تفاصيل بطاقة الوظيفة غير مكتملة';
});
/* ── 2026-10-06 (طلب الإدارة): ترتيب المسار وصفحة المراجعة والاستمارة ──
   الترتيب المطلوب: الاسم ← السكن ← الميلاد ← الهاتف ← الجنس ← الوظائف ←
   المراجعة ← الاستمارة، مع اختيار الوظيفة بالنقر على بطاقتها (لا نافذة تأكيد)،
   ورجوع في كل صفحة. */
check('ترتيب خطوات التقديم بالضبط كما طُلب (الاسم، السكن، الميلاد، الهاتف، الجنس، الوظائف)', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  const order = ['pg-welcome', 'pg-name', 'pg-addr', 'pg-dob', 'pg-phone', 'pg-gender', 'pg-jobs', 'pg-review', 'pg-result'];
  const m = page.match(/var STEP_IDS=\[([^\]]*)\]/);
  const got = m ? m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) : [];
  return JSON.stringify(got) === JSON.stringify(order) || 'الترتيب الحالي: ' + got.join(' → ');
});
check('صفحة المراجعة تعرض بيانات الزبون والوظيفة مع أزرار تعديل ورجوع', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  const has = page.includes('id="pg-review"') && page.includes('renderReview') &&
    page.includes('rv-edit') && page.includes('مراجعة الطلب قبل الإتمام');
  return has || 'صفحة المراجعة ناقصة';
});
check('اختيار الوظيفة بالنقر على بطاقتها مع علامة اختيار وزر «التالي» معطَّل قبل الاختيار', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  return (page.includes('pickJob') && page.includes('pick-mark') &&
    page.includes('id="btn-jobs-next"') && /btn-jobs-next"[^>]*disabled/.test(page) &&
    page.includes('syncJobsFooter')) || 'منطق اختيار الوظيفة ناقص';
});
check('لا توجد نافذة تأكيد قديمة — الإتمام من صفحة المراجعة', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  return (!page.includes('modal-overlay') && !page.includes('showModalError') &&
    page.includes('id="btn-finish"') && page.includes('finish:function')) || 'بقايا النافذة القديمة';
});
check('الاستمارة تُطبع بباركود البطاقة نفسه وتذكر إمكانية وظيفة ثانية', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  return (page.includes('fs-qr-note') && page.includes('باركود البطاقة نفسه') &&
    page.includes('اختيار وظيفة أخرى') && page.includes('قابل للطباعة'.slice(0, 0) + 'window.print()')) ||
    'ملاحظة الباركود في الاستمارة ناقصة';
});
check('الطباعة تُخرج ورقة الاستمارة وحدها (بلا هيرو النجاح وبلا أزرار)', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  const printBlock = page.slice(page.indexOf('@media print'));
  return printBlock.includes('#result-content .ok-hero') &&
    printBlock.includes('#pg-result > :not(#result-content)') &&
    printBlock.includes('break-inside:avoid') || 'كتلة الطباعة لا تخفي عناصر الواجهة';
});
check('كل خطوات الإدخال فيها زر رجوع، ومؤشر الهاتف يتحقق من 11 رقماً تبدأ بـ 07', () => {
  const page = readFileSync(resolve(ROOT, 'apply.html'), 'utf8');
  const backs = (page.match(/G\.go\(-1\)/g) || []).length;
  return (backs >= 6 && page.includes('phone-meter') && page.includes('onPhone') &&
    /\^07\[3-9\]/.test(page)) || 'أزرار الرجوع ' + backs;
});
check('رابط التحقق الداخلي للبطاقة بالصيغة المطلوبة', () => {
  const url = site.window.HRCStore.verifyUrl('HRC-BC-000120');
  return /^https?:\/\/[^/]+\/verify\?form=HRC-BC-000120&t=[0-9a-f]{8}$/.test(url) ||
    /^https:\/\/hrc-babil\.com\/verify\?form=HRC-BC-000120&t=[0-9a-f]{8}$/.test(url) || url;
});
{
  const app = site.window.HRCStore.getApplicant('HRC-BC-000119');
  const before = app.printedCount;
  site.window.HRCVoucher.print(app);
  await new Promise((r) => setTimeout(r, 260));
  const after = site.window.HRCStore.getApplicant('HRC-BC-000119').printedCount;
  const rootHtml = site.doc.getElementById('print-root').innerHTML;
  if (after === before + 1 && site.window.__printed > 0 && rootHtml.includes('HRC-BC-000119')) {
    ok('الطباعة تستدعي نافذة الطباعة وتزيد عدّاد الطباعة');
  } else {
    bad('الطباعة تستدعي نافذة الطباعة وتزيد عدّاد الطباعة',
      'قبل ' + before + ' بعد ' + after + ' | استدعاءات الطباعة ' + site.window.__printed + ' | حاوية الطباعة ' + rootHtml.length);
  }
}
check('الاختبارات الذاتية لمولّد الباركود تنجح بالكامل', () => {
  const r = site.window.HRCQR.selfTest();
  return r.failed === 0 || (r.failed + ' اختبار فاشل: ' + JSON.stringify(r.results.filter((x) => !x.pass)));
});

/* ======================= 3) منطق العمل ======================= */
console.log('\n=== 3) منطق الفرصتين والحجز 24 ساعة والحالة الحرجة ===');
const S = site.window.HRCStore;
check('البطاقة الجديدة تُصدر بباركود وفرصتين بلا أي رموز', () => {
  const app = S.createApplicant({ fullName: 'فحص البطاقة', phone: '07711111110', address: 'الحلة', posName: 'مكتب فحص — شارع 40' });
  if (!/^[2-9A-HJKMNP-Z]{10}$/.test(app.serial)) return 'الباركود: ' + app.serial;
  if (app.feePaid !== true) return 'البطاقة تُباع كاشاً — يجب أن تكون مدفوعة عند الإصدار';
  if (!app.posName) return 'نقطة البيع غير مسجلة';
  const att = S.getAttempts(app.serial);
  if (att.length !== 2) return 'عدد الفرص: ' + att.length;
  if (att.some((t) => t.code)) return 'ما زال يُولَّد رمز فرصة: ' + att.map((t) => t.code).join(',');
  if (S.listPosNames().indexOf('مكتب فحص — شارع 40') < 0) return 'نقطة البيع غير مدرجة بقائمة الإكمال';
  return true;
});
await (async () => {
  const name = 'التقديم الذاتي بالباركود وحده يحجز الوظيفة 24 ساعة';
  try {
    const serial = S.listApplicants({ q: 'فحص البطاقة' })[0].serial;
    const res = await S.cardUseChance(serial, 'HRC-1042');
    if (!res || !res.ok) return bad(name, (res && res.error) || 'رفض غير متوقع');
    const job = S.getJob('HRC-1042');
    const hours = S.diffHours(job.holdExpiresAt, new Date());
    return (job.status === 'reserved' && hours > 23 && hours <= 24)
      ? ok(name) : bad(name, 'الحالة ' + job.status + ' والمهلة ' + hours);
  } catch (e) { bad(name, e.message); }
})();
await (async () => {
  const name = 'التقديم الذاتي على وظيفة غير متاحة يُرفض ولا يستهلك الفرصة';
  try {
    const serial = S.listApplicants({ q: 'فحص البطاقة' })[0].serial;
    const left = S.attemptsLeft(serial);
    const res = await S.cardUseChance(serial, 'HRC-1049');
    const pass = (!res.ok && S.attemptsLeft(serial) === left);
    return pass ? ok(name) : bad(name, JSON.stringify({ res: res.error, left: left, now: S.attemptsLeft(serial) }));
  } catch (e) { bad(name, e.message); }
})();
check('إعادة الطباعة: بطاقة بلا رمز تُفتح بالباركود، وبطاقة برمز ترفض الخطأ', () => {
  const serial = S.listApplicants({ q: 'فحص البطاقة' })[0].serial;
  const r = S.cardVerifyCode(serial, '');
  const bad1 = !r.ok || !r.app || r.app.serial !== serial || !r.attempts || r.attempts.length !== 2;
  if (bad1) return 'شكل الرد: ' + JSON.stringify({ ok: r.ok, app: r.app && r.app.serial });
  /* بطاقة لها رمز تحقق مطبوع: لا تُفتح إلا به */
  let withCode = S.listApplicants({}).find((a) => a.cardPrintCode);
  if (!withCode) {
    withCode = S.createApplicant({ fullName: 'بطاقة برمز', phone: '07711111111' });
    /* رمز التحقق المستقل يُضبط عند الإصدار من القاعدة/اللوحة */
    S.getApplicant(withCode.serial).cardPrintCode = '7A2C9E4B1D8F6C03';
  }
  const okCode = S.cardVerifyCode(withCode.serial, '7A2C9E4B1D8F6C03');
  const badCode = S.cardVerifyCode(withCode.serial, '0000-AA');
  return (okCode.ok && badCode.ok === false) || 'حماية رمز التحقق لا تعمل';
});
check('رفض المرشح يعيد الوظيفة «متاحة» والفرصة مستهلكة لا تعود', () => {
  const serial = S.listApplicants({ q: 'فحص البطاقة' })[0].serial;
  const usedNo = S.getAttempts(serial).find((t) => t.slotStatus === 'reserved').no;
  const res = S.setOutcome(serial, usedNo, 'rejected', 'لم يجتز المقابلة');
  const job = S.getJob('HRC-1042');
  const left = S.attemptsLeft(serial);
  return (res.ok && job.status === 'available' && left === 1) ||
    ('الوظيفة: ' + job.status + ' — المتبقي: ' + left);
});
await (async () => {
  const name = 'انتهاء مهلة 24 ساعة يدخل الوظيفة «حالة حرجة» — لا إفراج تلقائي';
  try {
  const serial = S.listApplicants({ q: 'فحص البطاقة' })[0].serial;
  const r = await S.cardUseChance(serial, 'HRC-1047');
  if (!r.ok) return bad(name, r.error);
  // إرجاع المهلة إلى الماضي لمحاكاة انتهاء الـ24 ساعة
  const job = S.getJob('HRC-1047');
  job.holdExpiresAt = new Date(Date.now() - 60000).toISOString();
  S.db().attempts.filter((t) => t.jobId === job.id && t.slotStatus === 'reserved')
    .forEach((t) => { t.holdExpiresAt = job.holdExpiresAt; });
  const actions = S.runMaintenance();
  const slot = S.getAttempts(serial).find((t) => t.jobId === job.id);
  const crit = S.pendingActions().critical || [];
  const stayed = job.status === 'reserved' && !job.holdExpiresAt && job.critical === true;
  const good = stayed && slot.slotStatus === 'critical' && crit.some((c) => c.job.code === 'HRC-1047');
  return good ? ok(name) : bad(name,
    'الوظيفة ' + job.status + ' (critical=' + job.critical + ') / الفرصة ' + slot.slotStatus + ' / طابور الحرجة ' + crit.length);
  } catch (e) { bad(name, e.message); }
})();
check('قرار الحرجة «إرجاع» يعيد الوظيفة متاحة والفرصة تبقى مستهلكة', () => {
  const serial = S.listApplicants({ q: 'فحص البطاقة' })[0].serial;
  const no = S.getAttempts(serial).find((t) => t.slotStatus === 'critical').no;
  const res = S.releaseHold(serial, no, 'قرار حرجة: إرجاع');
  const job = S.getJob('HRC-1047');
  const slot = S.getAttempts(serial).find((x) => x.no === no);
  return (res.ok && job.status === 'available' && job.critical !== true && slot.slotStatus !== 'empty') ||
    ('إرجاع: ' + res.ok + ' / الوظيفة ' + job.status + ' / الفرصة ' + slot.slotStatus);
});
check('حد الفرصتين مُطبّق — لا فرصة ثالثة', () => {
  const serial = S.listApplicants({ q: 'فحص البطاقة' })[0].serial;
  if (S.attemptsLeft(serial) !== 0) return 'المتبقي قبل الفحص: ' + S.attemptsLeft(serial);
  const res = S.selectAttempt(serial, 'HRC-1048');
  return (res.ok === false) || 'قُبلت فرصة ثالثة!';
});
check('توثيق العمليات في سجل التدقيق (تقديم ذاتي + قرار حرج)', () => {
  const selfApply = S.listAudit({ q: 'تقديم ذاتي ببطاقة' });
  const critical = S.listAudit({ q: 'حرجة' });
  return (selfApply.length > 0 && critical.length > 0) ||
    ('تقديم ذاتي: ' + selfApply.length + ' / حرجة: ' + critical.length);
});
check('البطاقة المنتهية (30 يوماً) تتوقف عن قبول التقديم', () => {
  const app = S.getApplicant('HRC-BC-000120');
  app.expiryDate = new Date(Date.now() - 86400000).toISOString();
  app.status = 'active';
  S.runMaintenance();
  const st = S.formStatus(S.getApplicant('HRC-BC-000120'));
  const res = S.selectAttempt('HRC-BC-000120', 'HRC-1048');
  return (st === 'expired' && res.ok === false && /صلاحية/.test(res.error)) || ('الحالة ' + st + ' / النتيجة ' + JSON.stringify(res));
});
check('التوظيف يغلق الوظيفة ولا يُنهي البطاقة (تبقى سارية)', () => {
  const app = S.createApplicant({ fullName: 'توظيف ناجح', phone: '07711111112', address: 'الحلة' });
  S.selectAttempt(app.serial, 'HRC-1048');
  const res = S.setOutcome(app.serial, 1, 'succeeded', 'نجح');
  const job = S.getJob('HRC-1048');
  const st = S.formStatus(S.getApplicant(app.serial));
  const left = S.attemptsLeft(app.serial);
  return (res.ok && job.status === 'closed' && st === 'active' && left === 1) ||
    ('الوظيفة ' + job.status + ' / حالة البطاقة ' + st + ' / المتبقي ' + left);
});

/* ======================= 4) صفحة التحقق ======================= */
console.log('\n=== 4) صفحة التحقق (verify.html) ===');
/* الزائر: بوابة تسدّ التحقق كلياً (بلا أي بيانات) */
const gate = await load('verify.html', { search: '?form=HRC-BC-000120' });
check('صفحة التحقق للزائر تعرض بوابة «للموظفين والإدارة فقط»', () => {
  const t = gate.doc.getElementById('verify-root').textContent;
  return /موظفي الشركة والإدارة|تسجيل دخول الموظفين/.test(t) || 'لا توجد بوابة للزائر';
});
check('الزائر لا يرى أي بيانات بطاقة (لا رقم ولا اسم ولا فرص)', () => {
  const t = gate.doc.getElementById('verify-root').textContent;
  const leak = t.includes('HRC-BC-000120') || t.includes('حسين') || /فرصة/.test(t);
  return !leak || 'تسريب بيانات للزائر في صفحة التحقق';
});
check('لا يمكن للزائر تشغيل التحقق من رابط الكيو آر كود (يبقى محجوباً)', () => {
  gate.window.HRCVerify.mount('?form=HRC-BC-000120&t=deadbeef');
  const t = gate.doc.getElementById('verify-root').textContent;
  return (/موظفي الشركة والإدارة/.test(t) && !t.includes('HRC-BC-000120')) || 'البوابة لا تحمي mount()';
});

/* الموظف: التحقق يعمل كما كان */
const verify = await load('verify.html', { search: '?form=HRC-BC-000120', session: STAFF_SESSION });
check('بجلسة موظف: صفحة التحقق تُحمّل بدون أخطاء', () => verify.errors.length === 0 || verify.errors.join(' | '));
check('بلا بصمة: تُظهر الرقم والحالة مع تقنيع اسم الباحث وهاتفه', () => {
  const t = verify.doc.getElementById('verify-root').textContent;
  const masked = !t.includes('حسين كاظم عبد الله');
  const hasStatus = t.includes('سارية') || t.includes('استُهلكت');
  return (t.includes('HRC-BC-000120') && masked && hasStatus && !t.includes('مكتملة')) ||
    ('الاسم ظاهر بلا بصمة؟ ' + !masked + ' — لا شارة حالة صحيحة');
});
check('بالنمط: الاسم مقنّع في الرد نفسه لا في العرض فقط', () => {
  const r = verify.window.HRCStore.verify('HRC-BC-000120');
  return (r.masked === true && !r.fullName.includes('حسين') && /•/.test(r.fullName) && /•/.test(r.phone)) ||
    JSON.stringify({ masked: r.masked, fullName: r.fullName, phone: r.phone });
});
/* بالبصمة الصحيحة (كما في رابط الكيو آر كود) تظهر البيانات كاملة */
const vTok = verify.window.HRCStore.token('HRC-BC-000120');
const verifyTok = await load('verify.html', { search: '?form=HRC-BC-000120&t=' + vTok, session: STAFF_SESSION });
check('بالبصمة الصحيحة: اسم الباحث يظهر كاملاً', () => {
  const t = verifyTok.doc.getElementById('verify-root').textContent;
  return t.includes('حسين كاظم عبد الله') || 'الاسم غير ظاهر مع بصمة صحيحة';
});

check('تعرض جدول الفرصتين مع أكواد الوظائف', () => {
  const rows = verify.doc.querySelectorAll('#verify-root table.data tbody tr').length;
  const hasCode = verify.doc.getElementById('verify-root').textContent.includes('HRC-1042');
  return (rows === 2 && hasCode) || ('صفوف: ' + rows + ' / كود: ' + hasCode);
});
check('التوظيف لا يُنهي البطاقة: HRC-BC-000118 (فرصة ناجحة) تبقى «سارية»', () => {
  const r = verify.window.HRCStore.verify('HRC-BC-000118');
  return (r.ok === true && r.status === 'active' && r.attemptsLeft === 1) ||
    JSON.stringify({ status: r.status, left: r.attemptsLeft });
});
check('تعرض كيو آر كود التحقق (SVG)', () => {
  const svg = verify.doc.querySelector('#verify-root .verify-qr svg path');
  return !!svg || 'لا يوجد SVG للكيو آر كود';
});
check('رقم غير موجود يعطي رسالة واضحة', () => {
  const s2 = verify.window.HRCStore.verify('HRC-BC-999999');
  return (s2.ok === false && /لا توجد بطاقة/.test(s2.error)) || JSON.stringify(s2);
});
check('بصمة تحقق غير مطابقة تُرفع كتحذير', () => {
  const res = verify.window.HRCStore.verify('HRC-BC-000120', 'deadbeef');
  return res.tokenOk === false || 'لم يتم كشف البصمة المزيفة';
});

/* ======================= 5) المنظومة الداخلية ======================= */
console.log('\n=== 5) المنظومة الداخلية (dashboard.html) ===');
const dash = await load('dashboard.html');
/* حسابات فحص محلية (fixtures): الإنتاج أغلق باب الدخول المحلي نهائياً
   (users: [] و enforceAuth: true في supabase-config.js) — وهذا هو الصحيح
   أمنياً ولا يُخفض للاختبارات. فاختبارات الواجهة الداخلية تزرع حساباتها في
   هذا المتصفح الافتراضي وحده (كما تُزرع جلسة الموظف أعلاه)، والدخول هنا
   محلي بحت لأن jsdom بلا fetch فلا سحابة أصلاً. */
dash.window.HRCSupabaseConfig.enforceAuth = false; // isolated local UI fixture only
dash.window.HRC_CONFIG.users = [
  { username: 'admin', password: 'admin123', name: 'مدير الفحص', role: 'admin', title: 'مدير عام' },
  { username: 'staff', password: 'staff123', name: 'موظف فحص', role: 'staff', title: 'موظف توظيف' }
];
check('شاشة الدخول تظهر في البداية', () =>
  (!dash.doc.getElementById('login-wrap').classList.contains('hidden') &&
    dash.doc.getElementById('app-shell').classList.contains('hidden')) || 'الحالة الابتدائية خاطئة');
check('دخول موظف ببيانات صحيحة', () => {
  dash.doc.getElementById('login-user').value = 'staff';
  dash.doc.getElementById('login-pass').value = 'staff123';
  dash.doc.getElementById('login-form').dispatchEvent(new dash.window.Event('submit', { bubbles: true, cancelable: true }));
  const hidden = dash.doc.getElementById('app-shell').classList.contains('hidden');
  const user = dash.window.HRCStore.currentUser();
  return (!hidden && user && user.role === 'staff') || 'لم يتم الدخول';
});
check('كلمة مرور خاطئة تُرفض', () => {
  const s = dash.window.HRCStore.login('staff', 'wrong');
  dash.window.HRCStore.logout && dash.window.HRCStore.login('staff', 'staff123');
  return s === null || 'قبل كلمة مرور خاطئة';
});
check('اللوحة المالية وسجل التدقيق مخفيان للموظف', () => {
  const fin = dash.doc.querySelector('[data-view="finance"]');
  return fin.classList.contains('hidden') || 'زر اللوحة المالية ظاهر للموظف';
});
check('جدول الوظائف يعرض بيانات صاحب العمل (للموظف)', () => {
  dash.doc.querySelector('#side-nav button[data-view="jobs"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const t = dash.doc.getElementById('jobs-table-body').textContent;
  return (t.includes('07701234567') && t.includes('HRC-1042')) || 'البيانات الداخلية غير ظاهرة';
});
check('جدول البطاقات يعرض الفرص المتبقية', () => {
  dash.doc.querySelector('#side-nav button[data-view="applicants"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const rows = dash.doc.querySelectorAll('#apps-table-body tr').length;
  return rows >= 4 || 'عدد الصفوف: ' + rows;
});
check('إزالة زر بيع وتعبئة البطاقة وإجراء التعبئة من القائمة', () =>
  !dash.doc.getElementById('btn-new-app') && !dash.doc.querySelector('[data-app-fill]'));
check('إصدار دفعة بطاقات فارغة: باركودات عشوائية فريدة لا تتشابه', () => {
  closeAllModals(dash.doc);
  dash.window.HRCStore.login('admin', 'admin123');   /* إصدار الدفعات للمدير فقط */
  const btn = dash.doc.getElementById('btn-new-batch');
  if (!btn) return 'زر «إصدار دفعة فارغة» مفقود';
  if (!btn.classList.contains('hidden') === false && dash.window.HRCStore.isAdmin && dash.window.HRCStore.isAdmin()) {
    /* الزر ظاهر للإدارة — نكمل */
  }
  const before = dash.window.HRCStore.listBlankCards().length;
  btn.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const box = lastModal(dash.doc);
  if (!box) return 'لم تُفتح نافذة الدفعة';
  const cnt = box.querySelector('#b-count');
  if (cnt.value !== '9' || cnt.min !== '1' || cnt.max !== '90' || cnt.step !== '1') return 'قيود عدد الدفعة غير صحيحة';
  for (const n of [0, 1.5, 91]) { cnt.value = String(n); if (cnt.checkValidity()) return 'قُبل عدد غير صالح: ' + n; }
  for (let n = 1; n <= 90; n++) { cnt.value = String(n); if (!cnt.checkValidity()) return 'رُفض عدد صالح: ' + n; }
  cnt.value = '9';
  box.querySelector('#b-notes').value = 'دفعة اختبار';
  box.querySelector('#b-save').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const made = dash.window.HRCStore.listBlankCards().length - before;
  if (made !== 9) return 'الدفعة: قبل ' + before + ' بعد +' + made;
  const blanks = dash.window.HRCStore.listBlankCards().slice(0, 9);
  const serials = blanks.map((b) => b.serial);
  const uniq = new Set(serials);
  if (uniq.size !== 9) return 'باركودات مكررة بالدفعة: ' + serials.join(',');
  if (!serials.every((x) => /^[2-9A-HJKMNP-Z]{10}$/.test(x))) return 'صيغة باركود خاطئة: ' + serials.join(',');
  /* مختلط: أرقام وأحرف معاً في كل باركود، بلا شرطة ولا بادئة */
  if (!serials.every((x) => /[2-9]/.test(x) && /[A-Z]/.test(x))) return 'باركود غير مختلط: ' + serials.join(',');
  /* عشوائية لا تسلسل: لا يجوز أن تكون الأرقام متتالية أو متشابهة الترتيب */
  const nums = serials.map((x) => parseInt(x, 36));
  const sorted = [...nums].sort((a, b) => a - b);
  const sequential = sorted.every((v, i) => i === 0 || v - sorted[i - 1] === 1);
  if (sequential) return 'الباركودات متسلسلة (قابلة للتخمين): ' + serials.join(',');
  if (!blanks.every((b) => b.status === 'blank' && !b.fullName && !b.issueDate && !b.expiryDate))
    return 'بطاقة فارغة ببيانات زبون أو تواريخ';
  const codes = blanks.flatMap((b) => dash.window.HRCStore.getAttempts(b.serial).map((t) => t.code));
  if (codes.some(Boolean)) return 'ما زالت الدفعة تُولّد رموز فرص';
  return true;
});
check('إضافة البطاقات للمدير فقط: الموظف مرفوض في المتجر نفسه', () => {
  dash.window.HRCStore.login('staff', 'staff123');
  const r1 = dash.window.HRCStore.createCardWithSerial('', 'محاولة موظف');
  const batch = dash.window.HRCStore.createCardBatch(3, 'محاولة موظف');
  dash.window.HRCStore.login('admin', 'admin123');
  if (r1.ok) return 'الموظف أضاف بطاقة بكودها';
  if (batch.length) return 'الموظف أصدر دفعة';
  return true;
});
check('صيغة الباركود: الجديدة (10 خانات) والقديمة (HRC-BC-######) مقبولتان، والمرفوضة مرفوضة', () => {
  const S = dash.window.HRCStore;
  if (!S.isCardSerial('7KQ4M9TR2X')) return 'الجديدة مرفوضة';
  if (!S.isCardSerial('7kq4m9tr2x')) return 'الجديدة بحروف صغيرة مرفوضة';
  if (!S.isCardSerial('HRC-BC-000120') || !S.isCardSerial('000120')) return 'القديمة مرفوضة';
  if (S.isCardSerial('7KQ0M9TR2X') || S.isCardSerial('7KQIM9TR2X') || S.isCardSerial('7KQ4M9TR2')) return 'أبجدية/طول خاطئ مقبول';
  return true;
});
/* ═══ محرّر صورة الوظيفة: معاينة + تكبير/تصغير + تثبيت ما يراه الموظف ═══ */
await (async () => {
  const name = 'محرّر صورة الوظيفة: معاينة وتكبير/تصغير وإزالة';
  closeAllModals(dash.doc);
  dash.doc.getElementById('btn-new-job').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const box = lastModal(dash.doc);
  const q = (id) => box.querySelector('#' + id);
  if (!q('img-editor') || !q('img-stage') || !q('img-zoom')) return bad(name, 'عناصر المحرّر غير موجودة');
  if (q('img-editor').hidden !== true || q('img-empty').hidden !== false) {
    return bad(name, 'المحرّر ظاهر قبل اختيار صورة');
  }
  const before = Number(q('img-zoom').value);
  q('img-zoom-in').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const zoomed = Number(q('img-zoom').value);
  if (!(zoomed > before) || q('img-zoom-val').textContent !== zoomed + '%') {
    return bad(name, 'زر + لا يكبّر: ' + before + ' → ' + zoomed);
  }
  for (let i = 0; i < 12; i++) q('img-zoom-in').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  if (Number(q('img-zoom').value) !== 250) return bad(name, 'التكبير تجاوز الحد ٢٥٠٪');
  q('img-zoom').value = '160';
  q('img-zoom').dispatchEvent(new dash.window.Event('input', { bubbles: true }));
  if (q('img-zoom-val').textContent !== '160%') return bad(name, 'شريط التمرير لا يضبط النسبة');
  q('img-reset').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  if (q('img-zoom-val').textContent !== '100%') return bad(name, 'إعادة الضبط لا ترجع ١٠٠٪');
  q('img-remove').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  if (q('img-editor').hidden !== true) return bad(name, 'إزالة الصورة لا تُخفي المحرّر');
  if (q('img-stage').getAttribute('tabindex') !== '0') return bad(name, 'المسرح غير قابل للتركيز بلوحة المفاتيح');
  closeAllModals(dash.doc);
  return ok(name);
})();

await (async () => {
  const name = 'حفظ الوظيفة يُثبّت الصورة كما رآها الموظف (بنسبة 10:7)';
  /* بديل canvas يرصد الرسم والأبعاد */
  const origCreate = dash.doc.createElement.bind(dash.doc);
  let drawn = null, canvasDims = null;
  dash.doc.createElement = function (tag, opts) {
    if (String(tag).toLowerCase() !== 'canvas') return origCreate(tag, opts);
    return {
      width: 0, height: 0,
      getContext() {
        return { fillStyle: '', fillRect() { }, drawImage(i, x, y, w, h) { drawn = { x, y, w, h }; } };
      },
      toDataURL(type) { canvasDims = { type, w: this.width, h: this.height }; return 'data:image/jpeg;base64,' + 'A'.repeat(120); }
    };
  };
  try {
    const S = dash.window.HRCStore;
    closeAllModals(dash.doc);
    dash.doc.getElementById('btn-new-job').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
    const box = lastModal(dash.doc);
    const q = (id) => box.querySelector('#' + id);
    /* اختيار صورة ثم محاكاة تحميلها (jsdom لا يفكّ الصور) */
    const file = new dash.window.File([new dash.window.Uint8Array([137, 80, 78, 71])], 'job.png', { type: 'image/png' });
    Object.defineProperty(q('f-image'), 'files', { value: [file], configurable: true });
    q('f-image').dispatchEvent(new dash.window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    Object.defineProperty(q('img-stage'), 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(q('img-stage'), 'clientHeight', { value: 280, configurable: true });
    q('img-stage').getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 280, right: 400, bottom: 280 });
    const img = q('img-target');
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    if (typeof img.onload === 'function') img.onload();
    img.getBoundingClientRect = () => ({ left: -80, top: -35, width: 560, height: 420, right: 480, bottom: 385 });
    q('img-zoom-in').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
    q('f-title').value = 'وظيفة صورة مثبَّتة';
    q('f-ename').value = 'صاحب عمل';
    q('f-ephone').value = '07700000009';
    q('f-eaddr').value = 'الحلة';
    q('job-save').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const job = S.listJobs({}).find((j) => j.title === 'وظيفة صورة مثبَّتة');
    if (!job) return bad(name, 'الوظيفة لم تُحفظ');
    if (!/^data:image\/jpeg;base64,/.test(job.imageUrl || '')) return bad(name, 'الصورة المحفوظة ليست نسخة مثبَّتة');
    if (!canvasDims || canvasDims.w !== 1280 || Math.abs(canvasDims.h - 896) > 1) {
      return bad(name, 'أبعاد التثبيت: ' + JSON.stringify(canvasDims));
    }
    if (!drawn || !(drawn.w > 1280) || !(drawn.x < 0)) return bad(name, 'التكبير/الموضع لم يُطبَّق: ' + JSON.stringify(drawn));
    return ok(name);
  } finally {
    dash.doc.createElement = origCreate;
    closeAllModals(dash.doc);
  }
})();

check('نموذج إضافة وظيفة يُنتج كود HRC-#### جديداً', () => {
  closeAllModals(dash.doc);
  const before = dash.window.HRCStore.stats().totalJobs;
  dash.doc.getElementById('btn-new-job').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const box = lastModal(dash.doc);
  box.querySelector('#f-title').value = 'فني تبريد';
  box.querySelector('#f-ename').value = 'شركة تبريد الفرات';
  box.querySelector('#f-ephone').value = '07733333333';
  box.querySelector('#f-eaddr').value = 'الحلة - الصناعية';
  box.querySelector('#f-min').value = '600000';
  box.querySelector('#f-max').value = '800000';
  box.querySelector('#job-save').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const after = dash.window.HRCStore.stats().totalJobs;
  const newJob = dash.window.HRCStore.listJobs({}).find((j) => j.title === 'فني تبريد');
  return (after === before + 1 && newJob && /^HRC-\d{4}$/.test(newJob.code)) || ('عدد ' + after + ' / كود ' + (newJob && newJob.code));
});
check('نموذج الوظيفة بلا رمز صاحب العمل وبلا منطقة (قرار 2026-10-25)', () => {
  closeAllModals(dash.doc);
  dash.doc.getElementById('btn-new-job').click();
  const box = lastModal(dash.doc);
  const gone = !box.querySelector('#f-epin') && !box.querySelector('#f-epin-confirm') &&
    !box.querySelector('#f-region') && !/الرمز السري/.test(box.textContent) &&
    !/المنطقة/.test(box.textContent);
  const hasGov = !!box.querySelector('#f-governorate');
  closeAllModals(dash.doc);
  return (gone && hasGov) || ('رموز/منطقة باقية: ' + JSON.stringify({ gone, hasGov }));
});
check('قائمة «مناطق العمل» حُذفت من الإعدادات — المحافظة وحدها', () => {
  const cfg = dash.window.HRCCONFIG || dash.window.HRC_CONFIG || dash.window.HRCConfig || dash.window.CFG;
  const noRegions = !cfg || !('regions' in cfg);
  const govs = !cfg || (cfg.governorates || []).length >= 18;
  return (noRegions && govs) || JSON.stringify({ noRegions, govs: cfg && (cfg.governorates || []).length });
});
check('شاشة الحجوزات تعرض الحجوزات الجارية مع العدّاد التنازلي', () => {
  const r = dash.window.HRCStore.selectAttempt('HRC-BC-000117', 'HRC-1049');
  // HRC-1049 مغلقة → نتوقع فشلاً، ثم نجرّب وظيفة متاحة
  const avail = dash.window.HRCStore.listJobs({ status: 'available' })[0];
  const ok = dash.window.HRCStore.selectAttempt('HRC-BC-000117', avail.code);
  dash.doc.querySelector('#side-nav button[data-view="holds"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const list = dash.doc.getElementById('holds-list').textContent;
  const timer = dash.doc.querySelector('#holds-list [data-expiry]');
  return (ok.ok && list.includes(avail.code) && !!timer) || ('نتيجة الحجز ' + JSON.stringify(ok.error || 'ok') + ' / عدّاد ' + !!timer);
});
check('تثبيت نتيجة المقابلة (نجاح) يغلق الوظيفة', () => {
  const holds = dash.window.HRCStore.pendingActions().holds;
  if (!holds.length) return 'لا حجوزات لاختبارها';
  const h = holds[holds.length - 1];
  const before = dash.window.HRCStore.getJob(h.job.code).status;
  dash.doc.querySelector('#side-nav button[data-view="overview"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const res = dash.window.HRCStore.setOutcome(h.serial, dash.window.HRCStore.getAttempts(h.serial).find((t) => t.jobId === h.job.id).no, 'succeeded', 'اختبار آلي');
  const after = dash.window.HRCStore.getJob(h.job.code).status;
  return (before === 'reserved' && res.ok && after === 'closed') || ('قبل ' + before + ' بعد ' + after);
});
check('سجل التدقيق يرصد كل العمليات بالثانية', () => {
  const logs = dash.window.HRCStore.listAudit({});
  const shaped = logs.filter((l) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(l.ts) && l.user && l.ip && l.action);
  return (logs.length >= 5 && shaped.length === logs.length) || ('عدد السجلات ' + logs.length + ' / مطابقة ' + shaped.length);
});
check('البحث السريع بالكود يفتح بطاقة الوظيفة', () => {
  closeAllModals(dash.doc);
  const q = dash.doc.getElementById('quick-code');
  q.value = 'HRC-1045';
  dash.doc.getElementById('quick-code-form').dispatchEvent(new dash.window.Event('submit', { bubbles: true, cancelable: true }));
  const modal = lastModal(dash.doc);
  return (modal && modal.textContent.includes('HRC-1045') && modal.textContent.includes('بطاقة الوظيفة الداخلية')) || 'لم تُفتح البطاقة';
});
check('الإعدادات مختصرة والنسخ الجديد منفصل عن الأدوات القديمة', () => {
  const doc = dash.doc, advanced = doc.getElementById('settings-advanced');
  const main = doc.querySelector('#view-settings .settings-main'), recovery = doc.getElementById('recovery-tools');
  return (!!advanced && !advanced.open && !!recovery && !advanced.contains(recovery) &&
    main.contains(doc.getElementById('settings-form')) && main.contains(doc.getElementById('users-table-body')) &&
    advanced.contains(doc.getElementById('set-verify-base')) &&
    ['btn-export','btn-import','btn-schedule-backup','btn-reset'].every(id=>!advanced.querySelector('#'+id))) || 'اختل ترتيب الأساسيات أو بقيت أدوات النسخ القديمة';
});
check('قسم الاتصال وإدارة القناة محذوف من الصفحة وليس مخفياً', () => {
  return ['settings-connection', 'users-channel', 'btn-cloud-key'].every((id) => !dash.doc.getElementById(id)) || 'بقيت أدوات القناة في الصفحة';
});
check('الإعدادات المتقدمة تُفتح وتُغلق بلوحة التحكم', () => {
  const advanced = dash.doc.getElementById('settings-advanced');
  advanced.querySelector('summary').click();
  const opened = advanced.open;
  advanced.querySelector('summary').click();
  return (opened && !advanced.open) || 'القسم المتقدم لا يفتح ويغلق';
});
check('الإعدادات: عدد الفرص قابل للتعديل والإفراج التلقائي مقفل', () => {
  const att = dash.doc.getElementById('set-attempts');
  return (att && !att.disabled && att.min === '1' && att.max === '10' && !dash.doc.getElementById('set-auto')) || 'حقول القواعد غير صحيحة';
});
check('صلاحية المدير تُظهر اللوحة المالية وسجل التدقيق الكامل', () => {
  closeAllModals(dash.doc);
  dash.window.HRCStore.logout();
  dash.window.HRCStore.login('admin', 'admin123');
  dash.window.HRCRefresh();
  const fin = dash.doc.querySelector('[data-view="finance"]');
  const navVisible = !fin.classList.contains('hidden');
  fin.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const view = dash.doc.getElementById('view-finance');
  const bars = dash.doc.querySelectorAll('#fin-bars .bar-row').length;
  const stats = dash.doc.querySelectorAll('#fin-stats .stat-card').length;
  const auditRows = dash.doc.querySelectorAll('#audit-table-body tr').length;
  return (navVisible && view.classList.contains('active') && bars > 0 && stats === 4) ||
    ('ظاهر: ' + navVisible + ' / نشط: ' + view.classList.contains('active') + ' / أعمدة: ' + bars + ' / بطاقات: ' + stats + ' / سجل: ' + auditRows);
});
check('تغيير عدد الفرص من إعدادات المدير يحفظ حقوق البطاقات القديمة', () => {
  const store = dash.window.HRCStore;
  const old = store.createApplicant({ fullName: 'بطاقة قبل التغيير', phone: '07711111111' });
  const form = dash.doc.getElementById('settings-form');
  const field = dash.doc.getElementById('set-attempts');
  field.value = '3';
  form.dispatchEvent(new dash.window.Event('submit', { bubbles: true, cancelable: true }));
  const newer = store.createApplicant({ fullName: 'بطاقة بعد التغيير', phone: '07711111112' });
  const valid = store.settings().attemptLimit === 3 && store.getAttempts(old.serial).length === 2 &&
    old.attemptLimit === 2 && store.getAttempts(newer.serial).length === 3 && newer.attemptLimit === 3 &&
    store.getAttempts(newer.serial).every((t) => dash.window.HRCVoucher.buildHtml(newer).includes(t.code));
  field.value = '2';
  form.dispatchEvent(new dash.window.Event('submit', { bubbles: true, cancelable: true }));
  return (valid && newer.attemptLimit === 3 && store.settings().attemptLimit === 2) || 'تغيّرت حقوق البطاقات أو لم يُحفظ الإعداد';
});
check('الإعدادات ترفض أعداد الفرص غير الصالحة', () => {
  const store = dash.window.HRCStore;
  for (const value of [0, -1, 1.5, 11]) {
    try { store.updateSettings({ attemptLimit: value }); return 'قُبل عدد غير صالح: ' + value; } catch (e) { }
  }
  return store.settings().attemptLimit === 2;
});
check('اللوحة المالية تحسب المتوقع تحصيله = البطاقات × السعر', () => {
  const fee = dash.window.HRCStore.settings().formFee;
  const rows = dash.window.HRCStore.financials('', '');
  return rows.every((r) => r.expected === r.forms * fee) || JSON.stringify(rows.map((r) => [r.forms, r.expected, fee]));
});

/* ======================= 6) النسخة المستقلة ======================= */
console.log('\n=== 6) الملف المستقل (hrc-standalone.html) ===');
const st = await load('hrc-standalone.html');
check('الملف المستقل يُحمّل بدون أخطاء', () => st.errors.length === 0 || st.errors.join(' | '));
check('لا مسارات ملفات خارجية (كل شيء مدمج)', () => {
  const html = readFileSync(resolve(ROOT, 'hrc-standalone.html'), 'utf8');
  const bads = [];
  if (/<link[^>]+href="assets\//.test(html)) bads.push('css');
  if (/<script[^>]+src="/.test(html)) bads.push('js');
  if (/url\(['"]?\.\.\//.test(html)) bads.push('font/img url');
  return bads.length === 0 || bads.join(',');
});
/* نسخة ثانية بجلسة موظف: التحقق يفتح داخل الملف المستقل */
const stStaff = await load('hrc-standalone.html', { hash: '#!verify?form=HRC-BC-000120', session: STAFF_SESSION });

check('القسم العام يعرض الوظائف داخل الملف المستقل', () => {
  const n = st.doc.querySelectorAll('#jobs-grid .job-card').length;
  return n >= 8 || 'عدد البطاقات ' + n;
});
check('مسار التحقق بالملف المستقل محجوب عن الزائر', () => {
  st.window.location.hash = '#!verify?form=HRC-BC-000120';
  st.window.dispatchEvent(new st.window.Event('hashchange'));
  const root = st.doc.getElementById('verify-root').textContent;
  const routeHidden = st.doc.getElementById('route-verify').hidden;
  const siteHidden = st.doc.getElementById('route-site').hidden;
  const blocked = /موظفي الشركة والإدارة/.test(root) && !root.includes('HRC-BC-000120');
  return (!routeHidden && siteHidden && blocked) ||
    ('مخفي التحقق: ' + routeHidden + ' / النص: ' + root.slice(0, 60));
});
check('مسار التحقق بالملف المستقل يعمل بجلسة موظف', () => {
  const root = stStaff.doc.getElementById('verify-root').textContent;
  return root.includes('HRC-BC-000120') || ('النص: ' + root.slice(0, 90));
});
check('المسار الهاشي يعرض المنظومة الداخلية', () => {
  st.window.location.hash = '#!dashboard';
  st.window.dispatchEvent(new st.window.Event('hashchange'));
  const hidden = st.doc.getElementById('route-dashboard').hidden;
  return (!hidden && !!st.doc.getElementById('login-wrap')) || 'لم يُعرض مسار اللوحة';
});
check('الملف المستقل بلا زر تقديم أو طلب استمارة للزائر', () => {
  const bad = st.doc.getElementById('btn-request-form') || st.doc.getElementById('btn-request-form-2') ||
    st.doc.querySelector('[data-action="request-form"]') || st.doc.getElementById('verify-quick');
  return !bad || 'ما زال عنصر طلب/تحقق ظاهراً في الملف المستقل';
});
check('العودة إلى الموقع العام تعمل', () => {
  st.window.location.hash = '#jobs';
  st.window.dispatchEvent(new st.window.Event('hashchange'));
  return (!st.doc.getElementById('route-site').hidden && st.doc.getElementById('route-verify').hidden) || 'فشل الرجوع';
});

/* ======================= 7) الموقع العام في وضع قاعدة الشركة =======================
 * المحاكاة: نفس index.html المنشورة، مع window.fetch وهمي يُحقن عبر ملف
 * supabase-config.js (يُحمَّل قبل store.js) يجيب عن public_jobs فقط — تماماً
 * كعميل REST الحقيقي. هكذا نتحقق من سلوك الزائر الحقيقي على النسخة المنشورة:
 * لا بيانات متصفح (seed/كاش) إطلاقاً، بل هيكل تحميل ثم المعلن من القاعدة،
 * أو «لا توجد وظائف معروضة حالياً»، أو «تعذّر الاتصال بقاعدة الشركة». */
console.log('\n=== 7) الموقع العام في وضع قاعدة الشركة (Supabase مفعّل) ===');
{
  const REST = 'https://vqsvztudvfukyuerzcgx.supabase.co/rest/v1/';
  const CLOUD_JOBS = [
    { code: 'HRC-9001', title: 'فني تشغيل من القاعدة', category: 'تقني', region: 'الحلة', shift: 'صباحي',
      salary_min: 700000, salary_max: 900000, gender: 'لا فرق', vacancies: 2, requirements: ['خبرة سنتين'],
      status: 'available', is_reserved: false, hold_expires_at: null,
      created_at: '2026-09-01T00:00:00.000Z', description: 'وصف معلن', image_url: '' },
    { code: 'HRC-9002', title: 'محاسب من القاعدة', category: 'إداري', region: 'المسيب', shift: 'دوام كامل',
      salary_min: 900000, salary_max: 1200000, gender: 'لا فرق', vacancies: 1, requirements: [],
      status: 'available', is_reserved: false, hold_expires_at: null,
      created_at: '2026-09-02T00:00:00.000Z', description: '', image_url: '' }
  ];

  function cloudMockScript(scenario) {
    return `
;(function () {
  var REST = ${JSON.stringify(REST)};
  var ROWS = ${JSON.stringify(scenario.fail ? [] : (scenario.jobs || []))};
  var FAIL = ${scenario.fail ? 'true' : 'false'};
  var DELAY = ${scenario.delay || 400};
  window.__brcMockFetchCalls = 0;
  window.fetch = function (url) {
    window.__brcMockFetchCalls++;
    var u = String(url);
    var out;
    if (u.indexOf(REST + 'public_jobs') === 0) {
      out = FAIL
        ? Promise.reject(new Error('mock: network down'))
        : Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(ROWS)); } });
    } else {
      out = Promise.reject(new Error('unexpected fetch: ' + u));
    }
    /* معالج فوري حتى لا يصبح الوعد المرفوض unhandledRejection قبل انقضاء المهلة */
    out.catch(function () {});
    return new Promise(function (res, rej) { setTimeout(function () { out.then(res, rej); }, DELAY); });
  };
})();`;
  }

  class CloudMockLoader extends ResourceLoader {
    constructor(scenario) { super(); this.scenario = scenario; }
    fetch(url, options) {
      if (String(url).includes('/assets/js/supabase-config.js')) {
        return super.fetch(url, options)
          .then((buf) => Buffer.from(String(buf) + '\n' + cloudMockScript(this.scenario), 'utf8'));
      }
      return super.fetch(url, options);
    }
  }

  async function loadCloudIndex(scenario) {
    const vc = new VirtualConsole();
    const errors = [];
    vc.on('jsdomError', (e) => {
      if (/Could not load|Error: Not implemented/.test(String(e.message))) return;
      errors.push(e.message);
    });
    vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
    const dom = await JSDOM.fromFile(resolve(ROOT, 'index.html'), {
      url: pathToFileURL(resolve(ROOT, 'index.html')).href,
      runScripts: 'dangerously', resources: new CloudMockLoader(scenario),
      pretendToBeVisual: true, virtualConsole: vc
    });
    return { dom, window: dom.window, doc: dom.window.document, errors };
  }

  async function pollUntil(fn, timeoutMs, label) {
    const t0 = Date.now();
    for (;;) {
      if (fn()) return true;
      if (Date.now() - t0 > timeoutMs) throw new Error('انتهت مهلة الانتظار: ' + label);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /* نسخة await من check (الفحوص هنا تنتظر رد القاعدة الوهمي) */
  async function acheck(name, fn) {
    try {
      const r = await fn();
      if (r === true || r === undefined) ok(name);
      else bad(name, String(r));
    } catch (e) { bad(name, e.message); }
  }

  /* (أ) النجاح: هيكل تحميل ثم المعلن من القاعدة — ولا أثر للبيانات التجريبية */
  const okPage = await loadCloudIndex({ jobs: CLOUD_JOBS, delay: 400 });
  check('الصفحة العامة لا أخطاء JavaScript في الوضع السحابي', () => okPage.errors.length === 0 || okPage.errors.join(' | '));
  await acheck('هيكل التحميل يظهر أثناء قراءة public_jobs (لا بيانات متصفح)', async () => {
    await pollUntil(() => okPage.doc.querySelectorAll('#jobs-grid .job-card.skeleton').length > 0, 4000, 'ظهور الهيكل');
    const grid = okPage.doc.getElementById('jobs-grid').textContent;
    const skeleton = okPage.doc.querySelector('#jobs-grid .app-card.skeleton');
    return (okPage.doc.getElementById('jobs-grid').getAttribute('aria-busy') === 'true' && /تحميل/.test(okPage.doc.getElementById('jobs-loading-status').textContent) && skeleton && skeleton.querySelector('.job-image') && skeleton.querySelectorAll('.ac-row').length === 5 && skeleton.querySelector('.ac-foot .skel-button') && !grid.includes('HRC-1042') && okPage.doc.querySelectorAll('#hero-stats .app-stat.skeleton').length === 4) ||
      'ظهرت بيانات المتصفح أثناء التحميل أو الهيكل ناقص';
  });
  await acheck('بعد الرد: الوظائف المعلنة من القاعدة (لا التجريبية)', async () => {
    await pollUntil(() => okPage.doc.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length > 0, 5000, 'وصول الوظائف');
    const grid = okPage.doc.getElementById('jobs-grid').textContent;
    return (okPage.doc.getElementById('jobs-grid').getAttribute('aria-busy') === 'false' && !okPage.doc.getElementById('jobs-loading-status').textContent && grid.includes('HRC-9001') && grid.includes('HRC-9002') && !grid.includes('HRC-1042')) ||
      'البطاقات ليست من القاعدة: ' + grid.slice(0, 80);
  });
  await acheck('إحصاءات الزائر من المعلن فقط (لا أعداد استمارات داخلية)', async () => {
    const stats = [...okPage.doc.querySelectorAll('#hero-stats .app-stat')].map((s) => s.textContent);
    /* الزائر يرى أرقاماً عامة فقط: وظائف متاحة + قواعد البطاقة الثابتة —
       ولا أي عدّاد داخلي للشركة (بطاقات صادرة / توظيف ناجح). */
    const all = stats.join(' | ');
    return (stats.length === 4 && /متاحة/.test(stats[0]) &&
      !/بطاقة صادرة/.test(all) && !/توظيف ناجح/.test(all)) ||
      'الإحصاءات: ' + JSON.stringify(stats);
  });
  await acheck('الزائر = طلب واحد فقط (public_jobs) ولا صلاحية كتابة', async () => {
    const st = okPage.window.HRCStore.cloudStatus();
    return (okPage.window.__brcMockFetchCalls === 1 && st.state === 'on' && st.role === 'public' && st.readOnly === true) ||
      JSON.stringify({ calls: okPage.window.__brcMockFetchCalls, state: st.state, role: st.role });
  });
  await acheck('بطاقة الوظيفة تعرض زر «احجز» يحمل كود الوظيفة المعلنة', async () => {
    const a = okPage.doc.querySelector('#jobs-grid .job-card [data-action="open-booking"]');
    return (a && /HRC-9001|HRC-9002/.test(a.getAttribute('data-code') || '')) || 'لا زر حجز إلكتروني';
  });
  await acheck('نافذة «بطاقتي» تعمل في وضع القاعدة: تفتح على شاشة إدخال الباركود', async () => {
    const a = okPage.doc.querySelector('#jobs-grid .job-card [data-action="open-booking"]');
    a.dispatchEvent(new okPage.window.MouseEvent('click', { bubbles: true }));
    const modal = [...okPage.doc.querySelectorAll('.modal-backdrop .modal')].pop();
    return (modal && modal.querySelector('#bk-serial') && modal.textContent.includes('بطاقتي')) ||
      'لم تُفتح نافذة بطاقتي';
  });
  okPage.dom.window.close();

  /* (ب) قاعدة متصلة لكن لا وظائف معلنة */
  const emptyPage = await loadCloudIndex({ jobs: [], delay: 200 });
  await acheck('قاعدة بلا وظائف معلنة: رسالة «لا توجد وظائف معروضة حالياً»', async () => {
    await pollUntil(() => {
      const e = emptyPage.doc.getElementById('jobs-empty');
      return e && !e.classList.contains('hidden');
    }, 5000, 'رسالة الفراغ');
    const e = emptyPage.doc.getElementById('jobs-empty');
    const h = e.querySelector('h3');
    const cards = emptyPage.doc.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length;
    return (emptyPage.doc.getElementById('jobs-grid').getAttribute('aria-busy') === 'false' && h && h.textContent.includes('لا توجد وظائف معروضة حالياً') && cards === 0) ||
      ('العنوان: ' + (h && h.textContent) + ' / بطاقات: ' + cards);
  });
  await acheck('حالة الفراغ لا تعرض البيانات التجريبية إطلاقاً', async () => {
    const body = emptyPage.doc.getElementById('jobs-grid').textContent + emptyPage.doc.getElementById('hero-stats').textContent;
    return !body.includes('HRC-1042') || 'ظهرت بيانات seed مع قاعدة فارغة';
  });
  emptyPage.dom.window.close();

  /* (ج) فشل الاتصال: رسالة فشل صريحة + إعادة محاولة — لا سقوط لبيانات المتصفح */
  const failPage = await loadCloudIndex({ fail: true, delay: 200 });
  await acheck('فشل الاتصال: «تعذّر الاتصال بقاعدة الشركة» + زر إعادة المحاولة', async () => {
    await pollUntil(() => /تعذّر الاتصال بقاعدة الشركة/.test(failPage.doc.getElementById('jobs-grid').textContent), 5000, 'رسالة الفشل');
    const retry = failPage.doc.querySelector('#jobs-grid [data-action="retry-cloud"]');
    const st = failPage.window.HRCStore.cloudStatus();
    return (failPage.doc.getElementById('jobs-grid').getAttribute('aria-busy') === 'false' && !!retry && st.state === 'degraded') || JSON.stringify({ retry: !!retry, state: st.state });
  });
  await acheck('عند الفشل لا تُعرض وظائف المتصفح التجريبية', async () => {
    const grid = failPage.doc.getElementById('jobs-grid').textContent;
    return (!grid.includes('HRC-1042') && !grid.includes('عامل مخزن')) || 'سقط العرض إلى بيانات seed عند الفشل';
  });
  failPage.dom.window.close();
}

/* ═══════════ 8) أدوات الموظف والمدير: التحقق يبقى داخل المنظومة ═══════════ */
console.log('\n=== 8) أدوات الموظف — التحقق من المنظومة الداخلية (بجلسة موظف) ===');
{
  const dash = await load('dashboard.html', { session: STAFF_SESSION });
  const DB = JSON.stringify(site.window.HRCStore.db());
  injectFixture(dash.window.HRCStore,DB);
  dash.window.HRCStore.emit && dash.window.HRCStore.emit();
  dash.window.HRCRefresh && dash.window.HRCRefresh();
  await new Promise((r) => setTimeout(r, 200));

  check('المنظومة تُفتح بجلسة الموظف مباشرة', () => !dash.doc.getElementById('app-shell').classList.contains('hidden'));

  const viewBtn = dash.doc.querySelector('#side-nav button[data-view="applicants"]');
  if (viewBtn) viewBtn.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));

  const verifyBtn = dash.doc.querySelector('[data-app-verify="HRC-BC-000120"]');
  check('زر التحقق من الاستمارة موجود في جدول الموظف',
    () => !!verifyBtn || ('الأزرار الموجودة: ' + dash.doc.querySelectorAll('[data-app-verify]').length));

  if (verifyBtn) {
    verifyBtn.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const box = lastModal(dash.doc);
    const bt = box ? box.textContent : '';
    check('نافذة التحقق تعرض الرقم ورابط التحقق المطبوع',
      () => (/HRC-BC-000120/.test(bt) && /\/verify(\.html)?\?form=/.test(bt)) || bt.slice(0, 120));
    check('كيو آر كود الاستمارة مرسوم داخل النافذة', () => !!(box && box.querySelector('svg')));
    check('زر «فتح صفحة التحقق» موجود للموظف', () => !!(box && box.querySelector('#go-verify')));
    check('رابط التحقق المحلي صالح',
      () => /verify\.html\?form=HRC-BC-000120/.test(dash.window.HRCStore.verifyLocalUrl('HRC-BC-000120')),
      dash.window.HRCStore.verifyLocalUrl('HRC-BC-000120'));
    const close = box && box.querySelector('[data-close]');
    if (close) close.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  }

  /* المدير: نفس الأدوات + الصلاحيات الإدارية قائمة */
  const admin = await load('dashboard.html', { session: { username: 'admin', name: 'مدير فحص', role: 'admin', title: 'مدير عام', at: new Date().toISOString() } });
  injectFixture(admin.window.HRCStore,DB);
  admin.window.HRCStore.emit && admin.window.HRCStore.emit();
  await new Promise((r) => setTimeout(r, 150));
  check('لوحة المدير تفتح وتُظهر أدوات الإدارة (اللوحة المالية)', () => {
    const fin = admin.doc.querySelector('[data-view="finance"]');
    return (!!fin && !fin.classList.contains('hidden')) || 'زر اللوحة المالية غير ظاهر للمدير';
  });
  check('المدير يرى صفحة التحقق كموظف (نفس البوابة تُجيزه)', () => {
    const u = admin.window.HRCStore.currentUser();
    return !!u && (u.role === 'admin' || u.role === 'staff');
  });
}

/* ======================= النتيجة ======================= */
console.log('\n' + '='.repeat(58));
console.log(`النتيجة: ✅ ${pass} ناجح | ❌ ${fail} فاشل`);
if (failures.length) { console.log('\nالإخفاقات:'); failures.forEach((f) => console.log('  • ' + f)); }
console.log('='.repeat(58));
process.exit(fail ? 1 : 0);
