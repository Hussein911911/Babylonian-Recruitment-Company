#!/usr/bin/env node
/* ===========================================================================
 *  HRC — اختبار عميل PostgREST المصغّر (assets/js/cloud-http.js)
 *  ---------------------------------------------------------------------------
 *  لماذا هذا الملف؟ كل اختبارات السحابة السابقة كانت تمرر عميلاً وهمياً
 *  بلا HTTP فعلي — فلم يتحقق أحد قط **بأي ترويسات** تُرسل دوال RPC.
 *  والنتيجة عطل حقيقي بالموقع المنشور (2026-10-02): عميلنا أرسل
 *  Content-Profile وحده، وPostgREST يبحث عن الدالة بموجب Accept-Profile،
 *  فبحث في public لا brc ورُدّ:
 *    «Could not find the function public.activate_card(p_data, p_serial)
 *     in the schema cache»
 *  هنا نتحقق من الترويسات نفسها باعتراض fetch — لا محاكاة منطقية.
 *
 *  التشغيل:  node tests/cloud-http.mjs
 * =========================================================================== */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

console.log('\n' + '═'.repeat(74));
console.log('  HRC — ترويسات PostgREST لعميل الصفحات العامة (cloud-http.js + cloud.js)');
console.log('═'.repeat(74));

/* ── تحميل cloud-http.js في نافذة وهمية (نفس أسلوب tests/cloud.mjs) ── */
const httpSrc = readFileSync(join(ROOT, 'assets', 'js', 'cloud-http.js'), 'utf8');
const httpWin = {};
new Function('window', httpSrc)(httpWin);
const HRCHttp = httpWin.HRCHttp;
check('cloud-http.js يُحمّل ويصدّر HRCHttp', !!HRCHttp && typeof HRCHttp.createClient === 'function');

/* ── اعتراض fetch: نسجّل النداء والترويسات ثم نرد رداً واقعياً ── */
let captured = null;          // آخر نداء { url, method, headers }
let nextResponse = null;      // ما يرد به الاعتراض
const realFetch = globalThis.fetch;
globalThis.fetch = function (url, init) {
  captured = { url: String(url), method: init && init.method, headers: (init && init.headers) || {} };
  const r = nextResponse || { ok: true, status: 200, text: () => Promise.resolve('{"ok":true}') };
  return Promise.resolve(r);
};

try {
  const URL_ = 'https://example.supabase.co';
  const KEY = 'sb_publishable_TEST';
  const client = HRCHttp.createClient(URL_, KEY, { schema: 'brc' });

  /* ═══ 1) ترويسات rpc — قلب الاختبار (عطل الموقع المنشور) ═══ */
  step(1, 'rpc(): الترويستان معاً — Accept-Profile يحدّد مخطط الدالة');
  await client.rpc('activate_card', { p_serial: 'HRC-BC-000001', p_data: {} });
  {
    const h = captured.headers;
    check('نداء rpc يذهب إلى ‎/rest/v1/rpc/activate_card بـ POST',
      captured.method === 'POST' && /\/rest\/v1\/rpc\/activate_card$/.test(captured.url));
    check('★ rpc يرسل Accept-Profile: brc — بدونه يبحث PostgREST في public (عطل 2026-10-02)',
      h['Accept-Profile'] === 'brc', 'Accept-Profile=' + h['Accept-Profile']);
    check('rpc يرسل Content-Profile: brc أيضاً (مخطط الحمولة)',
      h['Content-Profile'] === 'brc', 'Content-Profile=' + h['Content-Profile']);
    check('rpc يرسل المفتاح والتخويل وContent-Type',
      h['apikey'] === KEY && h['Authorization'] === 'Bearer ' + KEY && h['Content-Type'] === 'application/json');
  }

  /* ═══ 2) قراءة الجداول تبقى كما كانت: Accept-Profile وحده ═══ */
  step(2, 'from().select(): قراءة الجداول بلا تغيير');
  await client.from('public_jobs').select('code,title').eq('code', 'HRC-1046').limit(5);
  {
    const h = captured.headers;
    check('قراءة الجدول GET مع Accept-Profile: brc',
      captured.method === 'GET' && h['Accept-Profile'] === 'brc' && /public_jobs\?/.test(captured.url));
    check('قراءة الجدول لا ترسل Content-Profile', h['Content-Profile'] === undefined);
  }

  /* ═══ 3) سكيما مخصصة تُحترم في rpc ═══ */
  step(3, 'السكيما المخصصة تنسحب على ترويسات rpc');
  const other = HRCHttp.createClient(URL_, KEY, { schema: 'hrx' });
  await other.rpc('some_fn', { a: 1 });
  check('سكيما مخصصة (hrx) تُرسل بالترويستين',
    captured.headers['Accept-Profile'] === 'hrx' && captured.headers['Content-Profile'] === 'hrx');

  /* ═══ 4) خطأ PostgREST الحقيقي يُفسَّر بلا تشويه ═══ */
  step(4, 'تفسير ردود أخطاء PostgREST كما هي');
  nextResponse = {
    ok: false, status: 404,
    text: () => Promise.resolve(JSON.stringify({
      code: 'PGRST202',
      message: 'Could not find the function public.activate_card(p_data, p_serial) in the schema cache',
      hint: 'Perhaps you meant to call the function brc.activate_card(p_serial, p_data)'
    }))
  };
  const r = await client.rpc('activate_card', { p_serial: 'X', p_data: {} });
  nextResponse = null;
  check('خطأ PGRST202 يصل برمزه ورسالته كاملة (يُعرض للزبون كما رآها المالك)',
    r.error && r.error.code === 'PGRST202' &&
    /Could not find the function public\.activate_card/.test(r.error.message));

  /* ═══ 5) cloud.js: عميل supabase-js الكامل يحصل على الترويسة الناقصة ═══ */
  step(5, 'cloud.js rpcCall(): ترويسة ناقصة لعميل supabase-js قبل كل نداء');
  const cloudSrc = readFileSync(join(ROOT, 'assets', 'js', 'cloud.js'), 'utf8');
  const cloudWin = {};
  new Function('window', cloudSrc)(cloudWin);
  const C = cloudWin.HRCCloud;
  check('cloud.js يُحمّل ويصدّر HRCCloud', !!C);
  let customerArgs;
  const customerClient = {rpc: async (name, args) => {customerArgs={name,args};return {data:{ok:true,app:{serial:'CARD'},attempt:{no:2,employerName:'جهة الاختبار'}},error:null};}};
  const customer = await C.customerApplication(customerClient, ' cArD ', 2);
  check('تفاصيل التقديم تطلب البطاقة والفرصة المحددة فقط', customer.ok && customer.attempt.no === 2 && customerArgs.name === 'customer_application_details' && customerArgs.args.p_serial === 'CARD' && customerArgs.args.p_attempt_no === 2);
  const deniedCustomer = await C.customerApplication({rpc:async()=>({data:{ok:false,error:'لا توجد فرصة'},error:null})},'CARD',1);
  check('رفض التفاصيل من الخادم لا يتحول إلى نجاح', deniedCustomer.ok === false);
  const offlineCustomer = await C.customerApplication({rpc:async()=>{throw new Error('offline')}},'CARD',1);
  check('فشل شبكة تفاصيل التقديم لا يكشف بيانات وهمية', offlineCustomer.ok === false && !offlineCustomer.app);


  const argsSeen=[];
  const caseClient={rpc:async (name,args)=>{argsSeen.push({name,args});return {data:{ok:false,error:'اختبار'},error:null}}};
  await C.lookupCard(caseClient,' k7m2xq9t4r ');
  await C.verifyForm(caseClient,' hrc-no-900001 ',null);
  check('بحث البطاقة والتحقق يرسلان نفس الرقم مهما اختلف حجم الحروف',argsSeen[0].args.p_serial==='K7M2XQ9T4R' && argsSeen[1].args.p_serial==='HRC-NO-900001');

  /* عميل كامل الشكل (مثل supabase-js): rest.headers.set قابلة للاعتراض */
  const headerSets = [];
  let hadHeaderAtRpc = null;
  const fullClient = {
    rpc(name, args) {
      hadHeaderAtRpc = headerSets.some(function (p) { return p[0] === 'Accept-Profile'; });
      return Promise.resolve({ data: { ok: true, app: { serial: 'HRC-BC-000001' }, attempt: { no: 1 }, job: { code: 'HRC-1046' } }, error: null });
    },
    rest: { headers: { set: function (k, v) { headerSets.push([k, v]); } } }
  };
  /* ⚠️ كان هذا الاختبار يتأكد أن `activateCard` ينادي rpc مضبوطاً — وهذا
     بالضبط الخطأ: `brc.activate_card` **منزوعة** من anon/authenticated منذ
     20261030100000_remove_direct_card_sale.sql، فالنداء كان يُرفض دائماً ثم
     يسقط المسار للمحلي. الآن الدالة محذوفة من HRCCloud عمداً، والاختبار
     يثبت الغياب كي لا تعود. */
  check('activateCard لم تعد تُصدَّر في HRCCloud (الدالة منزوعة في القاعدة)',
    typeof C.activateCard !== 'function',
    typeof C.activateCard);
  /* ونفس الترويسة تُفحص على دالة حيّة فعلاً — كي لا يسقط الفحص الأصلي بلا بديل */
  await C.customerApplication(fullClient, 'HRC-BC-000001', 1);
  check('نداء rpc حيّ يضبط Accept-Profile: brc قبل النداء نفسه',
    hadHeaderAtRpc === true &&
    headerSets.some(function (p) { return p[0] === 'Accept-Profile' && p[1] === 'brc'; }));

  /* عميل بلا rest (كالعميل المصغّر): لا ينكسر — ترسل الترويسة من عنده */
  let miniOk = null;
  const miniClient = {
    rpc() { return Promise.resolve({ data: { ok: false, code: 'blank', error: 'فارغة' }, error: null }); }
  };
  const er = await C.lookupCard(miniClient, 'HRC-BC-000001');
  miniOk = er && er.ok === false;
  check('lookupCard عبر عميل بلا rest (المصغّر): يعمل بلا انكسار',
    miniOk === true && /فارغة/.test(er.error || ''));
  check('لا بقايا لدوال صاحب العمل المحذوفة في طبقة السحابة',
    typeof C.employerView === 'undefined' && typeof C.employerDecide === 'undefined');

  /* القيمة الافتراضية brc تُحترم حتى بلا HRCSupabaseConfig بالنافذة */
  check('السكيما الافتراضية brc عند غياب الإعداد', headerSets.every(function (p) { return p[1] === 'brc'; }));

  await wait(60);
} finally {
  globalThis.fetch = realFetch;
}

function step(n, t) { console.log('\n▌ ' + n + ' — ' + t); }

console.log('\n' + '─'.repeat(74));
console.log('  الخلاصة: ✅ ' + pass + ' ناجح   |   ❌ ' + fail + ' فاشل');
if (fail) { console.log('  الإخفاقات:'); problems.forEach((p) => console.log('   • ' + p)); process.exit(1); }
process.exit(0);
