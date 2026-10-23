// Rescanned, exhausted cards must never expose a new application — and since 2026-10-24 no employer entry either.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../apply.html',import.meta.url),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
let checks=0;const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('✓ '+name);};
for(const remaining of [0,1,2])for(const feedFails of [false,true]){
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://example.test/apply.html?form=CARD-TEST',runScripts:'outside-only',pretendToBeVisual:true});
 try{
 const w=dom.window,$=id=>w.document.getElementById(id);let writes=0;
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HRCHttp={createClient:()=>({rpc:async(name)=>{if(name!=='self_service_card')writes++;return {data:{ok:true,card:{serial:'CARD-TEST',status:remaining===2?'blank':'active',chancesLeft:remaining,profileLocked:remaining<2,profile:{fullName:'اسم خاص للاختبار'},chances:Array.from({length:2},(_,i)=>({no:i+1,slotStatus:i<2-remaining?'reserved':'empty',jobCode:i<2-remaining?'JOB-'+i:'',jobTitle:'عنوان خاص'}))}}};},from:()=>({select:async()=>feedFails?{error:{code:'NETWORK',message:'failed'}}:{data:[]}})})};
 w.eval(inline);await new Promise(r=>setTimeout(r,80));
 if(remaining===0){
  check('exhausted rescan keeps welcome, even if jobs feed fails='+feedFails,$('pg-welcome').classList.contains('active')&&!$('pg-error').classList.contains('active'));
  check('exhausted card exposes no entry button and no employer entry, feedFails='+feedFails,$('btn-start').disabled&&$('btn-start').parentNode.style.display==='none'&&!w.document.querySelector('.employer-link'));
  check('welcome does not reveal applied jobs or owner',!$('welcome-status').textContent.includes('خاص'));
  w.G.start();await new Promise(r=>setTimeout(r,350));
  check('start cannot reopen exhausted application',$('pg-welcome').classList.contains('active')&&writes===0);
 }else if(!feedFails){
  check('remaining '+remaining+' keeps applicant entry visible',!$('btn-start').disabled&&$('btn-start').style.display!=='none');
  w.G.start();await new Promise(r=>setTimeout(r,400));
  check('remaining '+remaining+' opens correct step',$(remaining===1?'pg-jobs':'pg-name').classList.contains('active'));
 }else check('real feed errors still fail closed for applicants',$('pg-error').classList.contains('active'));
 }finally{dom.window.close();}
}
console.log(`Employer entry: ${checks} checks passed.`);
