/* بطاقة توظيف 86×54 مم: وجه للهوية والباركود، وظهر برمز تحقق واحد.
   لا بيانات زبون على البطاقة؛ الاستمارة A4 منفصلة. طباعة بالحجم الفعلي. */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG;
  var UI = root.HRCUI;
  var Store = root.HRCStore;

  var DISCLAIMER = 'ملاحظات مهمة: خدمات الشركة تنحصر في توفير الأيادي العاملة من الناحية الفنية والتخصصية فقط وليس الأمنية. ' +
    'الشركة غير مسؤولة قانونياً وعشائرياً عن الشخص المرسل وصاحب العمل.';

  var TERMS = [
    'بطاقة <b>شخصية</b> بـ<b>فرصتين مستقلتين</b>؛ صالحة <b>30 يوماً</b> من البيع.',
    'الحجز <b>24 ساعة</b>؛ بعدها تصبح الوظيفة حرجة وتقرر الشركة: توظيف أو إرجاع أو حذف.',
    'تُستهلك الفرصة بالتقديم <b>ولا تعود</b>؛ بعد استهلاك فرص البطاقة تُشترى بطاقة جديدة.',
    'المتابعة وإعادة الطباعة من «بطاقتي» أو <b>أي مكتب استنساخ</b>.'
  ];

  /* ======================= الأنماط (تُحقن مرة واحدة) ======================= */
  var STYLE_ID = 'hrc-card-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.hrc-card{box-sizing:border-box;width:86mm;height:54mm;flex:0 0 auto;border-radius:3.5mm;position:relative;overflow:hidden;background:radial-gradient(120% 150% at 92% 8%,rgba(200,162,74,.20) 0%,rgba(200,162,74,0) 46%),radial-gradient(100% 130% at 4% 96%,rgba(31,143,150,.18) 0%,rgba(31,143,150,0) 52%),linear-gradient(128deg,#16345f 0%,#0b1a35 42%,#07101f 100%);box-shadow:0 12px 32px rgba(6,13,31,.30),0 1px 0 rgba(255,255,255,.06) inset;color:#fff;display:flex;flex-direction:column;padding:3mm 3.6mm;font-family:Cairo,'Segoe UI',Tahoma,sans-serif;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.hrc-card *{box-sizing:border-box;}
.hrc-card .frame{position:absolute;inset:1.4mm;border:.28mm solid #cfa958;border-radius:2.6mm;pointer-events:none;box-shadow:inset 0 0 0 .55mm rgba(6,13,31,1),inset 0 0 0 .78mm rgba(207,169,88,.45);}
.hc-glow{position:absolute;inset:-30% -20% auto auto;width:60mm;height:60mm;border-radius:50%;background:radial-gradient(circle,rgba(232,208,137,.22),rgba(232,208,137,0) 62%);pointer-events:none;}.hc-guilloche{position:absolute;inset:0;pointer-events:none;opacity:.10;background-image:radial-gradient(circle at 50% 50%,rgba(232,208,137,.55) 0 .18mm,transparent .18mm 1.6mm),linear-gradient(115deg,transparent 47.6%,rgba(232,208,137,.35) 48%,rgba(232,208,137,.35) 48.4%,transparent 48.8%);background-size:3.2mm 3.2mm,100% 100%;}.hc-holo{position:absolute;inset-inline-start:2.2mm;inset-block-end:5.6mm;width:7mm;height:7mm;border-radius:50%;pointer-events:none;background:conic-gradient(from 210deg,#e8d089,#8fd3cf,#c8a24a,#e8d089);opacity:.75;box-shadow:0 0 0 .25mm rgba(255,255,255,.35) inset;filter:saturate(.9);}.hc-ribbon{position:absolute;inset-block-start:1.4mm;inset-inline-end:30mm;z-index:2;background:linear-gradient(180deg,rgba(232,208,137,.96),rgba(200,162,74,.96));color:#1c1405;font-size:2.6pt;font-weight:900;letter-spacing:.04em;padding:.55mm 1.6mm;border-radius:.8mm;box-shadow:0 .2mm .6mm rgba(0,0,0,.25);}.hc-top{display:flex;align-items:center;justify-content:space-between;gap:2mm;border-bottom:.2mm solid #826b3f;padding-bottom:1.7mm;position:relative;z-index:1;}
.hc-top .brand{display:flex;align-items:center;gap:1.8mm;min-width:0;}
.hc-top .embl{width:8mm;height:8mm;flex:none;color:#e8cc86;}
.hc-top .ar{font-size:7pt;font-weight:900;line-height:1.5;color:#f2d58d;}
.hc-top .en{font-size:3.5pt;color:#d8e1ef;direction:ltr;line-height:1.7;}
.hc-ctype{text-align:left;flex:none;}
.hc-ctype .t1{display:block;font-size:5.5pt;font-weight:900;color:#f2d58d;}
.hc-ctype .t2{display:block;font-size:3pt;color:#d8e1ef;letter-spacing:.06em;direction:ltr;}
.hc-identity{display:grid;grid-template-columns:minmax(0,1fr) 23mm;gap:3mm;align-items:center;flex:1;padding:1.7mm 0;}
.hc-identity-copy{min-width:0;}
.hc-identity .lbl{font-size:4pt;line-height:1.5;color:#d8e1ef;}
.hc-serial{display:block;direction:ltr;text-align:right;white-space:nowrap;font-family:'Courier New',monospace;font-size:11pt;font-weight:900;letter-spacing:.09em;color:#ffe6a6;margin:1mm 0;line-height:1.35;text-shadow:0 0 .5mm rgba(232,208,137,.45);}
.hc-count{font-size:5.5pt;font-weight:700;line-height:1.5;}
.hc-identity .hint{font-size:4pt;line-height:1.65;color:#d8e1ef;margin:.6mm 0 0;}
.hc-qr{display:flex;flex-direction:column;align-items:center;gap:.5mm;}
.hc-qr .box{width:23mm;height:23mm;background:#fff;border-radius:1.6mm;padding:.5mm;border:.3mm solid #e1c16b;box-shadow:0 0 0 .6mm rgba(6,13,31,.55);}
.hrc-qr-slot svg{width:100%;height:100%;display:block;}
.hc-qr .caption{font-size:4pt;line-height:1.3;color:#f2d58d;}
.hc-dates{display:grid;grid-template-columns:1fr 1fr;border-top:.2mm solid #826b3f;padding-top:1mm;gap:3mm;}
.hc-date{display:flex;align-items:center;justify-content:space-between;gap:1mm;font-size:4.5pt;line-height:1.6;color:#d8e1ef;}
.hc-date b{font-family:'Courier New',monospace;font-size:5.5pt;direction:ltr;color:#fff;}
.hc-back-head{display:flex;align-items:center;justify-content:space-between;gap:2mm;padding-bottom:1mm;}
.hc-back-head b{font-size:6.5pt;color:#f2d58d;}
.hc-back-head span{font-size:3.8pt;color:#d8e1ef;}
.hc-codes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm;}
.hc-codebox{border:.2mm solid #e1c16b;border-radius:1.8mm;padding:.9mm 1.2mm;background:#f7f0df;color:#14203a;text-align:center;}
.hc-codebox .clbl{font-size:4.5pt;font-weight:700;line-height:1.4;}
.hc-codebox .code{font-family:'Courier New',monospace;font-size:10pt;font-weight:900;letter-spacing:.03em;direction:ltr;line-height:1.4;}
.hc-codes.single{grid-template-columns:1fr;}
.hc-codes.many{grid-template-columns:repeat(3,minmax(0,1fr));gap:.8mm;}
.hc-codes.many .hc-codebox{padding:.5mm;}
.hc-codes.many .code{font-size:7pt;letter-spacing:0;}
.hc-codes.many .clbl{font-size:3.5pt;}
.hc-codes.dense{grid-template-columns:repeat(5,minmax(0,1fr));}
.hc-codes.dense .code{font-size:5.7pt;}
.hc-terms{list-style:none;padding:0;margin:1.4mm 0;display:grid;gap:.5mm;}
.hc-terms li{font-size:4pt;line-height:1.65;padding-inline-start:2mm;position:relative;}
.hc-terms li:before{content:'•';position:absolute;inset-inline-start:0;color:#f2d58d;}
.hc-terms b{color:#f2d58d;font-weight:700;}
.hc-bot2{margin-top:auto;border-top:.2mm solid #826b3f;padding-top:.8mm;}
.hc-contact{display:flex;justify-content:space-between;align-items:center;gap:1mm;}
.hc-contact .phones{font-family:'Courier New',monospace;direction:ltr;white-space:nowrap;font-size:6pt;font-weight:700;color:#f2d58d;}
.hc-contact .addr{font-size:3.8pt;color:#d8e1ef;}
.hc-bot2 .disc{font-size:3.8pt;line-height:1.6;color:#e2e8f2;margin-top:.8mm;}
/* Babylonian Mكسَب card style: landscape, deep navy + warm ivory + gold. */
.hrc-card{width:86mm;height:54mm;border-radius:3mm;padding:2.3mm 3mm;background:#f5f1e5;color:#112b49;box-shadow:0 12px 30px #07162935;}
.hrc-card .frame{inset:1.4mm;border:.35mm solid #d6a92e;border-radius:3mm;box-shadow:none;}
.hc-glow,.hc-guilloche,.hc-holo,.hc-ribbon{display:none!important;}
.hrc-card[aria-label*=الأمامي]{background:linear-gradient(to bottom,#062d50 0%,#06385a 42%,#f5f1e5 42%,#f5f1e5 100%);}
.hrc-card[aria-label*=الأمامي]:before{content:'';position:absolute;top:35%;left:-10%;width:120%;height:14%;background:#f5f1e5;border-top:1.5mm solid #dfb536;border-radius:0 0 50% 50%;z-index:0;}
.hc-top{position:relative;z-index:1;border:0;padding:4mm 1mm 0;justify-content:center;}
.hc-top .brand{gap:2mm}.hc-top .embl{width:13mm;height:13mm;color:#f0c32b;}
.hc-top .ar{font-size:14pt;color:#fff}.hc-top .en{font-size:6pt;color:#e9eef2;}
.hc-ctype{display:none!important;}
.hc-identity{position:relative;z-index:1;display:flex;flex-direction:column-reverse;gap:3mm;justify-content:center;flex:1;padding:0;}
.hc-identity-copy{text-align:center;color:#102c4a;}
.hc-identity .lbl{font-size:8pt;color:#173556;}.hc-serial{font-size:12pt;text-align:center;color:#173556;margin:1mm 0;}
.hc-count{font-size:10pt}.hc-identity .hint{font-size:7pt;color:#304762;}
.hc-qr .box{width:46mm;height:46mm;padding:1.5mm;border:1mm solid #d5aa2c;border-radius:3mm;box-shadow:0 2mm 5mm #07162924;}
.hc-qr .caption{font-size:8pt;color:#fff;background:#062f53;padding:2mm 5mm;border-radius:3mm;width:100%;text-align:center;}
.hc-dates{display:none!important;}
.hrc-card[aria-label*=الخلفي]{background:#f5f1e5;color:#173556;padding-top:8mm;}
.hc-back-head{border-bottom:.3mm solid #183959;padding:3mm 1mm 2mm;margin-bottom:3mm;}
.hc-back-head b{font-size:13pt;color:#123555;}.hc-back-head span{font-size:7pt;color:#36516c;}
.hc-terms{gap:3mm;margin:4mm 0;}.hc-terms li{font-size:8pt;line-height:1.7;padding-inline-start:5mm;color:#173556;}
.hc-terms li:before{color:#d4a72d;font-size:12pt}.hc-terms b{color:#173556;}
.hc-bot2{border:0;margin-top:auto;background:#0a3558;color:white;border-radius:3mm;padding:3mm;}
.hc-contact{flex-direction:column;gap:1mm}.hc-contact .phones{font-size:10pt;color:white}.hc-contact .addr{font-size:7pt;color:white;}
.hc-bot2 .disc{font-size:6.5pt;line-height:1.65;color:#fff;margin-top:2mm;}
.hc-slogan{position:relative;z-index:1;text-align:center;margin:4mm 0 0;color:#f2c53d;font-size:19pt;font-weight:900;line-height:1.3;}
.hc-identity{gap:2mm;}
.hc-identity-copy{width:100%;}
.hc-identity .lbl{font-size:7pt;}
.hc-serial{font-size:11pt;}
.hc-count{font-size:9pt;}
.hc-identity .hint{font-size:6.5pt;}
.hc-qr .caption{font-weight:800;font-size:8pt;padding:2.5mm 3mm;}
.hc-steps{position:relative;z-index:1;display:flex;justify-content:center;align-items:center;gap:3mm;color:#102f50;font-weight:900;font-size:8pt;padding:2mm 0;}
.hc-steps i{font-size:15pt;font-style:normal;color:#d4a72d;}
.hc-front-contact{position:relative;z-index:1;display:flex;justify-content:center;align-items:center;gap:3mm;border-top:.3mm solid #d6b64d;padding-top:2mm;color:#123555;font-size:7pt;}
.hc-front-contact b{font-family:'Courier New',monospace;direction:ltr;font-size:9pt;}
.hc-dates{position:relative;z-index:1;display:grid!important;grid-template-columns:1fr 1fr;border-top:.3mm solid #d6b64d;padding-top:1.5mm;gap:2mm;margin-top:1mm;}
.hc-date{font-size:6pt;color:#173556;}.hc-date b{font-family:inherit;font-size:6pt;color:#173556;}
.hrc-card[aria-label*=الأمامي]{background:linear-gradient(to bottom,#062d50 0%,#06385a 47%,#f5f1e5 47%,#f5f1e5 100%);}
.hrc-card[aria-label*=الأمامي]:before{top:39%;height:17%;border-top-width:.9mm;}
.hc-top{padding:0 1mm 1mm;justify-content:space-between;border-bottom:0;}
.hc-top .embl{width:9mm;height:9mm;}.hc-top .ar{font-size:9pt}.hc-top .en{font-size:4pt;}
.hc-slogan{font-size:12pt;margin:0 0 1mm;}
.hc-identity{display:grid;grid-template-columns:minmax(0,1fr) 27mm;gap:2mm;align-items:center;flex:1;padding:0;}
.hc-identity-copy{text-align:right;}.hc-identity .lbl{font-size:5pt;color:#173556;}.hc-serial{font-size:8pt;text-align:center;margin:.5mm 0;}
.hc-count{font-size:6pt}.hc-identity .hint{font-size:4.5pt;margin:0;}
.hc-qr .box{width:25mm;height:25mm;padding:.6mm;}.hc-qr .caption{font-size:4.5pt;padding:.8mm 1mm;}
.hc-steps{font-size:5pt;gap:1.5mm;padding:.5mm 0}.hc-steps i{font-size:9pt;}
.hc-front-contact{gap:1.5mm;padding-top:.7mm;font-size:4.5pt}.hc-front-contact b{font-size:6pt;}
.hc-dates{padding-top:.5mm;margin-top:.3mm;gap:1mm}.hc-date{font-size:4pt}.hc-date b{font-size:4pt;}
.hrc-card[aria-label*=الخلفي]{padding:3mm 4mm;}
.hc-back-head{padding:0 0 1mm;margin-bottom:1mm}.hc-back-head b{font-size:7.5pt}.hc-back-head span{font-size:4.5pt;}
.hc-terms{gap:.8mm;margin:1mm 0}.hc-terms li{font-size:5pt;line-height:1.5;padding-inline-start:3mm}.hc-terms li:before{font-size:7pt;}
.hc-bot2{padding:1mm 2mm;border-radius:1.5mm}.hc-contact{flex-direction:row;gap:1mm}.hc-contact .phones{font-size:6pt}.hc-contact .addr{font-size:4.5pt;}.hc-bot2 .disc{font-size:4pt;line-height:1.4;margin-top:.5mm;}
/* Final landscape composition: same two printed sides, styled after the supplied reference. */
.hrc-card{width:86mm;height:54mm;min-height:54mm;max-height:54mm;padding:2mm 2.8mm;border-radius:3mm;background:#f5f1e5;color:#102e4e;}
.hrc-card .frame{inset:1.1mm;border:.3mm solid #d4aa32;border-radius:2.5mm;z-index:5;pointer-events:none;}
.hrc-card[aria-label*=الأمامي]{background:linear-gradient(180deg,#062e51 0%,#06395c 46%,#f5f1e5 46%,#f5f1e5 100%);}
.hrc-card[aria-label*=الأمامي]:before{content:'';position:absolute;top:37%;left:-9%;width:118%;height:18%;z-index:0;background:#f5f1e5;border-top:1mm solid #e2b632;border-radius:0 0 50% 50%;}
.hc-top{position:relative;z-index:1;flex:0 0 auto;min-height:8mm;padding:0 1mm .5mm;justify-content:space-between;border:0;}
.hc-top .brand{gap:1.5mm}.hc-top .embl{width:8mm;height:8mm;color:#f4c735;}
.hc-top .ar{font-size:8pt;line-height:1.2;color:#fff}.hc-top .en{font-size:3.5pt;color:#e3edf4;}
.hc-ctype{display:block;text-align:left}.hc-ctype .t1{font-size:5pt;color:#fff}.hc-ctype .t2{font-size:3pt;color:#dbe5eb;}
.hc-slogan{position:relative;z-index:1;flex:0 0 auto;margin:0;text-align:center;font-size:12pt;line-height:1.2;color:#f4c43b;text-shadow:0 .3mm #082742;}
.hc-identity{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) 24mm;gap:2mm;align-items:center;flex:1;min-height:0;padding:0 1mm;}
.hc-identity-copy{width:auto;min-width:0;text-align:right;color:#102e4e;}
.hc-identity .lbl{font-size:4.5pt;line-height:1.3;color:#183958;}.hc-serial{font-size:8pt;line-height:1.2;margin:.4mm 0;text-align:center;color:#113455;}
.hc-count{font-size:5.3pt;line-height:1.3;color:#173754}.hc-identity .hint{font-size:4pt;line-height:1.3;margin:.4mm 0 0;color:#344f65;}
.hc-qr{gap:.4mm}.hc-qr .box{width:22mm;height:22mm;padding:.5mm;border: .7mm solid #d7aa2e;border-radius:2mm;box-shadow:0 1mm 2mm #102e4e28;}
.hc-qr .caption{width:100%;padding:.6mm 1mm;background:#073656;color:#fff;border-radius:1.4mm;text-align:center;font-size:4pt;line-height:1.2;font-weight:800;}
.hc-steps{position:relative;z-index:1;flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:1.5mm;padding:.5mm 0 0;color:#102e4e;font-size:4.5pt;font-weight:900;}
.hc-steps i{font-size:8pt;font-style:normal;color:#d1a52b;line-height:1;}
.hc-front-contact{position:relative;z-index:1;flex:0 0 auto;display:flex;justify-content:center;align-items:center;gap:1.5mm;padding:.4mm 0 0;border-top:.2mm solid #d3ad3d;color:#153b5c;font-size:4pt;line-height:1.2;}
.hc-front-contact b{font:700 5.5pt 'Courier New',monospace;direction:ltr;}
.hc-dates{position:relative;z-index:1;display:grid!important;grid-template-columns:1fr 1fr;gap:1mm;margin:0;padding:.4mm 1mm 0;border-top:.2mm solid #d3ad3d;}
.hc-date{font-size:3.7pt;line-height:1.2;color:#1c3d5b}.hc-date b{font:700 4pt inherit;color:#153754;}
.hrc-card[aria-label*=الخلفي]{display:flex;flex-direction:column;padding:2.5mm 3mm;background:#f5f1e5;color:#123555;}
.hc-back-head{position:relative;flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:1mm;padding:0 0 1mm;margin:0 0 1mm;border-bottom:.35mm solid #193c5b;}
.hc-back-head:before{content:'معلومات مهمة';order:2;background:#0b3658;color:#fff;border-radius:4mm;padding:.8mm 2mm;font-size:6pt;font-weight:900;}
.hc-back-head b{font-size:6pt;color:#153957}.hc-back-head span{font-size:3.7pt;color:#415970;}
.hc-terms{position:relative;flex:1;align-content:center;gap:1.1mm;margin:0;padding:0 1mm;}
.hc-terms li{font-size:4.4pt;line-height:1.45;padding-inline-start:4mm;color:#183957;}
.hc-terms li:before{content:'✓';inset-inline-start:0;width:3mm;height:3mm;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#e3b637;color:#123555;font-size:4pt;font-weight:900;}
.hc-terms b{color:#123555;}
.hc-bot2{position:relative;flex:0 0 auto;margin:0;padding:1.1mm 2mm .9mm;border:0;border-radius:2mm;background:#0a3558;color:#fff;}
.hc-contact{flex-direction:row;justify-content:space-between;gap:1mm}.hc-contact .phones{font-size:5.3pt;color:#fff}.hc-contact .addr{font-size:3.8pt;color:#f3f0e6;}
.hc-bot2 .disc{margin-top:.5mm;font-size:3.4pt;line-height:1.3;color:#fff;}
@media print{@page{size:86mm 54mm;margin:0;}#print-root .hrc-card{width:86mm;height:54mm;min-height:54mm;max-height:54mm;border-radius:0;}}
`
      /* معاينة داخل نافذة */
      + '.hrc-card-sheet{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;background:transparent;padding:6px;}'
      /* الطباعة: صفحتان 86×54مم */
      + '@media print{'
      +   '@page{size:86mm 54mm;margin:0;}'
      +   'html,body{background:#fff !important;padding:0 !important;margin:0 !important;}'
      +   '#print-root{display:block !important;position:static !important;width:auto !important;}'
      +   '#print-root .hrc-card{box-shadow:none !important;margin:0 !important;page-break-after:always;break-after:page;border-radius:3.5mm;}'
      +   '#print-root .hrc-card:last-child{page-break-after:auto;break-after:auto;}'
      +   '#print-root .hrc-card-sheet{display:block !important;padding:0 !important;}'
      + '}';
    document.head.appendChild(st);
  }

  /* ======================= أدوات ======================= */
  function qrSvg(text, size) {
    try {
      var model = root.HRCQR.encode(text, 'M');
      return root.HRCQR.renderSVG(model, { margin: 4, size: size || 132, dark: '#0b1a3a', light: '#ffffff' });
    } catch (e) {
      return '<div class="tiny">تعذّر توليد الكيو آر كود</div>';
    }
  }

  function esc(v) { return UI ? UI.esc(String(v == null ? '' : v)) : String(v == null ? '' : v); }


  /* الوجه الأمامي بلا بيانات شخصية؛ الصلاحية تبدأ عند البيع. */
  function isBlank(app) {
    /* البطاقة لا تحمل بيانات زبون أبداً (قرار 2026-10-01): «فارغة» تعني
       لم تُبع ولم تُفعّل بعد — البيانات تعيش على استمارة A4 بنفس الباركود. */
    return !app || app.status === 'blank';
  }

  function frontHtml(app, attempts) {
    var blank = isBlank(app);
    var count = attempts.length === 2 ? 'فرصتان مستقلتان' : attempts.length + ' فرص مستقلة';
    return '<div class="hrc-card" aria-label="الوجه الأمامي لبطاقة التوظيف">' +
      /* طبقات الزخرفة: وهج ذهبي + نقش إرشادي + لمعة هولوغرام (تُطبع كخلفية فقط) */
      '<span class="hc-glow" aria-hidden="true"></span>' +
      '<span class="hc-guilloche" aria-hidden="true"></span>' +
      '<span class="hc-holo" aria-hidden="true"></span>' +
      '<div class="frame"></div>' +
      '<span class="hc-ribbon" aria-hidden="true">بطاقة توظيف معتمدة</span>' +
      '<div class="hc-top"><div class="brand">' +
      '<svg class="embl" viewBox="0 0 120 120"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>' +
      '<div><div class="ar">' + esc(CFG.company.nameAr) + '</div><div class="en">' + esc(CFG.company.nameEn) + '</div></div></div>' +
      '<div class="hc-ctype"><span class="t1">بطاقة توظيف</span><span class="t2">EMPLOYMENT CARD</span></div></div>' +
      '<div class="hc-slogan">فرصتك تبدأ من هنا</div>' +
      '<div class="hc-identity"><div class="hc-identity-copy"><div class="lbl">بطاقة الزبون — هوية الباركود</div>' +
      '<b class="hc-serial">' + esc(app.serial) + '</b><div class="hc-count">' + esc(count) + '</div>' +
      '<p class="hint">' + (blank ? 'تُفعّل عند البيع؛ الصلاحية تبدأ من التعبئة.' : 'بيانات الزبون على استمارة A4 بنفس الباركود.') + '</p></div>' +
      '<div class="hc-qr"><div class="box hrc-qr-slot">' + qrSvg(Store.cardUrl(app.serial), 200) + '</div>' +
      '<span class="caption">امسح لفتح «بطاقتي»</span></div></div>' +
      '<div class="hc-steps"><span>امسح</span><i>›</i><span>سجّل</span><i>›</i><span>اختر وظيفتك</span></div>' +
      '<div class="hc-front-contact"><span>خدمة العملاء</span><b>' + esc(CFG.company.phones[0] || '') + '</b></div>' +
      '<div class="hc-dates"><div class="hc-date"><span>الإصدار</span><b>' + (blank ? 'عند البيع' : esc(Store.fmtDate(app.issueDate))) + '</b></div>' +
      '<div class="hc-date"><span>الصلاحية</span><b>' + (blank ? '30 يوماً من البيع' : esc(Store.fmtDate(app.expiryDate))) + '</b></div></div></div>';
  }

  function independentBackHtml(app, attempts) {
    // Legacy cards print one of their existing codes; both old codes still verify.
    var secret = app.cardPrintCode || (attempts[0] && attempts[0].code) || '';
    var printed = app.cardPrintCode ? secret.match(/.{1,4}/g).join('-') : secret;
    return '<div class="hrc-card" aria-label="الوجه الخلفي لبطاقة التوظيف">' +
      '<span class="hc-glow" aria-hidden="true"></span><span class="hc-guilloche" aria-hidden="true"></span>' +
      '<div class="frame"></div>' +
      '<div class="hc-back-head"><b>رمز التحقق من البطاقة</b><span>خاص بإعادة الطباعة</span></div>' +
      '<div class="hc-codes single"><div class="hc-codebox"><div class="clbl">احتفظ بهذا الرمز ولا تشاركه</div>' +
      '<div class="code">' + esc(printed || 'راجع الإدارة قبل الطباعة') + '</div></div></div>' +
      '<ul class="hc-terms">' + TERMS.map(function (n) {
        return '<li>' + (attempts.length === 2 ? n : n.replace('فرصتين مستقلتين', attempts.length + ' فرص مستقلة').replace('بعد الفرصتين', 'بعد استهلاك فرص البطاقة')) + '</li>';
      }).join('') + '</ul>' +
      '<div class="hc-bot2"><div class="hc-contact"><span class="phones">' + esc(CFG.company.phones.join(' · ')) + '</span>' +
      '<span class="addr">' + esc(CFG.company.addressShort) + '</span></div><div class="disc">' + esc(DISCLAIMER) + '</div></div></div>';
  }

  /* ظهر البطاقة بلا أي رموز فرص (قرار 2026-10-25): الشروط والتواصل فقط.
     البطاقة نفسها بباركودها هي إثبات الحيازة عند التقديم. */
  function backHtml(app, attempts) {
    if (app.cardPrintCode) return independentBackHtml(app, attempts);
    return '<div class="hrc-card" aria-label="الوجه الخلفي لبطاقة التوظيف">' +
      '<span class="hc-glow" aria-hidden="true"></span><span class="hc-guilloche" aria-hidden="true"></span>' +
      '<div class="frame"></div>' +
      '<div class="hc-back-head"><b>شروط استخدام البطاقة</b><span>لا تحتاج أي رمز — باركود البطاقة يكفي</span></div>' +
      '<ul class="hc-terms">' + TERMS.map(function (n) {
        return '<li>' + (attempts.length === 2 ? n : n.replace('فرصتين مستقلتين', attempts.length + ' فرص مستقلة').replace('بعد الفرصتين', 'بعد استهلاك فرص البطاقة')) + '</li>';
      }).join('') + '</ul>' +
      '<div class="hc-bot2"><div class="hc-contact"><span class="phones">' + esc(CFG.company.phones.join(' · ')) + '</span>' +
      '<span class="addr">' + esc(CFG.company.addressShort) + '</span></div><div class="disc">' + esc(DISCLAIMER) + '</div></div></div>';
  }

  /* ==========================================================================
   *  استمارة التوظيف A4 — الوثيقة التي تحمل بيانات الزبون والوظيفة المطلوبة
   *  (قرار الإدارة 2026-10-01: البطاقة تبقى بورقتها العامة، والبيانات هنا).
   *  تحمل نفس باركود البطاقة — يمسحها صاحب العمل فيرى المتقدم ويقرر التوظيف.
   *  ========================================================================== */
  function ensureFormStyle() {
    if (document.getElementById('hrc-form-style')) return;
    var st = document.createElement('style');
    st.id = 'hrc-form-style';
    st.textContent = ''
      + '.hrc-form{width:190mm;min-height:273mm;margin:0 auto;background:#fff;color:#231a06;'
      +   'font-family:\'Cairo\',\'Segoe UI\',Tahoma,sans-serif;direction:rtl;position:relative;'
      +   'display:flex;flex-direction:column;padding:9mm 10mm;box-sizing:border-box;}'
      + '.hrc-form .ff-head{display:flex;justify-content:space-between;align-items:center;gap:8mm;'
      +   'border-bottom:.7mm solid #16294d;padding-bottom:4mm;}'
      + '.hrc-form .ff-brand{display:flex;align-items:center;gap:4mm;}'
      + '.hrc-form .ff-brand svg{width:15mm;height:15mm;}'
      + '.hrc-form .ff-brand .ar{font-size:15pt;font-weight:900;color:#16294d;line-height:1.3;}'
      + '.hrc-form .ff-brand .en{font-size:7pt;font-weight:700;color:#8d7c50;letter-spacing:.12em;direction:ltr;}'
      + '.hrc-form .ff-title{text-align:left;}'
      + '.hrc-form .ff-title .t1{font-size:16pt;font-weight:900;color:#a8781a;}'
      + '.hrc-form .ff-title .t2{font-size:7pt;font-weight:700;color:#8d7c50;letter-spacing:.22em;direction:ltr;}'
      + '.hrc-form .ff-meta{display:flex;gap:6mm;align-items:flex-start;margin-top:5mm;}'
      + '.hrc-form .ff-qr{display:flex;flex-direction:column;align-items:center;gap:1.5mm;}'
      + '.hrc-form .ff-qr .box{padding:1.5mm;border:.4mm solid #16294d;border-radius:2mm;background:#fff;}'
      + '.hrc-form .ff-qr .cap{font-size:8pt;font-weight:900;color:#16294d;direction:ltr;letter-spacing:.04em;}'
      + '.hrc-form .ff-fields{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:2mm 5mm;align-content:start;}'
      + '.hrc-form .ff-f{border-bottom:.25mm dotted #b9a87e;padding-bottom:1mm;}'
      + '.hrc-form .ff-f .k{font-size:7.5pt;font-weight:700;color:#8d7c50;}'
      + '.hrc-form .ff-f .v{font-size:11pt;font-weight:800;color:#16294d;}'
      + '.hrc-form h3{font-size:11pt;font-weight:900;color:#16294d;margin:5mm 0 2mm;'
      +   'display:flex;align-items:center;gap:2mm;}'
      + '.hrc-form h3::before{content:\'\';width:1.8mm;height:5mm;background:#c8a24a;border-radius:1mm;}'
      + '.hrc-form .ff-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2mm 4mm;}'
      + '.hrc-form .ff-emp{margin-top:2.5mm;border:.35mm solid #c8a24a;border-radius:2.5mm;'
      +   'background:#fdf9ee;padding:3mm 4mm;display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 4mm;}'
      + '.hrc-form .ff-note{margin-top:2.5mm;border:.35mm dashed #8d7c50;border-radius:2.5mm;'
      +   'padding:3mm 4mm;font-size:9pt;color:#5a4a22;line-height:1.9;}'
      + '.hrc-form ul.ff-terms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.2mm;}'
      + '.hrc-form ul.ff-terms li{font-size:8.5pt;line-height:1.8;color:#3a2f14;padding-inline-start:5mm;position:relative;}'
      + '.hrc-form ul.ff-terms li::before{content:\'★\';position:absolute;inset-inline-start:0;color:#c8a24a;}'
      + '.hrc-form .ff-employer-box{margin-top:2.5mm;background:#16294d;color:#f4efe2;border-radius:3mm;padding:4mm 5mm;}'
      + '.hrc-form .ff-employer-box h4{margin:0 0 2mm;font-size:11pt;color:#e8d089;}'
      + '.hrc-form .ff-employer-box ol{margin:0;padding-inline-start:6mm;font-size:9pt;line-height:2;}'
      + '.hrc-form .ff-sign{display:flex;justify-content:space-between;gap:10mm;margin-top:7mm;}'
      + '.hrc-form .ff-sign .s{flex:1;text-align:center;font-size:9pt;font-weight:700;color:#16294d;}'
      + '.hrc-form .ff-sign .l{border-bottom:.3mm dotted #8d7c50;height:11mm;margin-bottom:1.5mm;}'
      + '.hrc-form .ff-foot{margin-top:auto;border-top:.5mm solid #16294d;padding-top:2.5mm;'
      +   'font-size:7.5pt;color:#6b5320;text-align:center;line-height:1.8;}'
      /* الطباعة: A4 بلا هوامش (الحاوية تتكفل بالهوامش الداخلية) */
      + '@media print{'
      +   '.hrc-form{width:auto;min-height:auto;box-shadow:none;}'
      +   '.hrc-form, .hrc-form *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}'
      + '}';

    st.textContent += `
.hrc-form{color:#17263b;padding:7mm 9mm;line-height:1.5;}
.hrc-form,.hrc-form *{box-sizing:border-box;}
.hrc-form .ff-head{gap:4mm;padding-bottom:3mm;}
.hrc-form .ff-brand .ar{font-size:14pt;}
.hrc-form .ff-title .t1{font-size:15pt;}
.hrc-form .ff-meta{gap:5mm;margin:3mm 0 1mm;align-items:center;}
.hrc-form .ff-meta .ff-f{padding:0 0 1mm;border-bottom:.2mm solid #dce2e9;background:none;}
.hrc-form .ff-qr .box svg{display:block;width:23mm;height:23mm;}
.hrc-form .ff-fields{gap:1.5mm 4mm;}
.hrc-form .ff-section{margin-top:3mm;border:.3mm solid #cbd4df;border-radius:2mm;overflow:hidden;break-inside:avoid;page-break-inside:avoid;}
.hrc-form .ff-section h3{margin:0;padding:1.7mm 3mm;background:#eef2f7;border-bottom:.25mm solid #cbd4df;color:#16294d;font-size:11pt;line-height:1.4;gap:2mm;}
.hrc-form .ff-section h3::before{display:none;}
.hrc-form .ff-section-no{display:inline-flex;align-items:center;justify-content:center;width:6mm;height:6mm;border:.25mm solid currentColor;border-radius:1mm;font:700 8pt 'Segoe UI',sans-serif;direction:ltr;flex:none;}
.hrc-form .ff-customer{border-inline-start:1mm solid #16294d;}
.hrc-form .ff-job{border-inline-start:1mm solid #ac7d27;}
.hrc-form .ff-job h3{background:#faf5e9;}
.hrc-form .ff-employer{border-inline-start:1mm solid #356b6a;}
.hrc-form .ff-employer h3{background:#edf5f3;color:#254f50;}
.hrc-form .ff-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:0;padding:1mm 2mm;}
.hrc-form .ff-grid-two{grid-template-columns:repeat(2,minmax(0,1fr));}
.hrc-form .ff-section .ff-f{min-width:0;padding:1.3mm 2mm;border:0;border-bottom:.2mm solid #e4e8ed;}
.hrc-form .ff-f .k{font-size:7.2pt;font-weight:700;color:#596575;line-height:1.5;}
.hrc-form .ff-f .v{font-size:10pt;font-weight:800;color:#142640;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap;}
.hrc-form .ff-wide{grid-column:span 2;}
.hrc-form .ff-full{grid-column:1/-1;}
.hrc-form .ff-ltr .v{direction:ltr;unicode-bidi:isolate;text-align:right;font-family:'Segoe UI',Tahoma,sans-serif;font-variant-numeric:tabular-nums;}
.hrc-form .ff-empty{padding:3mm 4mm;color:#596575;font-size:9pt;}
.hrc-form .ff-note{padding:2mm 3mm;margin-top:2mm;font-size:8pt;line-height:1.7;background:#fffdf7;break-inside:avoid;}
.hrc-form h3{margin:3mm 0 1.5mm;font-size:10pt;}
.hrc-form ul.ff-terms{gap:.5mm;}
.hrc-form ul.ff-terms li{font-size:7.5pt;line-height:1.65;}
.hrc-form .ff-employer-box{padding:2.5mm 3.5mm;margin-top:2.5mm;background:#f4f6f9;color:#25364d;border:.25mm solid #cbd4df;border-radius:2mm;break-inside:avoid;}
.hrc-form .ff-employer-box h4{font-size:9pt;color:#16294d;margin:0 0 1mm;}
.hrc-form .ff-employer-box ol{font-size:7.5pt;line-height:1.7;}
.hrc-form .ff-sign{gap:7mm;margin:3mm 0;break-inside:avoid;}
.hrc-form .ff-sign .l{height:7mm;}
.hrc-form .ff-sign .s{font-size:8pt;}
.hrc-form .ff-foot{font-size:6.8pt;padding-top:2mm;line-height:1.6;}
@media print{.hrc-form{width:190mm;min-height:277mm;margin:0 auto;padding:6mm 8mm;}.hrc-form .ff-head,.hrc-form .ff-meta,.hrc-form .ff-foot{break-inside:avoid;}}
`;

    document.head.appendChild(st);
  }

  /* بناء الاستمارة — attempt اختيارية (التقديم الجاري أو آخر تقديم) */
  function formHtml(app, attempt, verifiedAttempts) {
    if (!app) return '<div class="hrc-form">لا توجد بيانات</div>';
    ensureFormStyle();
    var attempts = verifiedAttempts || Store.getAttempts(app.serial);
    if (!attempt) {
      /* أحدث تقديم قيد اللعب أولاً (هو المطبوع لصاحب العمل)، وإلا آخر فرصة مستخدمة */
      var inPlay = attempts.filter(function (t) {
        return t.slotStatus === 'reserved' || t.slotStatus === 'critical' || t.slotStatus === 'hiring';
      });
      inPlay.sort(function (a, b) {
        var da = new Date(a.selectedAt || 0).getTime(), db = new Date(b.selectedAt || 0).getTime();
        if (db !== da) return db - da;
        return (b.no || 0) - (a.no || 0);
      });
      attempt = inPlay[0] ||
        attempts.filter(function (t) { return t.slotStatus !== 'empty'; }).slice().sort(function (a, b) {
          return (b.no || 0) - (a.no || 0);
        })[0] || null;
    }
    var job = attempt && attempt.jobCode ? Store.getJob(attempt.jobCode) : null;
    var cUrl = Store.cardUrl(app.serial);
    var st = (CFG.formStatus || {})[formStatusOf(app)] || { ar: '—' };

    function field(label, value, extra) {
      return '<div class="ff-f' + (extra ? ' ' + extra : '') + '"><div class="k">' + esc(label) +
        '</div><div class="v">' + esc(value == null || value === '' ? '—' : value) + '</div></div>';
    }
    function section(kind, number, title, content) {
      return '<section class="ff-section ff-' + kind + '" aria-labelledby="ff-' + kind + '-title">' +
        '<h3 id="ff-' + kind + '-title"><span class="ff-section-no">' + number + '</span>' + title + '</h3>' + content + '</section>';
    }
    var employer = (job && job.employer) || {};
    var customer = section('customer', '01', 'بيانات الزبون', '<div class="ff-grid">' +
      field('الاسم الكامل', app.fullName, 'ff-wide') + field('رقم الهاتف', app.phone, 'ff-ltr') +
      field('عنوان السكن', app.address, 'ff-full') + field('الجنس', app.gender) +
      field('تاريخ الميلاد', app.dob ? Store.fmtDate(app.dob) : '') + field('الجنسية', app.nationality) + '</div>');
    var jobDetails = section('job', '02', 'تفاصيل الوظيفة', attempt ? '<div class="ff-grid">' +
      field('الوظيفة المطلوبة', attempt.jobTitle || (job && job.title), 'ff-wide') + field('كود الوظيفة', attempt.jobCode, 'ff-ltr') +
      field('المحافظة', (job && job.governorate) || attempt.governorate || '—') +
      field('الأجر الشهري', job ? Store.money(job.salaryMin) + ' – ' + Store.money(job.salaryMax) : '') +
      field('الدوام', job && job.shift) + field('حالة التقديم', slotText(attempt)) +
      field('تاريخ التقديم', attempt.selectedAt ? Store.fmtDateTime(attempt.selectedAt) : '', 'ff-wide') + '</div>' :
      '<div class="ff-empty">لم يُقدَّم على وظيفة بعد — فرص البطاقة متاحة من «بطاقتي» على الموقع أو عند أي نقطة بيع.</div>');
    var employerDetails = section('employer', '03', 'بيانات صاحب العمل', attempt ? '<div class="ff-grid ff-grid-two">' +
      field('اسم جهة العمل', attempt.employerName || employer.name) +
      field('هاتف جهة العمل', attempt.employerPhone || employer.phone, 'ff-ltr') +
      field('عنوان جهة العمل', employer.address) + field('مكان المقابلة', job && job.interviewLocation) + '</div>' :
      '<div class="ff-empty">تظهر بيانات جهة العمل بعد التقديم على وظيفة.</div>');
    var holdNote = attempt && attempt.holdExpiresAt && attempt.slotStatus === 'reserved'
      ? '<div class="ff-note">الحجز مؤقت <b>24 ساعة</b> من وقت التقديم (' + esc(Store.fmtDateTime(attempt.selectedAt)) +
        ') — يسجّل صاحب العمل قراره بمسح الباركود؛ وبعد المهلة تصبح الوظيفة حرجة وتقرر الشركة.</div>' : '';

    return ''
      + '<div class="hrc-form">'
      +   '<div class="ff-head">'
      +     '<div class="ff-brand">'
      +       '<svg viewBox="0 0 120 120"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>'
      +       '<div><div class="ar">' + esc(CFG.company.nameAr) + '</div>'
      +       '<div class="en">' + esc(CFG.company.nameEn) + '</div></div>'
      +     '</div>'
      +     '<div class="ff-title"><div class="t1">استمارة توظيف</div>'
      +       '<div class="t2">JOB APPLICATION FORM</div></div>'
      +   '</div>'
      +   '<div class="ff-meta">'
      +     '<div class="ff-qr"><div class="box">' + qrSvg(cUrl, 96) + '</div>'
      +       '<div class="cap">' + esc(app.serial) + '</div></div>'
      +     '<div class="ff-fields">'
      +       '<div class="ff-f"><div class="k">رقم البطاقة (الباركود)</div><div class="v mono" style="direction:ltr">' + esc(app.serial) + '</div></div>'
      +       '<div class="ff-f"><div class="k">حالة البطاقة</div><div class="v">' + esc(st.ar) + '</div></div>'
      +       '<div class="ff-f"><div class="k">تاريخ التفعيل</div><div class="v">' + esc(Store.fmtDate(app.issueDate)) + '</div></div>'
      +       '<div class="ff-f"><div class="k">تنتهي الصلاحية</div><div class="v">' + esc(Store.fmtDate(app.expiryDate)) + '</div></div>'
      +       (app.posName ? '<div class="ff-f" style="grid-column:1/-1"><div class="k">نقطة البيع</div><div class="v">' + esc(app.posName) + '</div></div>' : '')
      +     '</div>'
      +   '</div>'
      +   customer + jobDetails + employerDetails + holdNote
      +   '<h3>شروط البطاقة</h3>'
      +   '<ul class="ff-terms">' + TERMS.map(function (n) { return '<li>' + (attempts.length === 2 ? n : n.replace('فرصتين مستقلتين', attempts.length + ' فرص مستقلة').replace('بعد الفرصتين', 'بعد استهلاك فرص البطاقة')) + '</li>'; }).join('') + '</ul>'
      +   '<div class="ff-employer-box">'
      +     '<h4>✦ لصاحب العمل — كيف تُكمل التوظيف؟</h4>'
      +     '<ol>'
      +       '<li>امسح الباركود أعلاه بكاميرة أي موبايل — يفتح موقع الشركة ويظهر لك تعريف المتقدم وتفاصيله.</li>'
      +       '<li>اطلع على بيانات المتقدم وأجرِ المقابلة في المكان المحدد أعلاه.</li>'
      +       '<li>اضغط زر «تم التوظيف» أو «لم يتم التوظيف» من نفس الصفحة — يُسجَّل طلبك لدى الشركة وتبقى الوظيفة «جاري التوظيف» حتى يثبّت موظفو الشركة القرار أو يلغوه.</li>'
      +       '<li>إن لم يُسجَّل طلب خلال <b>24 ساعة</b> من التقديم، تنتقل الوظيفة لحالة حرجة وتقرر الشركة.</li>'
      +     '</ol>'
      +   '</div>'
      +   '<div class="ff-sign">'
      +     '<div class="s"><div class="l"></div>توقيع الزبون</div>'
      +     '<div class="s"><div class="l"></div>توقيع نقطة البيع</div>'
      +     '<div class="s"><div class="l"></div>ختم الشركة (اختياري)</div>'
      +   '</div>'
      +   '<div class="ff-foot">'
      +     esc(DISCLAIMER) + ' — ' + esc(CFG.company.addressShort) + ' — '
      +     '<b dir="ltr">' + esc(CFG.company.phones.join(' / ')) + '</b>'
      +   '</div>'
      + '</div>';
  }

  function formStatusOf(app) {
    try { return Store.formStatus(app); } catch (e) { return 'active'; }
  }

  function slotText(t) {
    var m = CFG.slotStatus || {};
    return (m[t.slotStatus] && m[t.slotStatus].ar) || t.slotStatus || '—';
  }

  /* طباعة الاستمارة A4: تبديل مقاس الصفحة (آخر <style> يغلب قاعدة 86×54) */
  function printForm(app, attempt, verifiedAttempts) {
    ensureStyle();
    ensureFormStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّرت الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!app) return;
    var pageStyle = document.getElementById('hrc-form-page-style');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'hrc-form-page-style';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent = '@media print { @page { size: A4; margin: 0; } }';
    var seq = ++printSeq;
    rootEl.innerHTML = formHtml(app, attempt, verifiedAttempts);
    try { Store.audit('طباعة استمارة توظيف', 'applicant', app.serial,
      'طباعة استمارة توظيف A4 بنفس باركود البطاقة — للزبون ' + app.fullName); } catch (e) { }
    function after() {
      if (printSeq !== seq) return;
      rootEl.innerHTML = '';
      pageStyle.textContent = '';
    }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { readyPrint(seq, after, 1600); }, 160);
  }

  /* معاينة الاستمارة داخل نافذة (للشاشة) — تُستدعى من شاشة نجاح البيع
     فيتأكد أنماطها أولاً (ليست مخصصة لوضع الطباعة وحده) */
  function previewForm(app, attempt) {
    ensureStyle();
    ensureFormStyle();
    return '<div style="background:#f3ecd9;border:1px solid var(--line-soft);border-radius:12px;padding:18px 20px;overflow:auto">'
      + formHtml(app, attempt) + '</div>';
  }

  /* ======================= الواجهة (متوافقة مع الاستخدام السابق) ======================= */
  function buildHtml(app, attempts, staffName) {
    if (!app) return '<div class="hrc-card-sheet">لا توجد بيانات</div>';
    attempts = attempts || Store.getAttempts(app.serial);
    ensureStyle();
    return '<div class="hrc-card-sheet">' + frontHtml(app, attempts) + backHtml(app, attempts) + '</div>';
  }

  /* الطباعة: الوجهان بصفحتين 86×54مم بالحجم الفعلي.
     ⚠️ رمز تسلسلي: طبقتان متتاليتان (مثلاً بطاقتان خلف بعض) — مؤقّت التنظيف
     الخاص بالطباعة القديمة قد ينفجر بين إعداد محتوى الجديدة ونداء الطباعة
     فيمسح ورقتها بيضاء. التنظيف الآن لا يعمل إلا لآخر طباعة فقط. */
  var printSeq = 0, printFonts;
  function readyPrint(seq, after, delay) {
    if (!printFonts) printFonts = document.fonts && document.fonts.load ? Promise.all([400,600,700,900].map(function (w) { return document.fonts.load(w+' 12px Cairo','العراق ABC 123'); })).catch(function () { printFonts = null; }) : Promise.resolve();
    printFonts.then(function () { if (printSeq === seq) { window.print(); setTimeout(after, delay); } });
  }

  function print(app, opts) {
    opts = opts || {};
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّر الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!app) return;
    var attempts = opts.attempts || Store.getAttempts(app.serial);
    var seq = ++printSeq;
    setSheetCss(false);
    rootEl.innerHTML = '<div class="hrc-card-sheet">' + frontHtml(app, attempts) + backHtml(app, attempts) + '</div>';
    Store.markPrinted(app.serial);
    function after() { if (printSeq === seq) rootEl.innerHTML = ''; }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { readyPrint(seq, after, 1200); }, 120);
  }

  /* طباعة دفعة بطاقات (الفارغة عند الإصدار): كل بطاقة بوجهيها وصفحة خاصة */
  function printBatch(apps) {
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّرت الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!apps || !apps.length) { UI.toast('err', 'تعذّرت الطباعة', 'لا توجد بطاقات بالدفعة'); return; }
    var seq = ++printSeq;
    setSheetCss(false);
    rootEl.innerHTML = apps.map(function (app) {
      var attempts = Store.getAttempts(app.serial);
      return frontHtml(app, attempts) + backHtml(app, attempts);
    }).join('');
    apps.forEach(function (app) { try { Store.markPrinted(app.serial); } catch (e) { } });
    function after() { if (printSeq === seq) rootEl.innerHTML = ''; }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { readyPrint(seq, after, 1600); }, 160);
  }

  /* ======================= طباعة الدفعات على ورق A4 ======================= */
  /* 10 بطاقات بالصفحة (عمودان × 5 صفوف) بمقاسها الفعلي 86×54مم، والباقي على
     الصفحات التالية. كل 10 بطاقات = صفحة أمامية ثم صفحة خلفية، والخلفية
     مُبدَّلة أفقياً (العمود 1↔2) لتتطابق مع الأمامية عند الطباعة على الوجهين
     بخيار «قلب على الحافة الطويلة» — وإن طُبعت وجهاً واحداً فكل صفحة مستقلة. */
  var SHEET_COLS = 2, SHEET_ROWS = 5, SHEET_PER = SHEET_COLS * SHEET_ROWS;
  var SHEET_CSS = '@media print{'
    + '@page{size:A4;margin:0;}'
    + '#print-root{display:block !important;}'
    + '#print-root .hrc-sheet-page{width:210mm;height:297mm;box-sizing:border-box;padding:7.5mm 16mm;'
    +   'display:grid;grid-template-columns:86mm 86mm;grid-auto-rows:54mm;column-gap:6mm;row-gap:3mm;'
    +   'align-content:start;justify-content:start;overflow:hidden;background:#fff;'
    +   'page-break-after:always;break-after:page;}'
    + '#print-root .hrc-sheet-page:last-child{page-break-after:auto;break-after:auto;}'
    + '#print-root .hrc-cell{width:86mm;height:54mm;overflow:hidden;}'
    + '#print-root .hrc-cell .hrc-card{margin:0 !important;box-shadow:none !important;'
    +   'page-break-after:auto !important;break-after:auto !important;}'
    + '}';
  var sheetStyleEl = null;
  function setSheetCss(on) {
    if (!sheetStyleEl) {
      sheetStyleEl = document.getElementById('hrc-sheet-style');
      if (!sheetStyleEl) {
        sheetStyleEl = document.createElement('style');
        sheetStyleEl.id = 'hrc-sheet-style';
        document.head.appendChild(sheetStyleEl);
      }
    }
    /* يُفعَّل فقط أثناء طباعة الورق: يبقى بقية الطباعة (بطاقة مفردة/استمارة) كما هي */
    sheetStyleEl.textContent = on ? SHEET_CSS : '';
  }

  function sheetPage(slots) {
    var cells = [];
    for (var i = 0; i < SHEET_PER; i++) {
      cells.push('<div class=\"hrc-cell\">' + (slots[i] || '') + '</div>');
    }
    return '<div class=\"hrc-sheet-page\">' + cells.join('') + '</div>';
  }

  function sheetHtml(apps) {
    var out = '';
    for (var p = 0; p < apps.length; p += SHEET_PER) {
      var chunk = apps.slice(p, p + SHEET_PER);
      var front = [], back = [];
      for (var k = 0; k < SHEET_PER; k++) { front.push(''); back.push(''); }
      chunk.forEach(function (app, i) {
        var att = Store.getAttempts(app.serial);
        front[i] = frontHtml(app, att);
        back[i ^ 1] = backHtml(app, att);   /* تبديل العمودين للوجه الخلفي */
      });
      out += sheetPage(front) + sheetPage(back);
    }
    return out;
  }

  /* عدد أوراق A4 (كل ورقة بوجهين) لعدد بطاقات معيّن — للعرض في النافذة */
  function sheetCount(n) { return Math.ceil((Number(n) || 0) / SHEET_PER); }

  function printSheet(apps) {
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّرت الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!apps || !apps.length) { UI.toast('err', 'تعذّرت الطباعة', 'لا توجد بطاقات للطباعة'); return; }
    var seq = ++printSeq;
    setSheetCss(true);
    rootEl.innerHTML = sheetHtml(apps);
    apps.forEach(function (app) { try { Store.markPrinted(app.serial); } catch (e) { } });
    function after() { if (printSeq === seq) { rootEl.innerHTML = ''; setSheetCss(false); } }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { readyPrint(seq, after, 2000); }, 160);
  }

  /* معاينة داخل نافذة منبثقة */
  function preview(app) {
    return '<div style="background:#f3ecd9;border:1px solid var(--line-soft);border-radius:12px;padding:18px 20px">'
      + buildHtml(app) + '</div>';
  }

  root.HRCVoucher = {
    buildHtml: buildHtml, print: print, printBatch: printBatch, printSheet: printSheet, sheetCount: sheetCount, preview: preview,
    formHtml: formHtml, printForm: printForm, previewForm: previewForm,
    DISCLAIMER: DISCLAIMER, qrSvg: qrSvg, verifyUrl: function (s) { return Store.verifyUrl(s); }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCVoucher;
})(typeof window !== 'undefined' ? window : globalThis);
