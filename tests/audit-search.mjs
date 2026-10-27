#!/usr/bin/env node
// Real dashboard + isolated browser storage. No production network or records.
import { JSDOM, VirtualConsole } from 'jsdom';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
process.env.TZ = 'Asia/Baghdad';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Not implemented|Could not load/.test(e.message)) errors.push(e.message); });
const dom = await JSDOM.fromFile(resolve(root, 'dashboard.html'), {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    const session = new Map([['hrc_session_v2', JSON.stringify({ username: 'manager', role: 'admin', name: 'مدير الاختبار', cloud: true })]]);
    Object.defineProperty(w, 'sessionStorage', { value: { getItem: (k) => session.get(k) || null, setItem: (k,v) => session.set(k,String(v)), removeItem: (k) => session.delete(k) } });
  }
});
await new Promise((r) => { if (dom.window.document.readyState === 'complete') r(); else dom.window.addEventListener('load', r, { once: true }); });
const w = dom.window, doc = w.document, store = w.HRCStore;
let pass = 0;
function check(name, condition) { assert.ok(condition, name); pass++; console.log('  ✅ ' + name); }
const field = (key) => doc.getElementById('log-' + key);
const change = (key, value) => { field(key).value = value; field(key).dispatchEvent(new w.Event('change', { bubbles: true })); };
const wait = () => new Promise((r) => setTimeout(r, 240));
const reset = () => doc.getElementById('log-reset').click();
/* 2026-10-25: السجل جدول مرتّب — الصفوف داخل tbody بلا صفّ «فارغ» */
const visible = () => [...doc.querySelectorAll('#audit-table-body tr')].filter((r) => !r.querySelector('.table-empty'));
try {
  const fixture = Array.from({length: 125}, (_,i) => ({
    id: 'row-' + i, ts: new Date(Date.UTC(2026,9,16,10,0,i)).toISOString(),
    user: i % 2 ? 'worker' : 'manager', name: i % 2 ? 'أحمد علي' : 'مدير', role: i % 2 ? 'staff' : 'admin',
    ip: '10.0.0.' + i, action: i % 2 ? 'طباعة بطاقة' : 'تعديل وظيفة', entity: i % 2 ? 'applicant' : 'job',
    entityId: 'HRC-' + (1000+i), details: 'تفاصيل ' + i
  }));
  store.db().audit = fixture;
  doc.querySelector('#side-nav [data-view="audit"]').click();
  check('صفحة أولى من 25 سجلاً', visible().length === 25 && doc.getElementById('log-page-info').textContent === '1 / 5');
  check('زر السابق معطّل في البداية', doc.getElementById('log-prev').disabled);
  doc.getElementById('log-next').click();
  check('الانتقال للصفحة التالية', doc.getElementById('log-page-info').textContent === '2 / 5');
  change('page-size','100');
  check('تغيير حجم الصفحة يعيد الصفحة الأولى', visible().length === 100 && doc.getElementById('log-page-info').textContent === '1 / 2');
  change('action','طباعة بطاقة'); change('role','staff'); change('entity','applicant');
  check('تقاطع فلاتر العملية والصلاحية والنوع', visible().length === 62);
  change('user','manager');
  check('حالة نتائج فارغة واضحة', visible().length === 0 && doc.querySelector('.table-empty').textContent.includes('مطابقة'));
  reset();
  check('تصفير الفلاتر', field('action').value === 'all' && field('user').value === 'all' && visible().length === 100);
  field('q').value = 'احمد ١٠٠١'; field('q').dispatchEvent(new w.Event('input')); await wait();
  check('بحث عربي بالاسم والهمزات والأرقام مع عدة كلمات', visible().length === 1 && visible()[0].textContent.includes('HRC-1001'));
  check('فلتر البحث يعيد الصفحة الأولى', doc.getElementById('log-page-info').textContent === '1 / 1');
  reset(); change('sort','oldest');
  check('ترتيب الأقدم أولاً', visible()[0].textContent.includes('HRC-1000'));
  reset();
  check('الافتراضي الأحدث أولاً', visible()[0].textContent.includes('HRC-1124'));
  // Local calendar-day boundaries: Baghdad is UTC+3, including sub-second end.
  const base = { user:'manager',name:'مدير',role:'admin',entity:'job',action:'حدود التاريخ',entityId:'DAY',details:'',ip:'' };
  store.db().audit = [
    {...base, id:'before', ts:'2026-10-15T20:59:59.999Z'},
    {...base, id:'first', ts:'2026-10-15T21:00:00.000Z'},
    {...base, id:'last', ts:'2026-10-16T20:59:59.999Z'},
    {...base, id:'after', ts:'2026-10-16T21:00:00.000Z'}
  ];
  change('from','2026-10-16'); change('to','2026-10-16');
  check('تاريخ اليوم كامل بالتوقيت المحلي دون تسريب يوم مجاور', store.listAudit({from:'2026-10-16',to:'2026-10-16'}).map((r) => r.id).join(',') === 'last,first');
  change('from','2026-10-17');
  check('منع نطاق تاريخ معكوس وتصديره', !doc.getElementById('log-date-error').classList.contains('hidden') && doc.getElementById('btn-export-audit').disabled);
  reset(); doc.querySelector('[data-audit-range="today"]').click();
  check('اختصار اليوم حسب تاريخ الجهاز', field('from').value === store.fmtDate(new Date()) && field('from').value === field('to').value);
  doc.querySelector('[data-audit-range="week"]').click();
  check('آخر سبعة أيام يشمل اليوم وستة أيام قبله', Math.round((new Date(field('to').value) - new Date(field('from').value))/86400000) === 6);
  store.db().audit = fixture; reset(); change('page-size','25');
  let download = null;
  w.HRCUI.download = (name, body) => { download = {name,body}; };
  doc.getElementById('btn-export-audit').click();
  check('التصدير يشمل جميع النتائج لا الصفحة فقط', download.body.split('\n').length === 126);
  change('entity','applicant'); doc.getElementById('btn-export-audit').click();
  check('التصدير يحترم فلاتر السجل', download.body.split('\n').length === 63 && !download.body.includes('تعديل وظيفة'));
  reset();
  // Export must read a pending search immediately, without waiting for debounce.
  fixture[0].details = '=HYPERLINK("evil")';
  field('q').value = 'HRC-1000'; field('q').dispatchEvent(new w.Event('input'));
  doc.getElementById('btn-export-audit').click();
  check('تصدير البحث فوراً قبل انتهاء التأخير', download.body.split('\n').length === 2 && download.body.includes('HRC-1000'));
  check('تعطيل صيغ الجداول وهروب علامات الاقتباس في CSV', download.body.includes("\"'=HYPERLINK(\"\"evil\"\")\""));
  check('التصدير لا يغيّر سجل التدقيق الأصلي', fixture[0].details === '=HYPERLINK("evil")');
  w.sessionStorage.setItem('hrc_session_v2', JSON.stringify({username:'worker',role:'staff',name:'أحمد',cloud:true}));
  check('الموظف لا يوسّع السجل إلى مستخدم آخر في طبقة البيانات', store.listAudit({user:'manager'}).length === 0);
  check('الموظف يرى سجلاته فقط حتى دون فلتر', store.listAudit({}).every((r) => r.user === 'worker'));
  reset(); doc.getElementById('btn-export-audit').click();
  check('التصفير والتصدير لا يتجاوزان نطاق الموظف', !download.body.includes('تعديل وظيفة') && field('user').value === 'worker');
  check('لا أخطاء JavaScript', errors.length === 0);
  console.log(`\nالنتيجة: ✅ ${pass} ناجح | 0 فاشل`);
} finally { dom.window.close(); }
