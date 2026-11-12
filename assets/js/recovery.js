/* Lazy-loaded admin console. Snapshots come from the DB, never cached Store.db(). */
(function(root){
 'use strict';
 var Store=root.HRCStore,UI=root.HRCUI,box,loaded=false,busy=false,copies=[];
 function el(tag,text,cls){var node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
 function status(text,error){var node=box.querySelector('[data-recovery-status]');node.textContent=text;node.classList.toggle('recovery-error',!!error);}
 function countText(c){return (c.jobs||0)+' وظيفة · '+(c.applicants||0)+' بطاقة · '+(c.attempts||0)+' فرصة';}
 function lock(value){busy=value;box.setAttribute('aria-busy',String(value));box.querySelectorAll('button').forEach(function(b){b.disabled=value;});}

 /* ── إصلاح المزامنة العالقة ────────────────────────────────────────────────
  * الحالة الشائعة: تغيير من جهاز/جلسة سابقة بقي في localStorage ولم يُرفع
  * (انقطعت الشبكة أثناء الحفظ)، فيمنع النظام النسخ — وهذا صحيح أمنياً،
  * لأن النسخة يجب أن تعكس القاعدة لا نسخة نصف-مرحّلة. لكن المدير كان
  * يقف عاجزاً بلا زر.
  * الخياران هنا صريحان: (أ) أكمل الرفع — الأصح، يحفظ ما لم يُرفع.
  *                      (ب) تجاهل العالق — للطوارئ فقط، يفقد تلك التغييرات.
  * ──────────────────────────────────────────────────────────────────────── */
 async function retrySync(){
  var note=box.querySelector('[data-recovery-status]');
  if(note){note.classList.remove('recovery-error');note.textContent='جارٍ إكمال المزامنة…';}
  try{
   var res=await Store.pushCloud();
   var failed=res&&(res.failed||res.error||res.skipped);
   var left=Store.cloudQueueLength()+Store.diffCloud().length;
   if(failed||left){
    var why=pendingOf();
    throw new Error('لم تكتمل المزامنة: '+why.join(' · '));
   }
   await refresh();
   UI.toast('ok','اكتملت المزامنة','صار بوسعك إنشاء نسخة الآن.');
  }catch(e){
   if(note){note.classList.add('recovery-error');note.textContent='تعذّرت المزامنة: '+e.message+' — يمكنك «تجاهل التغييرات العالقة» أدناه إن كانت مكرّرة أو غير مهمّة.';}
   showDiscardButton();
  }
 }

 /* زر إعادة المحاولة — الإجراء الأصح أولاً: ارفع ما لم يُرفع */
 function showRetryButton(){
  var note=box.querySelector('[data-recovery-status]');
  if(!note||box.querySelector('#recovery-retry'))return;
  var wrap=el('div',undefined,'recovery-stuck-actions');
  var b=el('button','أكمل المزامنة الآن',undefined);b.type='button';b.id='recovery-retry';b.className='btn btn-gold btn-sm';
  b.onclick=function(){retrySync();};
  wrap.append(b);note.after(wrap);
 }

 /* إظهار زر التجاهل تحت رسالة الحالة مباشرة عند الفشل */
 function showDiscardButton(){
  var note=box.querySelector('[data-recovery-status]');
  if(!note||box.querySelector('#recovery-discard'))return;
  var wrap=el('div',undefined,'recovery-stuck-actions');
  var b=el('button','تجاهل التغييرات العالقة',undefined);b.type='button';b.id='recovery-discard';b.className='btn btn-outline btn-sm';
  b.title='يحذف طابور الرفع المحلي (localStorage) ويعيد قراءة القاعدة. التغييرات التي لم تُرفع ستُفقد.';
  b.onclick=function(){discardStuck();};
  wrap.append(b);note.after(wrap);
 }

 function discardStuck(){
  if(!root.confirm)return;
  var ok=root.confirm('سيُحذف ما لم يُرفع من هذا المتصفح (طابور الرفع + الفروق المحلية) وتُعاد قراءة القاعدة.\n\nهل أنت متأكد؟ البيانات الموجودة في القاعدة لا تتأثر إطلاقاً.');
  if(!ok)return;
  try{
   root.localStorage.removeItem(root.HRCSync.QUEUE_KEY);
   root.localStorage.removeItem('hrc-cloud-snapshot');
   /* مسح ذاكرة الجلسة المحلية يجبر إعادة سحب كامل من القاعدة */
   try{Store.discardLocalDraft&&Store.discardLocalDraft();}catch(e){}
   UI.toast('ok','تم التجاهل','أُعيد تحميل الصفحة لقراءة الحالة الحقيقية من القاعدة.');
   setTimeout(function(){root.location.reload();},600);
  }catch(e){UI.toast('err','تعذّر التجاهل',String(e&&e.message||e));}
 }
 /* ── تشخيص سبب تعذّر المزامنة ───────────────────────────────────────────
  * كان: رسالة واحدة عامة «توجد تغييرات لم تكتمل مزامنتها» — تقول للمدير
  * تعذّر، ولا تقول **ماذا** عالق ولا **لماذا**. فيقف عاجزاً.
  * الآن: نفحص الحالات الثلاث مستقلةً ونقول أين المشكلة بالتحديد،
  * ونُرفق آخر خطأ دفع سجّلته المتصفح إن وُجد.
  * ──────────────────────────────────────────────────────────────────── */
 function pendingOf(){
  /* ما العالق؟ نفحص كل مصدر على حدة بدل شرط واحد مدموج. */
  var st=Store.cloudStatus(), issues=[];
  if(st.state!=='on'||st.role!=='staff') issues.push('الاتصال بالقاعدة غير مكتمل');
  if(st.lastError) issues.push(st.lastError);
  var q=Store.cloudQueueLength();
  if(q>0) issues.push(q+' عملية في طابور الإرسال');
  var d=Store.diffCloud().length;
  if(d>0) issues.push(d+' تغيير في هذا الجهاز لم يُرفع');
  return issues;
 }
 async function flush(){
  var st=Store.cloudStatus();
  if(st.state!=='on'||st.role!=='staff'){
   throw new Error('انتظر اكتمال الاتصال والمزامنة مع القاعدة ثم أعد المحاولة');
  }
  var result=await Store.pushCloud();
  var bad=result&&(result.failed||result.error||result.skipped);
  if(!bad&&Store.cloudQueueLength()===0&&Store.diffCloud().length===0) return;
  /* فشل — نجمع الأسباب ونعرضها في سطر واحد يشرح الحالة */
  var why=pendingOf();
  var t='تعذّر إكمال المزامنة قبل النسخ: '+why.join(' · ');
  /* «skipped» وحدها تعني أن الدفع لم يبدأ أصلاً — نوضّحها */
  if(result&&result.skipped&&!Store.cloudStatus().lastError){
   t='لم تُجرَ المزامنة: الجلسة ليست موظفاً متصلاً بالقاعدة. أعد تحميل اللوحة وسجّل الدخول.';
  }
  throw new Error(t+' — اضغط «معاينة واسترجاع» أو أعد تحميل الصفحة، ثم حاول مجدداً.');
 }
 async function refresh(){
  if(busy)return;lock(true);
  try{var res=await Store.recoveryRPC('list');copies=res.copies||[];paint();loaded=true;
   var good=copies.filter(function(c){return c.restorable!==false;});
   if(!copies.length)status('لا توجد نسخة محفوظة بعد؛ أنشئ أول نسخة من بيانات القاعدة.');
   else if(!good.length)status('لا توجد نسخة قابلة للاسترجاع: شكل قاعدة البيانات تغيّر بعد آخر نسخة. اضغط «إنشاء نسخة الآن» فوراً.',true);
   else status('آخر نسخة ناجحة: '+Store.fmtDateTime(good[0].createdAt)+' — قابلة للاسترجاع.'+((copies.length>good.length)?' ('+(copies.length-good.length)+' نسخة قديمة غير قابلة للاسترجاع)' : ''));}
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
   /* نسخة أقدم من هجرة أعمدة: لا يمكن استرجاعها (recovery_read يرفضها) —
      نوضّحها هنا بدل أن يكتشفها المدير بعد ضغط «معاينة واسترجاع». */
   var stale=copy.restorable===false;
   if(stale)details.append(el('span','غير قابلة للاسترجاع — شكل قاعدة أقدم','recovery-stale'));
   var button=el('button',stale?'غير قابلة للاسترجاع':'معاينة واسترجاع','btn btn-outline');button.type='button';
   if(stale){button.disabled=true;button.title='أُنشئت قبل تغيير أعمدة الجداول؛ أنشئ نسخة جديدة من الزر أعلاه.';}
   else button.onclick=function(){preview(copy);};
   var actions=el('div',undefined,'recovery-actions'),remove=el('button','حذف','btn btn-outline btn-sm');remove.type='button';remove.setAttribute('aria-label','حذف النسخة '+copy.name);remove.onclick=function(){removeCopy(copy);};actions.append(button,remove);row.append(details,actions);list.append(row);
  });
 }
 async function removeCopy(copy){
  if(busy)return;
  var ok=await UI.confirm({title:'حذف نسخة محفوظة',danger:true,confirmText:'حذف النسخة',message:'سيحذف ملف النسخة «'+copy.name+'» فقط، وليس بيانات الموقع. لا يمكن التراجع عن حذفها، ولا يسمح بحذف آخر نسخة.'});
  if(!ok)return;lock(true);
  try{await Store.recoveryRPC('remove',copy.id);lock(false);await refresh();UI.toast('ok','حُذفت النسخة','بيانات الموقع لم تتغير.');}catch(e){status(e.message,true);}finally{lock(false);}
 }

 /* ═══ النسخة المحمولة: تنزيل مشفّر بكلمة مرور المالك ═══════════════════════
    التشفير في المتصفح (Web Crypto) — المفتاح لا يمرّ بالقاعدة، فتبقى النسخة
    قابلة للاسترجاع بعد فقدان المشروع. المكتبة تُحمَّل عند الطلب (9KB) لأن
    اللوحة على سقف ميزانيتها.
    ⛔ حارس: isAdmin() هنا، وStore.recoveryExportFull، وrecovery_export_full. */
 var portableLoading=false;
 function loadPortable(){
  if(root.HRCPortableBackup)return Promise.resolve(root.HRCPortableBackup);
  if(portableLoading)return new Promise(function(res,rej){
   var n=0,t=setInterval(function(){n++;if(root.HRCPortableBackup){clearInterval(t);res(root.HRCPortableBackup);}else if(n>60){clearInterval(t);rej(new Error('تعذّر تحميل وحدة التشفير'));}},100);});
  portableLoading=true;
  return new Promise(function(resolve,reject){
   var js=document.createElement('script');js.src='assets/js/portable-backup.js';
   js.onload=function(){portableLoading=false;resolve(root.HRCPortableBackup);};
   js.onerror=function(){portableLoading=false;reject(new Error('تعذّر تحميل وحدة التشفير — تحقق من الاتصال'));};
   document.head.appendChild(js);
  });
 }
 function portableStatus(text,kind){
  var n=box&&box.querySelector('[data-portable-status]');if(!n)return;
  n.textContent=text||'';n.className=kind==='error'?'is-error':(kind==='ok'?'is-ok':'');
 }
 function portableStrength(pw){
  var score=0;
  if(pw.length>=10)score++;if(pw.length>=14)score++;
  if(/[a-z]/.test(pw)&&/[A-Z]/.test(pw))score++;
  if(/[0-9]/.test(pw))score++;if(/[^a-zA-Z0-9]/.test(pw))score++;
  return score;
 }
 function portableDownload(){
  if(!Store.isAdmin()){UI.toast('err','صلاحية المدير فقط','نسخة الجهاز من صلاحيات المدير العام.');return;}
  loadPortable().then(function(PB){
   var body='<div class="field"><label for="pb-pass">كلمة مرور النسخة *</label>'+
     '<input type="password" id="pb-pass" minlength="'+PB.MIN_PASSWORD+'" autocomplete="new-password" placeholder="عشر محارف على الأقل"></div>'+
     '<div class="field"><label for="pb-pass2">تأكيد كلمة المرور *</label>'+
     '<input type="password" id="pb-pass2" autocomplete="new-password"></div>'+
     '<p class="small muted" id="pb-str" role="status">استخدم كلمة طويلة لا تستعملها في موقع آخر. لا يمكن استعادة هذه الكلمة إن نسيتها.</p>'+
     '<p class="recovery-warning" style="margin-top:12px">الملف يصل إلى <b>كل بيانات الشركة</b> — الوظائف والبطاقات وسجل التدقيق كاملاً. حينها يصبح أي شخص يحصل عليه وكلمةُ مروره قادراً على قراءتها. احفظه في مكان آمن.</p>'+
     '<p class="small" id="pb-err" style="color:#963f35;display:none"></p>';
   UI.modal({title:'تنزيل نسخة محمولة',subtitle:'تُشفَّر في متصفحك — المفتاح لا يُرسَل إلى القاعدة.',
    body:body,footer:'<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-gold" id="pb-go">تنزيل</button>',
    onMount:function(modal,close){
     var p1=modal.querySelector('#pb-pass'),p2=modal.querySelector('#pb-pass2'),err=modal.querySelector('#pb-err'),str=modal.querySelector('#pb-str');
     p1.oninput=function(){
      var sc=portableStrength(p1.value);
      var label=['ضعيفة جداً','ضعيفة','مقبولة','جيدة','قوية'][Math.min(sc,4)];
      str.textContent=p1.value?'القوة: '+label+' — استخدم كلمة طويلة لا تستعملها في موقع آخر.':'استخدم كلمة طويلة لا تستعملها في موقع آخر. لا يمكن استعادة هذه الكلمة إن نسيتها.';
     };
     modal.querySelector('#pb-go').onclick=async function(){
      var btn=this;err.style.display='none';
      if(p1.value.length<PB.MIN_PASSWORD){err.textContent='كلمة المرور قصيرة — الحد الأدنى '+PB.MIN_PASSWORD+' محارف.';err.style.display='block';return;}
      if(p1.value!==p2.value){err.textContent='كلمتا المرور غير متطابقتين.';err.style.display='block';return;}
      btn.disabled=true;err.style.display='none';
      /* تقدّم حقيقي: نُظهر المرحلة كي لا يظن المدير أن الزر علّق على شبكة بطيئة. */
      var t0=Date.now();
      var tick=setInterval(function(){
       var sec=Math.round((Date.now()-t0)/1000);
       btn.textContent='جارٍ التجهيز… '+sec+' ث';
      },1000);
      btn.textContent='جارٍ سحب البيانات…';
      try{
       var data=await Store.recoveryExportFull();
       btn.textContent='جارٍ التشفير…';
       var env=await PB.seal(data,p1.value);
       clearInterval(tick);
       var name=PB.suggestName(new Date());
       UI.download(name,JSON.stringify(env),'application/json;charset=utf-8');
       close();lock(false);
       var c=env.counts||{};
       var trimmed=Number(c.diffTrimmed||0);
       var note='نُزِّلت النسخة: '+(c.applicants||0)+' بطاقة و'+(c.audit||0)+' سجل تدقيق — '+name;
       if(trimmed)note+=' (استُبعد الفرق التفصيلي من '+trimmed+' سجلاً يحمل صوراً مضمّنة)';
       portableStatus(note,'ok');
       UI.toast('ok','نُزِّلت النسخة المشفّرة',name+' — احفظ كلمة المرور؛ بدونها لا تُفتح.');
      }catch(e){
       clearInterval(tick);
       err.textContent=e.message||'تعذّر إنشاء النسخة';err.style.display='block';
       btn.disabled=false;btn.textContent='تنزيل';
      }
     };
    }});
  }).catch(function(e){portableStatus(e.message,'error');});
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
    catch(e){status(e.message,true);button.disabled=false;lock(false);
      /* زر إصلاح فوري بدل رسالة صمّاء: يعيد الرفع، وإن فشل يعرض التجاهل */
      if(box.querySelector('[data-recovery-status]'))showRetryButton();}
   };
  }});
 }
 async function preview(copy){
  if(busy)return;lock(true);status('جارٍ التحقق من النسخة ومقارنتها بالبيانات الحالية…');
  try{await flush();var plan=await Store.recoveryRPC('preview',copy.id);showPlan(copy,plan);status('اكتملت المعاينة؛ لم تبدأ الاستعادة.');}
  catch(e){status(e.message,true);showRetryButton();}
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
 /* ===================== جدولة النسخ التلقائي (المدير) =====================
    تُخزَّن في القاعدة (brc.settings → recovery_schedule) وتُعيد ضبط مهمة
    pg_cron فوراً — لا تعتمد على بقاء هذه الصفحة مفتوحة. */
 var DAYS=[['0','الأحد'],['1','الاثنين'],['2','الثلاثاء'],['3','الأربعاء'],['4','الخميس'],['5','الجمعة'],['6','السبت']];
 function paintSchedule(s){
  var daysBox=box.querySelector('[data-recovery-days]');if(!daysBox)return;
  var picked=(s&&s.days)||[];
  daysBox.replaceChildren();
  DAYS.forEach(function(d){
   var id='recovery-day-'+d[0];
   var label=el('label','','recovery-day');label.setAttribute('for',id);
   var cb=document.createElement('input');cb.type='checkbox';cb.id=id;cb.value=d[0];
   cb.checked=picked.map(String).indexOf(d[0])>=0;label.append(cb,el('span',d[1]));daysBox.append(label);
  });
  var time=box.querySelector('#recovery-sched-time');
  if(time&&s&&s.time)time.value=s.time;
  var on=!!(s&&s.enabled);
  var badge=box.querySelector('[data-recovery-sched-badge]');
  if(badge){badge.textContent=on?'مُفعّلة':'موقوفة';badge.classList.toggle('is-off',!on);}
  var note=box.querySelector('[data-recovery-sched-note]');
  if(note){
   if(!s)note.textContent='';
   else if(!on)note.textContent='لا نسخة تلقائية الآن — «حفظ الجدولة» بعد اختيار يوم يعيد التفعيل.';
   else note.textContent='التالية: '+(s.nextRunText||'')+(s.lastRunText?' · آخر نسخة: '+s.lastRunText:'');
  }
 }
 function readScheduleDays(){
  return [].slice.call(box.querySelectorAll('[data-recovery-days] input:checked')).map(function(i){return Number(i.value);});
 }
 function nextRunText(days,time){
  if(!days.length)return '';
  var now=new Date(),pad2=function(n){return (n<10?'0':'')+n;};
  var parts=String(time||'23:00').split(':'),hh=Number(parts[0])||0,mm=Number(parts[1])||0;
  for(var i=0;i<8;i++){
   var d=new Date(now.getTime()+i*86400000);
   if(days.indexOf(d.getDay())<0)continue;
   var slot=new Date(d.getFullYear(),d.getMonth(),d.getDate(),hh,mm,0,0);
   if(slot.getTime()<=now.getTime())continue;
   return new Intl.DateTimeFormat('ar-IQ',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Baghdad'}).format(slot);
  }
  return '';
 }
 async function loadSchedule(){
  if(!box)return;
  try{
   var s=await Store.recoveryScheduleGet();
   s.nextRunText=nextRunText((s.days||[]).map(Number),s.time);
   s.lastRunText=s.lastRun?Store.fmtDateTime(s.lastRun):'';
   paintSchedule(s);
  }catch(e){
   var note=box.querySelector('[data-recovery-sched-note]');
   if(note)note.textContent='تعذّرت قراءة الجدولة: '+e.message;
   var badge=box.querySelector('[data-recovery-sched-badge]');
   if(badge)badge.textContent='غير متاحة';
  }
 }
 async function saveSchedule(off){
  var note=box.querySelector('[data-recovery-sched-note]');
  var btn=box.querySelector('#recovery-sched-save');
  var days=off?[]:readScheduleDays();
  var time=(box.querySelector('#recovery-sched-time')||{}).value||'23:00';
  if(!off&&!days.length){if(note){note.textContent='اختر يوماً واحداً على الأقل، أو اضغط «إيقاف التلقائي».';note.classList.add('is-error');}return;}
  if(note){note.classList.remove('is-error');note.textContent='جارٍ الحفظ…';}
  if(btn)btn.disabled=true;
  try{
   var s=await Store.recoveryScheduleSet(days,time);
   s.nextRunText=nextRunText((s.days||[]).map(Number),s.time);
   s.lastRunText=s.lastRun?Store.fmtDateTime(s.lastRun):'';
   paintSchedule(s);
   UI.toast('ok',off?'أُوقفت الجدولة':'حُفظت الجدولة',off?'لا نسخة تلقائية حتى تعيد التفعيل.':'تسري من اللحظة داخل القاعدة.');
  }catch(e){
   if(note){note.textContent='تعذّر الحفظ: '+e.message;note.classList.add('is-error');}
   UI.toast('err','تعذّر حفظ الجدولة',e.message);
  }finally{if(btn)btn.disabled=false;}
 }
 root.HRCRecovery={mount:function(){
  if(!Store.isAdmin()||!Store.cloudStatus().enforceAuth)return;
  var target=document.getElementById('recovery-tools');if(!target)return;
  if(box!==target||!target.dataset.recoveryReady){box=target;target.dataset.recoveryReady='yes';
   box.className='recovery-console';
   box.innerHTML='<header class="recovery-head"><div><span class="recovery-eyebrow">حماية بيانات الشركة</span><h3>النسخ الاحتياطي والاسترجاع</h3><p>احفظ نسخة، وارجع لها إذا انحذفت بيانات الموقع بالخطأ.</p></div><button type="button" class="btn btn-gold" id="recovery-create">إنشاء نسخة الآن</button></header><div class="recovery-strip"><span>نسخ مشفرة من القاعدة الفعلية</span><span>استرجاع بصلاحية المدير فقط</span></div><p data-recovery-status role="status">جارٍ الاتصال بخدمة النسخ…</p><section class="recovery-schedule" aria-labelledby="recovery-sched-title"><div class="recovery-schedule-head"><div><h4 id="recovery-sched-title">جدولة النسخ التلقائي</h4><p>يحددها المدير: اختر الأيام والساعة (بتوقيت بغداد)، وتُنفَّذ داخل القاعدة نفسها حتى لو كانت اللوحة مغلقة.</p></div><span class="recovery-sched-badge" data-recovery-sched-badge>جارٍ القراءة…</span></div><div class="recovery-days" data-recovery-days role="group" aria-label="أيام النسخ التلقائي"></div><div class="recovery-sched-foot"><label class="field" for="recovery-sched-time">الساعة<input type="time" id="recovery-sched-time" value="23:00" step="300"></label><button type="button" class="btn btn-gold btn-sm" id="recovery-sched-save">حفظ الجدولة</button><button type="button" class="btn btn-outline btn-sm" id="recovery-sched-off">إيقاف التلقائي</button><span class="recovery-sched-note" data-recovery-sched-note role="status"></span></div></section><section class="portable-backup" aria-labelledby="portable-title"><h4 id="portable-title">نسخة محمولة تنزل على جهازك</h4><p>تُشفَّر في متصفحك بكلمة مرور تختارها أنت — المفتاح لا يُخزَّن في القاعدة. لذلك تبقى قابلة للاسترجاع حتى لو ضاع المشروع كله، بخلاف النسخ أعلاه المشفّرة بمفتاح داخل القاعدة نفسها. تختار مسار الحفظ من نافذة المتصفح.</p><div class="portable-row"><button type="button" class="btn btn-gold btn-sm" id="portable-download">تنزيل نسخة إلى الجهاز</button><a class="portable-help" href="restore.html" target="_blank" rel="noopener">أداة الاسترجاع المستقلّة ↗</a></div><p data-portable-status role="status"></p></section><div class="recovery-list-head"><h4>النسخ المحفوظة</h4><button type="button" class="btn btn-outline btn-sm" id="recovery-refresh">تحديث القائمة</button></div><div data-recovery-list></div><div class="recovery-scope">الحفظ داخل نفس مشروع القاعدة · Google Drive غير مربوط.<details><summary>نطاق النسخة وملاحظات الأمان</summary><p>استعادة لبيانات التشغيل وروابط الصور، وليست استرداداً لكود الموقع أو ملفات Storage أو حسابات الدخول. الجدولة أعلاه يضبطها المدير وتُنفَّذ داخل القاعدة، لكنها لا تحمي من حذف المشروع بالكامل. لقطات المتصفح القديمة ليست جزءاً من النظام الجديد ولم تُحذف.</p></details></div>';
   box.querySelector('#recovery-create').onclick=create;box.querySelector('#recovery-refresh').onclick=refresh;
   box.querySelector('#recovery-sched-save').onclick=function(){saveSchedule(false);};
   box.querySelector('#recovery-sched-off').onclick=function(){saveSchedule(true);};
   var pd=box.querySelector('#portable-download');if(pd)pd.onclick=portableDownload;
   var t=box.querySelector('#recovery-sched-time');if(t)t.onchange=function(){
     var note=box.querySelector('[data-recovery-sched-note]');
     if(note){note.classList.remove('is-error');note.textContent='التالية: '+nextRunText(readScheduleDays(),t.value);}
   };
   paintSchedule(null);
   loaded=false;
  }
  if(!loaded&&!busy){refresh();loadSchedule();}
 }};
 root.HRCRecovery.mount();
})(window);
