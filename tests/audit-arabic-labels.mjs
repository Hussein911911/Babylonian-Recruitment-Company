#!/usr/bin/env node
/* ===========================================================================
 *  حارس: «العملية» و«التفاصيل» في سجل التدقيق بالعربية بالكامل
 *  ---------------------------------------------------------------------------
 *  مشغّل القاعدة brc.trg_audit() يكتب action/details بصيغة مختلطة
 *  («تعديل applicants» / «تغيير في applicants»)، وبعض سجلات المتجر تحمل
 *  تفاصيل JSON بحقول إنكليزية. نُعرّبها عند العرض فقط: الجدول، الفلاتر،
 *  «آخر العمليات»، التصدير، ونص البحث. القيم الخام لا تُمسّ.
 *
 *  التشغيل: npm run test:audit-arabic
 * =========================================================================== */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let checks = 0;
const check = (label, condition, detail) => {
  assert.ok(condition, label + (detail ? ' — ' + detail : ''));
  console.log('  ✓ ' + label);
  checks++;
};
const latin = (s) => (String(s).match(/[A-Za-z][A-Za-z0-9_]*/g) || []);

/* 1) الملفات المبنية تحتوي طبقة التعريب (لا تعديل يدوي على HTML) */
check('dashboard.html يحمل نسخة dashboard.js المعرَّبة',
  /assets\/js\/dashboard\.js/.test(read('dashboard.html')) &&
  /auditDetailsLabel/.test(read('assets/js/dashboard.js')) &&
  /AUDIT_PHRASE/.test(read('assets/js/dashboard.js')));
for (const p of ['hrc-standalone.html', 'hrc-light.html']) {
  check(p + ' يحمل معرّب السجل مدمجاً', /auditDetailsLabel/.test(read(p)) && /AUDIT_PHRASE/.test(read(p)));
}
check('store.js يعرض خطاف تسميات البحث', /setAuditDisplayLabels/.test(read('assets/js/store.js')));
check('القاعدة ما زالت تكتب القيم الخام (دليل التدقيق لا يُعدَّل)',
  /'تغيير في ' \|\| tg_table_name/.test(read('docs/schema.sql')));

/* 2) تشغيل اللوحة الحقيقية بسجل يحاكي صفوف القاعدة */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Not implemented|Could not load|Failed to load resource/.test(e.message)) errors.push(e.message); });
const dom = await JSDOM.fromFile(join(ROOT, 'dashboard.html'), {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    const session = new Map([['hrc_session_v2', JSON.stringify({ username: 'manager', role: 'admin', name: 'مدير الاختبار', cloud: true })]]);
    Object.defineProperty(w, 'sessionStorage', { value: {
      getItem: (k) => session.get(k) || null,
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    } });
  }
});
await new Promise((r) => {
  if (dom.window.document.readyState === 'complete') return r();
  const t = setTimeout(r, 5000);
  dom.window.addEventListener('load', () => { clearTimeout(t); r(); }, { once: true });
});
const w = dom.window, doc = w.document, store = w.HRCStore;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = () => [...doc.querySelectorAll('#audit-table-body tr')].filter((r) => !r.querySelector('.table-empty'));
const col = (i) => rows().map((r) => r.children[i].textContent.trim());

const fixture = [
  { id: 'db1', ts: '2026-11-07T08:00:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'تعديل applicants', entity: 'applicants', entityId: '4SC', details: 'تغيير في applicants' },
  { id: 'db2', ts: '2026-11-07T08:01:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'إضافة jobs', entity: 'jobs', entityId: 'HRC-1042', details: 'تغيير في jobs' },
  { id: 'db3', ts: '2026-11-07T08:02:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'حذف job_attempts', entity: 'job_attempts', entityId: 'XS8', details: 'تغيير في job_attempts' },
  { id: 'local1', ts: '2026-11-07T08:03:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'تعديل مستخدم', entity: 'user', entityId: 'worker',
    details: '{"name":"أحمد","role":"admin","password":"s3cr3t"}' },
  { id: 'local2', ts: '2026-11-07T08:04:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'تعديل وظيفة', entity: 'job', entityId: 'HRC-1043',
    details: 'تحديث بيانات الوظيفة ({"t":"مهندس","g":"بابل","s":"available"} ← {"t":"مهندس","g":"بابل","s":"closed"})' },
  { id: 'arabic', ts: '2026-11-07T08:05:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'طباعة بطاقة', entity: 'applicant', entityId: 'HRC-NO-000120', details: 'طباعة بطاقة التوظيف' }
];

try {
  check('خطاف تسميات البحث متاح للوحة', typeof store.setAuditDisplayLabels === 'function');
  store.db().audit = fixture;
  doc.querySelector('#side-nav [data-view="overview"]').click();
  const recent = [...doc.querySelectorAll('#ov-recent .ov-log-action')].map((e) => e.textContent);
  check('«آخر العمليات» بلا كلمات إنكليزية', recent.length > 0 && recent.every((t) => latin(t).length === 0),
    JSON.stringify(recent));

  doc.querySelector('#side-nav [data-view="audit"]').click();
  check('كل صفوف السجل معروضة', rows().length === 6);

  const actions = col(4), details = col(5);
  const byId = (id) => rows().find((r) => r.children[3].textContent.includes(id));
  const actionOf = (id) => byId(id).children[4].textContent.trim();
  const detailsOf = (id) => byId(id).children[5].textContent.trim();
  check('العملية: جدول القاعدة → عربية',
    actionOf('4SC') === 'تعديل بطاقة' && actionOf('HRC-1042') === 'إضافة وظيفة' &&
    actionOf('XS8') === 'حذف فرصة', JSON.stringify(actions));
  check('العملية: السجلات العربية الأصلية لم تتغيّر',
    actionOf('worker') === 'تعديل مستخدم' && actionOf('HRC-1043') === 'تعديل وظيفة' &&
    actionOf('HRC-NO-000120') === 'طباعة بطاقة');
  check('التفاصيل: «تغيير في …» → جملة عربية سليمة',
    detailsOf('4SC') === 'تعديل بيانات البطاقة' && detailsOf('HRC-1042') === 'تعديل بيانات الوظيفة' &&
    detailsOf('XS8') === 'تعديل بيانات الفرصة', JSON.stringify(details));
  const userDetails = detailsOf('worker');
  check('التفاصيل: JSON يُقرأ عربياً مع حجب كلمة المرور',
    /الاسم: أحمد/.test(userDetails) && /الرتبة: مدير عام/.test(userDetails) &&
    /كلمة المرور: محجوب/.test(userDetails) && !userDetails.includes('s3cr3t'), userDetails);
  const jobDetails = detailsOf('HRC-1043');
  check('التفاصيل: مفاتيح وقيم الحالات معرّبة داخل JSON',
    /العنوان: مهندس/.test(jobDetails) && /المحافظة: بابل/.test(jobDetails) &&
    /الحالة: متاحة/.test(jobDetails) && /الحالة: مغلقة/.test(jobDetails), jobDetails);
  check('لا كلمة إنكليزية في «العملية» و«التفاصيل»',
    [...actions, ...details].every((t) => latin(t).length === 0),
    JSON.stringify([...actions, ...details].flatMap(latin)));
  check('«القسم» معرّب أيضاً', byId('4SC').children[3].textContent.startsWith('بطاقة') &&
    byId('HRC-1042').children[3].textContent.startsWith('وظيفة'));
  check('الأكواد المطبوعة بقيت كما هي', byId('HRC-1042').children[3].textContent.includes('HRC-1042') &&
    byId('HRC-NO-000120').children[3].textContent.includes('HRC-NO-000120'));

  const optionTexts = (id) => [...doc.getElementById(id).options].map((o) => o.textContent.trim());
  check('فلتر «كل العمليات» عربي بالكامل',
    optionTexts('log-action').every((t) => latin(t).length === 0), JSON.stringify(optionTexts('log-action')));
  check('فلتر «كل الأقسام» عربي بالكامل',
    optionTexts('log-entity').every((t) => latin(t).length === 0), JSON.stringify(optionTexts('log-entity')));

  /* البحث بالعربية يجد السطر الخام، والبحث بالاسم الخام يبقى عاملاً */
  const q = doc.getElementById('log-q');
  const search = async (text) => { q.value = text; q.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(320); return rows().length; };
  check('البحث بـ«بطاقة» يجد سجل applicants الخام', await search('بطاقة') >= 2);
  check('البحث بالقيمة الخام applicants ما زال يعمل', await search('applicants') === 1);
  check('البحث بـ«وظيفة» يعمل على التسمية المعربة', await search('وظيفة') >= 2);

  /* التصدير معرّب، والسجل الأصلي لم يتغيّر */
  doc.getElementById('log-reset').click();
  let download = null;
  w.HRCUI.download = (name, body) => { download = { name, body }; };
  doc.getElementById('btn-export-audit').click();
  check('التصدير لا يسرّب أسماء الجداول ولا كلمة المرور', !!download &&
    !/\b(applicants|job_attempts|s3cr3t|password)\b/.test(download.body),
    download ? download.body.slice(0, 300) : 'no download');
  check('التصدير يحمل التسميات العربية', !!download &&
    download.body.includes('تعديل بطاقة') && download.body.includes('تعديل بيانات البطاقة'));
  check('القيم الخام بقيت في المتجر (دليل التدقيق)',
    store.db().audit[0].action === 'تعديل applicants' &&
    store.db().audit[0].details === 'تغيير في applicants' &&
    store.db().audit[3].details.includes('s3cr3t'));
  check('لا أخطاء JavaScript', errors.length === 0, errors.join(' | '));
} finally {
  dom.window.close();
}
console.log(`\nسجل التدقيق بالعربية: ${checks} فحصاً ناجحاً.`);
