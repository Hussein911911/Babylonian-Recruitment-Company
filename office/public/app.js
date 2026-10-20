'use strict';
const $=id=>document.getElementById(id);let state=null;
const labels={reserve:'طلب حجز',activate:'طلب تعبئة بطاقة',job_note:'ملاحظة وظيفة',pending:'بانتظار المزامنة',sending:'جارٍ التحقق',done:'معتمد في الموقع',conflict:'تعارض — يحتاج مراجعة',blocked:'موقوف — يلزم تحقق',expired:'طلب قديم — يحتاج مراجعة',cancelled:'ملغي محلياً'};
function message(text){$('message').textContent=text;}
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':state?.csrf||''},body:body?JSON.stringify(body):undefined,cache:'no-store'});const value=await r.json();if(!r.ok){if(r.status===401){state=null;render();}throw new Error(value.error||'تعذر الاتصال بالمكتب المحلي');}return value;}
function render(){
 $('login').hidden=!!state;$('workspace').hidden=!state;if(!state){for(const id of ['outbox','cards','job'])$(id).replaceChildren();for(const id of ['serial','fullName','phone','posName','address','note'])$(id).value='';$('employee').textContent='';$('connection').textContent='يلزم دخول رسمي';return;}
 $('employee').textContent=state.profile.name+' · '+state.profile.username;
 $('connection').textContent=state.error?'الطلبات محفوظة محلياً':'بوابة الشركة المحلية';
 const date=v=>v?new Date(v).toLocaleString('ar-IQ'):'لم يتم بعد';
 $('snapshot-at').textContent=date(state.snapshot?.at);$('sync-at').textContent=date(state.lastSync);$('backup-at').textContent=date(state.backup?.at);
 const db=state.databaseBackup;const late=db?.nextPlanned&&Date.parse(db.nextPlanned)<Date.now();$('database-backup').textContent=db?(db.state==='failed'?'فشل آخر تنفيذ — ':late?'متأخر عن الخطة — ':'')+'آخر نجاح: '+date(db.lastSuccess)+' · الموعد المخطط: '+date(db.nextPlanned)+' · ليست تجربة استعادة':'غير مجهزة؛ لا نجاح متحقق بعد';
 const selected=$('job').value;$('job').replaceChildren();for(const j of state.snapshot?.jobs||[]){const o=document.createElement('option');o.value=j.code;o.textContent=j.code+' — '+j.title+' · '+({available:'متاحة',reserved:'محجوزة',hiring:'بانتظار تثبيت الشركة',closed:'مغلقة'}[j.status]||j.status);$('job').append(o);}if([...$('job').options].some(o=>o.value===selected))$('job').value=selected;
 $('cards').replaceChildren();for(const a of state.snapshot?.applicants||[]){const o=document.createElement('option');o.value=a.serial;o.label=a.full_name||'بطاقة فارغة';$('cards').append(o);}
 $('outbox').replaceChildren();for(const op of [...state.outbox].reverse()){
  const item=document.createElement('article');item.className='item';item.dataset.status=op.status;
  const title=document.createElement('h3');title.textContent=(labels[op.kind]||op.kind)+' · '+op.data.jobCode;item.append(title);
  for(const text of [labels[op.status]||op.status,op.data.serial||'',op.data.fullName||op.data.note||'',op.message||''])if(text){const p=document.createElement('p');p.textContent=text;item.append(p);}
  const time=document.createElement('time');time.textContent=date(op.createdAt);item.append(time);
  if(['pending','conflict','expired'].includes(op.status)){const b=document.createElement('button');b.className='subtle';b.textContent='إلغاء الطلب المحلي';b.onclick=()=>run(async()=>{await api('cancel',{id:op.id});await refresh();});item.append(b);}
  $('outbox').append(item);
 }
 if(!state.outbox.length)$('outbox').textContent='لا توجد طلبات محلية بعد.';
}
async function refresh(){state=await api('state');render();}
async function run(fn){const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){message(e.message);}finally{buttons.forEach(b=>b.disabled=false);}}
$('login-form').onsubmit=e=>{e.preventDefault();run(async()=>{const password=$('password').value;$('password').value='';state=await api('login',{username:$('username').value,password});render();message('تم التحقق من الحساب. الطلبات المحلية ليست قرارات نهائية حتى المزامنة.');});};
$('kind').onchange=()=>{const kind=$('kind').value;$('customer').hidden=kind!=='activate';$('card-field').hidden=kind==='job_note';$('note-field').hidden=kind!=='job_note';};
$('operation').onsubmit=e=>{e.preventDefault();run(async()=>{const data={kind:$('kind').value,jobCode:$('job').value};for(const k of ['serial','fullName','phone','posName','address','note'])data[k]=$(k).value;await api('operations',data);$('operation').reset();$('kind').onchange();await refresh();message('حُفظ الطلب مشفّراً على سيرفر المكتب — بانتظار التحقق والمزامنة، وليس حجزاً نهائياً.');});};
$('sync').onclick=()=>run(async()=>{state=await api('sync',{});render();message(state.error||'اكتملت محاولة المزامنة؛ راجع حالات الطلبات.');});
$('logout').onclick=()=>run(async()=>{await api('logout',{});state=null;render();message('تم الخروج. الطلبات محفوظة، ولا تعود للمزامنة بعد الخروج إلا بدخول صاحبها الرسمي؛ الطلب المرسل فعلاً قد يكتمل.');});
setInterval(()=>{if(state)void refresh().catch(e=>message(e.message));},15000);void refresh().catch(()=>{});
