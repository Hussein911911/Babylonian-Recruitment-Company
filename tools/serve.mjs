#!/usr/bin/env node
/* ===========================================================================
 *  HRC — خادم معاينة محلي (بدون أي حزم خارجية)
 *  ---------------------------------------------------------------------------
 *  التشغيل:  node tools/serve.mjs  [المنفذ]
 *  يخدم الملفات الثابتة من جذر المشروع ويفتح الموقع على http://localhost:PORT
 * =========================================================================== */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { verifyRequest } from './revalidate-core.mjs';

/* ── معاينة "/demo" بلا قاعدة بيانات (أداة تطوير فقط) ───────────────────────
 * تُحقن 20 وظيفة وهمية في نسخة index.html داخل الذاكرة عند الطلب، ويُعطَّل
 * الاتصال بـ Supabase، لمراجعة ميزات الواجهة (مثل «عرض المزيد») حتى بلا إنترنت
 * أو مفاتيح. لا تُكتب في أي ملف، ولا تُنسخ إلى dist، ولا تصل للإنتاج أبداً.
 * ⚠️ بيانات العرض هذه وهمية بالكامل ولا تمثّل وظائف الشركة الحقيقية. */
const DEMO_JOBS = Array.from({ length: 20 }, (_, i) => ({
  code: 'HRC-' + (9001 + i), title: 'وظيفة عرض ' + (i + 1),
  category: ['صناعي', 'خدمات', 'صحي', 'هندسي', 'إداري'][i % 5],
  region: 'الحلة', governorate: 'بابل', shift: i % 2 ? 'مسائي' : 'صباحي',
  salaryMin: 600000 + i * 10000, salaryMax: 850000 + i * 10000,
  gender: 'لا فرق', requirements: ['خبرة مناسبة', 'الالتزام بالدوام'],
  vacancies: i % 3 === 0 ? 2 : 1, imageUrl: ''
}));
function demoPage(html) {
  const seed = '<script>window.__HRC_TEST_SEED__=' + JSON.stringify({
    jobs: DEMO_JOBS, jobsExtras: {}, applicants: [], attempts: []
  }) + ';</script>';
  const offline = '<script>window.HRCSupabaseConfig.enabled=false;</script>';
  return html.replace('</head>', seed + '\n</head>')
    .replace(/(<script src="assets\/js\/supabase-config\.js[^"]*"><\/script>)/, '$1' + offline);
}

/* ── معاينة "/demo-card" لشاشة «وظائف البطاقة» بلا قاعدة بيانات ────────────────
 *  نفس نمط /demo: تُخدَم نسخة apply.html داخل الذاكرة مع بطاقة ووظائف وهمية،
 *  ويُحوَّل منفذ Supabase إلى المسار المحلي نفسه الذي يجيب بالبيانات الوهمية.
 *  الغرض مراجعة بطاقة الفرص ولوحة «الوظائف التي قمت باختيارها» بصرياً فقط.
 *  ⚠️ لا يُنشر شيء من هذا: لا ملف، ولا dist، ولا اتصال بأي قاعدة. */
const DEMO_CARD = {
  ok: true,
  card: {
    serial: 'DEMO-CARD-01', status: 'active', profileLocked: true, chancesLeft: 3,
    profile: { fullName: 'أحمد محمد علي جاسم', phone: '07712345678', address: 'بابل — الحلة', gender: 'ذكر', dob: '1999-05-04' },
    chances: [
      { no: 1, slotStatus: 'reserved', jobCode: 'HRC-0900', jobTitle: 'سائق توصيل' },
      { no: 2, slotStatus: 'empty' }, { no: 3, slotStatus: 'empty' }, { no: 4, slotStatus: 'empty' }
    ]
  }
};
const DEMO_CARD_JOBS = [
  { id: 'd1', code: 'HRC-9001', title: 'عامل إنتاج خطوط', status: 'available', governorate: 'بابل', region: 'الحلة', shift: 'صباحي', salary_min: 600000, salary_max: 750000, vacancies: 2, gender: 'لا فرق', category: 'صناعة' },
  { id: 'd2', code: 'HRC-9002', title: 'محاسب', status: 'available', governorate: 'بغداد', region: 'الكرادة', shift: 'صباحي', salary_min: 900000, salary_max: 1100000, vacancies: 1, gender: 'لا فرق', category: 'إدارة' },
  { id: 'd3', code: 'HRC-9003', title: 'فني كهرباء', status: 'available', governorate: 'بابل', region: 'الهاشمية', shift: 'مسائي', salary_min: 700000, salary_max: 900000, vacancies: 1, gender: 'لا فرق', category: 'هندسي' },
  { id: 'd4', code: 'HRC-9004', title: 'موظف استقبال', status: 'available', governorate: 'كربلاء', region: 'المركز', shift: 'مسائي', salary_min: 550000, salary_max: 700000, vacancies: 1, gender: 'أنثى', category: 'خدمات' }
];
function demoCardPage(html) {
  return html.replace("var SUPA_URL='https://vqsvztudvfukyuerzcgx.supabase.co'", "var SUPA_URL=''");
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
/* بصمة إبطال كاش البيانات العامة في المعاينة — يرفعها /api/revalidate */
let PUBLIC_CACHE_EPOCH = 0;
/* سرّ تطوير عشوائي لكل تشغيل — للاختبار على 127.0.0.1 فقط، لا قيمة ثابتة
   في الكود يمكن استغلالها على نسخة منشورة. يُطبع مرة واحدة كي يستخدمه
   من يختبر محلياً (وهو ليس سرّ إنتاج). */
const DEVELOP_SECRET = process.env.HRC_DEV_REVALIDATE_SECRET ||
  (process.argv.includes('--print-dev-secret') ? randomBytes(24).toString('hex') : '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    let pathname = decodeURIComponent(url.pathname);

    // مسارات نظيفة مطابقة لملف _redirects في Cloudflare Pages — لتطابق المعاينة المحلية الإنتاج
    const CLEAN_ROUTES = {
      '/verify': '/verify.html',
      '/dashboard': '/dashboard.html',
      '/standalone': '/hrc-standalone.html',
      '/light': '/hrc-light.html',
      '/restore': '/restore.html'
    };
    /* أقسام الصفحة الرئيسية: /jobs → /#jobs (تحويل 301 مطابق لـ _redirects) */
    const SECTION_ROUTES = ['home', 'jobs', 'how', 'services', 'about', 'contact'];
    const bare = pathname.replace(/\/+$/, '') || pathname;
    const isDemo = bare === '/demo';
    const isDemoCard = bare === '/demo-card';

    /* ── إعادة التحقق الفوري (On-Demand Revalidation) ───────────────────
       يحاكي functions/api/revalidate.js بنفس النواة المشتركة، فلا يظهر فرق
       بين المعاينة والإنتاج. يعمل في المعاينة بلا سرّ (وضع تطوير) فقط إذا
       لم يُضبط HRC_REVALIDATE_SECRET صراحةً — والإنتاج يرفض بلا سرّ. */
    if (bare === '/api/revalidate') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'content-type, x-hrc-timestamp, x-hrc-signature',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Max-Age': '600'
        });
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'POST فقط' }));
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      /* ⛔ لا سرّ افتراضي مكتوب في الكود. السابق كان يُقبل على أي نسخة
         منشورة من هذا الخادم، فيستطيع أي أحد حذف كاش البيانات. الآن:
           • محلي على 127.0.0.1 → سرّ تطوير عشوائي جديد كل تشغيل (للاختبار).
           • غير ذلك → يجب HRC_REVALIDATE_SECRET وإلا 503 كالإنتاج. */
      const loopback = ['127.0.0.1', '::1', 'localhost'].indexOf(req.socket.remoteAddress) >= 0 ||
                       ['127.0.0.1', '::1', 'localhost'].indexOf(req.socket.localAddress) >= 0;
      let secret = process.env.HRC_REVALIDATE_SECRET || '';
      if (!secret && loopback && DEVELOP_SECRET) secret = DEVELOP_SECRET;
      if (!secret) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'لم يُضبط HRC_REVALIDATE_SECRET' }));
        return;
      }
      const verdict = await verifyRequest({ secret: secret, headers: req.headers, payload: raw });
      if (!verdict.ok) {
        res.writeHead(verdict.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: verdict.error }));
        return;
      }
      /* المعاينة لا تملك CDN، فنُبطل كاش البيانات بمفتاح إصدار يقرأه العميل. */
      PUBLIC_CACHE_EPOCH = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, purged: verdict.paths, epoch: PUBLIC_CACHE_EPOCH, at: new Date().toISOString() }));
      return;
    }
    if (bare === '/api/cache-epoch') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ epoch: PUBLIC_CACHE_EPOCH }));
      return;
    }

    /* /demo-card: شاشة «وظائف البطاقة» ببطاقة وهمية — أداة مراجعة بصرية فقط */
    if (isDemoCard) {
      res.writeHead(302, { Location: '/apply.html?form=DEMO-CARD-01&demo=1' });
      res.end();
      return;
    }
    /* تفاصيل الفرصة بعد التقديم: تُعيد بيانات صاحب العمل — كما تفعل الدالة
       الحقيقية brc.customer_application_details. بيانات وهمية بالكامل. */
    if (bare.startsWith('/rest/v1') && bare.includes('/rpc/customer_application_details') && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch { p = {}; }
      const no = Number(p.p_attempt_no);
      const slot = DEMO_CARD.card.chances.find(c => Number(c.no) === no && c.slotStatus !== 'empty');
      if (!slot || String(p.p_serial || '').toUpperCase() !== DEMO_CARD.card.serial) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'لا يوجد تقديم مسجل لهذه الفرصة' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        app: { serial: DEMO_CARD.card.serial, fullName: DEMO_CARD.card.profile.fullName,
          phone: DEMO_CARD.card.profile.phone, address: DEMO_CARD.card.profile.address,
          gender: DEMO_CARD.card.profile.gender, dob: DEMO_CARD.card.profile.dob },
        attempt: {
          no: slot.no, slotStatus: slot.slotStatus, jobCode: slot.jobCode, jobTitle: slot.jobTitle,
          location: 'بابل', shift: 'صباحي', salaryMin: 600000, salaryMax: 750000,
          employerName: 'شركة الرافدين للصناعات الغذائية',
          employerPhone: '07801112233', employerAddress: 'بابل — الحلة — شارع ٤٠ — مجمع الصناعات',
          interviewLocation: 'مقر الشركة — الطابق الثاني — مكتب الموارد البشرية',
          selectedAt: '2026-11-06T09:20:00Z', holdExpiresAt: '2026-11-07T09:20:00Z'
        }
      }));
      return;
    }
    if (bare.startsWith('/rest/v1')) {
      if (bare.includes('/rpc/self_service_card')) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(DEMO_CARD));
        return;
      }
      if (bare.includes('/public_jobs')) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(DEMO_CARD_JOBS));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{}');
      return;
    }

    if (SECTION_ROUTES.includes(bare.slice(1))) {
      res.writeHead(301, { Location: '/#' + bare.slice(1) });
      res.end();
      return;
    }
    /* ⛔ لا تُضِف هنا تحويل «/index.html → /»: المعاينة يجب أن تطابق Cloudflare
       Pages، وهناك يُطبَّع /index.html ↔ / داخلياً فتدور القاعدة حلقة لا تنتهي
       (ERR_TOO_MANY_REDIRECTS) تُسقط الصفحة الرئيسية كلها. التطبيع يتم في
       nav.js على جانب العميل حيث لا حلقة. */
    const clean = CLEAN_ROUTES[bare];
    if (clean) pathname = clean;
    if (isDemo) pathname = '/index.html';
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(ROOT, safe);

    // خدمة المجلدات
    try {
      const st = await stat(filePath);
      if (st.isDirectory()) filePath = join(filePath, 'index.html');
    } catch { /* غير موجود */ }

    let data = await readFile(filePath);
    if (isDemo && extname(filePath).toLowerCase() === '.html') {
      data = Buffer.from(demoPage(data.toString('utf8')), 'utf8');
    }
    if (url.searchParams.get('demo') === '1' && /[\\/]apply\.html$/.test(filePath)) {
      data = Buffer.from(demoCardPage(data.toString('utf8')), 'utf8');
    }
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': data.length
    });
    res.end(data);
  } catch (e) {
    /* نفس سلوك Cloudflare Pages: صفحة 404 بهوية الشركة (404.html) وليس نصاً عارياً،
       حتى تطابق المعاينة المحلية ما يراه الزائر على الموقع المنشور تماماً. */
    try {
      const page = await readFile(join(ROOT, '404.html'));
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': page.length
      });
      res.end(page);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8">' +
        '<body style="font-family:sans-serif;padding:40px;background:#0b1a3a;color:#fff">' +
        '<h1>404 — الصفحة غير موجودة</h1><p><a style="color:#e8d089" href="/">العودة إلى الموقع</a></p></body></html>');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('— خادم معاينة منصة مكسب للتوظيف يعمل —');
  console.log('  الموقع العام   : http://localhost:' + PORT + '/');
  console.log('  صفحة التحقق    : http://localhost:' + PORT + '/verify.html?form=HRC-NO-000120');
  /* لا نطبع بيانات دخول في الطرفية: من يرى الشاشة يرى ما لا يحق له، ونفس
     السبب الذي أوجب حذف الحسابات التجريبية من الشاشة ينطبق على السجل. */
  console.log('  لوحة الموظفين  : http://localhost:' + PORT + '/dashboard.html');
  console.log('  الملف المستقل  : http://localhost:' + PORT + '/hrc-standalone.html');
  console.log('  مسارات نظيفة   : /verify  ·  /dashboard  ·  /standalone  ·  /light  ·  /restore   (مثل Render)');
  console.log('  معاينة بلا قاعدة: /demo  (20 وظيفة وهمية — للمراجعة البصرية فقط، لا تُستخدم في الإنتاج)');
  console.log('  معاينة شاشة الوظائف: /demo-card  (بطاقة وهمية بأربع فرص — للمراجعة البصرية فقط)');
});
