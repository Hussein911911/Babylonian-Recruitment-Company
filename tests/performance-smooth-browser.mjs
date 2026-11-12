// Synthetic data; isolated local preview. Reports frame timing, not real-device FPS.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const base='http://127.0.0.1:4173/';
try {
 for(const width of [375,1440]) {
  const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await context.newPage();
  /* خنق المعالج حسب نوع الجهاز — وقياسه:
     الموبايل (٣٧٥px) هو الحالة الحرجة فعلاً: هاتف رخيص ≈ ٤× أبطأ من
     جهاز التطوير. نقيسه بـ٤× كما يجب.
     سطح المكتب (١٤٤٠px) مساحته المرسومة أكبر ٣.٥×، فخنقه ٤× يحاكي
     «سطح مكتب أبطأ ٤ مرات» — جهاز لا وجود له في الواقع. مقيس:
     ١٤٤٠px بلا خنق = إطار واحد ٦٧ms · بخنق ٤× = ١٩ إطاراً ٦٧ms.
     نخنق سطح المكتب ١× (بلا خنق) ونوثّق ذلك بدل تجميل الرقم. */
  if(width<=860){
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  }
  await page.addInitScript(()=>{
   window.__favReads=0; const get=Storage.prototype.getItem;
   Storage.prototype.getItem=function(k){if(k==='hrc_fav_jobs_v1')window.__favReads++;return get.call(this,k)};
   window.fetch=url=>String(url).includes('/rest/v1/public_jobs')?Promise.resolve(new Response(JSON.stringify(Array.from({length:60},(_,i)=>({code:'HRC-'+(9001+i),title:'وظيفة '+(i+1),category:i%2?'تقني':'خدمات',region:'الحلة',shift:'صباحي',salary_min:700000,status:'available',vacancies:1,requirements:[]}))),{status:200,headers:{'Content-Type':'application/json'}})):Promise.reject(new Error('blocked'));
  });
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.goto(base+'index.html');
  /* العرض التدريجي: 10 بطاقات أولاً، ثم «عرض المزيد» يُظهر الـ120 في قياس الأداء */
  await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length===10);
  assert.equal((await page.locator('#jobs-more .jobs-more-label').innerText()).trim(),'عرض المزيد');
  await page.locator('#jobs-more').click();
  await page.waitForFunction(()=>document.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length===60);
  assert.equal((await page.locator('#jobs-more .jobs-more-label').innerText()).trim(),'عرض أقل');
  const initialReads=await page.evaluate(()=>window.__favReads);
  await page.evaluate(()=>{window.__favReads=0});await page.locator('#filter-reset').click();
  const reads=await page.evaluate(()=>window.__favReads);
  /* فصل القياسين — وإلا خلطنا كلفة التصفير بكلفة السحب:

     (أ) كلفة التصفير: إعادة كتابة ٦٠ بطاقة في innerHTML.
     (ب) كلفة السحب: تحريك الصفحة بعناصرها الجاهزة.

     نقيس (أ) بحدّه الخاص، ثم ننتظر حتى يفرغ المتصفح تماماً
     (requestIdleCallback) قبل قياس (ب). بلا هذا الانتظار يقيس
     القياسُ بقايا رسم التصفير وينسبها للسحب. */
  const resetMs=await page.evaluate(async()=>{
    /* نقيس حتى ينتهي عمل التصفير المعلّق */
    const t0=performance.now();
    await new Promise(r=>{ if('requestIdleCallback' in window) requestIdleCallback(()=>r(),{timeout:1200}); else setTimeout(r,600); });
    return Math.round(performance.now()-t0);
  });
  console.log(`${width}px · التصفير: ${resetMs}ms حتى يفرغ المتصفح`);
  /* ── سكرول سريع حقيقي: ٤٠ قفزة عنيفة على ارتفاع الصفحة كاملاً.
     القياس القديم كان ٩٠ قفزة منتظمة صغيرة، فلا يكشف الكلفة البصرية
     (تمويه، ظلال، كتل تظهر وتتحرك) التي تظهر عند السحب بقوة.
     قياس واحد على صفحة نظيفة: جرّبنا التكرار وأخذ الوسيط، لكن كل تكرار
     يفرض إعادة تحميل تُدخل كلفتها في القياس (١٦–٢٠ إطاراً مبطئاً مقابل
     ١–٢ نظيفة). فقياس واحد نظيف أدقّ. */
  const frames=await page.evaluate(async()=>{
    const H=document.documentElement.scrollHeight-innerHeight;
    /* إصبع المستخدم يحرّك الصفحة مباشرة — لا حركة متحركة.
       لكن html عليه scroll-behavior:smooth، فكل scrollTo يبدأ حركة .35s
       وتتراكم ٤٠ حركة فوق بعضها فنقيس محرك الحركة لا كلفة الرسم.
       نعطّله محلياً في القياس فقط (لا نغيّر ملف الأنماط). */
    const prevSB=document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior='auto';
    /* إحماء: ٥ فريمات. بلا إحماء يظهر إطار بارد واحد بسبب أول رفع
       للطبقات إلى GPU — وليس لگو في الصفحة. */
    for(let w=0;w<5;w++)await new Promise(r=>requestAnimationFrame(r));

    const long=[];let lmax=0;
    try{new PerformanceObserver(l=>{for(const e of l.getEntries()){long.push(e.duration);lmax=Math.max(lmax,e.duration)}}).observe({entryTypes:['longtask']})}catch(e){}

    let last=performance.now(), intervals=[], where=[];
    for(let i=0;i<40;i++){
      await new Promise(resolve=>requestAnimationFrame(now=>{
        const d=now-last;
        intervals.push(d);
        if(d>34)where.push((i+1)+':'+Math.round(d));
        last=now;
        scrollTo(0,H*Math.pow(i/39,1.5));   // قفزات متزايدة = سحب سريع
        resolve();
      }));
    }
    await new Promise(r=>setTimeout(r,150));
    document.documentElement.style.scrollBehavior=prevSB;

    /* كم كتلة .reveal داخل الشاشة وما زالت غير ظاهرة تماماً؟
       هذا ما يراه المستخدم «فراغاً» أثناء السحب. */
    const inView=[...document.querySelectorAll('.reveal')].filter(el=>{
      const b=el.getBoundingClientRect();
      return b.top<innerHeight&&b.bottom>0;
    });
    const hidden=inView.filter(el=>parseFloat(getComputedStyle(el).opacity)<1).length;

    return {slow:intervals.filter(x=>x>34).length, total:intervals.length,
      max:Math.max(...intervals).toFixed(1),
      longTasks:long.length, longMax:Math.round(lmax),
      revealInView:inView.length, revealHidden:hidden, where};
  });

  console.log(`${width}px: favorites ${initialReads}/${reads} · سكرول سريع: >34ms=${frames.slow}/${frames.total} max=${frames.max}ms · مهام طويلة=${frames.longTasks} (أطولها ${frames.longMax}ms) · كتل غير ظاهرة داخل الشاشة=${frames.revealHidden}/${frames.revealInView}${frames.where.length?' · مواضع: '+frames.where.join(','):''}`);

  if(!process.env.BASELINE){
    assert.ok(reads<=4,`filter reset should not read favorites once per card: ${reads}`);
    /* الحدود مقيسة على هذا الجهاز بـ٣ خانات CPU (أضعف من معظم الهواتف):
       الافتراضي ١٠ بطاقات → أبطأ إطار ١٧ms بلا إطار مبطئ.
       «عرض المزيد» (٦٠ بطاقة) → أبطأ إطار ٥٠ms وإطار واحد فوق ٣٤ms.
       قبل الإصلاح: ١٠٠ms و٧ إطارات مبطئة على ٦٠ بطاقة، و٨٣ms/٧ على ١٢٠.
       السقف ٨٠ms يترك هامشاً للتذبذب مع بقائه دالّاً على تراجع حقيقي. */
    assert.ok(Number(frames.max)<=80,`سكرول سريع: أبطأ إطار ${frames.max}ms يتجاوز ٨٠ms`);
    /* لا كتلة شبه شفافة داخل الشاشة — هذا «الفراغ» الذي يُرى أثناء السحب */
    assert.equal(frames.revealHidden,0,`${frames.revealHidden} كتلة غير ظاهرة داخل الشاشة أثناء السكرول`);
  }
  await context.close();
 }
}finally{await browser.close()}
