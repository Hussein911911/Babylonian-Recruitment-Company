(function(){
'use strict';
var $=function(id){return document.getElementById(id);},token='',busy=false,epoch=0;
$('serial').value=(new URLSearchParams(location.search).get('form')||'').toUpperCase();
function message(text){$('message').textContent=text||'';$('message').hidden=!text;}
function normalize(text){return String(text).replace(/[٠-٩۰-۹]/g,function(c){return String(c.charCodeAt(0)-(c<='٩'?1632:1776));});}
function reset(){epoch++;token='';$('code').value='';$('reason').value='';$('details').replaceChildren();['job-title','job-code','decision-status'].forEach(function(id){$(id).textContent='';});$('application').hidden=true;$('job-form').hidden=false;$('phase-label').textContent='دخول صاحب العمل';message('');}
async function request(name,args){
 var version=epoch,c=window.HRCSupabaseConfig;
 if(!c||!c.enabled||!/^https:\/\//.test(c.url))throw new Error('خدمة الشركة غير مهيّأة بعد. راجع الإدارة.');
 var r;try{r=await fetch(c.url.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json','Content-Profile':'brc','Accept-Profile':'brc',apikey:c.publishableKey||c.anonKey||''},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),body:JSON.stringify(args)});}catch(e){throw new Error('تعذّر تأكيد الاتصال بخدمة الشركة. تحقق من الشبكة وحاول لاحقاً.');}
 if(version!==epoch)throw new Error('أعد التحقق للدخول مجدداً.');
 var d;try{d=await r.json();}catch(e){throw new Error('رد خدمة الشركة غير متاح. راجع الإدارة.');}
 if(version!==epoch)throw new Error('أعد التحقق للدخول مجدداً.');
 if(!r.ok||!d||!d.ok){if(d&&d.code==='session_expired')reset();throw new Error(d&&typeof d.error==='string'?d.error:r.status===404?'خدمة الرمز السري تحتاج تطبيق تحديث قاعدة البيانات من الشركة.':'تعذّر فتح الطلب أو تسجيل القرار. تحقق من بيانات الدخول أو راجع الشركة.');}return d;
}
async function run(fn){if(busy)return;busy=true;message('');document.querySelectorAll('button').forEach(function(b){b.disabled=true;});try{await fn();}catch(e){message(e.message||'تعذّر إكمال الطلب');}finally{busy=false;document.querySelectorAll('button').forEach(function(b){b.disabled=false;});}}
function show(d){$('job-form').hidden=true;$('application').hidden=false;$('phase-label').textContent='طلب وظيفتك';$('job-title').textContent=d.job.title;$('job-code').textContent=d.job.code+' · '+(d.job.region||'')+' · الشاغر '+Number(d.job.vacancyNo||1);$('details').replaceChildren();[['اسم المتقدم',d.applicant.name],['هاتف المتقدم',d.applicant.phone],['السكن',d.applicant.address],['الجنس',d.applicant.gender]].forEach(function(p){var row=document.createElement('div'),k=document.createElement('dt'),v=document.createElement('dd');k.textContent=p[0];v.textContent=p[1]||'—';row.append(k,v);$('details').append(row);});$('decision-form').hidden=!!d.decision;$('decision-status').textContent=d.decision?(d.decision==='hire'?'سُجّل طلب تثبيت التوظيف بانتظار الشركة.':'سُجّل عدم التوظيف؛ الشاغر المعني معلّق بانتظار قرار الشركة.')+(d.reason?' السبب: '+d.reason:''):'';}
$('code').addEventListener('input',function(){this.value=normalize(this.value).replace(/\D/g,'').slice(0,6);});
$('job-form').addEventListener('submit',function(e){e.preventDefault();run(async function(){var serial=$('serial').value.trim().toUpperCase(),job=$('job').value.trim().toUpperCase(),pin=normalize($('code').value);if(!/^[A-Z0-9-]{3,64}$/.test(serial)||!/^[A-Z0-9-]{3,40}$/.test(job)||!/^\d{6}$/.test(pin))throw new Error('تحقق من رقم البطاقة وكود الوظيفة والرمز السري المكوّن من ٦ أرقام.');var d=await request('employer_pin_login',{p_serial:serial,p_job:job,p_pin:pin});token=d.token;$('code').value='';show(await request('employer_pin_action',{p_session:token}));});});
function decide(decision){if(decision==='reject'&&$('reason').value.trim().length<3){message('اكتب سبباً واضحاً لا يقل عن ٣ أحرف.');return;}if(!window.confirm(decision==='hire'?'تأكيد رفع نتيجة التوظيف إلى الشركة؟':'تأكيد تسجيل عدم التوظيف بالسبب المكتوب؟'))return;run(async function(){show(await request('employer_pin_action',{p_session:token,p_decision:decision,p_reason:$('reason').value.trim()}));});}
$('hire').addEventListener('click',function(){decide('hire');});$('reject').addEventListener('click',function(){decide('reject');});
$('logout').addEventListener('click',function(){var previous=token;reset();run(async function(){await request('employer_pin_action',{p_session:previous,p_decision:'logout'});});});
window.addEventListener('pagehide',reset);
})();
