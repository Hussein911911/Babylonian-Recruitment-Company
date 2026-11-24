#!/usr/bin/env node
/* ===========================================================================
 *  HRC — الحزمة القانونية: سياسة الخصوصية وشروط الاستخدام
 *  ---------------------------------------------------------------------------
 *  الموقع يجمع بيانات شخصية (اسم، هاتف، سكن، ميلاد، جنس). هذه الحزمة هي
 *  الإفصاح والموافقة. الاختبار يحمي خمسة أشياء لا يجوز أن تنكسر بصمت:
 *
 *    • الصفحتان موجودتان ومبنيتان بهوية الموقع (رأس/تذييل/شعار).
 *    • كل قسم جوهري موجود فعلاً (من نحن، ما نجمعه، من يطّلع، الاحتفاظ، الحقوق…).
 *    • الروابط إليهما موجودة في كل صفحة عامة (ومنها نموذج التقديم نفسه).
 *    • الموافقة في apply.html إلزامية و**تسبق** أي كتابة في القاعدة.
 *    • جدول الاحتفاظ في الصفحة مطابق للوثيقة التشغيلية (لا وعدان مختلفان).
 *
 *  التشغيل:  node tests/privacy-terms.mjs
 * =========================================================================== */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

console.log('\n' + '═'.repeat(74));
console.log('  HRC — سياسة الخصوصية وشروط الاستخدام');
console.log('═'.repeat(74));

const PRIVACY = 'privacy.html', TERMS = 'terms.html';
const DOC = 'docs/privacy-and-terms-2026-11-24.md';

/* ------------------------------------------------------------------------- */
step(1, 'الصفحتان موجودتان ومبنيتان بهوية الموقع');
{
  check('privacy.html موجود', existsSync(join(ROOT, PRIVACY)));
  check('terms.html موجود', existsSync(join(ROOT, TERMS)));
  const p = read(PRIVACY), t = read(TERMS);
  for (const [name, html] of [[PRIVACY, p], [TERMS, t]]) {
    check(name + ': يحمل تذييل الموقع', /class="site-footer"/.test(html));
    check(name + ': يحمل شعار المنصة (sprite)', /id="i-mkseb-dark"/.test(html));
    check(name + ': بلا سكربت مضمّن (سياسة CSP بالبصمات)', !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]{0,40}?[^\s]/.test(html.replace(/<script[^>]*src=[^>]*><\/script>/g, '')));
    check(name + ': يعلن الإصدار وتاريخ السريان', /الإصدار/.test(html) && /سارية من/.test(html));
    check(name + ': يعلن أولوية النص العربي', /النص العربي هو المرجع/.test(html));
  }
}

/* ------------------------------------------------------------------------- */
step(2, 'الأقسام الجوهرية في سياسة الخصوصية');
{
  const p = read(PRIVACY);
  const need = [
    ['من نحن / المسؤول عن البيانات', /المسؤول عن البيانات|من نحن/],
    ['ما نجمعه', /ما نجمعه/],
    ['لماذا نجمعه (الأغراض)', /لماذا نجمعه|الأغراض/],
    ['أساس المعالجة والموافقة', /أساس المعالجة/],
    ['من يطّلع على البيانات', /من يطّلع على البيانات/],
    ['مزوّدو الخدمة والنقل خارج العراق', /النقل خارج العراق|مزوّدو الخدمة/],
    ['ملفات تعريف الارتباط', /ملفات تعريف الارتباط/],
    ['مدة الاحتفاظ والحذف', /مدة الاحتفاظ والحذف/],
    ['الحقوق', /حقوقك/],
    ['الأمان', /الأمان وحماية البيانات/],
    ['السن', /السن|١٦ سنة/],
    ['التغييرات والتواصل', /تغييرات السياسة والتواصل/]
  ];
  for (const [label, re] of need) check('قسم: ' + label, re.test(p));

  check('يذكر المزوّدين الفعليين (Supabase + Cloudflare)', /Supabase/.test(p) && /Cloudflare/.test(p));
  check('ينفي أدوات التتبّع صراحةً', /لا يستخدم الموقع أي ملفات تتبّع|لا أدوات تحليل/.test(p));
  check('يذكر ما لا يُجمع (مستمسكات/صحة/دين/سياسة)', /ما لا نجمعه/.test(p) && /المستمسكات/.test(p));
  check('يذكر أن بيانات صاحب العمل غير منشورة', /غير منشورة/.test(p));
  check('يفصح أن SAAS خارج العراق (خوادم خارج)', /خارج العراق/.test(p));
  check('يشرح إثبات الموافقة (وقت الطلب = وقت الموافقة)', /وقت تسجيل الطلب/.test(p));
}

/* ------------------------------------------------------------------------- */
step(3, 'بنود شروط الاستخدام الأساسية');
{
  const t = read(TERMS);
  const need = [
    ['تعريف الخدمة', /تعريف الخدمة/],
    ['البطاقة والفرص (٢ + ٣٠ يوماً + ٢٤ ساعة)', /فرصتان/.test(t) && /٣٠ يوماً/.test(t) && /٢٤ ساعة/.test(t)],
    ['الفرصة مستهلكة بأي نتيجة', /مستهلكة بأي نتيجة/],
    ['التزامات الباحث', /التزاماتك كباحث عن عمل/],
    ['التزامات صاحب العمل', /التزامات صاحب العمل/],
    ['الرسوم والاسترداد', /الرسوم والاسترداد/],
    ['الاستخدام المحرَّم', /الاستخدام المحرَّم/],
    ['إيقاف البطاقة', /إيقاف البطاقة/],
    ['حدود المسؤولية', /حدود المسؤولية/],
    ['الملكية الفكرية', /الملكية الفكرية/],
    ['القانون الواجب التطبيق (العراق)', /القانون العراقي/],
    ['التواصل', /التواصل/]
  ];
  for (const [label, re] of need) check('بند: ' + label, re === true || (re instanceof RegExp && re.test(t)));
  check('البطاقة ليست وعداً بالتوظيف', /ليست وعداً بالتوظيف/.test(t));
  check('تحذير الدفع مقابل وظيفة', /لا تدفع لأي شخص/.test(t));
  check('لا نعد بعقوبات/قوانين غير نافذة', !/GDPR|اللائحة الأوروبية/.test(t) && !/GDPR/.test(read(PRIVACY)));
}

/* ------------------------------------------------------------------------- */
step(4, 'الروابط إليهما في كل صفحة عامة');
{
  for (const page of ['index.html', 'verify.html', '404.html', 'privacy.html', 'terms.html', 'dashboard.html']) {
    const html = read(page);
    check(page + ': رابط سياسة الخصوصية', /href="(\.\/)?privacy\.html"/.test(html) || /href="\/privacy\.html"/.test(html));
    check(page + ': رابط شروط الاستخدام', /href="(\.\/)?terms\.html"/.test(html) || /href="\/terms\.html"/.test(html));
  }
  check('apply.html: الرابطان داخل رحلة التقديم', /href="privacy\.html"/.test(read('apply.html')) && /href="terms\.html"/.test(read('apply.html')));
  const bk = read('assets/js/booking.js');
  check('نافذة الحجز العامة: سطر موافقة بالوثيقتين', /privacy\.html[\s\S]{0,220}terms\.html/.test(bk) && /باستخدامك النموذج/.test(bk));
  check('404: روابط الصفحتين مطلقة (تُخدَم على مسار تعسّفي)', /404\.html/ && /\/privacy\.html/.test(read('404.html')) && /\/terms\.html/.test(read('404.html')));
  const sm = read('sitemap.xml');
  check('sitemap: /privacy', /<loc>[^<]*\/privacy<\/loc>/.test(sm));
  check('sitemap: /terms', /<loc>[^<]*\/terms<\/loc>/.test(sm));
  check('sitemap: نطاق واحد لكل الروابط',
    new Set([...sm.matchAll(/<loc>https:\/\/([^/]+)\//g)].map(m => m[1])).size === 1,
    [...sm.matchAll(/<loc>https:\/\/([^/]+)\//g)].map(m => m[1]).join(','));
  check('_redirects: بلا قاعدة لـ privacy/terms (تطبيع Pages يخدمها)',
    !/^\/(privacy|terms)/m.test(read('_redirects')));
}

/* ------------------------------------------------------------------------- */
step(5, 'الموافقة في نموذج التقديم إلزامية وتسبق الكتابة');
{
  const a = read('apply.html');
  check('خانة الموافقة موجودة', /id="consent-privacy"[^>]*type="checkbox"|type="checkbox"[^>]*id="consent-privacy"/.test(a));
  check('الخانة داخل صفحة المراجعة قبل زر الإتمام',
    a.indexOf('id="consent-privacy"') > 0 && a.indexOf('id="consent-privacy"') < a.indexOf('id="btn-finish"'));
  check('نص الموافقة يشير للوثيقتين', /أقرّ بأنني قرأت[\s\S]{0,400}privacy\.html[\s\S]{0,200}terms\.html/.test(a));
  /* البوابة داخل finish() وقبل نداء apply_with_card */
  const finishAt = a.indexOf('finish:function()');
  const gateAt = a.indexOf("consentBox&&!consentBox.checked", finishAt);
  const rpcAt = a.indexOf("rpc('apply_with_card'", finishAt);
  check('بوابة الموافقة داخل finish()', finishAt > 0 && gateAt > finishAt);
  check('البوابة تسبق نداء apply_with_card', gateAt > 0 && rpcAt > gateAt,
    'gate@' + gateAt + ' rpc@' + rpcAt);
  check('رفض الإرسال برسالة عربية واضحة', /قبل الإتمام: يجب الموافقة على سياسة الخصوصية/.test(a));
  check('الخانة تُبرز عند النقص (is-missing)', /classList\.add\('is-missing'\)/.test(a));
  check('التنبيه يزول فور التعليم', /consentChk\.addEventListener\('change'/.test(a));
}

/* ------------------------------------------------------------------------- */
step(6, 'سجل الاحتفاظ: وعد واحد لا وعدان');
{
  const p = read(PRIVACY), d = existsSync(join(ROOT, DOC)) ? read(DOC) : '';
  check('وثيقة تشغيلية للحزمة موجودة', !!d && /جرد البيانات/.test(d));
  for (const [label, re] of [['١٢ شهراً', /١٢ شهراً/], ['٢٤ شهراً', /٢٤ شهراً/], ['٣٠ نسخة', /٣٠ نسخة/]]) {
    check('السياسة تذكر ' + label, re.test(p));
    check('الوثيقة التشغيلية تذكر ' + label, re.test(d));
  }
  check('إجراء الحذف موثّق (٣٠ يوماً + التحقق من الهوية)', /إجراء الحذف/.test(d) && /٣٠ يوماً/.test(d));
  check('الوثيقة تُحيل لاختبار الحزمة', /privacy-terms\.mjs|test:privacy/.test(d));
  check('README يحيل للصفحة المنشورة', /privacy\.html/.test(read('README.md')));
}

/* ------------------------------------------------------------------------- */
step(7, 'لا ادّعاء ترخيص/إجازة بلا رقم موثّق (قرار المالك 2026-11-24)');
{
  const CLAIM = /إجازة عمل|مرخّص|مرخصة|وزارة العمل والشؤون الاجتماعية/;
  for (const page of ['index.html', 'verify.html', '404.html', 'dashboard.html', PRIVACY, TERMS, 'apply.html', 'hrc-standalone.html', 'hrc-light.html']) {
    check(page + ': بلا ادّعاء ترخيص أو إجازة', !CLAIM.test(read(page)),
      (read(page).match(CLAIM) || [''])[0]);
  }
  check('config: مفتاح الإجازة فارغ (لا ادّعاء غير موثّق)', /license: ''/.test(read('assets/js/config.js')));
  check('الوثيقة تسجّل قرار الإزالة', /أُزيل \*\*كل\*\* ادّعاء ترخيص|إزالة ادّعاء/.test(read(DOC)));
  check('«إجازة سوق» في متطلبات الوظائف باقية (ليست ادّعاء ترخيص)',
    /إجازة سوق/.test(read('hrc-standalone.html')));
  /* المصادر أيضاً: المخطط وبذور الإعدادات وأجزاء اللصق — لا ادّعاء حتى عند الاسترجاع. */
  const sqlFiles = ['docs/schema.sql', 'restore.html',
    ...readdirSync('docs/sql-parts/schema').filter(f => f.endsWith('.sql')).map(f => 'docs/sql-parts/schema/' + f),
    ...readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => 'supabase/migrations/' + f).filter(f => /2026091500/.test(f))];
  for (const f of sqlFiles) check(f + ': بلا ادّعاء إجازة/ترخيص', !CLAIM.test(read(f)),
    (read(f).match(CLAIM) || [''])[0]);
}

/* ------------------------------------------------------------------------- */
step(8, 'نظافة التسليم: نطاق واحد وبلا بريد إلكتروني منشور');
{
  const DOMAIN = 'babylonian-recruitment-company.pages.dev';
  check('robots: خريطة الموقع على النطاق الرسمي', read('robots.txt').includes(DOMAIN + '/sitemap.xml'));
  check('_headers: CORS على النطاق الرسمي', read('_headers').includes('Access-Control-Allow-Origin: https://' + DOMAIN));
  check('_headers: بلا أصل وهمي', !/hrc\.example/.test(read('_headers')));
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
  for (const page of ['index.html', 'apply.html', 'verify.html', 'dashboard.html', PRIVACY, TERMS, '404.html', 'hrc-standalone.html', 'hrc-light.html']) {
    check(page + ': بلا بريد إلكتروني منشور', !EMAIL.test(read(page)), (read(page).match(EMAIL) || [''])[0]);
  }
  check('config: لا مفتاح بريد', !/\bemail\s*:/.test(read('assets/js/config.js')));
  check('config: رقم التحقق على نطاق النشر', /verifyBase:\s*'https:\/\/babylonian-recruitment-company\.pages\.dev\/verify'/.test(read('assets/js/config.js')));
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
console.log('═'.repeat(74) + '\n');
if (problems.length) { console.log('  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); console.log(); }
process.exit(fail ? 1 : 0);
