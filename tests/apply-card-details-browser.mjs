// QR landing, blank and historical opportunities. Isolated synthetic RPCs only.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {brotliDecompressSync} from 'node:zlib';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const base='http://127.0.0.1:4173/', serial='K7M2XQ9T4R';
try {
 for(const width of [320,375,768,1440]) for(const mode of ['blank','used','failed']) {
  const ctx=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block',reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.printCount=0;window.print=()=>window.printCount++;window.open=()=>{throw Error('Unexpected preview window');};});
  await page.route('**/*',async r=>{const u=r.request().url();
   if(u.includes('/rest/v1/rpc/self_service_card'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card: mode==='blank'?{serial,status:'blank',chancesLeft:2,profile:{},chances:[{no:1,slotStatus:'empty'},{no:2,slotStatus:'empty'}]}:{serial,status:'active',profileLocked:true,chancesLeft:0,profile:{fullName:'زبون الاختبار',phone:'07700000000',address:'بابل',gender:'ذكر',dob:'2000-01-01'},chances:[{no:1,slotStatus:'expired',jobCode:'JOB-1',jobTitle:null},{no:2,slotStatus:'reserved',jobCode:'JOB-2',jobTitle:'الوظيفة الثانية'}]}})});
   if(u.includes('/rest/v1/rpc/customer_application_details')){
    const args=r.request().postDataJSON(),n=args.p_attempt_no;requests.push(args);
    if(mode==='failed'&&n===1)return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'offline'})});
    return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,app:{serial,fullName:'زبون الاختبار',phone:'07700000000',address:'عنوان أصلي',gender:'ذكر',dob:'2000-01-01',expiryDate:'2026-12-12'},attempt:{no:n,slotStatus:n===1?'expired':'reserved',jobCode:'JOB-'+n,jobTitle:'الوظيفة الأصلية '+n,location:'بابل',shift:'صباحي',salaryMin:500000,salaryMax:600000,employerName:'جهة العمل '+n,employerPhone:'0770000000'+n,employerAddress:'عنوان جهة '+n,interviewLocation:'مكان مقابلة '+n}})});
   }
   if(u.includes('/rest/v1/public_jobs'))return r.fulfill({contentType:'application/json',body:JSON.stringify([{code:'JOB-1',title:'وظيفة مختلفة بنفس الرمز',status:'available',employer_name:'جهة خاطئة'}])});
   return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();
  });
  await page.goto(base+'apply.html?form='+serial);
  await page.waitForFunction(()=>window.G && document.querySelector('#btn-card-details'));
  await page.waitForFunction(()=>document.querySelector('#btn-card-details').getAttribute('aria-label')?.includes('K7M2XQ9T4R'));
  assert.ok(await page.locator('#btn-card-details').isVisible());
  const link=page.getByRole('link',{name:'رابط موقع المنصة'});assert.ok(await link.isVisible());assert.match(await link.evaluate(el=>getComputedStyle(el).backgroundImage),/gradient/);assert.equal(new URL(await link.getAttribute('href'),page.url()).href,base);
  assert.ok(await page.evaluate(()=>{const d=document.querySelector('#welcome-details-wrap').getBoundingClientRect(),l=document.querySelector('.mk-platform-link').getBoundingClientRect();return l.top>=d.bottom-1}));
  await page.locator('#btn-card-details').click();
  if(mode==='blank'){
   assert.match(await page.locator('#welcome-details-message').innerText(),/البطاقة فارغة/);assert.equal(await page.locator('#card-details').isVisible(),false);assert.equal(requests.length,0);
  }else{
   await page.locator('#card-details').waitFor({state:'visible'});
   await page.waitForFunction(()=>document.querySelector('#cs-extra-2').textContent.includes('جهة العمل 2'));
   assert.equal(await page.locator('.cs-print').count(),2);
   if(mode==='failed'){
    await page.waitForFunction(()=>document.querySelector('#cs-extra-1').textContent.includes('تعذّر تحميل'));
    await page.locator('.cs-print').first().click();await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.printCount),0);
   }else{
    await page.waitForFunction(()=>document.querySelector('#cs-extra-1').textContent.includes('جهة العمل 1'));
    assert.match(await page.locator('#cs-extra-1').innerText(),/الوظيفة الأصلية 1/);assert.doesNotMatch(await page.locator('#card-details-body').innerText(),/جهة خاطئة|وظيفة مختلفة/);
    for(const n of [1,2]){
     await page.locator('.cs-print').nth(n-1).click();await page.waitForFunction(n=>window.printCount===n,n);
     await page.evaluate(()=>window.dispatchEvent(new Event('afterprint'))); // mobile can fire this before capturing preview
     const root=page.locator('#chance-print-root'),text=await root.textContent();
     assert.doesNotMatch(text,/توقيع الزبون|توقيع نقطة البيع|ختم الشركة|خدمات الشركة تنحصر/);
     assert.match(text,new RegExp('جهة العمل '+n));assert.doesNotMatch(text,new RegExp('جهة العمل '+(n===1?2:1)));
     assert.match(text,new RegExp('الوظيفة الأصلية '+n));assert.match(text,/عنوان أصلي/);assert.match(text,/01\/01\/2000/);assert.match(text,/مكان مقابلة/);
     assert.equal(await root.locator('.form-sheet').count(),1);assert.equal(await root.locator('.hrc-card').count(),0);assert.equal(await root.locator('[data-qr] svg').count(),1);
     await page.emulateMedia({media:'print'});assert.equal(await root.evaluate(e=>getComputedStyle(e).display),'block');assert.equal(await root.locator('.form-sheet').evaluate(e=>getComputedStyle(e).visibility),'visible');if(width===375){const pdf=await page.pdf({format:'A4',printBackground:true});const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;assert.equal(doc.numPages,1,'one A4 page');const text=(await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');assert.ok(text.includes('K7M2XQ9T4R')&&text.includes('JOB-'+n)&&text.replace(/\s/g,'').includes('JOBAPPLICATIONFORM'),'PDF must contain the actual selected application, not a white page');}await page.emulateMedia({media:'screen'});
    }
    await page.locator('.cs-close').click();assert.equal(await page.locator('#chance-print-root .form-sheet').count(),0);
    if(width===375){
     await page.evaluate(()=>{const job={code:'JOB-RESULT',title:'وظيفة النتيجة',governorate:'بابل',shift:'صباحي',salaryMin:500,salaryMax:600,employer:{name:'جهة النتيجة',phone:'07700000000',address:'عنوان'},interviewLocation:'المقابلة'};G.showResults([{job,data:{app:{fullName:'صاحب البطاقة'},attempt:{no:1,slotStatus:'reserved'}},index:0}],[]);});
     await page.waitForFunction(()=>document.querySelector('#pg-result.active'));
     await page.locator('#result-actions .ra-print').click();await page.waitForFunction(()=>window.printCount===3);
     await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
     await page.emulateMedia({media:'print'});const pdf=await page.pdf({format:'A4',printBackground:true});const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;const result=(await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');
     assert.equal(doc.numPages,1,'result form occupies one page');assert.ok(result.includes('JOB-RESULT')&&result.includes('K7M2XQ9T4R'),'result page print contains real form after printing a chance');
     await page.emulateMedia({media:'screen'});
     await page.evaluate(()=>{const a={code:'JOB-RESULT',title:'الوظيفة الأولى',governorate:'بابل',shift:'صباحي',salaryMin:500,salaryMax:600,employer:{name:'جهة 1',phone:'',address:''},interviewLocation:''};const b={...a,code:'JOB-SECOND',title:'الوظيفة الثانية',employer:{name:'جهة 2'}};G.showResults([a,b].map((job,i)=>({job,data:{app:{fullName:'صاحب البطاقة'},attempt:{no:i+1,slotStatus:'reserved'}},index:i})),[]);});
     await page.locator('#result-actions .ra-print').click();await page.waitForFunction(()=>window.printCount===4);await page.emulateMedia({media:'print'});
     const both=await getDocument({data:new Uint8Array(await page.pdf({format:'A4',printBackground:true})),useSystemFonts:true}).promise;assert.equal(both.numPages,2,'two applications print on two pages');
     const p1=(await (await both.getPage(1)).getTextContent()).items.map(x=>x.str).join(' '),p2=(await (await both.getPage(2)).getTextContent()).items.map(x=>x.str).join(' ');
     assert.ok(p1.includes('JOB-RESULT')&&!p1.includes('JOB-SECOND')&&p2.includes('JOB-SECOND')&&!p2.includes('JOB-RESULT'),'each page has the correct opportunity');
     await page.emulateMedia({media:'screen'});

    }

   }
   assert.ok(requests.every(x=>x.p_serial===serial && [1,2].includes(x.p_attempt_no)));
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await ctx.close();console.log('PASS QR landing / '+mode+' / '+width+'px');
 }
 // No popup or intermediate page, including when embedded in a host page.
 {
  const ctx=await browser.newContext({viewport:{width:375,height:850},serviceWorkers:'block'}),page=await ctx.newPage();
  await page.route('**/*',async r=>{const u=r.request().url();
   if(u===base+'test-frame')return r.fulfill({contentType:'text/html',body:'<iframe style="width:375px;height:850px" sandbox="allow-scripts allow-same-origin allow-modals" src="/apply.html?form='+serial+'"></iframe>'});
   if(u.includes('/rest/v1/rpc/self_service_card'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card:{serial,status:'active',profileLocked:true,chancesLeft:0,profile:{fullName:'زبون اختبار'},chances:[{no:1,slotStatus:'reserved',jobCode:'JOB-1'}]}})});
   if(u.includes('/rest/v1/rpc/customer_application_details'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,app:{serial,fullName:'زبون اختبار'},attempt:{no:1,slotStatus:'reserved',jobCode:'JOB-1',jobTitle:'وظيفة اختبار',employerName:'جهة الاختبار'}})});
   if(u.includes('/rest/v1/public_jobs'))return r.fulfill({contentType:'application/json',body:'[]'});
   return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();
  });
  await page.goto(base+'test-frame');const frame=page.frameLocator('iframe');
  const inner=page.frames().find(f=>f.url().includes('apply.html'));
  await inner.evaluate(()=>{window.printCount=0;window.print=()=>{window.printCount++;window.printSnapshot=document.querySelector('#chance-print-root').textContent};window.open=()=>{throw Error('Unexpected preview window')};});
  await frame.locator('#btn-card-details').click();await frame.locator('.cs-print').click();
  await inner.waitForFunction(()=>window.printCount===1);assert.match(await inner.evaluate(()=>window.printSnapshot),/JOB-1/);
  assert.equal(ctx.pages().length,1);await ctx.close();console.log('PASS embedded page requests direct printing without a popup');
 }
 // Per-card entitlements, including cards created under different settings.
 for(const total of [1,3,5]){
  const ctx=await browser.newContext({viewport:{width:393,height:850},serviceWorkers:'block',reducedMotion:'reduce'}),page=await ctx.newPage();
  const jobs=Array.from({length:6},(_,i)=>({id:'j'+i,code:'JOB-'+(i+1),title:'وظيفة '+(i+1),status:'available',governorate:'بابل',vacancies:1,gender:'لا فرق'}));
  let used=0;
  await page.route('**/*',async r=>{const u=r.request().url();
   if(u.includes('/rest/v1/rpc/self_service_card'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card:{serial,status:'active',profileLocked:true,chancesLeft:total,profile:{fullName:'زبون اختبار',phone:'07700000000',address:'بابل'},chances:Array.from({length:total},(_,i)=>({no:i+1,slotStatus:'empty'}))}})});
   if(u.includes('/rest/v1/rpc/apply_with_card')){const a=r.request().postDataJSON();used++;return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,app:a.p_data,profile:a.p_data,attempt:{no:used,slotStatus:'reserved',jobCode:a.p_job_code}})});}
   if(u.includes('/rest/v1/public_jobs'))return r.fulfill({contentType:'application/json',body:JSON.stringify(jobs)});
   return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();
  });
  await page.goto(base+'apply.html?form='+serial);await page.waitForFunction(()=>document.querySelector('#btn-card-details').getAttribute('aria-label')?.includes('K7M2XQ9T4R'));
  assert.equal(await page.evaluate(()=>G.maxPick()),total);
  await page.locator('#btn-card-details').click();
  const totalText=await page.locator('#card-details').innerText();const arabic=String(total).replace(/[0-9]/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]);assert.ok(totalText.includes(arabic+' من '+arabic));
  await page.locator('.cs-close').click();await page.evaluate(()=>G.go(6));
  for(let i=0;i<total;i++){
   const button=page.locator('.job-card').filter({hasText:'JOB-'+(i+1)}).locator('.job-main-btn');
   await button.click();
   assert.equal(await page.locator('.job-card.selected').count(),i+1);
  }
  assert.equal(await page.locator('#jobs-list.has-focus').count(),1);
  await page.evaluate(()=>G.renderReview());
  const review=await page.locator('#review-content').innerText();assert.match(review,new RegExp('الفرص المتاحة للتعيين: '+String(total).replace(/[0-9]/g,d=>'٠١٢٣٤٥٦٧٨٩'[d])));
  await page.evaluate(()=>G.finish());await page.waitForFunction(n=>document.querySelectorAll('#result-content .form-sheet').length===n,total);
  assert.equal(used,total,'each selected job is submitted once');
  const sheets=page.locator('#result-content .form-sheet');
  for(let i=0;i<total;i++){const text=await sheets.nth(i).innerText();assert.ok(text.includes('JOB-'+(i+1)));assert.doesNotMatch(text,/توقيع الزبون|توقيع نقطة البيع|ختم الشركة|خدمات الشركة تنحصر/);}
  await ctx.close();console.log('PASS selection and submission match card entitlement',total);
 }
}finally{await browser.close()}
