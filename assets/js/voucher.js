/* ===========================================================================
 *  HRC — قالب «بطاقة التوظيف» المطبوعة (86×54 مم — بحجم البطاقة المصرفية)
 *  ---------------------------------------------------------------------------
 *  التصميم المعتمد «بطاقة بوابة عشتار» (2026-09-30): لابيس ليلي + ذهب بابلي
 *  + ختم بوابة عشتار ونجمة عشتار الثمانية وخط Cairo — نفس هوية الموقع.
 *
 *  الوجه الأمامي: الشعار والاسم · اسم الزبون ورقمه · وظيفته الحالية بحالة
 *  فرصتيه · باركود QR (يفتح «بطاقتي» بالباركود معبّأً) · تاريخا الإصدار
 *  والانتهاء (30 يوماً).
 *  الوجه الخلفي: رمزا الفرصتين (مكشوفان — قرار الإدارة) · الشريط البابلي ·
 *  التعليمات (فرصتان مستقلتان · حجز 24 ساعة · الفرصة تُستهلك ولا تعود ·
 *  إعادة الطباعة بأي مكتب استنساخ) · أرقام التواصل والإخلاء القانوني.
 *
 *  الطباعة: صفحتان 86×54مم (الأمامية ثم الخلفية) — تُطبع على ورق مقوى
 *  300–350غم بخيار «الحجم الفعلي» ثم تُغلَّف حرارياً بمكتب الاستنساخ.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG;
  var UI = root.HRCUI;
  var Store = root.HRCStore;

  var DISCLAIMER = 'ملاحظات مهمة: خدمات الشركة تنحصر في توفير الأيادي العاملة من الناحية الفنية والتخصصية فقط وليس الأمنية. ' +
    'الشركة غير مسؤولة قانونياً وعشائرياً عن الشخص المرسل وصاحب العمل.';

  var TERMS = [
    'بطاقة <b>شخصية</b> تحتوي <b>فرصتين مستقلتين</b> للتقديم على الوظائف وصالحة <b>30 يوماً</b> من الإصدار.',
    'حجز الوظيفة مؤقت <b>24 ساعة</b>؛ وبعده تقرر الشركة: اكتمال التوظيف أو إرجاع الوظيفة أو حذفها.',
    'تُستهلك الفرصة بالتقديم <b>ولا تعود</b> بأي نتيجة؛ وبعد الفرصتين تُشترى بطاقة جديدة من نقاط البيع.',
    'لإعادة الطباعة: افتح موقع الشركة وادخل باركود بطاقتك — ويطبعها <b>أي مكتب استنساخ</b>.'
  ];

  /* ======================= الأنماط (تُحقن مرة واحدة) ======================= */
  var STYLE_ID = 'hrc-card-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = ''
      + '.hrc-card{width:86mm;height:54mm;border-radius:4.6mm;position:relative;overflow:hidden;'
      +   'background:radial-gradient(26mm 18mm at 88% 6%,rgba(63,193,196,.16),transparent 70%),'
      +   'radial-gradient(30mm 22mm at 8% 96%,rgba(200,162,74,.14),transparent 70%),'
      +   'linear-gradient(133deg,#17376c 0%,#0b1a3a 46%,#08132a 100%);'
      +   'box-shadow:0 10px 30px rgba(6,13,31,.35);color:#f9f6ef;display:flex;flex-direction:column;'
      +   'padding:2.1mm 2.9mm;font-family:Cairo,\'Segoe UI\',Tahoma,sans-serif;direction:rtl;'
      +   '-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      + '.hrc-card .frame{position:absolute;inset:1.5mm;border:.35mm solid rgba(200,162,74,.6);border-radius:3.4mm;pointer-events:none;}'
      + '.hrc-card .frame::after{content:"";position:absolute;inset:.7mm;border:.14mm solid rgba(200,162,74,.35);border-radius:2.8mm;}'
      + '.hrc-card .shine{position:absolute;inset:0;pointer-events:none;'
      +   'background:linear-gradient(115deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,0) 30%);}'
      + '.hrc-card .wm{position:absolute;left:-7mm;bottom:-9mm;width:34mm;height:34mm;opacity:.07;pointer-events:none;}'
      + '.hc-top{display:flex;justify-content:space-between;align-items:center;gap:2mm;position:relative;z-index:2;}'
      + '.hc-top .brand{display:flex;gap:1.8mm;align-items:center;}'
      + '.hc-top .brand .embl{width:9.6mm;height:9.6mm;flex:0 0 auto;}'
      + '.hc-top .brand .ar{font-size:6.6pt;font-weight:900;color:#e8d089;line-height:1.25;}'
      + '.hc-top .brand .en{font-size:3.1pt;font-weight:700;letter-spacing:.14em;color:rgba(249,246,239,.62);direction:ltr;text-align:right;}'
      + '.hc-ctype{text-align:left;display:flex;flex-direction:column;gap:.5mm;align-items:flex-start;}'
      + '.hc-ctype .t1{font-size:5.4pt;font-weight:900;color:#e8d089;border:.3mm solid rgba(200,162,74,.55);'
      +   'border-radius:2mm;padding:.4mm 2mm;background:rgba(200,162,74,.10);}'
      + '.hc-ctype .t2{font-size:2.9pt;font-weight:700;letter-spacing:.22em;color:rgba(249,246,239,.55);direction:ltr;}'
      + '.hc-ctype .serial{font-size:5pt;font-weight:700;letter-spacing:.1em;color:#f9f6ef;direction:ltr;}'
      + '.hc-main{display:flex;justify-content:space-between;align-items:center;gap:2mm;margin-top:1.4mm;position:relative;z-index:2;}'
      + '.hc-main .lbl{font-size:3.4pt;font-weight:700;color:rgba(200,162,74,.85);letter-spacing:.04em;}'
      + '.hc-main .name{font-size:9pt;font-weight:900;color:#f9f6ef;line-height:1.28;text-shadow:0 .3mm .8mm rgba(0,0,0,.45);max-width:52mm;'
      +   'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.hc-main .phone{font-size:6.8pt;font-weight:700;color:#e8d089;direction:ltr;text-align:right;letter-spacing:.06em;}'
      + '.hc-main .chip{width:11.5mm;height:8.6mm;flex:0 0 auto;}'
      + '.hc-jobs{margin-top:1.5mm;position:relative;z-index:2;display:flex;flex-direction:column;gap:.9mm;}'
      + '.hc-jobrow{display:flex;align-items:center;gap:1.6mm;border-radius:2mm;padding:.9mm 2mm;'
      +   'background:rgba(6,13,31,.42);border:.2mm solid rgba(200,162,74,.28);}'
      + '.hc-jobrow .slotno{font-size:4.2pt;font-weight:900;color:#e8d089;white-space:nowrap;}'
      + '.hc-jobrow .jtitle{font-size:5.6pt;font-weight:700;color:#f9f6ef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.hc-jobrow .jcode{font-size:4.2pt;font-weight:700;color:rgba(249,246,239,.8);direction:ltr;'
      +   'border:.2mm solid rgba(249,246,239,.3);border-radius:1.4mm;padding:0 1.2mm;white-space:nowrap;}'
      + '.hc-jobrow .jstat{font-size:3.9pt;font-weight:700;border-radius:1.4mm;padding:.3mm 1.6mm;margin-inline-start:auto;white-space:nowrap;}'
      + '.hc-jobrow .jstat.warn{color:#2a1d04;background:linear-gradient(135deg,#f0cf8a,#e0a93e);}'
      + '.hc-jobrow .jstat.ok{color:#04231a;background:linear-gradient(135deg,#7fe3c8,#3ec1a0);}'
      + '.hc-jobrow .jstat.danger{color:#2a0605;background:linear-gradient(135deg,#e8a49b,#d06055);}'
      + '.hc-jobrow .free-hint{font-size:4.6pt;font-weight:700;color:rgba(249,246,239,.66);margin-inline-start:auto;}'
      + '.hc-bot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:2mm;position:relative;z-index:2;}'
      + '.hc-bot .valid{font-size:4.1pt;line-height:1.75;color:rgba(249,246,239,.85);}'
      + '.hc-bot .valid b{color:#e8d089;font-weight:700;}'
      + '.hc-bot .valid .perms{margin-top:.4mm;color:rgba(200,162,74,.95);font-weight:700;}'
      + '.hc-bot .qr{display:flex;flex-direction:column;align-items:center;gap:.5mm;}'
      + '.hc-bot .qr .box{width:14.5mm;height:14.5mm;background:#fff;border:.35mm solid #c8a24a;border-radius:2.2mm;'
      +   'padding:.8mm;box-shadow:0 0 0 .35mm rgba(200,162,74,.25);}'
      + '.hc-bot .qr .cap{font-size:3.4pt;font-weight:700;letter-spacing:.12em;color:#e8d089;direction:ltr;}'
      + '.hrc-qr-slot svg{width:100%;height:100%;display:block;}'
      /* الوجه الخلفي */
      + '.hc-band{height:8.2mm;margin:-.4mm -1.4mm 1.6mm;position:relative;z-index:2;'
      +   'background:linear-gradient(90deg,#08132a,#0d1f42 50%,#08132a);'
      +   'border-top:.3mm solid rgba(200,162,74,.55);border-bottom:.3mm solid rgba(200,162,74,.55);'
      +   'display:flex;align-items:center;justify-content:center;gap:2.4mm;overflow:hidden;}'
      + '.hc-band .st{width:4.6mm;height:4.6mm;opacity:.8;flex:0 0 auto;}'
      + '.hc-band .txt{font-size:3.2pt;font-weight:700;letter-spacing:.26em;color:rgba(232,208,137,.9);direction:ltr;white-space:nowrap;}'
      + '.hc-codes{display:flex;gap:2.2mm;margin-top:.4mm;position:relative;z-index:2;}'
      + '.hc-codebox{flex:1;border:.3mm solid rgba(200,162,74,.5);border-radius:2.4mm;padding:1.2mm 2mm 1.4mm;'
      +   'background:linear-gradient(180deg,rgba(239,231,214,.94),rgba(233,222,199,.94));}'
      + '.hc-codebox .clbl{font-size:3.7pt;font-weight:900;color:#6b5320;text-align:center;}'
      + '.hc-codebox .code{font-size:8.6pt;font-weight:900;letter-spacing:.18em;color:#231a06;direction:ltr;text-align:center;line-height:1.2;}'
      + '.hc-terms{list-style:none;margin:1.6mm 0 0;position:relative;z-index:2;display:flex;flex-direction:column;gap:.75mm;padding:0;}'
      + '.hc-terms li{font-size:3.7pt;line-height:1.55;color:rgba(249,246,239,.92);padding-inline-start:2.6mm;position:relative;}'
      + '.hc-terms li::before{content:"★";position:absolute;inset-inline-start:0;top:.2mm;font-size:3pt;color:#c8a24a;}'
      + '.hc-terms b{color:#e8d089;}'
      + '.hc-bot2{margin-top:auto;position:relative;z-index:2;text-align:center;}'
      + '.hc-bot2 .phones{font-size:4.4pt;font-weight:700;color:#e8d089;letter-spacing:.05em;}'
      + '.hc-bot2 .addr{font-size:3.6pt;color:rgba(249,246,239,.8);margin-top:.3mm;}'
      + '.hc-bot2 .disc{font-size:3.1pt;color:rgba(249,246,239,.55);margin-top:.8mm;line-height:1.5;}'
      /* معاينة داخل نافذة */
      + '.hrc-card-sheet{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;background:transparent;padding:6px;}'
      /* الطباعة: صفحتان 86×54مم */
      + '@media print{'
      +   '@page{size:86mm 54mm;margin:0;}'
      +   'html,body{background:#fff !important;padding:0 !important;margin:0 !important;}'
      +   '#print-root{display:block !important;position:static !important;width:auto !important;}'
      +   '#print-root .hrc-card{box-shadow:none !important;margin:0 !important;page-break-after:always;break-after:page;border-radius:4.6mm;}'
      +   '#print-root .hrc-card:last-child{page-break-after:auto;break-after:auto;}'
      +   '#print-root .hrc-card-sheet{display:block !important;padding:0 !important;}'
      + '}';
    document.head.appendChild(st);
  }

  /* ======================= أدوات ======================= */
  function qrSvg(text, size) {
    try {
      var model = root.HRCQR.encode(text, 'M');
      return root.HRCQR.renderSVG(model, { margin: 1, size: size || 132, dark: '#0b1a3a', light: '#ffffff' });
    } catch (e) {
      return '<div class="tiny">تعذّر توليد الكيو آر كود</div>';
    }
  }

  function esc(v) { return UI ? UI.esc(String(v == null ? '' : v)) : String(v == null ? '' : v); }

  function fmtCode(code) {
    /* يُطبع الرمز بشرطته نفسها (NNNN-AA) ليطابق حرفياً ما يكتبه الزبون عند التقديم */
    return String(code || '————');
  }

  var EMBLEM = '<svg viewBox="0 0 120 120"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>';
  var STAR8 = '<svg viewBox="0 0 24 24"><use href="#i-star8" xlink:href="#i-star8"/></svg>';
  var CHIP = '<svg class="chip" viewBox="0 0 46 34">'
    + '<rect x="0" y="0" width="46" height="34" rx="4.5" fill="#c8a24a"/>'
    + '<rect x="0" y="0" width="46" height="34" rx="4.5" fill="none" stroke="#8a6d2c" stroke-width="1"/>'
    + '<g fill="none" stroke="#6b5320" stroke-width="1.5" opacity=".85">'
    + '<path d="M7 31V13a7 7 0 0 1 7-7h18a7 7 0 0 1 7 7v18"/>'
    + '<path d="M13 31V15a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v16"/>'
    + '<path d="M2 12h9M2 22h9M35 12h9M35 22h9"/></g>'
    + '<path d="M17 31V18a6 6 0 0 1 12 0v13z" fill="#0b1a3a" opacity=".88"/>'
    + '<path d="M17 31V18a6 6 0 0 1 12 0v13z" fill="none" stroke="#6b5320" stroke-width="1.2"/></svg>';

  /* شارة حالة الفرصة */
  function statBadge(t) {
    var st = (CFG.slotStatus && CFG.slotStatus[t.slotStatus]) || { ar: '—', cls: 'muted' };
    var cls = st.cls === 'ok' ? 'ok' : (st.cls === 'danger' ? 'danger' : 'warn');
    return '<span class="jstat ' + cls + '">' + esc(st.ar) + '</span>';
  }

  /* صف فرصة بالوجه الأمامي: الوظيفة الحالية أو «متاحة» */
  function jobRow(t, no) {
    if (!t || t.slotStatus === 'empty') {
      return '<div class="hc-jobrow"><span class="slotno">الفرصة ' + (no === 1 ? '١' : no) + '</span>'
        + '<span class="free-hint">متاحة — تُستخدم بعد الوظيفة الأولى أو معها</span></div>';
    }
    return '<div class="hc-jobrow"><span class="slotno">الفرصة ' + (no === 1 ? '١' : no) + '</span>'
      + '<span class="jtitle">' + esc(t.jobTitle || '—') + '</span>'
      + '<span class="jcode">' + esc(t.jobCode || '') + '</span>'
      + statBadge(t) + '</div>';
  }

  /* ======================= الوجه الأمامي ======================= */
  /* البطاقة الفارغة (قبل البيع): بلا اسم وبلا هاتف — خطّان للتعبئة، والباركود
     ورمزا الفرصتين موجودان لأنهما هوية البطاقة. الصلاحية تبدأ عند التعبئة. */
  function isBlank(app) {
    /* البطاقة لا تحمل بيانات زبون أبداً (قرار 2026-10-01): «فارغة» تعني
       لم تُبع ولم تُفعّل بعد — البيانات تعيش على استمارة A4 بنفس الباركود. */
    return !app || app.status === 'blank';
  }

  function frontHtml(app, attempts) {
    var cUrl = Store.cardUrl(app.serial);
    var blank = isBlank(app);
    var validLine = blank
      ? '<div>بطاقة <b>فارغة</b> — تُفعّل عند البيع، والصلاحية <b>30 يوماً</b> تبدأ من التعبئة</div>'
      : '<div>أُصدرت: <b>' + esc(Store.fmtDate(app.issueDate)) + '</b> · تنتهي: <b>' + esc(Store.fmtDate(app.expiryDate)) + '</b> (30 يوماً)</div>';
    return ''
      + '<div class="hrc-card">'
      +   '<div class="frame"></div><div class="shine"></div>'
      +   '<svg class="wm" viewBox="0 0 120 120"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>'
      +   '<div class="hc-top">'
      +     '<div class="brand">'
      +       '<svg class="embl" viewBox="0 0 120 120"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>'
      +       '<div><div class="ar">' + esc(CFG.company.nameAr) + '</div>'
      +       '<div class="en">' + esc(CFG.company.nameEn) + '</div></div>'
      +     '</div>'
      +     '<div class="hc-ctype"><span class="t1">بطاقة توظيف</span>'
      +       '<span class="t2">JOB PLACEMENT CARD</span>'
      +       '<span class="serial">' + esc(app.serial) + '</span></div>'
      +   '</div>'
      +   '<div class="hc-main">'
      +     '<div><div class="lbl">بطاقة الزبون — هوية الباركود</div>'
      +       '<div class="name" style="font-size:4.6pt;line-height:1.7;letter-spacing:0">' + (blank
            ? 'بطاقة فارغة — تُفعّل عند البيع وتُعبّأ استمارة الزبون بنفس الباركود'
            : 'بيانات الزبون مطبوعة على استمارة التوظيف المرافقة — بنفس الباركود') + '</div>'
      +     '<div class="lbl" style="margin-top:.8mm">الفرصتان</div>'
      +       '<div class="name" style="font-size:4.6pt;line-height:1.7">فرصتان مستقلتان — رمز كل فرصة بظهر البطاقة</div></div>'
      +     CHIP
      +   '</div>'
      +   '<div class="hc-jobs">'
      +     (attempts[0] ? jobRow(attempts[0], 1) : '')
      +     (attempts[1] ? jobRow(attempts[1], 2) : '')
      +   '</div>'
      +   '<div class="hc-bot">'
      +     '<div class="valid">'
      +       validLine
      +       '<div class="perms">فرصتان مستقلتان · للاستفسار: نقطة البيع أو مقر الشركة</div>'
      +     '</div>'
      +     '<div class="qr"><div class="box hrc-qr-slot">' + qrSvg(cUrl, 132) + '</div>'
      +       '<div class="cap">' + esc(app.serial) + '</div></div>'
      +   '</div>'
      + '</div>';
  }

  /* ======================= الوجه الخلفي ======================= */
  function backHtml(app, attempts) {
    var c1 = attempts[0] ? attempts[0].code : '';
    var c2 = attempts[1] ? attempts[1].code : '';
    return ''
      + '<div class="hrc-card">'
      +   '<div class="frame"></div><div class="shine"></div>'
      +   '<div class="hc-band">'
      +     '<svg class="st" style="color:#c8a24a" viewBox="0 0 24 24"><use href="#i-star8" xlink:href="#i-star8"/></svg>'
      +     '<span class="txt">AL-HADAF RECRUITMENT COMPANY · BABEL — AL-HILLAH</span>'
      +     '<svg class="st" style="color:#c8a24a" viewBox="0 0 24 24"><use href="#i-star8" xlink:href="#i-star8"/></svg>'
      +   '</div>'
      +   '<div class="hc-codes">'
      +     '<div class="hc-codebox"><div class="clbl">رمز الفرصة الأولى</div>'
      +       '<div class="code">' + esc(fmtCode(c1)) + '</div></div>'
      +     '<div class="hc-codebox"><div class="clbl">رمز الفرصة الثانية</div>'
      +       '<div class="code">' + esc(fmtCode(c2)) + '</div></div>'
      +   '</div>'
      +   '<ul class="hc-terms">' + TERMS.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>'
      +   '<div class="hc-bot2">'
      +     '<div class="phones">' + esc(CFG.company.phones[0]) + ' · ' + esc(CFG.company.phones[1]) + '</div>'
      +     '<div class="addr">' + esc(CFG.company.addressShort) + ' · ' + esc(CFG.company.branch || '') + '</div>'
      +     '<div class="disc">' + esc(DISCLAIMER) + ' البطاقة غير قابلة للتنازل وتُلغى عند التلاعب.</div>'
      +   '</div>'
      + '</div>';
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

    document.head.appendChild(st);
  }

  /* بناء الاستمارة — attempt اختيارية (التقديم الجاري أو آخر تقديم) */
  function formHtml(app, attempt) {
    if (!app) return '<div class="hrc-form">لا توجد بيانات</div>';
    ensureFormStyle();
    var attempts = Store.getAttempts(app.serial);
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

    var applied = attempt ? (
      '<div class="ff-grid">'
      + '<div class="ff-f"><div class="k">الوظيفة</div><div class="v">' + esc(attempt.jobTitle || '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">كود الوظيفة</div><div class="v mono" style="direction:ltr">' + esc(attempt.jobCode || '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">المنطقة</div><div class="v">' + esc(attempt.location || '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">الأجر الشهري</div><div class="v">' + (job ? esc(Store.money(job.salaryMin) + ' – ' + Store.money(job.salaryMax)) : '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">الدوام</div><div class="v">' + (job ? esc(job.shift) : '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">حالة التقديم</div><div class="v">' + esc(slotText(attempt)) + '</div></div>'
      + '</div>'
      + '<div class="ff-emp">'
      + '<div class="ff-f" style="grid-column:1/-1"><div class="k" style="font-size:9pt;color:#a8781a;font-weight:900">✦ بيانات التواصل بصاحب العمل</div></div>'
      + '<div class="ff-f"><div class="k">اسم جهة العمل</div><div class="v">' + esc(attempt.employerName || (job ? job.employer.name : '—')) + '</div></div>'
      + '<div class="ff-f"><div class="k">هاتف جهة العمل</div><div class="v mono" style="direction:ltr">' + esc(attempt.employerPhone || (job ? job.employer.phone : '—')) + '</div></div>'
      + '<div class="ff-f"><div class="k">عنوان جهة العمل</div><div class="v">' + esc(job ? job.employer.address : '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">مكان المقابلة</div><div class="v">' + esc(job ? job.interviewLocation : '—') + '</div></div>'
      + '</div>'
      + (attempt.holdExpiresAt && attempt.slotStatus === 'reserved'
           ? '<div class="ff-note">⏳ الحجز مؤقت <b>24 ساعة</b> من وقت التقديم (' + esc(Store.fmtDateTime(attempt.selectedAt)) + ') — '
             + 'على صاحب العمل تسجيل قراره (توظيف/رفض) بمسح الباركود خلال هذه المهلة.</div>' : '')
    ) : '<div class="ff-note">لم يُقدَّم على وظيفة بعد — الفرصتان متاحتان من «بطاقتي» على الموقع أو عند أي نقطة بيع.</div>';

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
      +   '<h3>بيانات الزبون</h3>'
      +   '<div class="ff-grid">'
      +     '<div class="ff-f"><div class="k">الاسم الكامل</div><div class="v">' + esc(app.fullName || '—') + '</div></div>'
      +     '<div class="ff-f"><div class="k">رقم الهاتف</div><div class="v mono" style="direction:ltr">' + esc(app.phone || '—') + '</div></div>'
      +     '<div class="ff-f"><div class="k">العنوان</div><div class="v">' + esc(app.address || '—') + '</div></div>'
      +     '<div class="ff-f"><div class="k">الجنس · تاريخ الميلاد</div><div class="v">' + esc(app.gender || '—') + (app.dob ? ' · ' + esc(Store.fmtDate(app.dob)) : '') + '</div></div>'
      +   '</div>'
      +   '<h3>الوظيفة المطلوبة</h3>'
      +   applied
      +   '<h3>شروط البطاقة</h3>'
      +   '<ul class="ff-terms">' + TERMS.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul>'
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
  function printForm(app, attempt) {
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
    rootEl.innerHTML = formHtml(app, attempt);
    try { Store.audit('طباعة استمارة توظيف', 'applicant', app.serial,
      'طباعة استمارة توظيف A4 بنفس باركود البطاقة — للزبون ' + app.fullName); } catch (e) { }
    function after() {
      if (printSeq !== seq) return;
      rootEl.innerHTML = '';
      pageStyle.textContent = '';
    }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 1600); }, 160);
  }

  /* معاينة الاستمارة داخل نافذة (للشاشة) */
  function previewForm(app, attempt) {
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
  var printSeq = 0;

  function print(app, opts) {
    opts = opts || {};
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّر الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!app) return;
    var attempts = opts.attempts || Store.getAttempts(app.serial);
    var seq = ++printSeq;
    rootEl.innerHTML = '<div class="hrc-card-sheet">' + frontHtml(app, attempts) + backHtml(app, attempts) + '</div>';
    Store.markPrinted(app.serial);
    function after() { if (printSeq === seq) rootEl.innerHTML = ''; }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 1200); }, 120);
  }

  /* طباعة دفعة بطاقات (الفارغة عند الإصدار): كل بطاقة بوجهيها وصفحة خاصة */
  function printBatch(apps) {
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّرت الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!apps || !apps.length) { UI.toast('err', 'تعذّرت الطباعة', 'لا توجد بطاقات بالدفعة'); return; }
    var seq = ++printSeq;
    rootEl.innerHTML = apps.map(function (app) {
      var attempts = Store.getAttempts(app.serial);
      return frontHtml(app, attempts) + backHtml(app, attempts);
    }).join('');
    apps.forEach(function (app) { try { Store.markPrinted(app.serial); } catch (e) { } });
    function after() { if (printSeq === seq) rootEl.innerHTML = ''; }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 1600); }, 160);
  }

  /* معاينة داخل نافذة منبثقة */
  function preview(app) {
    return '<div style="background:#f3ecd9;border:1px solid var(--line-soft);border-radius:12px;padding:18px 20px">'
      + buildHtml(app) + '</div>';
  }

  root.HRCVoucher = {
    buildHtml: buildHtml, print: print, printBatch: printBatch, preview: preview,
    formHtml: formHtml, printForm: printForm, previewForm: previewForm,
    DISCLAIMER: DISCLAIMER, qrSvg: qrSvg, verifyUrl: function (s) { return Store.verifyUrl(s); }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCVoucher;
})(typeof window !== 'undefined' ? window : globalThis);
