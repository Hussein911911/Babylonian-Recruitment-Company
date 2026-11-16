import { chromium as pw } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
const libs=new URL('./.tmp/horizontal/libraries/',import.meta.url),packed=new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br',import.meta.url);
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const b=await pw.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const ctx=await b.newContext({acceptDownloads:true});const p=await ctx.newPage();
const P='  '; let pass=0,fail=0;
const chk=(t,c,d)=>{if(c){pass++;console.log(P+'✅ '+t);}else{fail++;console.log(P+'❌ '+t+(d?'  :: '+d:''));}};

/* ═══════════════════════════════════════════════════════════════════════════
   النسخة المحمولة — سيناريو كامل في Chromium
   ---------------------------------------------------------------------------
   يغطّي ما لا تغطّيه فحوص jsdom: Web Crypto الحقيقي، رفع ملف فعلي، تنزيل
   فعلي، و`dir=ltr` على العيّنة. يُشغَّل يدوياً:
       node tests/portable-backup-browser.mjs
   (يحتاج الخادم المحلي على 4173 —tests/apply-mobile-browser.mjs يوضّح النمط)
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n█ النسخة المحمولة — سيناريو كامل\n');
console.log('▌١ التحميل');
/* ⚠ صُحّح 2026-11-16: هذا الفحص كان يفشل على شيفرة سليمة.
   السبب: يفتح `http://` (أي «الموقع المنشور») بلا جلسة، فبوابة المدير
   في restore-gate.js تقفل الخطوات الست — وهو سلوك **صحيح ومقصود**:
   صفحة الاسترجاع تكشف مخطط القاعدة وتفتح أي نسخة، فلا تُعطى لزائر.
   فالحقل لا يظهر، وينتهي الفحص بـTimeoutError يبدو كعطل في الشيفرة.

   الحلّان الممكنان: (أ) نُسجّل دخول مدير، (ب) نفتح `file://` كما يفعل
   المالك فعلاً على حاسبه. اخترنا (ب): لا يحتاج شبكة ولا حساباً وهمياً،
   وهو **الاستخدام الحقيقي** للأداة (تعمل بعد انقطاع الموقع). */
const FILE_ROOT = process.cwd();
await p.goto('file://' + FILE_ROOT + '/restore.html',{waitUntil:'load'});
await p.waitForTimeout(900);
const gateState = await p.evaluate(()=>({
  access: document.body.getAttribute('data-rp-access'),
  locked: document.querySelectorAll('[data-rp-step].is-locked').length
}));
chk('البوابة تفتح محلياً (file://) بلا قفل', gateState.locked === 0, JSON.stringify(gateState));
let r=await p.evaluate(()=>({t:document.title,drop:!!document.getElementById('rp-drop'),h2:document.getElementById('rp-step2').classList.contains('is-hidden'),cr:!!(window.crypto&&window.crypto.subtle),pb:typeof window.HRCPortableBackup,css:getComputedStyle(document.body).fontFamily.includes('Plex')}));
chk('العنوان عربي', r.t.includes('استرجاع'), r.t);
chk('منطقة الرفع موجودة', r.drop);
chk('الخطوات ٢+ مخفية ابتداءً', r.h2);
chk('Web Crypto متاح', r.cr);
chk('وحدة النسخ محمّلة', r.pb==='object', r.pb);
chk('الأنماط مطبّقة', r.css);

console.log('\n▌٢ تشفير + فك في المتصفح');
const env=await p.evaluate(async()=>{
  const PB=window.HRCPortableBackup;
  const payload={format:1,schema:'bt',exportedAt:new Date().toISOString(),
    counts:{jobs:3,applicants:5,attempts:7,audit:11,serials:5},
    jobs:[{id:1,code:'J1',title:'كهربائي'}],
    applicants:[{serial:'S1',full_name:'حسين علي',phone:'0770',status:'active'}],
    job_attempts:[],settings:[],employer_job_credentials:[],issued_serials:[],
    audit_log:[{id:1,username:'admin',action:'اختبار'}],staff:[{id:'u',username:'admin'}]};
  const e=await PB.seal(payload,'كلمة-مرور-الاختبار-2026');
  const back=await PB.open(e,'كلمة-مرور-الاختبار-2026');
  return {json:JSON.stringify(e),dec:back.payload.applicants[0].full_name,sum:back.meta.checksum.slice(0,10)};
});
chk('تشفير ثم فك يعيد البيانات', env.dec==='حسين علي', env.dec);
chk('بصمة محسوبة', env.sum.length===10, env.sum);

console.log('\n▌٣ رفع الملف');
await p.setInputFiles('#rp-file',{name:'browser-test.hrcbak',mimeType:'application/json',buffer:Buffer.from(env.json)});
await p.waitForTimeout(700);
r=await p.evaluate(()=>({s:document.getElementById('rp-file-status').textContent,ok:document.getElementById('rp-file-status').className.includes('is-ok'),v2:!document.getElementById('rp-step2').classList.contains('is-hidden'),meta:document.getElementById('rp-meta').innerText.replace(/\s+/g,' ')}));
chk('الملف مقبول', r.ok, r.s);
chk('بطاقة البيانات ظهرت', r.v2);
chk('يعرض عدد البطاقات', /٥|5/.test(r.meta), r.meta.slice(0,70));

console.log('\n▌٤ كلمة مرور خاطئة');
await p.fill('#rp-pass','كلمة-غلط-تماما-00');
await p.click('#rp-unlock-btn');
await p.waitForTimeout(1600);
r=await p.evaluate(()=>({s:document.getElementById('rp-unlock-status').textContent,v4:!document.getElementById('rp-step4').classList.contains('is-hidden')}));
chk('رُفضت', r.s.includes('غير صحيحة'), r.s);
chk('المحتوى لم يظهر', !r.v4);

console.log('\n▌٥ كلمة المرور الصحيحة');
await p.fill('#rp-pass','كلمة-مرور-الاختبار-2026');
await p.click('#rp-unlock-btn');
await p.waitForTimeout(1600);
/* ⚠ صُحّح 2026-11-16: كان يطلب `#rp-preview` (عيّنة JSON).
   وقد **حُذف الشرح من الصفحة بقرار المالك**: «خلي بس أزرار التنزيلات».
   فالعنصر غير موجود، والبند يفشل على شيفرة سليمة.

   الشيفرة نفسها تتعامل مع الغياب بأمان (restore-page.js:206) — وهذا
   **جوهر** ما نتأكد منه: العرض الاختياري لا يُسقط الفكّ الناجح. */
r=await p.evaluate(()=>({
  s:document.getElementById('rp-unlock-status').textContent,
  v4:!document.getElementById('rp-step4').classList.contains('is-hidden'),
  v5:!document.getElementById('rp-step5').classList.contains('is-hidden'),
  tot:document.getElementById('rp-totals').textContent.replace(/\s+/g,' '),
  hasPreview: !!document.getElementById('rp-preview'),
  rows: document.querySelectorAll('#rp-step5 table tbody tr').length
}));
chk('نجح الفكّ', r.s.includes('البصمة مطابقة') || r.s.includes('نجح الفكّ'), r.s);
chk('المحتوى ظهر (خطوة ٤)', r.v4);
chk('جدول الصفوف ظهر (خطوة ٥)', r.v5);
chk('الإجماليات معروضة', r.tot.includes('٥')||r.tot.includes('11'), r.tot.slice(0,70));
chk('غياب العيّنة الاختيارية لا يُسقط الفكّ', r.v4 && !r.hasPreview,
    'preview=' + r.hasPreview + ' v4=' + r.v4);

console.log('\n▌٦ تنزيل JSON');
const [d1]=await Promise.all([p.waitForEvent('download',{timeout:9000}),p.click('#rp-dl-json')]);
const j1=JSON.parse(readFileSync(await d1.path(),'utf8'));
chk('اسم الملف صحيح', /^hrc-restored-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(d1.suggestedFilename()), d1.suggestedFilename());
chk('محتوى JSON سليم', j1.applicants[0].full_name==='حسين علي');

console.log('\n▌٧ تنزيل CSV');
const [d2]=await Promise.all([p.waitForEvent('download',{timeout:9000}),p.click('#rp-dl-csv')]);
const csv=readFileSync(await d2.path(),'utf8');
chk('BOM لـ Excel', csv.charCodeAt(0)===0xFEFF);
chk('ترويسة الأعمدة', /serial,full_name,phone,status/.test(csv.split('\r\n')[0]), csv.split('\r\n')[0].slice(0,40));
chk('البيانات العربية', csv.includes('حسين علي'));

console.log('\n▌٨ تفريغ الذاكرة');
await p.click('#rp-lock');
await p.waitForTimeout(500);
r=await p.evaluate(()=>({v4:document.getElementById('rp-step4').classList.contains('is-hidden'),pw:document.getElementById('rp-pass').value,tot:document.getElementById('rp-totals').innerHTML}));
chk('المحتوى أُخفي', r.v4);
chk('كلمة المرور ممسوحة', r.pw==='');
chk('الإجماليات أُفرغت', r.tot==='');

console.log('\n▌٩ لا اتصال شبكي');
const ext=[]; p.on('request',q=>{const u=q.url();if(!u.startsWith('http://127.0.0.1:4173'))ext.push(u);});
await p.goto('http://127.0.0.1:4173/restore',{waitUntil:'load'});
await p.waitForTimeout(1200);
chk('صفر طلبات خارجية', ext.length===0, ext.join(', '));

console.log('\n'+'═'.repeat(60));
console.log('  '+(fail?'❌ ':'✅ ')+pass+' ناجح | '+fail+' فاشل');
console.log('═'.repeat(60)+'\n');
await b.close();
process.exit(fail?1:0);
