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
 /* ── الحفظ المباشر على USB ────────────────────────────────────────────────
  * طلب المدير (2026-11-15): «مسار مباشر بضغطة زر» إلى الفلاش.
  *
  * الحقيقة التقنية: لا متصفح يسمح لصفحة بكتابة `D:\HRC-Backups` بنفسها —
  * لو سمح، لأمكن لأي موقع أن يمسح ملفات المستخدم. لذلك نستخدم واجهة
  * متصفح قياسية (File System Access API، مدعومة في Chrome/Edge):
  *   • تفتح حافظ الملفات مرة واحدة ويختار المستخدم مجلد الـUSB.
  *   • الملف يُكتب هناك **مباشرة**، لا في مجلد التنزيلات.
  *   • يُخزَّن المقبض في IndexedDB، فبعدها يُفتح على نفس المجلد بضغطة.
  *   • بعد الكتابة نُعيد قراءة الملف ونقارن بصمته — لا نثق برسالة «تم».
  *
  * ⚠️ إن لم يتوفر (Firefox/Safari/سياق غير آمن) نرجع للتنزيل العادي،
  *    والنسخة تبقى سليمة، فقط المسار يدوي.
  * ──────────────────────────────────────────────────────────────────────── */
 var USB_DB='hrc-usb',USB_STORE='dirs',USB_KEY='usbBackupDir';
 function usbSupported(){
  return !!(root.showSaveFilePicker&&root.isSecureContext);
 }
 function usbIdb(){
  return new Promise(function(resolve,reject){
   if(!root.indexedDB)return reject(new Error('IndexedDB غير متاح'));
   var rq=root.indexedDB.open(USB_DB,1);
   rq.onupgradeneeded=function(){try{rq.result.createObjectStore(USB_STORE);}catch(e){}};
   rq.onsuccess=function(){resolve(rq.result);};
   rq.onerror=function(){reject(new Error('تعذّر فتح مخزن تذكّر المجلد'));};
  });
 }
 function usbRemember(handle){
  return usbIdb().then(function(db){
   return new Promise(function(resolve){
    try{
     var tx=db.transaction(USB_STORE,'readwrite');
     tx.objectStore(USB_STORE).put(handle,USB_KEY);
     tx.oncomplete=function(){db.close();resolve(true);};
     tx.onerror=function(){db.close();resolve(false);};
    }catch(e){db.close();resolve(false);}
   });
  }).catch(function(){return false;});
 }
 function usbRecall(){
  return usbIdb().then(function(db){
   return new Promise(function(resolve){
    try{
     var tx=db.transaction(USB_STORE,'readonly');
     var rq=tx.objectStore(USB_STORE).get(USB_KEY);
     rq.onsuccess=function(){db.close();resolve(rq.result||null);};
     rq.onerror=function(){db.close();resolve(null);};
    }catch(e){db.close();resolve(null);}
   });
  }).catch(function(){return null;});
 }
 /* هل بقي الإذن قائماً على المقبض؟ المتصفح قد يبطله بعد إغلاق كامل. */
 async function usbPermission(handle,request){
  if(!handle||!handle.queryPermission)return false;
  try{
   var opts={mode:'readwrite'};
   if((await handle.queryPermission(opts))==='granted')return true;
   if(!request)return false;
   return (await handle.requestPermission(opts))==='granted';
  }catch(e){return false;}
 }
 function usbPick(){
  return root.showSaveFilePicker({
   suggestedName:'hrc-backup.hrcbak',
   types:[{description:'نسخة احتياطية مشفّرة',accept:{'application/json':['.hrcbak']}}]
  });
 }
 /* يكتب النص ثم **يقرأه من جديد** ويقارن البصمة. لا يكفي onsuccess. */
 async function usbWrite(handle,text){
  var w=await handle.createWritable();
  try{await w.write(new Blob([text],{type:'application/json;charset=utf-8'}));}
  finally{await w.close();}
  var back=await handle.getFile();
  if(back.size!==new Blob([text]).size)throw new Error('حجم الملف على الـUSB لا يطابق الأصل');
  var buf=await back.arrayBuffer();
  if(root.crypto&&root.crypto.subtle){
   var digest=await root.crypto.subtle.digest('SHA-256',buf);
   var hex=Array.prototype.map.call(new Uint8Array(digest),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
   var src=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
   var srcHex=Array.prototype.map.call(new Uint8Array(src),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
   if(hex!==srcHex)throw new Error('بصمة الملف على الـUSB لا تطابق الأصل');
   return hex.slice(0,16);
  }
  return null;
 }
 /* تغيير المسار: يفتح حافظة **مجلدات** ويحفظ الاختيار.
  * طلب المدير: «أريد نغيّر المسار مباشر لأي مجلد نريده ويبقى محفوظاً».
  * نستخدم showDirectoryPicker إن توفّر — أوضح من حافظة ملفات، لأن المدير
  * يختار مجلداً لا ملفاً. ويبقى الاختيار في IndexedDB للاستعمالات القادمة.
  * ──────────────────────────────────────────────────────────────────────── */
 async function usbChooseFolder(){
  if(root.showDirectoryPicker){
   var dir=await root.showDirectoryPicker({mode:'readwrite',id:'hrc-usb',startIn:'desktop'});
   var ok=await usbPermission(dir,true);
   if(!ok)throw new Error('لم يُمنح الإذن للكتابة في المجلد');
   await usbRemember(dir);
   return dir;
  }
  /* احتياط: حافظة ملفات — نحفظ أباها كإشارة، لكن نكتب على الملف المختار. */
  var f=await usbPick();
  await usbRemember(f);
  return f;
 }
 /* حلّ المقبض إلى ملف قابل للكتابة داخل المجلد (أو الملف نفسه). */
 async function usbTargetFile(handle,name){
  if(handle&&handle.kind==='directory'){
   return await handle.getFileHandle(name,{create:true});
  }
  return handle;
 }
 /* يتحقق أن الملف موجود فعلاً داخل المجلد بعد الكتابة.
  * القاعدة: «تم» من المتصفح ليست دليلاً — نقرأ القائمة من القرص. */
 async function verifyInFolder(dirHandle,name){
  if(!dirHandle||typeof dirHandle.values!=='function')return;
  for await (var entry of dirHandle.values()){
   if(entry&&entry.name===name)return true;
  }
  throw new Error('لم أجد الملف داخل المجلد بعد الكتابة — أعد المحاولة');
 }
 function portableDownload(){
  if(!Store.isAdmin()){UI.toast('err','صلاحية المدير فقط','نسخة الجهاز من صلاحيات المدير العام.');return;}
  loadPortable().then(function(PB){
   var body=(usbSupported()?
     '<div class="pb-dest" id="pb-dest">'+
      '<div class="pb-dest-head"><b>مجلد الحفظ</b>'+
      '<button type="button" class="btn btn-outline btn-sm" id="pb-usb-change">تغيير…</button></div>'+
      '<div class="pb-dest-path" id="pb-usb-where" role="status">جارٍ القراءة…</div>'+
     '</div>':'')+
     '<div class="field"><label for="pb-pass">كلمة مرور النسخة *</label>'+
     '<input type="password" id="pb-pass" minlength="'+PB.MIN_PASSWORD+'" autocomplete="new-password" placeholder="عشر محارف على الأقل"></div>'+
     '<div class="field"><label for="pb-pass2">تأكيد كلمة المرور *</label>'+
     '<input type="password" id="pb-pass2" autocomplete="new-password"></div>'+
     '<p class="small muted" id="pb-str" role="status">استخدم كلمة طويلة لا تستعملها في موقع آخر. لا يمكن استعادة هذه الكلمة إن نسيتها.</p>'+
     (usbSupported()?'<div class="field" style="margin-top:14px"><label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="pb-usb" checked style="margin-top:4px"><span><b>حفظ مباشرة في المجلد المحدّد</b><br><span class="small muted">إن لم يكن هناك مجلد محفوظ ستُفتح نافذة اختيار. بعد ذلك يُحفظ الاختيار، وقد يطلب Chrome تأكيداً صغيراً فقط.</span></span></label>'+
 '</div>':'')+
     '<p class="recovery-warning" style="margin-top:12px">الملف يصل إلى <b>كل بيانات الشركة</b> — الوظائف والبطاقات وسجل التدقيق كاملاً. حينها يصبح أي شخص يحصل عليه وكلمةُ مروره قادراً على قراءتها. احفظه في مكان آمن.</p>'+
     '<p class="small" id="pb-err" style="color:#963f35;display:none"></p>';
   UI.modal({title:'تنزيل نسخة محمولة',subtitle:'تُشفَّر في متصفحك — المفتاح لا يُرسَل إلى القاعدة.',
    body:body,footer:'<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-gold" id="pb-go">تنزيل</button>',
    onMount:function(modal,close){
     var p1=modal.querySelector('#pb-pass'),p2=modal.querySelector('#pb-pass2'),err=modal.querySelector('#pb-err'),str=modal.querySelector('#pb-str');
     /* المجلد المحفوظ: نُظهره بالاسم فقط — المتصفح لا يكشف المسار الكامل
        (هذا قيد متصفح، لا تقصير). المدير يرى أين ستُحفظ النسخة. */
     var where=modal.querySelector('#pb-usb-where'),changeBtn=modal.querySelector('#pb-usb-change');
     function paintWhere(){
      if(!where)return;
      /* ⚠️ بلاغ المدير (2026-11-15): «عند اختيار مجلد يبقى اسم المجلد
         مو يختفي». السبب: كان زر التغيير يكتب «جارٍ الاختيار…» ثم
         «تم — المجلد محفوظ» في **نفس** السطر الذي يحمل الاسم، ثم يمسحه
         بمؤقّت. النتيجة: اسم المجلد يختفي بعد ثانيتين.
         القاعدة الآن: سطر المسار يحمل **الاسم فقط**، ولا يكتب فيه أي
         رسالة مؤقتة. حالات الأزرار لها عنصر مستقلّ. */
      usbRecall().then(async function(h){
       if(!h){
        where.textContent='لم يُحدَّد بعد — سيُطلب الاختيار عند أول تنزيل.';
        where.classList.add('is-unset');
        return;
       }
       where.classList.remove('is-unset');
       var granted=false;
       try{granted=(await h.queryPermission({mode:'readwrite'}))==='granted';}catch(e){}
       /* الاسم يبقى دائماً — والشارة تُضاف بجانبه لا بدلاً منه. */
       where.textContent='';
       var nameEl=document.createElement('span');
       nameEl.className='pb-dest-name';
       nameEl.textContent=h.name;
       var badge=document.createElement('span');
       badge.className='pb-dest-badge'+(granted?' is-ok':'');
       badge.textContent=granted?'جاهز':'يطلب تأكيداً';
       where.appendChild(nameEl);
       where.appendChild(badge);
      });
     }
     paintWhere();
     if(changeBtn)changeBtn.onclick=async function(){
      var label=changeBtn.textContent;
      changeBtn.disabled=true;changeBtn.textContent='جارٍ الاختيار…';
      try{
       await usbChooseFolder();
       await paintWhere();          /* الاسم يُحدَّث فوراً — لا يختفي */
       changeBtn.textContent='تم';
      }catch(e){
       changeBtn.textContent=(e&&e.name==='AbortError')?'أُلغي':'تعذّر';
      }
      changeBtn.disabled=false;
      root.setTimeout(function(){changeBtn.textContent=label;},1500);
     };
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
      var usbBox=modal.querySelector('#pb-usb');
      var wantUsb=!!(usbBox&&usbBox.checked);
      /* تقدّم حقيقي: نُظهر المرحلة كي لا يظن المدير أن الزر علّق على شبكة بطيئة. */
      var t0=Date.now();
      var tick=setInterval(function(){
       var sec=Math.round((Date.now()-t0)/1000);
       btn.textContent='جارٍ التجهيز… '+sec+' ث';
      },1000);
      btn.textContent='جارٍ سحب البيانات…';
      try{
       /* ⚠️ ترتيب حرج — نتيجة تجربة المدير الفعلية (2026-11-15):
          نزل الملف في مجلد التنزيلات بدل الـUSB.
          السبب: كنا نفتح نافذة الحفظ **بعد** سحب البيانات وتشفيرها.
          وقد يستغرق ذلك ثوانٍ، فيفقد المتصفح «تفعيل المستخدم» (user activation)
          الذي تشترطه File System Access API — فيرفض فتح النافذة ويرجع للتنزيل.
          الحل: نفتح النافذة **أولاً، فوراً بعد الضغط**، ثم نأخذ المقبض
          ونكتب فيه بعد انتهاء التشفير. النافذة تبقى صالحة. */
       var handle=null,usbCancelled=false;
       if(wantUsb&&usbSupported()){
        /* ⚠️ باگ أصلحه (بلاغ المدير 2026-11-15): «اختار المجلد، أنطي حفظ،
           أريد أنطي تنزيل — يرجع يطلب اختيار ملف».
           السبب: كنا نستعلم عن الإذن بـrequest=false فقط. حين يرجع 'prompt'
           (وهو الحال بعد إغلاق المتصفح أو انقضاء مدة) كان الكود يظنّ أنه لا
           مقبض، فيفتح الحافظة من الصفر رغم أن الاختيار محفوظ.
           الصحيح: request=true — يُظهر شريط إذن صغيراً («السماح») ويُبقي
           المجلد المحفوظ، بدل إجباره على إعادة الاختيار بأكمله. */
        var remembered=await usbRecall();
        if(remembered&&await usbPermission(remembered,true))handle=remembered;
        if(!handle){
         try{handle=await usbChooseFolder();}
         catch(pickErr){
          if(pickErr&&pickErr.name==='AbortError'){usbCancelled=true;}
         }
        }
       }
       if(usbCancelled){
        clearInterval(tick);
        btn.disabled=false;btn.textContent='تنزيل';
        err.textContent='لم تُحفظ النسخة — أُلغيت نافذة اختيار المجلد. أعد المحاولة واختر مجلد HRC-Backups على الـUSB.';
        err.style.display='block';
        return;
       }
       btn.textContent='جارٍ سحب البيانات…';
       var data=await Store.recoveryExportFull();
       btn.textContent='جارٍ التشفير…';
       var env=await PB.seal(data,p1.value);

       /* ═══ فحص ذاتي إلزامي قبل تسليم الملف ════════════════════════════════
          بلاغ المالك (2026-11-15): «أكتب رمز النسخة وأنزلها، وأجي أقراها
          وأفكّ التشفير بنفس الرمز يكلي خطأ — مع العلم نفس الرمز».

          درسٌ من تجربة مريرة: أي خلل في التشفير لا يظهر إلا عند الاستعادة،
          أي بعد أسابيع، وربما في يوم حاجةٍ حقيقية. وذاك أسوأ وقت لاكتشافه.

          فنقلب الفحص: نُفكّ النسخة **الآن، هنا، بنفس الكلمة، قبل أن تُكتب
          على الـUSB**. إن فشلت — لا نسلّم شيئاً، بل نُظهر خطأً صريحاً.
          الكلفة: أقل من ثانية. المكسب: يستحيل أن يخرج ملف لا يُفتح. */
       btn.textContent='جارٍ التحقق من النسخة…';
       var selfCheck;
       try{
        if(typeof PB.open!=='function'){
         /* لا وحدة فكّ متاحة (بيئة بلا WebCrypto — ولا يمكن أن تُشفّر أصلاً).
            لا نُسقط التنزيل بسبب حارسٍ عاجز عن الفحص. */
         throw {skip:true};
        }
        var round=await PB.open(JSON.stringify(env),p1.value);
        var a=(round.payload&&round.payload.applicants||[]).length;
        var b=(data&&data.applicants||[]).length;
        if(a!==b){selfCheck='عدد البطاقات بعد الفكّ '+a+' والمتوقع '+b;}
       }catch(checkErr){
        selfCheck=checkErr&&checkErr.skip?null:(checkErr&&checkErr.message)||'سبب غير معروف';
       }
       if(selfCheck){
        clearInterval(tick);
        btn.disabled=false;btn.textContent='تنزيل';
        err.textContent='⛔ أُوقفت العملية: النسخة التي أُنشئت لا تُفتح بنفس كلمة المرور ('+selfCheck+'). لم تُحفظ أي نسخة — أعد المحاولة، وإن تكرر فأبلغ الدعم.';
        err.style.display='block';
        return;
       }
       clearInterval(tick);
       var name=PB.suggestName(new Date());
       var payload=JSON.stringify(env);
       var saved=null,finger=null,fallback=false,savedIsFolder=false;
       if(handle){
        btn.textContent='جارٍ الكتابة على الـUSB…';
        try{
         var fileHandle=await usbTargetFile(handle,name);
         finger=await usbWrite(fileHandle,payload);
         /* ⚠️ بلاغ المدير (2026-11-15): «أنطي تنزيل ينزل لاسم المجلد مو
            ينكتبلي تم التنزيل للـUSB».
            السبب: كنا نأخذ `handle.name` — وهو اسم **المجلد** في وضع
            showDirectoryPicker — لا اسم **الملف** المكتوب. فيظهر السطر
            كأنه يذكر المجلد فقط، ولا يثبت أن الملف موجود.
            الصحيح: نسمّي الملف صراحة، ونقرأ قائمة المجلد بعد الكتابة
            ونتأكد أن الاسم موجود فعلاً. لا نثق بمقبض ولا برسالة متصفح. */
         if(handle.kind==='directory'){
          await verifyInFolder(handle,name);
          saved=handle.name+' / '+name;
          savedIsFolder=true;
         }else{
          /* حافظة ملفات: الاسم الصحيح هو اسم الملف الذي اختاره المستخدم. */
          saved=fileHandle&&fileHandle.name?fileHandle.name:handle.name||name;
          savedIsFolder=false;
         }
         await usbRemember(handle);
        }catch(writeErr){
         /* فشل الكتابة أو فشل التحقق: لا ندّعي نجاحاً — نرجع للتنزيل
            العادي كي لا يبقى المدير بلا نسخة أبداً. */
         fallback=true;handle=null;
        }
       }
       if(!saved){
        var savedName=name;
        UI.download(name,payload,'application/json;charset=utf-8');
        fallback=true;
       }
       close();lock(false);
       var c=env.counts||{};
       var trimmed=Number(c.diffTrimmed||0);
       /* الرسالة تقول **أين** و**ماذا** بالضبط — لا «تم» غامضة. */
       var counts=(c.applicants||0)+' بطاقة و'+(c.audit||0)+' سجل تدقيق';
       var note,title,detail;
       if(saved){
        var whereText=savedIsFolder?('المجلد: '+saved.split(' / ')[0]+'\nالملف: '+saved.split(' / ')[1])
                                   :('الملف: '+saved);
        title=savedIsFolder?('حُفظت في '+saved.split(' / ')[0]):'حُفظت النسخة';
        detail=counts+(finger?' · بصمة '+finger:'')+' · تحقّقت من الملف بعد الكتابة.';
        portableStatus('✓ حُفظت النسخة\n'+whereText+'\n'+detail,'ok');
       }else{
        title='نُزّلت إلى التنزيلات';
        detail=name+' — '+counts+'\nلم يُستخدم المجلد المحدّد؛ ابحث عن الملف في مجلد التنزيلات (Downloads) وانقله إلى الـUSB.';
        portableStatus('نُزّلت النسخة إلى مجلد التنزيلات — لم تُكتب في المجلد المحدّد.\n'+detail,'ok');
       }
       if(trimmed){
        var trimmedNote='استُبعد الفرق التفصيلي من '+trimmed+' سجلاً يحمل صوراً مضمّنة.';
        portableStatus(document.querySelector('.portable-backup [data-portable-status]').textContent+'\n'+trimmedNote,'ok');
       }
       UI.toast('ok',title,detail);
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
  /* النمط (2026-11-14): interval = كل عدد ساعات · days = أيام محدّدة */
  var mode=(s&&MODES.indexOf(s.mode)>=0)?s.mode:'days';
  var rb=box.querySelector('#recovery-mode-'+mode);
  if(rb)rb.checked=true;
  if(mode==='interval'){
    var hoursSel=box.querySelector('#recovery-sched-hours');
    if(hoursSel&&s&&s.hours)hoursSel.value=String(s.hours);
  }
  if(mode==='every_days'){
    var nSel=box.querySelector('#recovery-sched-days-n');
    if(nSel&&s&&s.hours)nSel.value=String(s.hours);
  }
  paintMode(mode);
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
 /* إظهار/إخفاء الحقول حسب النمط المختار — لا نُخفي عنصراً عن قارئ الشاشة
    بلا سبب: days يخصّ «أيام محدّدة» فقط، hours يخصّ «كل عدد ساعات» فقط. */
 function paintMode(mode){
  /* كل نمط يُظهر حقوله فقط — ونطفي القراءة عن الحقول المخفيّة كي لا يقرأها
     قارئ الشاشة ولا يجمعها الكود بالخطأ. */
  var show={interval:mode==='interval',every_days:mode==='every_days',days:mode==='days'};
  var iv=box.querySelector('[data-recovery-interval]');
  var ed=box.querySelector('[data-recovery-everydays]');
  var dd=box.querySelector('[data-recovery-days]');
  if(iv)iv.hidden=!show.interval;
  if(ed)ed.hidden=!show.every_days;
  if(dd)dd.hidden=!show.days;
  /* «كل يوم» و«أيام محدّدة» و«كل N يوم» تحتاج كلّها خانة الساعة */
  var note=box.querySelector('[data-recovery-sched-note]');
  if(note)note.classList.remove('is-error');
 }
 var MODES=['interval','daily','every_days','days'];
 function readScheduleMode(){
  var r=box.querySelector('[data-recovery-mode] input:checked');
  return r&&MODES.indexOf(r.value)>=0?r.value:'days';
 }
 function readScheduleDays(){
  return [].slice.call(box.querySelectorAll('[data-recovery-days] input:checked')).map(function(i){return Number(i.value);});
 }
 /* الحساب التالي — للنمط الدوري.
    القاعدة في SQL تُنتج `utc_h/N` أي «ابدأ من utc_h ثم كل N ساعة»، إذن أول
    تشغيل هو الساعة المختارة نفسها (بتوقيت بغداد) ثم تتكرر كل N.
    نُظهر التاريخ مع الساعة للمدير ليتأكد بنفسه. */
 /* موعد التشغيل القادم بوقت بغداد. للأنماط الثلاثة (interval/daily/every_days)
    الموعد هو «الساعة المختارة، اليوم أو غداً» — لأن الكرون يفحص عندها.
    ⚠️ في نمط «كل N يوم» هذه لحظة **الفحص** لا لحظة النسخة: النسخة تُؤخذ فقط
    إن مضى N يوم. نقولها للمدير صراحةً بدل إيهامه بموعد نسخة. */
 function nextRunText2(time){
  var parts=String(time||'23:00').split(':'),hh=Number(parts[0])||0,mm=Number(parts[1])||0;
  var now=new Date();
  var start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),hh,mm,0,0);
  if(start.getTime()<=now.getTime())start=new Date(start.getTime()+86400000);
  return new Intl.DateTimeFormat('ar-IQ',{weekday:'long',day:'numeric',month:'long',
    hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Baghdad'}).format(start);
 }
 function nextRunIntervalText(hours,time,daysN){
  if(daysN&&daysN>1)return 'الفحص '+nextRunText2(time)+' — والنسخة كل '+daysN+' يوم';
  return nextRunText2(time);
 }
 /* الموعد القادم لكل نمط — مكان واحد كي لا تتناقض النصوص بين الأزرار */
 function computeNext(s){
  if(!s)return '';
  var mode=s.mode,hrs=Number(s.hours)||0;
  if(mode==='interval')return nextRunIntervalText(hrs||24,s.time);
  if(mode==='daily')return nextRunText2(s.time);
  if(mode==='every_days')return nextRunIntervalText(0,s.time,hrs||1);
  return nextRunText((s.days||[]).map(Number),s.time);
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
   s.nextRunText=computeNext(s);
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
  var mode=readScheduleMode();
  var days=off?[]:readScheduleDays();
  var time=(box.querySelector('#recovery-sched-time')||{}).value||'23:00';
  var hours=0;
  if(!off){
    if(mode==='interval')hours=Number((box.querySelector('#recovery-sched-hours')||{}).value)||4;
    else if(mode==='every_days')hours=Number((box.querySelector('#recovery-sched-days-n')||{}).value)||7;
    else if(mode==='daily')hours=1;
  }
  if(!off&&mode==='days'&&!days.length){if(note){note.textContent='اختر يوماً واحداً على الأقل، أو اضغط «إيقاف التلقائي».';note.classList.add('is-error');}return;}
  if(!off&&mode==='interval'&&!hours){if(note){note.textContent='اختر عدد الساعات.';note.classList.add('is-error');}return;}
  if(!off&&mode==='every_days'&&!hours){if(note){note.textContent='اختر عدد الأيام.';note.classList.add('is-error');}return;}
  if(note){note.classList.remove('is-error');note.textContent='جارٍ الحفظ…';}
  if(btn)btn.disabled=true;
  try{
   var s=off?await Store.recoveryScheduleOff()
             :await Store.recoveryScheduleSet({mode:mode,hours:hours,days:days,time:time});
   s.nextRunText=computeNext(s);
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
   /* ═══ بنية اللوحة — مرتّبة في ثلاث طبقات واضحة ═══════════════════════
     طلب المدير (2026-11-15): «راجع صفحة التنزيل والاسترجاع وترتيبهن بشكل
     احترافي بلا أخطاء».
     الترتيب الجديد يتبع **قرار المستخدم** لا ترتيب الكود القديم:
        ①  نسخة فورية (أهم شي: حماية الآن)
        ②  جدولة تلقائية (حماية مستمرة)
        ③  النسخ المحفوظة (مراجعة واسترجاع)
     كل طبقة في بطاقة مستقلة بترقيم وعنوان وحالة — لا خليط. */
   box.innerHTML=
    '<header class="recovery-head">'+
     '<div><span class="recovery-eyebrow">حماية بيانات الشركة</span>'+
     '<h3>النسخ الاحتياطي والاسترجاع</h3>'+
     '<p>نسخة داخل الموقع تلقائياً، ونسخة على جهازك بكلمة مرورك.</p></div>'+
     '<button type="button" class="btn btn-gold" id="recovery-create">إنشاء نسخة الآن</button>'+
    '</header>'+

    '<div class="recovery-strip">'+
     '<span>🔒 نسخ مشفّرة من القاعدة الفعلية</span>'+
     '<span>👤 استرجاع بصلاحية المدير فقط</span>'+
     '<span>🗓️ الجدولة تُنفَّذ داخل القاعدة</span>'+
    '</div>'+

    '<p class="recovery-msg" data-recovery-status role="status">جارٍ الاتصال بخدمة النسخ…</p>'+

    /* ① نسخة على جهازك */
    '<section class="recovery-card" aria-labelledby="rc-portable">'+
     '<div class="recovery-card-head">'+
      '<span class="recovery-card-num">١</span>'+
      '<div><h4 id="rc-portable">نسخة على جهازك — الآن</h4>'+
      '<p>تُشفَّر في متصفحك بكلمة مرور تختارها. المفتاح لا يُخزَّن في القاعدة، '+
      'فتبقى قابلة للاسترجاع حتى لو ضاع المشروع كله. تحفظها في مجلد تحدّده أنت (فلاش USB مثلاً).</p></div>'+
     '</div>'+
     '<div class="recovery-card-body">'+
      '<div class="portable-row">'+
       '<button type="button" class="btn btn-gold btn-sm" id="portable-download">تنزيل نسخة إلى جهازي</button>'+
       '<a class="portable-help" href="restore.html" target="_blank" rel="noopener">أداة الاسترجاع المستقلّة ↗</a>'+
      '</div>'+
      '<p data-portable-status role="status"></p>'+
     '</div>'+
    '</section>'+

    /* ② الجدولة */
    '<section class="recovery-card" aria-labelledby="rc-sched">'+
     '<div class="recovery-card-head">'+
      '<span class="recovery-card-num">٢</span>'+
      '<div><h4 id="rc-sched">جدولة النسخ التلقائي</h4>'+
      '<p>يحددها المدير بتوقيت بغداد، وتُنفَّذ داخل القاعدة حتى لو كانت اللوحة مغلقة. '+
      'تُحفظ آخر ٣ نسخ، والأقدم يُحذف تلقائياً.</p></div>'+
      '<span class="recovery-sched-badge" data-recovery-sched-badge>جارٍ القراءة…</span>'+
     '</div>'+
     '<div class="recovery-card-body">'+
      '<div class="recovery-mode" data-recovery-mode role="radiogroup" aria-label="نمط الجدولة">'+
       '<label class="recovery-mode-opt"><input type="radio" name="recovery-mode" value="interval" id="recovery-mode-interval"><span>كل عدد ساعات</span></label>'+
       '<label class="recovery-mode-opt"><input type="radio" name="recovery-mode" value="daily" id="recovery-mode-daily"><span>كل يوم</span></label>'+
       '<label class="recovery-mode-opt"><input type="radio" name="recovery-mode" value="every_days" id="recovery-mode-every_days"><span>كل عدد أيام</span></label>'+
       '<label class="recovery-mode-opt"><input type="radio" name="recovery-mode" value="days" id="recovery-mode-days"><span>أيام محدّدة</span></label>'+
      '</div>'+
      '<div class="recovery-interval" data-recovery-interval hidden>'+
       '<label class="field" for="recovery-sched-hours">كل</label>'+
       '<select id="recovery-sched-hours"><option value="1">ساعة</option><option value="2">ساعتين</option>'+
       '<option value="3">٣ ساعات</option><option value="4">٤ ساعات</option><option value="6">٦ ساعات</option>'+
       '<option value="8">٨ ساعات</option><option value="12">١٢ ساعة</option><option value="24">٢٤ ساعة</option></select>'+
       '<span class="recovery-hours-hint">تبدأ من الساعة أدناه، ثم تتكرر كل المدة المختارة.</span>'+
      '</div>'+
      '<div class="recovery-everydays" data-recovery-everydays hidden>'+
       '<label class="field" for="recovery-sched-days-n">كل</label>'+
       '<select id="recovery-sched-days-n"><option value="1">يوم</option><option value="2">يومين</option>'+
       '<option value="3">٣ أيام</option><option value="5">٥ أيام</option><option value="7">٧ أيام</option>'+
       '<option value="14">١٤ يوم</option><option value="30">٣٠ يوم</option><option value="60">٦٠ يوم</option>'+
       '<option value="90">٩٠ يوم</option></select>'+
       '<span class="recovery-hours-hint">نفحص كل يوم في الساعة أدناه، ولا تُؤخذ النسخة إلا عند حلول الموعد.</span>'+
      '</div>'+
      '<div class="recovery-days" data-recovery-days role="group" aria-label="أيام النسخ التلقائي"></div>'+
      '<div class="recovery-sched-foot">'+
       '<label class="field" for="recovery-sched-time">الساعة'+
       '<input type="time" id="recovery-sched-time" value="23:00" step="300"></label>'+
       '<button type="button" class="btn btn-gold btn-sm" id="recovery-sched-save">حفظ الجدولة</button>'+
       '<button type="button" class="btn btn-outline btn-sm" id="recovery-sched-off">إيقاف التلقائي</button>'+
       '<span class="recovery-sched-note" data-recovery-sched-note role="status"></span>'+
      '</div>'+
     '</div>'+
    '</section>'+

    /* ③ المحفوظات */
    '<section class="recovery-card" aria-labelledby="rc-list">'+
     '<div class="recovery-card-head">'+
      '<span class="recovery-card-num">٣</span>'+
      '<div><h4 id="rc-list">النسخ المحفوظة داخل الموقع</h4>'+
      '<p>آخر ٣ نسخ مجدولة. نسخ الأمان لا تُحذف أبداً.</p></div>'+
      '<button type="button" class="btn btn-outline btn-sm" id="recovery-refresh">تحديث</button>'+
     '</div>'+
     '<div class="recovery-card-body" data-recovery-list></div>'+
    '</section>'+

    '<div class="recovery-scope">'+
     '<details><summary>ما تشمله النسخة وما لا تشمله</summary>'+
     '<p><b>تشمل:</b> الوظائف · البطاقات · الفرص · سجل التدقيق · الإعدادات · أرقام البطاقات المُصدرة · الحسابات (بلا كلمات مرور).</p>'+
     '<p><b>لا تشمل:</b> كود الموقع · ملفات الصور في Storage · كلمات مرور الحسابات · إعدادات مشروع Supabase.</p>'+
     '<p>النسخة داخل الموقع تُشفَّر بمفتاح داخلها، فلا تحمي من حذف المشروع. '+
     'النسخة المحمولة (١) مفتاحها كلمة مرورك، فتبقى صالحة بعد فقدان المشروع.</p>'+
     '</details></div>';

   box.querySelector('#recovery-create').onclick=create;box.querySelector('#recovery-refresh').onclick=refresh;
   box.querySelector('#recovery-sched-save').onclick=function(){saveSchedule(false);};
   box.querySelector('#recovery-sched-off').onclick=function(){saveSchedule(true);};
   var pd=box.querySelector('#portable-download');if(pd)pd.onclick=portableDownload;
   /* ربط النمط: التغيير يُظهر الحقول المناسبة فوراً بلا حفظ */
   box.querySelectorAll('[data-recovery-mode] input').forEach(function(r){
     r.onchange=function(){paintMode(readScheduleMode());refreshNext();};
   });
   var t=box.querySelector('#recovery-sched-time');
   /* كل مغيّر يُعيد حساب «التالية» فوراً — بلا حفظ */
   function refreshNext(){
     var note=box.querySelector('[data-recovery-sched-note]');
     if(!note)return;
     note.classList.remove('is-error');
     var m=readScheduleMode(),tv=t?t.value:'23:00';
     if(m==='interval'){
       var h=Number((box.querySelector('#recovery-sched-hours')||{}).value)||4;
       note.textContent='التالية: '+nextRunIntervalText(h,tv);
     }else if(m==='every_days'){
       var n=Number((box.querySelector('#recovery-sched-days-n')||{}).value)||7;
       note.textContent='التالية: '+nextRunIntervalText(0,tv,n);
     }else if(m==='daily'){
       note.textContent='التالية: '+nextRunText2(tv);
     }else{
       note.textContent='التالية: '+nextRunText(readScheduleDays(),tv);
     }
   }
   var hs=box.querySelector('#recovery-sched-hours');
   if(hs)hs.onchange=refreshNext;
   var dn=box.querySelector('#recovery-sched-days-n');
   if(dn)dn.onchange=refreshNext;
   paintSchedule(null);
   loaded=false;
  }
  if(!loaded&&!busy){refresh();loadSchedule();}
 }};
 root.HRCRecovery.mount();
})(window);
