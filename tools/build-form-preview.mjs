// Non-operational A4 sample generated from the actual protected reprint template.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const dom = new JSDOM('<html><head></head><body></body></html>', { runScripts: 'outside-only' });
const w = dom.window;
w.eval(read('assets/js/config.js'));
w.eval(read('assets/js/qr.js'));
const attempt = { no: 1, jobTitle: 'موظف مبيعات', jobCode: 'DEMO-JOB', location: 'بابل — الحلة', slotStatus: 'reserved', selectedAt: '2026-10-16T09:00:00Z', holdExpiresAt: '2026-10-17T09:00:00Z' };
const job = { title: attempt.jobTitle, region: attempt.location, salaryMin: 500000, salaryMax: 650000, shift: 'صباحي — 8 ساعات', employer: { name: 'جهة عمل تجريبية — للمعاينة فقط', phone: '07XX XXX XXXX', address: 'بابل — عنوان تجريبي' }, interviewLocation: 'مقر جهة العمل — مثال توضيحي' };
w.HRCStore = { getAttempts: () => [attempt, { no: 2, slotStatus: 'empty' }], getJob: () => job, cardUrl: () => 'https://example.invalid/DEMO-ONLY', formStatus: () => 'active', money: (n) => n.toLocaleString('ar-IQ') + ' د.ع', fmtDate: (s) => s ? s.slice(0, 10) : '—', fmtDateTime: () => '16 / 10 / 2026 — 12:00' };
w.eval(read('assets/js/voucher.js'));
const app = { serial: 'DEMO-ONLY', fullName: 'أحمد محمد علي — اسم تجريبي', phone: '07XX XXX XXXX', address: 'بابل — الحلة — عنوان تجريبي للمعاينة', gender: 'ذكر', dob: '1998-04-12', nationality: 'عراقي', issueDate: '2026-10-16', expiryDate: '2026-11-15', status: 'active', posName: 'نقطة بيع تجريبية' };
const html = w.HRCVoucher.formHtml(app, attempt);
const css = w.document.getElementById('hrc-form-style').textContent;
fs.writeFileSync(new URL('../form-design.html', import.meta.url), `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة استمارة التوظيف A4</title><link rel="stylesheet" href="assets/css/style.css"><style>
body{background:#e9edf3;margin:0;padding:24px 12px;color:#16294d;font-family:Cairo,'Segoe UI',sans-serif}.demo-toolbar{max-width:190mm;margin:0 auto 18px;padding:16px;box-sizing:border-box;background:#fff;border:1px solid #cbd4df;border-radius:10px}.demo-toolbar h1{font-size:20px;margin:0 0 8px}.demo-toolbar p{font-size:13px;line-height:1.7;margin:8px 0}.form-canvas{overflow:auto;padding-bottom:20px}.form-canvas .hrc-form{box-shadow:0 12px 36px #16294d24;flex-shrink:0}
${css}
@media print{@page{size:A4;margin:0}body{padding:0;background:white}.demo-toolbar{display:none}.form-canvas{overflow:visible;padding:0}.form-canvas .hrc-form{box-shadow:none}}
</style></head><body>${read('src/partials/sprite.html')}<header class="demo-toolbar"><h1>استمارة التوظيف — A4</h1><p>بيانات تجريبية للمعاينة فقط، وليست استمارة صالحة للتقديم. ثلاثة أقسام مستقلة: بيانات الزبون، تفاصيل الوظيفة، وبيانات صاحب العمل.</p><button class="btn btn-lapis" onclick="window.print()">طباعة المعاينة</button><p>الطباعة: ورق A4، الحجم الفعلي 100%. النص الطويل يتمدد ولا يُقص؛ راجع معاينة الطباعة قبل إصدار الاستمارة.</p></header><main class="form-canvas">${html}</main></body></html>`);
dom.window.close();
console.log('Generated form-design.html (demo data only).');
