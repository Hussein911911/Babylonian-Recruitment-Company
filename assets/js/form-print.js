/* Standalone, visible print preview for customer application forms.
   Keep private data in the opened document's memory, never in a URL or storage. */
(function (root) {
  'use strict';
  function open() {
    var win;
    try { win = root.open('', '_blank'); } catch (e) { return null; }
    if (!win) return null;
    try {
      var doc = win.document;
      doc.open();
      doc.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة استمارة التوظيف</title></head><body></body></html>');
      doc.close();
      var base = doc.createElement('base'); base.href = document.baseURI; doc.head.appendChild(base);
      // Inline styles include the complete application sheet and its local fonts.
      Array.prototype.forEach.call(document.querySelectorAll('head style,head link[rel="stylesheet"]'), function (style) {
        var copy;
        if (style.tagName.toLowerCase() === 'link') { copy=doc.createElement('link');copy.rel='stylesheet';copy.href=style.href; }
        else { copy=doc.createElement('style'); copy.textContent=style.textContent; }
        doc.head.appendChild(copy);
      });
      var style = doc.createElement('style');
      style.textContent = 'html,body{min-height:0!important;height:auto!important;margin:0!important;padding:0!important;background:#eef2f7!important;overflow:visible!important}' +
        '#preview-controls{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:12px;padding:14px;background:#122b4b;color:#fff;font:700 16px sans-serif;position:sticky;top:0;z-index:10}' +
        '#preview-controls button{min-height:48px;padding:10px 20px;border:0;border-radius:10px;background:#e6bf5d;color:#122b4b;font:800 16px sans-serif;cursor:pointer}' +
        '#preview-note{margin:0;line-height:1.6}#print-root{display:block!important;max-width:210mm;margin:12px auto!important;background:white;color:#17263b}' +
        '#print-root .form-sheet,#print-root .hrc-form{display:block!important;max-width:100%;box-sizing:border-box;margin:0 auto;background:white;color:#17263b;visibility:visible!important}' +
        '#print-root .hrc-form{display:flex!important;flex-direction:column}'+
        '#print-root .form-sheet + .form-sheet{break-before:page;page-break-before:always}' +
        '@media print{@page{size:A4;margin:8mm}html,body{background:#fff!important;height:auto!important;overflow:visible!important}' +
        'body>*:not(#print-root){display:none!important}#print-root{display:block!important;position:static!important;width:auto!important;max-width:none!important;margin:0!important}' +
        '#print-root,#print-root *{visibility:visible!important}#print-root .form-sheet,#print-root .hrc-form{box-shadow:none!important;border-radius:0!important;overflow:visible!important}'+
        '#print-root .hrc-form{zoom:.85!important;min-height:0!important;width:220mm!important;max-width:none!important}'+
        '#print-root .form-sheet + .form-sheet{break-before:page;page-break-before:always}}';
      doc.head.appendChild(style);
      var controls=doc.createElement('div'); controls.id='preview-controls';
      var note=doc.createElement('p'); note.id='preview-note'; note.textContent='جارٍ إعداد الاستمارة…'; controls.appendChild(note);
      var button=doc.createElement('button'); button.type='button'; button.textContent='طباعة أو حفظ PDF'; button.disabled=true; controls.appendChild(button);
      var close=doc.createElement('button'); close.type='button'; close.textContent='إغلاق'; close.onclick=function(){win.close();}; controls.appendChild(close);
      button.onclick=function(){
        if(button.disabled)return;
        var fonts=doc.fonts;
        var ready=fonts&&fonts.load?Promise.all([400,600,700,800,900].map(function(w){return fonts.load(w+' 12px Cairo','العراق ABC 123');})).catch(function(){}):Promise.resolve();
        ready.then(function(){try{win.focus();win.print();}catch(e){note.textContent='تعذّر فتح الطباعة. استخدم خيار الطباعة من قائمة المتصفح.';}});
      };
      doc.body.appendChild(controls);
      // The application sheet references a local SVG symbol for the logo.
      var symbol=document.getElementById('i-mkseb');
      if(symbol && symbol.ownerSVGElement){var sprite=symbol.ownerSVGElement.cloneNode(true);sprite.setAttribute('aria-hidden','true');sprite.style.position='absolute';sprite.style.width='0';sprite.style.height='0';doc.body.appendChild(sprite);}
      var host=doc.createElement('main');host.id='print-root';doc.body.appendChild(host);
      return {
        render:function(html){if(win.closed)return false;host.innerHTML=html;note.textContent='تأكد من ظهور الاستمارة أدناه، ثم اضغط طباعة أو حفظ PDF.';button.disabled=false;return true;},
        fail:function(message){if(!win.closed){note.textContent=message||'تعذّر إعداد الاستمارة. أغلق النافذة وأعد المحاولة.';button.disabled=true;}},
        close:function(){if(!win.closed)win.close();}
      };
    } catch(e) { try{win.close();}catch(ignore){} return null; }
  }
  root.HRCFormPrint={open:open};
})(typeof window!=='undefined'?window:this);
