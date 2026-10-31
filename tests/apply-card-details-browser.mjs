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
  await page.addInitScript(()=>{window.printCount=0;window.print=()=>window.printCount++;const open=window.open;window.open=function(...args){const child=open.apply(this,args);if(child){child.autoPrintCalls=0;child.print=()=>{child.autoPrintCalls++;child.printSnapshot=child.document.querySelector('#print-root')?.textContent||'';};}return child;};});
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
    const [preview]=await Promise.all([page.waitForEvent('popup'),page.locator('.cs-print').first().click()]);await preview.waitForFunction(()=>document.querySelector('#preview-note').textContent.includes('تعذّر'));assert.equal(await preview.locator('#preview-controls button').first().isDisabled(),true);await preview.close();
   }else{
    await page.waitForFunction(()=>document.querySelector('#cs-extra-1').textContent.includes('جهة العمل 1'));
    assert.match(await page.locator('#cs-extra-1').innerText(),/الوظيفة الأصلية 1/);assert.doesNotMatch(await page.locator('#card-details-body').innerText(),/جهة خاطئة|وظيفة مختلفة/);
    for(const n of [1,2]){
     const [preview]=await Promise.all([page.waitForEvent('popup'),page.locator('.cs-print').nth(n-1).click()]);
     await preview.locator('#preview-controls button').first().waitFor({state:'visible'});
     await preview.waitForFunction(()=>window.autoPrintCalls===1);
     assert.match(await preview.evaluate(()=>window.printSnapshot),new RegExp('JOB-'+n));
     const root=preview.locator('#print-root'),text=await root.innerText();
     assert.match(text,new RegExp('جهة العمل '+n));assert.doesNotMatch(text,new RegExp('جهة العمل '+(n===1?2:1)));
     assert.match(text,new RegExp('الوظيفة الأصلية '+n));assert.match(text,/عنوان أصلي/);assert.match(text,/01\/01\/2000/);
     assert.equal(await root.locator('.form-sheet').count(),1);assert.equal(await root.locator('.hrc-card').count(),0);assert.equal(await root.locator('[data-qr] svg').count(),1);
     if(width===375){const pdf=await preview.pdf({format:'A4',printBackground:true});const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;assert.equal(doc.numPages,1,'one A4 page');const txt=(await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');assert.ok(txt.includes('K7M2XQ9T4R')&&txt.includes('JOB-'+n),'PDF contains correct application');}
     await preview.getByRole('button',{name:'طباعة أو حفظ PDF'}).click();await preview.waitForFunction(()=>window.autoPrintCalls===2);
     await preview.close();
    }
    if(width===320){await page.evaluate(()=>{window.open=()=>null});await page.locator('.cs-print').first().click();assert.match(await page.locator('#cs-extra-1').innerText(),/تعذّر فتح معاينة الطباعة/);}
    await page.locator('.cs-close').click();
    if(width===375){
     await page.evaluate(()=>{const a={code:'JOB-RESULT',title:'الوظيفة الأولى',governorate:'بابل',shift:'صباحي',salaryMin:500,salaryMax:600,employer:{name:'جهة 1',phone:'',address:''},interviewLocation:''};const b={...a,code:'JOB-SECOND',title:'الوظيفة الثانية',employer:{name:'جهة 2'}};G.showResults([a,b].map((job,i)=>({job,data:{app:{fullName:'صاحب البطاقة'},attempt:{no:i+1,slotStatus:'reserved'}},index:i})),[]);});
     await page.waitForFunction(()=>document.querySelector('#pg-result.active'));
     const [preview]=await Promise.all([page.waitForEvent('popup'),page.locator('#result-actions .ra-print').click()]);
     await preview.waitForFunction(()=>window.autoPrintCalls===1);
     assert.equal(await preview.locator('#print-root .form-sheet').count(),2);
     const doc=await getDocument({data:new Uint8Array(await preview.pdf({format:'A4',printBackground:true})),useSystemFonts:true}).promise;assert.equal(doc.numPages,2,'two applications print on two pages');
     const p1=(await (await doc.getPage(1)).getTextContent()).items.map(x=>x.str).join(' '),p2=(await (await doc.getPage(2)).getTextContent()).items.map(x=>x.str).join(' ');
     assert.ok(p1.includes('JOB-RESULT')&&!p1.includes('JOB-SECOND')&&p2.includes('JOB-SECOND')&&!p2.includes('JOB-RESULT'),'each page contains its own form');await preview.close();
    }

   }
   assert.ok(requests.every(x=>x.p_serial===serial && [1,2].includes(x.p_attempt_no)));
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await ctx.close();console.log('PASS QR landing / '+mode+' / '+width+'px');
 }
 // Simulate an embedded preview: printing must happen in a separate top-level document.
 {
  const ctx=await browser.newContext({viewport:{width:375,height:850},serviceWorkers:'block'}),page=await ctx.newPage();
  await page.route('**/*',async r=>{const u=r.request().url();
   if(u===base+'test-frame')return r.fulfill({contentType:'text/html',body:'<iframe style="width:375px;height:850px" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" src="/apply.html?form='+serial+'"></iframe>'});
   if(u.includes('/rest/v1/rpc/self_service_card'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,card:{serial,status:'active',profileLocked:true,chancesLeft:0,profile:{fullName:'زبون اختبار'},chances:[{no:1,slotStatus:'reserved',jobCode:'JOB-1'}]}})});
   if(u.includes('/rest/v1/rpc/customer_application_details'))return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,app:{serial,fullName:'زبون اختبار'},attempt:{no:1,slotStatus:'reserved',jobCode:'JOB-1',jobTitle:'وظيفة اختبار',employerName:'جهة الاختبار'}})});
   if(u.includes('/rest/v1/public_jobs'))return r.fulfill({contentType:'application/json',body:'[]'});
   return u.startsWith(base)&&r.request().method()==='GET'?r.continue():r.abort();
  });
  await page.goto(base+'test-frame');const frame=page.frameLocator('iframe');
  await page.frames().find(f=>f.url().includes('apply.html')).evaluate(()=>{const open=window.open;window.open=function(...args){const child=open.apply(this,args);if(child){child.autoPrintCalls=0;child.print=()=>{child.autoPrintCalls++;};}return child;};});
  await frame.locator('#btn-card-details').click();await frame.locator('.cs-print').waitFor();
  const [preview]=await Promise.all([page.waitForEvent('popup'),frame.locator('.cs-print').click()]);
  await preview.waitForFunction(()=>window.autoPrintCalls===1);
  assert.equal(await preview.evaluate(()=>window===window.top),true);assert.equal(await preview.locator('.form-sheet').count(),1);
  assert.ok(!preview.url().includes(serial),'no private card identifier in preview URL');
  const pdf=await getDocument({data:new Uint8Array(await preview.pdf({format:'A4',printBackground:true})),useSystemFonts:true}).promise;
  const text=(await (await pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ');assert.ok(text.includes('JOB-1')&&text.includes(serial),'embedded flow PDF contains the form');
  await preview.close();await ctx.close();console.log('PASS embedded preview opens a standalone printable document');
 }
}finally{await browser.close()}
