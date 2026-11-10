/* بطاقة توظيف 59.4×94.6 مم: وجه للهوية والباركود، وظهر برمز تحقق واحد.
   لا بيانات زبون على البطاقة؛ الاستمارة A4 منفصلة. طباعة بالحجم الفعلي. */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG;
  var UI = root.HRCUI;
  var Store = root.HRCStore;

  var DISCLAIMER = 'ملاحظات مهمة: خدمات الشركة تنحصر في توفير الأيادي العاملة من الناحية الفنية والتخصصية فقط وليس الأمنية. ' +
    'الشركة غير مسؤولة قانونياً وعشائرياً عن الشخص المرسل وصاحب العمل.';

  var TERMS = [
    'بطاقة <b>شخصية</b> بـ<b>فرص مستقلة حسب البطاقة</b>؛ صالحة <b>30 يوماً</b> من أول تقديم.',
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
.hrc-card,.hrc-card *{box-sizing:border-box}
.hrc-card{box-sizing:border-box;width:70.2mm;height:111.8mm;flex:0 0 auto;position:relative;overflow:hidden;border-radius:3.9mm;padding:3.38mm;background:#f5f1e5;color:#112f4d;display:flex;flex-direction:column;font-family:Cairo,'Segoe UI',Tahoma,sans-serif;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:0 10px 24px #06172a35}
.hrc-card .frame{position:absolute;inset:2.6mm;border:0;pointer-events:none;z-index:5;box-shadow:0 0 0 .45mm #c9a251,inset 0 0 0 .45mm #c9a251,0 0 0 .8mm #f3ead2,inset 0 0 0 .8mm #f3ead2;border-radius:3.12mm}
/* تصميم البطاقة قابل للتعديل: الأشكال والنصوص والباركود منفصلة. */
.hrc-card[aria-label*=الأمامي]{padding:0;background:#f3f0e7;color:#071e39;text-align:center}
.mk-art{position:absolute;inset:0;width:100%;height:100%;z-index:0}
.mk-brand{position:absolute;top:9%;left:9%;width:83%;height:11%;display:flex;direction:ltr;align-items:center;justify-content:center;gap:1.95mm;color:#fff;z-index:1}
.mk-logo{position:relative;display:flex;direction:rtl;align-items:center;white-space:nowrap;font-size:29.9pt;line-height:1;font-weight:900;letter-spacing:-.59mm}
.mk-brand-icon{width:13mm;height:13mm;flex:none;margin-right:-.91mm}
.mk-brand-label{direction:rtl;border-left:.33mm solid #d2ad60;padding-left:1.95mm;color:#e7c77e;font-size:10.4pt;font-weight:900;line-height:1.2;text-align:center;white-space:nowrap}
.mk-slogan{position:absolute;top:22%;left:2%;width:96%;color:#d2ad60;font-weight:900;font-size:17.55pt;line-height:1.15;z-index:1;white-space:nowrap}
.mk-slogan:after{content:'';display:block;margin:.65mm auto 0;width:23%;height:.65mm;border-top:.45mm solid #c9a75d;border-radius:50%;transform:rotate(-3deg)}
.mk-qr{position:absolute;left:30%;top:32.5%;width:40%;aspect-ratio:1;background:#fff;border:.85mm solid #c2a264;border-radius:2.21mm;padding:.39mm;z-index:1}
.hrc-qr-slot svg{display:block;width:100%;height:100%}
.mk-caption{position:absolute;top:57.9%;left:12%;width:76%;height:8.6%;border-radius:2.6mm;background:#052b4d;color:white;display:flex;align-items:center;justify-content:center;gap:2.6mm;z-index:1;font-size:8.32pt;line-height:1.2;font-weight:800}
.mk-caption b{color:#d8b15e;font-size:11.05pt}.mk-caption svg{width:5.2mm;height:6.5mm;flex:none;color:#d8b15e}
.mk-steps{position:absolute;top:68%;left:13%;width:74%;height:8%;display:flex;direction:ltr;align-items:center;justify-content:space-between;z-index:1;font-size:7.41pt;line-height:1.1;font-weight:900}
.mk-step{direction:rtl;display:flex;flex-direction:column;align-items:center;gap:.39mm;white-space:nowrap}.mk-step svg{width:5.72mm;height:5.72mm;fill:#092744}.mk-steps i{color:#cba85e;font-size:15.6pt;font-style:normal}
.mk-ribbon{position:absolute;top:77.6%;left:17%;width:66%;height:5%;display:flex;align-items:center;justify-content:center;background:#d5a943;color:#092744;clip-path:polygon(4% 0,96% 0,100% 25%,97% 50%,100% 75%,96% 100%,4% 100%,0 75%,3% 50%,0 25%);font-size:7.93pt;font-weight:900;white-space:nowrap;z-index:1}
.mk-contact{position:absolute;top:82.5%;left:8%;width:84%;height:6%;display:flex;direction:ltr;align-items:center;justify-content:center;gap:1.56mm;z-index:1;color:#091f3b}
.mk-contact svg{width:5.2mm;height:5.2mm;fill:none;stroke:currentColor;stroke-width:2;flex:none}.mk-contact-text{direction:rtl;text-align:center;line-height:1.15;font-size:5.85pt;font-weight:900;white-space:nowrap}.mk-contact-text b{display:block;direction:ltr;font-family:Arial,sans-serif;font-size:7.15pt}.mk-contact-site{border-left:.33mm solid #c8a65b;padding-left:1.56mm}.mk-contact-site b{font-size:5.46pt;max-width:26mm;white-space:normal;overflow-wrap:anywhere}
.mk-footer{position:absolute;bottom:3.2%;left:27%;width:66%;height:7.6%;background:#052a4b;border-radius:1.4mm;display:flex;align-items:center;justify-content:space-around;gap:1.4mm;color:#fff;z-index:2;font-size:4.4pt;line-height:1.3;white-space:nowrap}.mk-footer b{display:block;direction:ltr;font:700 6.5pt Arial,sans-serif}.mk-footer .mk-serial b{border:.26mm solid #d6c7a6;border-radius:1.3mm;padding:.78mm 1.3mm}.mk-footer .mk-date{border-right:.26mm solid #e4e7e9;padding-right:1.95mm}
/* رقم الإصدار يُعرض فقط عند وجود رقم محفوظ فعلياً؛ لا نختلق رقماً للبطاقات القديمة. */
.mk-card-number{position:absolute;left:4.5%;bottom:3.2%;width:20%;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:.55mm;color:#f8e7bd;font-size:4.4pt;font-weight:800;line-height:1;white-space:nowrap}
.mk-card-number b{display:block;min-width:10.4mm;padding:.65mm 1.95mm;border:.33mm solid #d5aa55;border-radius:1.95mm;background:#f7e2aa;color:#092744;font:900 9.1pt Arial,sans-serif;direction:ltr}
.mk-card-number span{background:#052a4b;padding:.7mm 1.6mm;border-radius:1.1mm;letter-spacing:.15mm}
.mb-site-qr{position:absolute;left:5.5%;bottom:7.4%;width:14mm;z-index:2;display:flex;flex-direction:column;align-items:center;gap:.7mm;text-align:center;font-size:3.6pt;font-weight:800;color:#fff;line-height:1.6;text-shadow:0 1px 2px #052a4b}
.mb-site-qr .mb-site-qr-image{width:8.8mm;height:8.8mm;flex:0 0 8.8mm;background:#fff;border:.33mm solid #d0b16b;border-radius:.91mm;padding:.3mm}
.mb-site-qr svg{display:block;width:100%;height:100%}
/* الوجه الخلفي مبني بعناصر قابلة للتعديل، وليس صورة مطبوعة. */
.hrc-card[aria-label*=الخلفي]{padding:0;background:#f5f1e6;color:#092847}
.mb-art{position:absolute;inset:0;width:100%;height:100%}
.mb-slogan{position:absolute;top:7%;right:6%;font-size:11.7pt;line-height:1.2;font-weight:800;color:#0b3154;transform:rotate(-5deg)}
.mb-slogan:after{content:'';display:block;border-top:.59mm solid #c9a354;width:55%;margin:.91mm 0 0 auto;transform:rotate(-4deg)}
.mb-heading{position:absolute;top:15%;left:5%;right:5%;height:5%;display:flex;align-items:center;gap:1.3mm}
.mb-heading:after{content:'';height:.26mm;flex:1;background:#153555}.mb-heading b{background:#092e50;color:#fff;border-radius:2.08mm;padding:.91mm 3.25mm;font-size:9.1pt;line-height:1.1;white-space:nowrap}
.mb-rules{position:absolute;top:21%;left:5%;right:5%;height:39%;display:flex;flex-direction:column;justify-content:space-between;gap:.78mm}
.mb-rule{display:flex;align-items:center;gap:1.69mm;min-height:0;direction:rtl}.mb-icon{flex:none;width:6.24mm;height:6.24mm;border-radius:50%;background:#dfb650;display:grid;place-items:center;color:#0b3154}.mb-icon svg{width:4.29mm;height:4.29mm;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mb-rule p{margin:0;text-align:right;font-size:5.26pt;line-height:1.3;font-weight:700;color:#102d4c}.mb-rule b{font-weight:900}
.mb-code{position:absolute;top:60.5%;left:7%;width:86%;height:5.5%;display:flex;align-items:center;justify-content:center;gap:1.3mm;text-align:center;border:.26mm solid #d0b16b;border-radius:1.3mm;background:#fffaf0;font-size:4.55pt;line-height:1.1;font-weight:800}.mb-code .code{direction:ltr;font:900 7.02pt 'Courier New',monospace;white-space:nowrap}
.mb-notice{position:absolute;top:67.5%;left:5%;width:90%;height:8%;background:#c6dbea;border-radius:2.6mm;display:flex;align-items:center;gap:1.95mm;padding:1.3mm 2.6mm;color:#0b3154;font-size:6.11pt;line-height:1.35}.mb-notice b{font-size:7.8pt}.mb-notice svg{width:5.85mm;height:6.5mm;flex:none;fill:#0a3154;stroke:#fff;stroke-width:1}
.mb-phone{position:absolute;top:74.8%;left:5%;width:90%;height:8%;background:#062d50;border-radius:2.6mm;color:#fff;display:flex;align-items:center;justify-content:center;gap:2.6mm;font-size:6.5pt;font-weight:800}.mb-phone b{font:900 10.4pt Arial,sans-serif;direction:ltr}.mb-phone svg{width:5.2mm;height:5.2mm;fill:#fff}
.mb-bottom-slogan{position:absolute;top:86.5%;left:6%;font-size:7.8pt;font-weight:800;transform:rotate(-5deg);color:#12385a}.mb-bottom-slogan:after{content:'';display:block;border-top:.39mm solid #c8a34e;width:80%;margin:auto}
.mb-logo{position:absolute;bottom:3.3%;right:6%;display:flex;align-items:center;gap:.65mm;padding:.65mm 1.3mm;border-radius:1.56mm;background:#f5f1e6;font-size:15.6pt;line-height:1;font-weight:900;color:#092e50}.mb-logo svg{width:9.1mm;height:9.1mm;flex:none}.mb-logo small{display:block;font-size:5.2pt;margin-top:.91mm;white-space:nowrap}
@media print{@page{size:A4 portrait;margin:0}html,body{background:#fff!important;margin:0!important;padding:0!important}body>*{display:none!important}#print-root{display:block!important;position:static!important;width:auto!important}#print-root .hrc-card{width:70.2mm;height:111.8mm;zoom:1;margin:8.84mm auto 0!important;box-shadow:none!important;page-break-after:always;break-after:page}#print-root .hrc-card:last-child{page-break-after:auto;break-after:auto}#print-root .hrc-card-sheet{display:block!important;padding:0!important}}
`;
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

  /* نفس مسارات الشعار المعتمد، مرسومة داخل البطاقة لتعمل الطباعة بلا روابط خارجية. */
  var MKSEB_GLYPHS = "<path d=\"M80.6 331.4C79.2 330.0 79.0 328.6 79.4 324.1C79.8 321.0 80.9 306.6 82.0 292.0C85.6 244.4 86.6 235.0 89.1 228.6C95.3 212.7 114.9 201.0 135.4 201.0C145.9 201.0 145.6 196.2 139.9 263.8C138.3 282.7 134.8 281.0 174.9 280.9C192.8 280.8 222.1 280.5 240.0 280.1C272.5 279.5 272.5 279.5 279.1 276.4C291.0 270.7 297.2 258.1 292.5 249.0C286.5 237.5 270.7 243.2 260.9 260.4C257.6 266.4 256.7 266.9 249.8 266.9C247.3 266.8 244.3 267.3 243.2 267.9C240.2 269.5 228.5 269.2 224.3 267.5C220.8 266.0 220.8 265.9 221.2 261.2C221.8 255.3 227.1 242.6 232.1 235.1C237.6 226.8 255.3 209.3 264.0 203.5C275.2 196.1 283.3 194.6 295.9 197.5C330.3 205.6 347.1 240.8 333.9 276.7C323.5 304.7 297.9 323.3 259.5 330.7C252.8 332.0 237.8 332.3 166.9 332.7C87.8 333.1 82.2 333.0 80.6 331.4Z\" fill=\"#fff\"/>\n<path d=\"M172.0 256.2C169.5 255.4 169.0 253.8 169.5 248.5C170.8 235.2 174.2 205.3 174.6 203.8C174.9 202.9 190.7 186.9 209.8 168.4C228.9 149.9 247.0 132.3 250.0 129.3C256.6 122.9 256.4 122.0 246.5 117.0C239.3 113.4 236.4 109.6 238.5 106.5C242.2 101.3 255.4 85.8 256.8 85.1C257.7 84.6 273.6 83.9 292.1 83.5C324.5 82.8 325.8 82.8 326.8 84.6C327.4 85.9 327.3 95.9 326.4 114.5C325.7 129.9 325.1 144.8 325.0 147.7C325.0 151.7 324.4 153.5 322.4 155.9C319.5 159.4 300.6 173.0 298.6 173.0C296.6 173.0 294.6 170.1 291.6 163.0C288.4 155.3 286.3 152.0 284.9 152.0C283.8 152.0 249.2 185.0 194.0 238.6C177.0 255.1 174.6 257.1 172.0 256.2Z\" fill=\"#FABE04\"/>";
  function mksebLogo(dark, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 415 418" role="img" aria-label="شعار منصة مكسب">' +
      (dark ? MKSEB_GLYPHS.replace('fill="#fff"', 'fill="#012F3E"') : MKSEB_GLYPHS) + '</svg>';
  }


  /* الوجه الأمامي بلا بيانات شخصية؛ الصلاحية تبدأ عند أول تقديم. */
  function isBlank(app) {
    /* البطاقة لا تحمل بيانات زبون أبداً (قرار 2026-10-01): «فارغة» تعني
       لم تُبع ولم تُفعّل بعد — البيانات تعيش على استمارة A4 بنفس الباركود. */
    return !app || app.status === 'blank';
  }

  function frontHtml(app, attempts) {
    var blank = isBlank(app);
    var count = 'بطاقة واحدة .. ' + attempts.length + (attempts.length === 1 ? ' فرصة للتقديم' : ' فرص للتقديم');
    return '<div class="hrc-card" aria-label="الوجه الأمامي لبطاقة التوظيف">' +
      '<i class="frame" aria-hidden="true"></i>' +
      '<svg class="mk-art" viewBox="0 0 540 860" preserveAspectRatio="none" aria-hidden="true"><rect width="540" height="860" fill="#f3f0e7"/><path d="M0 0H540V372C408 449 131 459 0 379Z" fill="#052a4b"/><path d="M0 379C131 459 408 449 540 372" fill="none" stroke="#c7a255" stroke-width="6"/><path d="M0 766C151 813 383 803 540 756V860H0Z" fill="#052a4b"/><path d="M0 766C151 813 383 803 540 756" fill="none" stroke="#c7a255" stroke-width="5"/></svg>' +
      '<div class="mk-brand"><div class="mk-logo"><span>مكسب</span>' + mksebLogo(false, 'mk-brand-icon') + '</div><div class="mk-brand-label">منصة</div></div>' +
      '<div class="mk-slogan">فرصتك تبدأ من هنا</div>' +
      '<div class="mk-qr hrc-qr-slot">' + qrSvg(Store.cardUrl(app.serial), 200) + '</div>' +
      '<div class="mk-caption"><span>امسح الباركود للوصول إلى<br><b>منصة مكسب</b></span><svg viewBox="0 0 24 32" fill="none" aria-hidden="true"><rect x="3" y="1" width="18" height="30" rx="3" stroke="currentColor" stroke-width="2"/><path d="M9 4h6M11 27h2" stroke="currentColor" stroke-width="2"/></svg></div>' +
      '<div class="mk-steps"><div class="mk-step"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 2v17h10V3zm4 18h2v1h-2z"/></svg>امسح</div><i>›</i><div class="mk-step"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="5"/><path d="M4 23c0-7 3-10 8-10s8 3 8 10z"/></svg>سجّل</div><i>›</i><div class="mk-step"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6a2 2 0 0 1 2 2v1h4a2 2 0 0 1 2 2v4l-9 2v-1h-4v1l-9-2V8a2 2 0 0 1 2-2h4V5a2 2 0 0 1 2-2zm0 3h6V5H9zM1 14l9 2v1h4v-1l9-2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z"/></svg>اختر وظيفتك</div></div>' +
      '<div class="mk-ribbon">' + esc(count) + '</div>' +
      '<div class="mk-contact"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13v-2a9 9 0 0 1 18 0v2M3 12h3v7H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 1-2zm18 0h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2zm-2 7c0 2-2 3-5 3h-2"/></svg><div class="mk-contact-text">خدمة العملاء<b>' + esc(CFG.company.phones[0] || '') + '</b></div></div>' +
      (Number.isSafeInteger(app.cardNumber) && app.cardNumber > 0 ? '<div class="mk-card-number"><span>رقم البطاقة</span><b>' + esc(app.cardNumber) + '</b></div>' : '') +
      '<div class="mk-footer"><div class="mk-date">إصدار البطاقة<b>' + (!app.issueDate ? 'أول تقديم' : esc(Store.fmtDate(app.issueDate))) + '</b></div><div class="mk-serial">كود البطاقة<b>' + esc(app.serial) + '</b></div></div></div>';
  }

  function backHtml(app, attempts) {
    var printed = app.cardPrintCode ? (app.cardPrintCode.match(/.{1,4}/g) || []).join('-') : '';
    var terms = TERMS;
    var websiteUrl = String(CFG.verifyBase || '').replace(/verify\/?(?:[?#].*)?$/, '');
    return '<div class="hrc-card" aria-label="الوجه الخلفي لبطاقة التوظيف">' +
      '<i class="frame" aria-hidden="true"></i>' +
      '<svg class="mb-art" viewBox="0 0 540 860" preserveAspectRatio="none" aria-hidden="true"><path d="M0 795C135 852 407 860 540 817V860H0Z" fill="#062d50"/><path d="M0 795C135 852 407 860 540 817" fill="none" stroke="#d4ab51" stroke-width="7"/></svg>' +
      '<div class="mb-slogan">معاً .. نحو مستقبل أفضل</div><div class="mb-heading"><b>معلومات مهمة</b></div>' +
      '<div class="mb-rules">' +
      '<div class="mb-rule"><span class="mb-icon"><svg viewBox="0 0 24 24"><path d="M4 3h16v18H4zM8 7h8M8 11h8M8 15h5"/></svg></span><p>' + terms[0] + '</p></div>' +
      '<div class="mb-rule"><span class="mb-icon"><svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5zM8 12l3 3 5-6"/></svg></span><p>' + esc(DISCLAIMER) + '</p></div>' +
      '<div class="mb-rule"><span class="mb-icon"><svg viewBox="0 0 24 24"><path d="M5 3l4 4-2 3c2 4 3 5 7 7l3-2 4 4-2 2C11 21 3 13 3 5z"/></svg></span><p>' + terms[1] + ' ' + terms[2] + ' عند رفض الطلب أبلغ الدعم.</p></div>' +
      '<div class="mb-rule"><span class="mb-icon"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg></span><p>' + terms[3] + ' لأمانك لا تشارك بياناتك مع أي شخص.</p></div></div>' +
      (printed ? '<div class="mb-code"><span>رمز إعادة الطباعة<br>احتفظ به ولا تشاركه</span><span class="code">' + esc(printed) + '</span></div>' : '') +
      '<div class="mb-notice"><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 1L23 5v8c0 7-4 11-11 14C5 24 1 20 1 13V5z"/><path d="M7 14l3 3 6-7" fill="none"/></svg><span><b>ملاحظة نهائية:</b><br>هذه البطاقة غير قابلة للاسترجاع.</span></div>' +
      '<div class="mb-phone"><span>خدمة العملاء</span><b>' + esc(CFG.company.phones[0] || '') + '</b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2l4 5-2 3c1 3 3 5 6 6l3-2 5 4-2 4C11 22 2 13 2 4z"/></svg></div>' +
      '<div class="mb-site-qr"><div class="mb-site-qr-image" aria-label="رمز الموقع الإلكتروني">' + qrSvg(websiteUrl, 120) + '</div><span>الموقع الإلكتروني</span></div><div class="mb-logo">' + mksebLogo(true, 'mb-brand-icon') + '<div>مكسب<small>منصة مكسب للتوظيف</small></div></div></div>';
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
    var job = !app.__customerApplication && attempt && attempt.jobCode ? Store.getJob(attempt.jobCode) : null;
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
      field('المحافظة', (job && job.governorate) || attempt.governorate || attempt.location || '—') +
      field('الأجر الشهري', attempt.salaryMin != null ? Store.money(attempt.salaryMin) + ' – ' + Store.money(attempt.salaryMax) : job ? Store.money(job.salaryMin) + ' – ' + Store.money(job.salaryMax) : '') +
      field('الدوام', attempt.shift || (job && job.shift)) + field('حالة التقديم', slotText(attempt)) +
      field('تاريخ التقديم', attempt.selectedAt ? Store.fmtDateTime(attempt.selectedAt) : '', 'ff-wide') + '</div>' :
      '<div class="ff-empty">لم يُقدَّم على وظيفة بعد — فرص البطاقة متاحة من «بطاقتي» على الموقع أو عند أي نقطة بيع.</div>');
    var employerDetails = section('employer', '03', 'بيانات صاحب العمل', attempt ? '<div class="ff-grid ff-grid-two">' +
      field('اسم جهة العمل', attempt.employerName || employer.name) +
      field('هاتف جهة العمل', attempt.employerPhone || employer.phone, 'ff-ltr') +
      field('عنوان جهة العمل', attempt.employerAddress || employer.address) + field('مكان المقابلة', attempt.interviewLocation || (job && job.interviewLocation)) + '</div>' :
      '<div class="ff-empty">تظهر بيانات جهة العمل بعد التقديم على وظيفة.</div>');
    var holdNote = attempt && attempt.holdExpiresAt && attempt.slotStatus === 'reserved'
      ? '<div class="ff-note">الحجز مؤقت <b>24 ساعة</b> من وقت التقديم (' + esc(Store.fmtDateTime(attempt.selectedAt)) +
        ') — تبلّغ الشركة بنتيجة المقابلة؛ وبعد المهلة تصبح الوظيفة حرجة وتقرر الشركة.</div>' : '';

    return ''
      + '<div class="hrc-form">'
      +   '<div class="ff-head">'
      +     '<div class="ff-brand">'
      +       mksebLogo(true, 'ff-brand-icon')
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
      +   '<ul class="ff-terms">' + TERMS.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>'
      +   '<div class="ff-employer-box">'
      +     '<h4>✦ لصاحب العمل — كيف تُكمل التوظيف؟</h4>'
      +     '<ol>'
      +       '<li>تأكد من تفاصيل المتقدم والوظيفة في الاستمارة.</li>'
      +       '<li>اطلع على بيانات المتقدم وأجرِ المقابلة في المكان المحدد أعلاه.</li>'
      +       '<li>بلّغ الشركة بنتيجة المقابلة لتثبيت القرار في ملف المتقدم.</li>'
      +       '<li>إن لم يُسجَّل طلب خلال <b>24 ساعة</b> من التقديم، تنتقل الوظيفة لحالة حرجة وتقرر الشركة.</li>'
      +     '</ol>'
      +   '</div>'
      + '</div>';
  }

  function formStatusOf(app) {
    if (app && app.__customerApplication) return app.status || 'active';
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
    // Mobile browsers can emit afterprint before capturing the preview. Keep
    // this hidden form until it is explicitly replaced or the card is closed.
    setSheetCss(false);
    setTimeout(function () { readyPrint(seq, null, 0); }, 160);
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

  /* الطباعة: الوجهان بصفحتين 59.4×94.6مم بالحجم الفعلي.
     ⚠️ رمز تسلسلي: طبقتان متتاليتان (مثلاً بطاقتان خلف بعض) — مؤقّت التنظيف
     الخاص بالطباعة القديمة قد ينفجر بين إعداد محتوى الجديدة ونداء الطباعة
     فيمسح ورقتها بيضاء. التنظيف الآن لا يعمل إلا لآخر طباعة فقط. */
  var printSeq = 0, printFonts;
  function readyPrint(seq, after, delay) {
    if (!printFonts) printFonts = document.fonts && document.fonts.load ? Promise.all([400,600,700,900].map(function (w) { return document.fonts.load(w+' 12px Cairo','العراق ABC 123'); })).catch(function () { printFonts = null; }) : Promise.resolve();
    printFonts.then(function () { if (printSeq === seq) { window.print(); if (after) setTimeout(after, delay); } });
  }

  function clearFormPrint() {
    var rootEl = document.getElementById('print-root');
    if (!rootEl || !rootEl.querySelector('.hrc-form')) return;
    ++printSeq;
    rootEl.innerHTML = '';
    var style = document.getElementById('hrc-form-page-style');
    if (style) style.textContent = '';
  }

  function numbersReady(apps) {
    var workspace = Store.db && Store.db().meta && Store.db().meta.workspace;
    if (workspace && apps.some(function (a) { return a.cardNumberKnown !== true; })) {
      UI.toast('err', 'تعذّرت الطباعة', 'لم يتم التأكد من رقم البطاقة؛ تحقق من الاتصال وأعد تحميل البيانات قبل الطباعة.');
      return false;
    }
    return true;
  }

  function print(app, opts) {
    opts = opts || {};
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّر الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!app || !numbersReady([app])) return;
    clearFormPrint();
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
    if (!numbersReady(apps)) return;
    clearFormPrint();
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
  /* 4 بطاقات بالصفحة (عمودان × صفّان) بمقاس 59.4×94.6مم (54×86 مكبّرة 110%)،
     والباقي على الصفحات التالية.

     قرار 2026-11-07 (طلب الإدارة): كان 9 بطاقات بفراغ 3مم فقط، فلا يجد المقص
     مجالاً ويمرّ على البطاقة نفسها. الآن فراغ 20مم بين البطاقات — أي 20مم
     مساحة قطع حرّة — والكتلة موسّطة أفقياً وعمودياً في وسط الورقة.
     قياس الورقة A4 (210×297مم): الكتلة 138.8×209.2مم، فتقع بهوامش
     35.6مم يميناً ويساراً و43.9مم أعلى وأسفل.

     الخانة الفارغة تحجز مكانها (visibility لا display) وإلا انزاحت الباقية
     وتغيّر ترتيب الصفوف فانفصلت الخلفية عن الأمامية عند القلب.

     كل صفحة = وجه أمامي ثم وجه خلفي، والخلفية مُبدَّلة أفقياً (العمود 1↔2)
     لتتطابق مع الأمامية عند الطباعة على الوجهين بخيار «قلب على الحافة
     الطويلة» — وإن طُبعت وجهاً واحداً فكل صفحة مستقلة. */
  var SHEET_COLS = 2, SHEET_ROWS = 2, SHEET_PER = SHEET_COLS * SHEET_ROWS;
  var SHEET_GUTTER = 20;   /* مم — مساحة القصّ بين البطاقات (أفقياً وعمودياً) */
  var SHEET_CSS = '@media print{'
    + '@page{size:A4;margin:0;}'
    + '#print-root{display:block !important;}'
    + '#print-root .hrc-sheet-page{width:210mm;height:297mm;box-sizing:border-box;padding:0;'
    +   'display:grid;grid-template-columns:repeat(2,70.2mm);grid-auto-rows:111.8mm;'
    +   'column-gap:20mm;row-gap:20mm;'
    +   'align-content:center;justify-content:safe center;overflow:hidden;background:#fff;'
    +   'page-break-after:always;break-after:page;}'
    + '#print-root .hrc-sheet-page:last-child{page-break-after:auto;break-after:auto;}'
    + '#print-root .hrc-sheet-page[data-cols=\"1\"]{grid-template-columns:70.2mm;}'
    + '#print-root .hrc-cell{width:70.2mm;height:111.8mm;overflow:hidden;display:block;}'
    + '#print-root .hrc-cell.is-empty{visibility:hidden;}'
    + '#print-root .hrc-cell .hrc-card{margin:0 !important;box-shadow:none !important;'
    +   'zoom:1 !important;page-break-after:auto !important;break-after:auto !important;}'
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

  /* تُرسم الصفوف كاملة فقط: صفحة فيها بطاقتان تُنتج صفّاً واحداً (لا صفّين
     أحدهما فارغ) فتبقى موسّطة عمودياً — والصفوف تبقى مصطفّة مع الوجه الخلفي
     لأن الطرفين يستخدمان نفس عدد الصفوف. */
  /* ترسم الخانات كاملة وتحافظ على مواضعها — وهذا شرط سلامة الوجه الخلفي:
     الخلفية معكوسة أفقياً (خانة 1 ↔ خانة 0)، فلو حُذفت خانة فارغة أو غُيّر
     عدد الأعمدة لانزاحت الخلفية عن مكانها ولم تعد تطابق الأمامية عند القلب.

     التوسيط يقع على الصفحة كاملة (`align/justify-content: center`) لا على
     الخانات، فالصفحة ذات البطاقتين تبقى موسّطة بصفٍّ واحد في وسط الورقة. */
  function sheetPage(slots, count) {
    var n = (typeof count === 'number') ? count : SHEET_PER;
    var cols = (n === 1) ? 1 : SHEET_COLS;
    /* الصفوف المرسومة = صفوف البطاقات الفعلية فقط، حتى تُوسَّط الكتلة
       عمودياً. الخانات الفارغة تبقى محجوزة كعناصر (display:none) فلا تدخل
       في الحساب ولا تُزيح شيئاً — ومواضع الخلفية تبقى مطابقة للأمامية. */
    /* بطاقةٌ واحدة: عمودٌ واحد وبطاقةٌ واحدة في المنتصف تماماً. لا معنى
       للعكس الأفقي هنا (لا بطاقة ثانية تُزاح)، والخانة الثانية لو رُسمت
       لأضافت صفّاً كاملاً فأنزلت البطاقة عن المنتصف. */
    if (n === 1) {
      var only = '';
      for (var j = 0; j < slots.length; j++) { if (slots[j]) { only = slots[j]; break; } }
      return '<div class=\"hrc-sheet-page\" data-cols=\"1\"><div class=\"hrc-cell\">' + only + '</div></div>';
    }
    var rows = Math.max(1, Math.ceil(n / SHEET_COLS));
    var need = rows * SHEET_COLS;
    var cells = [];
    for (var i = 0; i < need; i++) {
      var has = !!slots[i];
      cells.push('<div class=\"hrc-cell' + (has ? '' : ' is-empty') + '\">' + (slots[i] || '') + '</div>');
    }
    return '<div class=\"hrc-sheet-page\" data-cols=\"' + cols + '\">' + cells.join('') + '</div>';
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
        back[Math.floor(i / SHEET_COLS) * SHEET_COLS + (SHEET_COLS - 1 - i % SHEET_COLS)] = backHtml(app, att);   /* عكس الأعمدة للوجه الخلفي */
      });
      out += sheetPage(front, chunk.length) + sheetPage(back, chunk.length);
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
    if (!numbersReady(apps)) return;
    clearFormPrint();
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
    formHtml: formHtml, printForm: printForm, clearFormPrint: clearFormPrint, previewForm: previewForm,
    DISCLAIMER: DISCLAIMER, qrSvg: qrSvg, verifyUrl: function (s) { return Store.verifyUrl(s); }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCVoucher;
})(typeof window !== 'undefined' ? window : globalThis);
