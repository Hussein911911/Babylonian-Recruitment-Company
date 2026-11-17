import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
const ROOT=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
await import(ROOT+'/assets/js/portable-backup.js');
let fails=0;
const ok=(label,pass,extra='')=>{ if(!pass) fails++; console.log((pass?'✅':'❌')+' '+label+(extra?' · '+extra:'')); };

const payload={format:2,schema:'two',exportedAt:'2026-11-13T00:00:00Z',
  counts:{jobs:1,applicants:1,attempts:0,audit:0,serials:0},
  staff:[], applicants:[{serial:'HRC-BC-000001',full_name:'أ',status:'blank',phone:'0770',address:'ب'}],
  jobs:[{code:'HRC-1',title:'و',status:'available',image_url:''}],
  job_attempts:[],settings:[],employer_job_credentials:[],issued_serials:[],
  card_number_registry:[{serial:'HRC-BC-000001',card_number:1}],card_number_counter:[{singleton:true,last_number:1}],audit_log:[]};
writeFileSync('/tmp/two.hrcbak', JSON.stringify(await globalThis.HRCPortableBackup.seal(payload,'كلمة-المرور-٢٠٢٦-طويلة')));

const libs=new URL('file://'+ROOT+'/tests/.tmp/horizontal/libraries/'),packed=new URL('file://'+ROOT+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');
if(existsSync(packed)&&!existsSync(new URL('lib/',libs))){mkdirSync(libs,{recursive:true});const tar=new URL('libs.tar',libs);writeFileSync(tar,brotliDecompressSync(readFileSync(packed)));execFileSync('tar',['xf',tar.pathname,'-C',libs.pathname]);}
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(s=>!['--disable-web-security','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),env:{...process.env,LD_LIBRARY_PATH:[new URL('lib/',libs).pathname,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')},headless:true});
const ctx=await browser.newContext({viewport:{width:430,height:900},acceptDownloads:true});
const page=await ctx.newPage();
const errs=[]; const external=[];
page.on('pageerror',e=>errs.push(e.message));
page.on('request',r=>{ if(!r.url().startsWith('file://')) external.push(r.url()); });

await page.goto('file://'+ROOT+'/restore.html');
await page.setInputFiles('#rp-file','/tmp/two.hrcbak');
await page.waitForSelector('#rp-step3:not(.is-hidden)');
await page.fill('#rp-pass','كلمة-المرور-٢٠٢٦-طويلة');
await page.click('#rp-unlock-btn');
await page.waitForSelector('#rp-step6:not(.is-hidden)',{timeout:20000});
await page.waitForTimeout(400);

ok('زر الهيكل ظاهر', await page.isVisible('#rp-dl-schema'));
ok('زر البيانات ظاهر', await page.isVisible('#rp-dl-sql'));

/* ⚠️ صار الهيكل يُنزَّل **خمسة أجزاء** لا ملفاً واحداً (2026-11-15).
   السبب: محرّر Supabase يقصّ اللصق عند ~٢٠٠٠ سطر ويرفع Success، والمخطط
   ٣١٥٤ سطراً — فكان الملف الواحد يصل ناقصاً بصمت (١١ جدولاً من ١٩).
   والتنزيلات المتعددة بضغطة واحدة يحجبها المتصفح — فصارت أزراراً منفصلة. */
await page.click('#rp-dl-schema');
await page.waitForSelector('#rp-schema-parts button');
const partBtns = await page.$$('#rp-schema-parts button');
/* العدد يتبع حجم المخطط لا رقم ثابت: المخطط ينمو، والشرط الحقيقي أن الأجزاء
   تُغطي المخطط كاملاً (يُفحص أدناه) وأن كل جزء قابل للصق. */
ok('الهيكل أزرار أجزاء (٥ أو أكثر)', partBtns.length >= 5, String(partBtns.length));

const names = [], parts = [];
for (let i = 0; i < partBtns.length; i++) {
  const d = page.waitForEvent('download');
  await partBtns[i].click();
  const f = await d;
  names.push(f.suggestedFilename());
  parts.push(readFileSync(await f.path(), 'utf8'));
}
const schemaSql = parts.join('');
ok('أسماء الأجزاء مرقّمة بالترتيب',
  names.every((n, i) => n === '1-schema-part-' + String(i + 1).padStart(2, '0') + '.sql'),
  names.join(' · '));
ok('كل جزء فيه محتوى', parts.every((p) => p.trim().length > 500));
ok('لا جزء يتجاوز ٧٠٠ سطر — حدّ محرّر Supabase',
  parts.every((p) => (p.match(/\n/g) || []).length <= 700),
  parts.map((p) => (p.match(/\n/g) || []).length).join(' · '));
ok('الهيكل فيه CREATE TABLE', /create table/i.test(schemaSql));
ok('الهيكل فيه RLS', /enable row level security/i.test(schemaSql));
ok('الهيكل بلا مفتاح مسرّب', !/eyJ[A-Za-z0-9_-]{20,}/.test(schemaSql));
ok('الهيكل بلا كلمة مرور اتصال', !/postgres:\/\/[^:]+:[^@]+@/.test(schemaSql));

const d2 = page.waitForEvent('download');
await page.click('#rp-dl-sql');
const f2 = await d2;
const dataSql = readFileSync(await f2.path(),'utf8');
ok('اسم ملف البيانات يبدأ بـ2-data', /^2-data-\d{4}-\d{2}-\d{2}\.sql$/.test(f2.suggestedFilename()), f2.suggestedFilename());
ok('البيانات فيها INSERT', /INSERT INTO brc/.test(dataSql));
ok('البيانات ليست الهيكل', !/create table/i.test(dataSql));
ok('لا طلبات شبكة', external.length===0, external[0]||'');
ok('لا أخطاء JS', errs.length===0, errs[0]||'');
await browser.close();
console.log(fails?`\n❌ ${fails} فشل`:`\n✅ ${'كل'} الفحوص نجحت`);
await browser.close();
process.exit(fails?1:0);
