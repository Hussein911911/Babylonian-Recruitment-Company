/* On-demand, read-only historical search. Never imports records into the sync DB. */
(function(root){
'use strict';
root.HRCArchive={open:function(Store,UI){
 if(!Store.currentUser())return;
 var owner=JSON.stringify(Store.currentUser()),page=0,ticket=0,query='';
 function permitted(box){return document.contains(box)&&JSON.stringify(Store.currentUser())===owner;}
 UI.modal({title:'السجل الكامل والأرشيف',wide:true,
 body:'<p class="tiny muted">البطاقات محفوظة بدون حذف. الأرشفة بعد 60 يوماً من الحسم النهائي أو انتهاء الصلاحية، ولا تشمل أي تقديم معلّق. النتائج للمراجعة فقط؛ لا تعيد فرصة أو شاغراً.</p><form id="history-form" class="flex" style="gap:8px;flex-wrap:wrap"><label for="history-query">رقم البطاقة أو الاسم أو الهاتف</label><input id="history-query" maxlength="120" autocomplete="off"><button class="btn btn-lapis" type="submit">بحث في القاعدة</button></form><p id="history-status" role="status" aria-live="polite"></p><div id="history-results"></div><div class="flex" style="gap:12px;flex-wrap:wrap"><button id="history-prev" class="btn btn-outline">السابق</button><span id="history-page"></span><button id="history-next" class="btn btn-outline">التالي</button></div>',
 footer:'<button class="btn btn-outline" data-close>إغلاق</button>',
 onMount:function(box){
  var status=box.querySelector('#history-status'),results=box.querySelector('#history-results'),prev=box.querySelector('#history-prev'),next=box.querySelector('#history-next');
  function load(){
   var id=++ticket;status.textContent='جاري البحث…';prev.disabled=next.disabled=true;results.replaceChildren();
   Store.searchCardHistory(query,page).then(function(data){
    if(id!==ticket||!permitted(box))return;
    status.textContent=data.cards.length?'50 بطاقة كحد أقصى لكل صفحة؛ البحث يشمل السجل الحالي والمؤرشف.':'لا توجد بطاقات مطابقة.';
    box.querySelector('#history-page').textContent='صفحة '+(page+1);prev.disabled=page===0;next.disabled=!data.hasMore;
    results.innerHTML=data.cards.map(function(a,i){return '<div class="data-item" style="margin:10px 0"><b class="mono">'+UI.esc(a.serial)+'</b> · '+UI.esc(a.fullName||'بدون اسم')+' · '+(a.archivedAt?'مؤرشفة':'غير مؤرشفة')+' <button class="btn btn-outline btn-sm" data-history-card="'+i+'">عرض التفاصيل</button></div>';}).join('');
    results.querySelectorAll('[data-history-card]').forEach(function(b){b.onclick=function(){
     if(!permitted(box))return;var a=data.cards[Number(b.dataset.historyCard)];
     function row(k,v){return '<div class="data-item"><b>'+UI.esc(k)+'</b>: '+UI.esc(v||'—')+'</div>';}
     var body=row('الاسم',a.fullName)+row('الهاتف',a.phone)+row('العنوان',a.address)+row('حالة البطاقة',(((root.HRC_CONFIG||{}).formStatus||{})[a.status]||{}).ar||a.status)+row('تاريخ التفعيل',a.issueDate)+row('انتهاء الصلاحية',a.expiryDate)+row('آخر حسم',a.finishedAt)+row('الأرشفة',a.archivedAt)+row('الملاحظات',a.notes);
     body+=(a.attempts||[]).map(function(t){return '<section class="data-item">'+row('فرصة البطاقة',String(t.no))+row('الوظيفة',(t.jobCode||'—')+' · '+(t.jobTitle||''))+row('شاغر الوظيفة',t.vacancyNo?String(t.vacancyNo):'لم يحدد')+UI.slotBadge(t.slotStatus)+row('التقديم',t.selectedAt)+row('الحسم',t.closedAt)+row('قرار صاحب العمل',t.employerDecision)+row('السبب',t.reason)+row('ملاحظة',t.note)+'</section>';}).join('');
     UI.modal({title:'مراجعة البطاقة '+a.serial,wide:true,body:body,footer:'<button class="btn btn-outline" data-close>إغلاق</button>'});
    };});
   }).catch(function(e){if(id!==ticket||!permitted(box))return;status.textContent=e.message||'تعذر البحث؛ تحقق من الاتصال';prev.disabled=page===0;});
  }
  box.querySelector('#history-form').onsubmit=function(e){e.preventDefault();query=box.querySelector('#history-query').value.trim();page=0;load();};
  prev.onclick=function(){if(page>0){page--;load();}};next.onclick=function(){page++;load();};load();
 }
 });
}};
})(typeof window!=='undefined'?window:globalThis);
