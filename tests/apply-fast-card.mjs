import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync('apply.html','utf8');
const dom=new JSDOM(html,{url:'https://example.test/apply.html?form=7KQ4M9TR2X',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window; w.scrollTo=()=>{};
const originalTimeout=w.setTimeout.bind(w);
w.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===20000?60:ms,...args);
let releaseJobs, calls=0;
w.HRCHttp={createClient:()=>({rpc:()=>Promise.resolve({data:{ok:true,card:{serial:'7KQ4M9TR2X',status:'blank',profile:{},chancesLeft:2,chances:[{no:1,slotStatus:'empty'},{no:2,slotStatus:'empty'}]}},error:null}),from:()=>({select:()=>{calls++;return new Promise(r=>{releaseJobs=r;});}})})};
w.eval(readFileSync('assets/js/iraq-admin.js','utf8'));
w.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(100);
assert.equal(calls,1,'jobs request started independently');
assert.equal(w.document.querySelector('#pg-error').classList.contains('active'),false,'jobs delay must not cause card timeout');
w.G.start();
assert.equal(w.document.body.getAttribute('data-step'),'1','blank card can start before jobs arrive');
assert.equal(w.G.currentJobs().length,0,'no stale jobs are shown');
releaseJobs({data:[{code:'HRC-TEST',title:'Test',status:'available'}],error:null});
await wait(20);
assert.equal(w.G.currentJobs().length,1);
const dots=w.document.querySelectorAll('.card-job-banner-dot'),img=w.document.querySelector('#card-banner-image'),info=w.document.querySelector('#card-banner-info');
assert.equal(dots.length,2,'exactly two banner controls');
info.open=true; w.G.showCardBanner(1);
assert.match(img.getAttribute('src'),/banner-2\.webp$/,'second control shows second image');
assert.equal(dots[1].getAttribute('aria-pressed'),'true');
assert.equal(dots[0].getAttribute('aria-pressed'),'false');
assert.equal(info.hidden,true);assert.equal(info.open,false);
w.G.showCardBanner(0);
assert.match(img.getAttribute('src'),/banner\.webp$/,'first control restores first image');
assert.equal(dots[0].getAttribute('aria-pressed'),'true');assert.equal(info.hidden,false);
const stage=w.document.querySelector('.card-job-banner-stage');
function pointer(type,x,y){const e=new w.Event(type,{bubbles:true});Object.assign(e,{pointerType:'touch',pointerId:1,clientX:x,clientY:y});img.dispatchEvent(e);}
pointer('pointerdown',220,45);pointer('pointerup',80,48);
assert.match(img.getAttribute('src'),/banner-2\.webp$/,'swipe left selects second image');
pointer('pointerdown',80,45);pointer('pointerup',220,48);
assert.match(img.getAttribute('src'),/banner\.webp$/,'swipe right selects first image');
pointer('pointerdown',160,10);pointer('pointerup',145,110);
assert.match(img.getAttribute('src'),/banner\.webp$/,'vertical scrolling does not change slide');
assert.equal(dots[0].getAttribute('aria-pressed'),'true');

assert.equal(calls,1);
dom.window.close();
console.log('PASS card starts independently of delayed fresh jobs and watchdog');
async function setup(cardReply, jobFactory) {
  const d=new JSDOM(html,{url:'https://example.test/apply.html?form=7KQ4M9TR2X',runScripts:'outside-only',pretendToBeVisual:true});
  const x=d.window; x.scrollTo=()=>{};
  const timeout=x.setTimeout.bind(x);x.setTimeout=(fn,ms,...args)=>timeout(fn,ms===20000?60:ms,...args);
  x.HRCHttp={createClient:()=>({rpc:()=>Promise.resolve(cardReply),from:()=>({select:jobFactory})})};
  x.eval(readFileSync('assets/js/iraq-admin.js','utf8'));
  x.eval(html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1]);
  await wait(100); return d;
}
const stuck=()=>new Promise(()=>{});
const bad=await setup({data:null,error:{message:'rejected',code:'42501'}},stuck);
assert.equal(bad.window.document.querySelector('#pg-error').classList.contains('active'),true,'card errors are not blocked by jobs');
bad.window.close();
const used=await setup({data:{ok:true,card:{serial:'7KQ4M9TR2X',status:'active',profile:{fullName:'Test'},chancesLeft:0,chances:[{no:1,slotStatus:'reserved',jobCode:'HRC-1042'}]}},error:null},stuck);
assert.equal(used.window.document.querySelector('#pg-error').classList.contains('active'),false,'used card details do not wait for jobs');
assert.match(used.window.document.querySelector('#welcome-title').textContent,/اكتمل/);
used.window.close();
let jobCalls=0;
const retry=await setup({data:{ok:true,card:{serial:'7KQ4M9TR2X',status:'active',profile:{fullName:'Test'},profileLocked:true,chancesLeft:1,chances:[{no:1,slotStatus:'reserved',jobCode:'HRC-OLD',jobTitle:'وظيفة سابقة'},{no:2,slotStatus:'empty'}]}},error:null},()=>{jobCalls++;return Promise.resolve(jobCalls===1?{error:{message:'offline'}}:{data:[{code:'HRC-1042',title:'Test',status:'available'}],error:null});});
assert.equal(retry.window.G.currentJobs().length,0);
retry.window.G.start(); await wait(20);
assert.equal(jobCalls,2,'locked profile retries unavailable jobs on start');
assert.equal(retry.window.G.currentJobs().length,1);
retry.window.G.start();
assert.equal(retry.window.document.body.getAttribute('data-step'),'6');
const rw=retry.window, bar=rw.document.querySelector('#chances-bar'), chosen=rw.document.querySelector('#chosen-jobs'), list=rw.document.querySelector('#chosen-jobs-list');
assert.match(bar.textContent,/فرصة واحدة فقط/);assert.match(bar.textContent,/١ مستخدمة/);assert.match(bar.textContent,/١ متبقية من ٢/);
assert.equal(bar.querySelectorAll('.chance-segment').length,2);assert.equal(bar.querySelectorAll('.chance-segment.is-used').length,1);
assert.match(list.textContent,/HRC-OLD/);assert.match(list.textContent,/تم التقديم/);
chosen.open=true;rw.G.pickJob('HRC-1042');
assert.match(list.textContent,/HRC-1042/);assert.match(list.textContent,/مختارة للمراجعة/);
assert.match(bar.textContent,/١ متبقية من ٢/,'selection alone must not consume an opportunity');
rw.G.removePickedJob(0);assert.doesNotMatch(list.textContent,/HRC-1042/);assert.equal(chosen.open,true);
for(const total of [1,3,5,10]){
 const d=await setup({data:{ok:true,card:{serial:'7KQ4M9TR2X',status:'active',profile:{},chancesLeft:total-1,chances:Array.from({length:total},(_,i)=>({no:i+1,slotStatus:i?'empty':'reserved',jobCode:i?'':'OLD'}))}},error:null},()=>Promise.resolve({data:[],error:null}));
 d.window.G.renderChances();const b=d.window.document.querySelector('#chances-bar');assert.equal(b.querySelectorAll('.chance-segment').length,total);assert.equal(b.querySelectorAll('.chance-segment.is-used').length,1);d.window.close();
}
/* بطاقة بلا خانات فرص (chances:[] من قراءة ناقصة): البطاقة لا تبقى فارغة —
   نشتقّ العدد من chancesLeft كي لا يرى الزبون صندوقاً خالياً). */
{
 const d=await setup({data:{ok:true,card:{serial:'7KQ4M9TR2X',status:'blank',profile:{},chancesLeft:3,chances:[]}},error:null},()=>Promise.resolve({data:[],error:null}));
 d.window.G.renderChances();const b=d.window.document.querySelector('#chances-bar');
 assert.equal(b.querySelectorAll('.chance-segment').length,3,'fallback draws one segment per remaining chance');
 assert.match(b.textContent,/٣ فرص/);assert.match(b.textContent,/٣ متبقية من ٣/);
 assert.equal(b.querySelector('.chance-count').textContent,'٣');
 d.window.close();
}
/* الاختيار للمراجعة يُعلَّم على شريط فرصته (أزرق) ولا يغيّر عدّاد المتبقي،
   والاختيار الثاني يأخذ الفرصة التالية، والعدّاد في رأس اللوحة يعدّ الجميع. */
{
 const d=await setup({data:{ok:true,card:{serial:'7KQ4M9TR2X',status:'active',profile:{},chancesLeft:2,chances:[{no:1,slotStatus:'reserved',jobCode:'OLD'},{no:2,slotStatus:'empty'},{no:3,slotStatus:'empty'}]}},error:null},()=>Promise.resolve({data:[{code:'JOB-A',title:'وظيفة أولى',status:'available'},{code:'JOB-B',title:'وظيفة ثانية',status:'available'}],error:null}));
 const x=d.window,doc=x.document,bar=()=>doc.querySelector('#chances-bar');
 x.G.pickJob('JOB-A');
 assert.equal(bar().querySelectorAll('.chance-segment.is-picked').length,1,'picked chance is marked, not consumed');
 assert.equal(bar().querySelectorAll('.chance-segment.is-used').length,1);
 assert.match(bar().textContent,/٢ متبقية من ٣/);
 assert.equal(doc.querySelector('#chosen-jobs-count').textContent,'٢','badge counts submitted plus picked');
 assert.equal(doc.querySelector('#chosen-jobs-count').hidden,false);
 x.G.pickJob('JOB-B');
 assert.equal(bar().querySelectorAll('.chance-segment.is-picked').length,2);
 assert.match(doc.querySelector('#chosen-jobs-list').textContent,/الفرصة ٢/);
 x.G.removePickedJob(0);
 assert.equal(bar().querySelectorAll('.chance-segment.is-picked').length,1,'removing a pick frees its segment');
 assert.equal(doc.querySelector('#chosen-jobs-count').textContent,'٢','submitted job stays in the count after cancelling a pick');
 d.window.close();
}

retry.window.close();
console.log('PASS card errors, used cards, and locked-profile job retry');
