// Generates a clearly labelled, non-operational sample from the actual card template.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dom=new JSDOM('<html><head></head><body></body></html>',{runScripts:'outside-only'});
const w=dom.window;
w.eval(fs.readFileSync(root+'assets/js/config.js','utf8'));
w.eval(fs.readFileSync(root+'assets/js/qr.js','utf8'));
w.HRCUI={esc: s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
w.HRCStore={cardUrl:()=> 'https://babylonian-recruitment-company.pages.dev/apply?form=DEMO-ONLY',fmtDate:s=>s?String(s).slice(0,10):'—'};
w.eval(fs.readFileSync(root+'assets/js/voucher.js','utf8'));
const app={serial:'DEMO-ONLY',status:'blank',cardNumber:1};
const attempts=[{no:1,code:'1234-AB',slotStatus:'empty'},{no:2,code:'5678-CD',slotStatus:'empty'}];
const html=w.HRCVoucher.buildHtml(app,attempts);
const style=w.document.getElementById('hrc-card-style').textContent;
const sprite=fs.readFileSync(root+'src/partials/sprite.html','utf8');
fs.writeFileSync(root+'card-design.html',`<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>معاينة بطاقة التوظيف — منصة مكسب</title>
<link rel="stylesheet" href="assets/css/style.css">
<style>
body{background:#edf0f5;color:#14203a}.wallet-demo{max-width:1000px;margin:40px auto;padding:0 18px}.wallet-demo h1{font-size:1.6rem;margin:0 0 10px}.wallet-demo p{color:#5a6781}.wallet-demo .hrc-card-sheet{gap:24px;padding:30px 0}.wallet-demo-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.wallet-safety{padding:12px 16px;background:#fff3d2;border:1px solid #e4cb84;border-radius:12px;font-size:.85rem}.wallet-demo .hrc-card{box-shadow:0 16px 36px #10234230}
${style}
@media(max-width:390px){.wallet-demo{padding:0 8px}.wallet-demo .hrc-card-sheet{padding:20px 0}}
@media print{body>*{display:none!important}#print-root{display:block!important}}
</style></head><body>
${sprite}
<main class="wallet-demo"><h1>بطاقة التوظيف</h1><p>معاينة الوجهين — الطباعة بمقاس 59.4 × 94.6 مم على ورقتين A4 بالطول، وجه واحد في كل ورقة.</p>
<div class="wallet-safety">الرموز والباركود <b>تجريبية للمعاينة فقط</b>، ولا تصلح للتقديم أو البيع.</div>
${html}
<div class="wallet-demo-actions"><button class="btn btn-lapis" type="button" onclick="window.print()">طباعة معاينة على A4 بالطول</button><a class="btn btn-outline" href="/">العودة للموقع</a></div>
<p class="small">لأفضل نتيجة: اختر A4 بالطول والحجم الفعلي 100%، صفحتين، وفعّل طباعة الخلفيات. الوجه الأمامي في الصفحة الأولى والظهر في الثانية.</p></main>
<div id="print-root">${html}</div>
</body></html>`);
dom.window.close();
