/* Lazy-loaded admin console. Snapshots come from the DB, never cached Store.db(). */
(function(root){
 'use strict';
 var Store=root.HRCStore,UI=root.HRCUI,box,loaded=false,busy=false,copies=[];
 function el(tag,text,cls){var node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
 function status(text,error){var node=box.querySelector('[data-recovery-status]');node.textContent=text;node.classList.toggle('recovery-error',!!error);}
 function countText(c){return (c.jobs||0)+' وظيفة · '+(c.applicants||0)+' بطاقة · '+(c.attempts||0)+' فرصة';}
 function lock(value){busy=value;box.setAttribute('aria-busy',String(value));box.querySelectorAll('button').forEach(function(b){b.disabled=value;});}
 async function flush(){
  if(Store.cloudStatus().state!=='on'||Store.cloudStatus().role!=='staff')throw new Error('انتظر اكتمال الاتصال والمزامنة مع القاعدة');
  var result=await Store.pushCloud();
  if(result&&(result.failed||result.error||result.skipped)||Store.cloudQueueLength()>0||Store.diffCloud().length>0)throw new Error('توجد تغييرات لم تكتمل مزامنتها؛ أكمل المزامنة قبل إنشاء النسخة أو معاينتها');
 }
 async function refresh(){
  if(busy)return;lock(true);
  try{var res=await Store.recoveryRPC('list');copies=res.copies||[];paint();loaded=true;status(copies.length?'آخر نسخة ناجحة: '+Store.fmtDateTime(copies[0].createdAt):'لا توجد نسخة محفوظة بعد؛ أنشئ أول نسخة من بيانات القاعدة.');}
  catch(e){status('تعذر قراءة النسخ من القاعدة: '+e.message,true);}
  finally{lock(false);}
 }
 function paint(){
  var list=box.querySelector('[data-recovery-list]');list.replaceChildren();
  if(!copies.length){list.append(el('p','لم تُحفظ نسخ في النظام الجديد بعد.','recovery-empty'));return;}
  copies.forEach(function(copy){
   var row=el('article',undefined,'recovery-copy'),details=el('div');
   details.append(el('h4',copy.name),el('p',Store.fmtDateTime(copy.createdAt)+' · '+countText(copy.counts),'recovery-copy-meta'));
   if(copy.safety)details.append(el('span','نسخة أمان قبل الاسترجاع','recovery-safety'));
   var button=el('button','معاينة واسترجاع','btn btn-outline');button.type='button';button.onclick=function(){preview(copy);};
   var actions=el('div',undefined,'recovery-actions'),remove=el('button','حذف','btn btn-outline btn-sm');remove.type='button';remove.setAttribute('aria-label','حذف النسخة '+copy.name);remove.onclick=function(){removeCopy(copy);};actions.append(button,remove);row.append(details,actions);list.append(row);
  });
 }
 async function removeCopy(copy){
  if(busy)return;
  var ok=await UI.confirm({title:'حذف نسخة محفوظة',danger:true,confirmText:'حذف النسخة',message:'سيحذف ملف النسخة «'+copy.name+'» فقط، وليس بيانات الموقع. لا يمكن التراجع عن حذفها، ولا يسمح بحذف آخر نسخة.'});
  if(!ok)return;lock(true);
  try{await Store.recoveryRPC('remove',copy.id);lock(false);await refresh();UI.toast('ok','حُذفت النسخة','بيانات الموقع لم تتغير.');}catch(e){status(e.message,true);}finally{lock(false);}
 }
 function dialog(opts){
  var background=document.getElementById('app-shell'),previous=document.activeElement,wasInert=background&&background.inert,mount=opts.onMount,closed=opts.onClose;
  opts.onMount=function(modal,close){
   modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',opts.title||'النسخ والاسترجاع');
   if(background)background.inert=true;
   modal.addEventListener('keydown',function(e){if(e.key!=='Tab')return;var nodes=Array.from(modal.querySelectorAll('button,input,select,textarea,a[href]')).filter(function(n){return !n.disabled&&n.getClientRects().length;});var first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
   if(mount)mount(modal,close);
  };
  opts.onClose=function(){if(background)background.inert=!!wasInert;if(previous&&previous.isConnected)previous.focus();if(closed)closed();};
  return UI.modal(opts);
 }
 function create(){
  if(busy)return;
  dialog({title:'إنشاء نسخة من بيانات الموقع',subtitle:'تُحفظ من القاعدة الفعلية، وليس من بيانات المتصفح.',body:'<label class="field">اسم النسخة<input id="recovery-copy-name" maxlength="100" value="نسخة '+UI.esc(Store.fmtDateTime(new Date()))+'"></label><p class="small muted">تشمل الوظائف والبطاقات والفرص وقواعد العمل ورموز صاحب العمل اللازمة للاسترداد. تبقى الحسابات وسجل التدقيق خارج الرجوع الزمني.</p>',footer:'<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-gold" id="recovery-save">حفظ النسخة</button>',onMount:function(modal,close){
   modal.querySelector('#recovery-save').onclick=async function(){
    var button=this;button.disabled=true;lock(true);status('جارٍ إكمال المزامنة وحفظ نسخة مشفرة من القاعدة…');
    try{await flush();await Store.recoveryRPC('create',null,modal.querySelector('#recovery-copy-name').value);close();lock(false);await refresh();UI.toast('ok','حُفظت نسخة الموقع','النسخة مأخوذة من القاعدة الفعلية ومحفوظة مشفرة داخل المشروع.');}
    catch(e){status(e.message,true);button.disabled=false;lock(false);}
   };
  }});
 }
 async function preview(copy){
  if(busy)return;lock(true);status('جارٍ التحقق من النسخة ومقارنتها بالبيانات الحالية…');
  try{await flush();var plan=await Store.recoveryRPC('preview',copy.id);showPlan(copy,plan);status('اكتملت المعاينة؛ لم تبدأ الاستعادة.');}
  catch(e){status(e.message,true);}
  finally{lock(false);}
 }
 function showPlan(copy,plan){
  var risks=plan.risks||{},blocked=!plan.canRestore,restoring=false;
  var body='<div class="recovery-comparison"><div><small>الموقع الآن</small><b>'+UI.esc(countText(plan.current))+'</b></div><div><small>النسخة المختارة · '+UI.esc(Store.fmtDateTime(copy.createdAt))+'</small><b>'+UI.esc(countText(plan.target))+'</b></div></div>';
  body+='<ul class="recovery-risk-list">'+[
   ['وظائف محذوفة ستعود',risks.missingJobs],['وظائف أضيفت بعد النسخة',risks.newJobs],['وظائف تغيّرت',risks.changedJobs],['بطاقات أضيفت بعد النسخة',risks.newCards],['بطاقات تغيّرت',risks.changedCards],['فرص تغيّرت',risks.changedAttempts]
  ].map(function(r){return '<li>'+UI.esc(r[0])+'<b>'+UI.esc(r[1]||0)+'</b></li>';}).join('')+'</ul>';
  if(blocked)body+='<p class="recovery-warning">الاسترجاع متوقف: '+UI.esc(risks.spentChanceConflicts||0)+' تعارض مع فرص مستهلكة، و'+UI.esc(risks.printedCodeConflicts||0)+' تعارض مع رموز/بطاقات مطبوعة. لا تُعاد الفرص ولا تُغيّر الرموز تلقائياً؛ يلزم مراجعة منفصلة.</p>';
  else body+='<p class="recovery-warning">سيُستبدل عمل أحدث حسب المعاينة. تُحفظ نسخة أمان أولاً وتُقفل الكتابة خلال العملية. تُنهى جلسات الموظفين وصاحب العمل ويلزم دخول جديد. الحسابات وسجل التدقيق لا يُسترجعان إلى الماضي، وتُحفظ تغييرات PIN الحالية للوظائف الموجودة.</p><label class="recovery-ack"><input id="recovery-ack" type="checkbox">أفهم أن العمل الأحدث قد يُستبدل، وراجعت المعاينة.</label><label class="field">اكتب «استرجاع» للتأكيد<input id="recovery-phrase" autocomplete="off" maxlength="20"></label>';
  dialog({canClose:function(){return !restoring;},title:'معاينة استرجاع نسخة الموقع',subtitle:copy.name+' · المعاينة صالحة لخمس دقائق؛ تغيّر البيانات يلغي اعتمادها.',wide:true,body:body,footer:'<button class="btn btn-outline" data-close>إلغاء</button>'+(blocked?'':'<button class="btn btn-danger" id="recovery-restore" disabled>استرجاع هذه النسخة</button>'),onMount:function(modal,close){
   if(blocked)return;
   var ack=modal.querySelector('#recovery-ack'),phrase=modal.querySelector('#recovery-phrase'),button=modal.querySelector('#recovery-restore');
   function ready(){button.disabled=restoring||!(ack.checked&&phrase.value.trim()==='استرجاع');}ack.onchange=ready;phrase.oninput=ready;
   button.onclick=async function(){
    if(restoring||button.disabled)return;restoring=true;ack.disabled=true;phrase.disabled=true;button.disabled=true;lock(true);
    try{
     if(Store.diffCloud().length||Store.cloudQueueLength())throw new Error('توجد تغييرات محلية جديدة؛ ألغِ المعاينة وأكمل مزامنتها ثم أعد المعاينة');
     status('جارٍ حفظ نسخة الأمان واسترجاع بيانات الموقع؛ لا تغلق الصفحة…');
     await Store.recoveryRPC('restore',copy.id,'',plan.token);
     restoring=false;close();status('اكتمل الاسترجاع وحُفظت نسخة الأمان. يلزم تسجيل الدخول مجدداً.');UI.toast('ok','اكتمل استرجاع الموقع','أعد تسجيل الدخول لقراءة البيانات المسترجعة.');
     root.setTimeout(function(){root.location.reload();},1500);
    }catch(e){restoring=false;close();status('لم يمكن تأكيد الاسترجاع: '+e.message+' — إذا انقطع الاتصال فقد تكون العملية اكتملت؛ افحص الحالة بعد تسجيل الدخول، ولا تعاودها عشوائياً.',true);}
    finally{lock(false);}
   };
  }});
 }
 root.HRCRecovery={mount:function(){
  if(!Store.isAdmin()||!Store.cloudStatus().enforceAuth)return;
  var target=document.getElementById('recovery-tools');if(!target)return;
  if(box!==target||!target.dataset.recoveryReady){box=target;target.dataset.recoveryReady='yes';
   box.className='recovery-console';
   box.innerHTML='<header class="recovery-head"><div><span class="recovery-eyebrow">حماية بيانات الشركة</span><h3>النسخ الاحتياطي والاسترجاع</h3><p>احفظ نسخة، وارجع لها إذا انحذفت بيانات الموقع بالخطأ.</p></div><button type="button" class="btn btn-gold" id="recovery-create">إنشاء نسخة الآن</button></header><div class="recovery-strip"><span>نسخ مشفرة من القاعدة الفعلية</span><span>استرجاع بصلاحية المدير فقط</span></div><p data-recovery-status role="status">جارٍ الاتصال بخدمة النسخ…</p><div class="recovery-list-head"><h4>النسخ المحفوظة</h4><button type="button" class="btn btn-outline btn-sm" id="recovery-refresh">تحديث القائمة</button></div><div data-recovery-list></div><div class="recovery-scope">الحفظ داخل نفس مشروع القاعدة · Google Drive غير مربوط.<details><summary>نطاق النسخة وملاحظات الأمان</summary><p>استعادة لبيانات التشغيل وروابط الصور، وليست استرداداً لكود الموقع أو ملفات Storage أو حسابات الدخول. لا توجد جدولة تلقائية هنا، ولا تحمي هذه النسخ وحدها من حذف المشروع بالكامل. لقطات المتصفح القديمة ليست جزءاً من النظام الجديد ولم تُحذف.</p></details></div>';
   box.querySelector('#recovery-create').onclick=create;box.querySelector('#recovery-refresh').onclick=refresh;loaded=false;
  }
  if(!loaded&&!busy)refresh();
 }};
 root.HRCRecovery.mount();
})(window);
