#!/usr/bin/env node
/* ===========================================================================
 *  HRC — قناة إنشاء الحسابات على السلك: المكتبة الحقيقية + HTTP حقيقي
 *  ---------------------------------------------------------------------------
 *  لماذا هذا الملف؟ كل اختبارات إدارة الحسابات السابقة كانت تُبدّل
 *  assets/vendor/supabase.js بعميل وهمي — فلا أحد تحقّق قط **بأي طلب فعلي**
 *  يخرج من المتصفح إلى دالة hrc-staff-admin: المسار، الترويسات، جسم الطلب،
 *  وترجمة الرد. عطل في أي منها يعني «إنشاء الحسابات لا يعمل» على الموقع
 *  المنشور مع نجاح كل الاختبارات.
 *
 *  هنا نُشغّل مكتبة سوبابيس **النسخة المدمجة نفسها** (assets/vendor/supabase.js)
 *  أمام خادم HTTP محلي يلعب دور Supabase، ونفحص ما يصل إليه حرفياً — ثم نفحص
 *  كيف تُترجم ردود الأخطاء (404 غير منشورة · 403 رفض دور · 409 اسم محجوز ·
 *  انقطاع الشبكة) إلى جُمل عربية في طبقة HRCCloudAuth.
 *
 *  التشغيل:  node tests/staff-admin-http.mjs
 * =========================================================================== */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

const PUBLISHABLE = 'sb_publishable_TESTKEY';
const seen = [];
let reply = { status: 200, body: { ok: true } };

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
    res.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const URL_BASE = 'http://127.0.0.1:' + PORT;

console.log('\n' + '═'.repeat(74));
console.log('  HRC — قناة الحسابات على السلك (المكتبة المدمجة + خادم HTTP فعلي)');
console.log('═'.repeat(74));

/* ── 1) المكتبة المدمجة نفسها ── */
step(1, 'المكتبة المدمجة: functions.invoke متاحة فعلاً في النسخة المنشورة');
let supabaseNs = null;
try {
  const vendor = readFileSync(join(ROOT, 'assets', 'vendor', 'supabase.js'), 'utf8');
  supabaseNs = new Function(vendor + '\nreturn supabase;')();
} catch (e) { /* يُبلَّغ عنه في الفحص التالي */ }
check('assets/vendor/supabase.js تُحمّل وتُصدّر createClient',
  !!(supabaseNs && typeof supabaseNs.createClient === 'function'));
if (!supabaseNs) { console.log('  ⚠️ لا يمكن متابعة الفحوص بلا المكتبة'); process.exit(1); }

const client = supabaseNs.createClient(URL_BASE, PUBLISHABLE, {
  db: { schema: 'brc' },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
check('client.functions.invoke موجودة (بلاها كان مسار الدالة يسقط لـ not_deployed)',
  !!(client.functions && typeof client.functions.invoke === 'function'));

/* ── 2) طبقة المشروع فوق المكتبة ── */
const authSrc = readFileSync(join(ROOT, 'assets', 'js', 'cloud-auth.js'), 'utf8');
const win = { HRCSupabaseConfig: { url: URL_BASE, schema: 'brc', enabled: true, authEmailDomain: 'hrc-babil.com' } };
new Function('window', authSrc)(win);
const CA = win.HRCCloudAuth.create(client);
check('HRCCloudAuth.staffAdmin متاحة', typeof CA.staffAdmin === 'function');
check('HRCCloudAuth.probeServiceKey متاحة (فحص المفتاح قبل حفظه)', typeof CA.probeServiceKey === 'function');

/* ── 3) بلا جلسة: لا توكن مزيف يُرسل ── */
step(3, 'بلا جلسة سحابية: لا Authorization بمفتاح عام (وإلا صار المفتاح توكن دخول)');
seen.length = 0;
reply = { status: 401, body: { code: 'no_token', error: 'الجلسة مطلوبة — سجّل الدخول كمدير' } };
let r = await CA.staffAdmin('create', { username: 'ahmed', password: 'pass1234', name: 'أحمد', role: 'staff' });
check('المسار الصحيح: /functions/v1/hrc-staff-admin', seen[0].url === '/functions/v1/hrc-staff-admin', seen[0].url);
check('الطريقة POST', seen[0].method === 'POST', seen[0].method);
check('apikey = المفتاح العام', seen[0].headers.apikey === PUBLISHABLE, seen[0].headers.apikey);
check('لا Authorization بمفتاح عام (omitApiKeyAsBearer)',
  !seen[0].headers.authorization || !String(seen[0].headers.authorization).includes(PUBLISHABLE),
  seen[0].headers.authorization);
check('رد 401 يُترجم إلى no_token مع جملة الدالة',
  r.ok === false && r.code === 'no_token' && /الجلسة/.test(r.error), JSON.stringify(r));

/* ── 4) بجلسة مدير: التوكن هو المحمول ── */
step(4, 'بجلسة مدير: Authorization يحمل توكن الجلسة، والجسم كامل');
client.auth.getSession = () => Promise.resolve({ data: { session: { access_token: 'JWT.ADMIN.TOKEN' } }, error: null });
seen.length = 0;
reply = { status: 200, body: { ok: true, authId: 'auth-9', staff: { id: 's-9', username: 'ahmed' } } };
r = await CA.staffAdmin('create', { username: 'ahmed', password: 'pass1234', name: 'أحمد', role: 'staff', title: 'موظف توظيف' });
check('Authorization = Bearer <توكن الجلسة>', seen[0].headers.authorization === 'Bearer JWT.ADMIN.TOKEN', seen[0].headers.authorization);
const sent = JSON.parse(seen[0].body || '{}');
check('الجسم يحمل action', sent.action === 'create', sent.action);
check('الجسم يحمل الاسم واسم المستخدم وكلمة المرور والدور والمسمى',
  sent.username === 'ahmed' && sent.password === 'pass1234' && sent.name === 'أحمد' && sent.role === 'staff' && sent.title === 'موظف توظيف',
  JSON.stringify(sent));
check('الجسم يحمل نطاق البريد المشتقّ (يطابق ما يُنشأ به الحساب)',
  sent.domain === 'hrc-babil.com', sent.domain);
check('الرد الناجح يُقرأ كما هو', r.ok === true && r.authId === 'auth-9', JSON.stringify(r));

/* ── 5) ترجمة الردود: 404 · 403 · 409 · 500 ── */
step(5, 'ترجمة الردود إلى جمل عربية تُسمّي الخطوة (لا نصوص إنجليزية غامضة)');
reply = { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
r = await CA.staffAdmin('create', { username: 'x', password: 'pass1234', name: 'ن', role: 'staff' });
check('404 → not_deployed بجملة عربية تُسمّي الملف', r.code === 'not_deployed' && /staff-accounts-edge/.test(r.error),
  JSON.stringify(r));

reply = { status: 403, body: { ok: false, code: 'not_admin', error: 'هذه الصلاحية للمدير العام فقط' } };
r = await CA.staffAdmin('create', { username: 'x', password: 'pass1234', name: 'ن', role: 'staff' });
check('403 → not_admin (رفض صلاحية لا يُتجاوز)', r.code === 'not_admin' && /للمدير العام/.test(r.error), JSON.stringify(r));

reply = { status: 409, body: { ok: false, code: 'username_taken', error: 'اسم المستخدم «ahmed» مسجّل لموظف آخر' } };
r = await CA.staffAdmin('create', { username: 'ahmed', password: 'pass1234', name: 'ن', role: 'staff' });
check('409 → username_taken بجملة عربية', r.code === 'username_taken' && /مسجّل/.test(r.error), JSON.stringify(r));

reply = { status: 500, body: { ok: false, code: 'not_configured', error: 'إعداد الدالة ناقص' } };
r = await CA.staffAdmin('create', { username: 'x', password: 'pass1234', name: 'ن', role: 'staff' });
check('500 من الدالة يصل برمزه ورسالته', r.code === 'not_configured' && /ناقص/.test(r.error), JSON.stringify(r));

/* ── 6) انقطاع الشبكة: جملة عربية + code=network (يُسمح بالمسار الاحتياطي) ── */
step(6, 'انقطاع النقل: جملة عربية و code=network — لا نص مكتبة إنجليزي');
server.close();
await new Promise((r2) => setTimeout(r2, 80));
r = await CA.staffAdmin('create', { username: 'x', password: 'pass1234', name: 'ن', role: 'staff' });
check('code = network (تعذّر الوصول، لا رفض صلاحية)', r.code === 'network', JSON.stringify(r));
check('الرسالة عربية بلا نص إنجليزي', /تعذّر الوصول/.test(r.error) && !/[A-Za-z]{4}/.test(r.error.replace(/Edge|Function/g, '')),
  r.error);

/* ── 7) فحص مفتاح الخدمة قبل حفظه ── */
step(7, 'فحص مفتاح الخدمة: يميّز المفتاح المرفوض من السكيما غير المكشوفة من انقطاع الشبكة');
const server2 = createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, headers: req.headers, body: '' });
  res.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(reply.body));
});
await new Promise((r2) => server2.listen(PORT, '127.0.0.1', r2));

reply = { status: 200, body: [{ id: 'staff-1' }] };
r = await CA.probeServiceKey('sb_secret_GOOD');
check('مفتاح صحيح → ok', r.ok === true, JSON.stringify(r));
/* ⚠️ Node يُصغّر أسماء الترويسات الواردة — نقرأها بحروف صغيرة */
const probeHeaders = seen[seen.length - 1].headers;
check('الفحص يقرأ brc.staff بترويسة السكيما', /\/rest\/v1\/staff/.test(seen[seen.length - 1].url) &&
  probeHeaders['accept-profile'] === 'brc',
  seen[seen.length - 1].url + ' | ' + probeHeaders['accept-profile']);
check('الفحص يحمل المفتاح في apikey وAuthorization معاً',
  probeHeaders.apikey === 'sb_secret_GOOD' && probeHeaders.authorization === 'Bearer sb_secret_GOOD',
  JSON.stringify({ apikey: probeHeaders.apikey, auth: probeHeaders.authorization }));

reply = { status: 401, body: { message: 'Invalid API key' } };
r = await CA.probeServiceKey('bad');
check('401 → bad_key بجملة تُسمّي مكان المفتاح الصحيح', r.code === 'bad_key' && /Settings/.test(r.error), JSON.stringify(r));

reply = { status: 404, body: { code: 'PGRST205', message: "Could not find the table 'brc.staff' in the schema cache" } };
r = await CA.probeServiceKey('sb_secret_GOOD');
check('PGRST205 → schema بجملة تُسمّي Exposed schemas', r.code === 'schema' && /Exposed schemas/.test(r.error), JSON.stringify(r));

server2.close();
await new Promise((r2) => setTimeout(r2, 60));
r = await CA.probeServiceKey('sb_secret_GOOD');
check('بلا اتصال → network بجملة عربية', r.code === 'network' && /تعذّر الوصول/.test(r.error), JSON.stringify(r));

/* ── 8) فحص whoami — نفس ما يفعله زر «فحص القناة» ── */
step(8, 'زر «فحص القناة» ينداء whoami — إجراء تشخيصي موجود في الدالة');
const server3 = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, staff: { id: 's-1', role: 'admin' } }));
  });
});
await new Promise((r2) => server3.listen(0, '127.0.0.1', r2));
const client3 = supabaseNs.createClient('http://127.0.0.1:' + server3.address().port, PUBLISHABLE, {
  db: { schema: 'brc' }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const CA3 = win.HRCCloudAuth.create(client3);
seen.length = 0;
r = await CA3.staffAdmin('whoami', {});
check('whoami يذهب إلى نفس الدالة', /\/functions\/v1\/hrc-staff-admin$/.test(seen[0].url), seen[0].url);
check('whoami يرسل action=whoami بلا أي بيانات إضافية', JSON.parse(seen[0].body).action === 'whoami', seen[0].body);
check('الرد الناجح → ok (القناة صالحة)', r.ok === true, JSON.stringify(r));
server3.close();

/* ---------------------------------- الخلاصة ---------------------------------- */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
