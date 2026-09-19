#!/usr/bin/env node
/* ===========================================================================
 *  BRC — ميزانية الأداء ومسارات الزوار
 *  ---------------------------------------------------------------------------
 *  لماذا اختبار للأداء؟ لأن الوزن يزيد بصمت: كل ملف يُضاف إلى صفحة يُنزّله كل
 *  زائر إلى الأبد، ولا أحد يلاحظ. هنا نُثبّت سقفاً لكل صفحة، ونمنع تحديداً:
 *    • تحميل مكتبة سوبابيس الكاملة (213KB) في صفحة زائر — حدث فعلاً وكان ثلث
 *      ما ينزّله الزائر، حتى صار للصفحات العامة عميل مصغّر (cloud-http).
 *    • أكثر من طلب قاعدة واحد لكل زيارة عامة.
 *
 *  ونُثبت أيضاً أن مسار الزائر **يعمل** بالعميل المصغّر: نُقلع خادماً وهمياً
 *  يتكلم PostgREST (يتحقق من ترويسة السكيما والردود) ونفتح index.html عليه.
 *
 *  التشغيل:  node tests/perf.mjs
 * =========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
 *  ميزانية الوزن لكل صفحة (بالكيلوبايت خاماً — قابلة للقياس بلا شبكة)
 *  الأرقام أعلى قليلاً من المقيس عمداً: هامش صغير للتحديثات، لكنها تمنع القفزات
 *  الكبيرة (مثل إعادة مكتبة 213KB إلى صفحة عامة).
 * ------------------------------------------------------------------------- */
const BUDGET = {
  'index.html': { raw: 400, requests: 20 },
  'verify.html': { raw: 380, requests: 20 },
  'dashboard.html': { raw: 700, requests: 20 }
};

function payloadOf(page) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const files = [...new Set([...html.matchAll(/(?:src|href)="([^"]+?\.(?:js|css))(?:\?[^"]*)?"/g)].map((m) => m[1]))];
  let raw = Buffer.byteLength(html);
  const each = [];
  for (const f of files) {
    const abs = join(ROOT, f);
    if (!existsSync(abs)) continue;
    const b = readFileSync(abs);
    raw += b.length;
    each.push({ path: f, raw: b.length, gz: gzipSync(b).length, br: brotliCompressSync(b).length });
  }
  return { page, files, each, raw, requests: files.length + 1, html };
}

console.log('\n' + '═'.repeat(74));
console.log('  BRC — ميزانية الأداء ومسار الزائر');
console.log('═'.repeat(74));

step(1, 'ميزانية الوزن — لا صفحة تتجاوز سقفها');
{
  for (const page of Object.keys(BUDGET)) {
    const p = payloadOf(page);
    const gz = gzipSync(Buffer.from(p.html)).length + p.each.reduce((a, e) => a + e.gz, 0);
    const br = brotliCompressSync(Buffer.from(p.html)).length + p.each.reduce((a, e) => a + e.br, 0);
    const b = BUDGET[page];
    console.log('   ' + page.padEnd(17) + 'خام ' + (p.raw / 1024).toFixed(0).padStart(4) + 'KB' +
      '  ·  gzip ' + (gz / 1024).toFixed(0).padStart(3) + 'KB' +
      '  ·  brotli ' + (br / 1024).toFixed(0).padStart(3) + 'KB' +
      '  ·  ' + p.requests + ' طلباً');
    check(page + ': الحجم الخام داخل الميزانية (' + b.raw + 'KB)', p.raw <= b.raw * 1024,
      (p.raw / 1024).toFixed(0) + 'KB');
    check(page + ': عدد الطلبات داخل الميزانية (' + b.requests + ')', p.requests <= b.requests, String(p.requests));
  }
}

step(2, 'الصفحات العامة لا تُحمّل مكتبة سوبابيس الكاملة');
{
  for (const page of ['index.html', 'verify.html']) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    check(page + ': لا مرجع لـ vendor/supabase.js', !/vendor\/supabase\.js/.test(html));
    check(page + ': يستخدم العميل المصغّر cloud-http.js', /cloud-http\.js/.test(html));
  }
  const dash = readFileSync(join(ROOT, 'dashboard.html'), 'utf8');
  check('اللوحة تحتفظ بمكتبة سوبابيس الكاملة (تحتاج Auth و Realtime)', /vendor\/supabase\.js/.test(dash));
  check('اللوحة تُحمّل وحدات الدخول', /cloud-auth\.js/.test(dash));
  const mini = readFileSync(join(ROOT, 'assets/js/cloud-http.js'));
  check('العميل المصغّر أقل من 10KB خاماً (مقابل 213KB)', mini.length < 10 * 1024, (mini.length / 1024).toFixed(1) + 'KB');
}

step(3, 'ميزانية القاعدة — طلبات Supabase لكل زيارة');
{
  /* العدد مأخوذ من السلوك الفعلي (واختبار store-cloud يتحقق منه بعميل وهمي):
     الزائر = طلب واحد لـ public_jobs، والموظف = ست قراءات + لحظي + دفعات. */
  const cfgJs = readFileSync(join(ROOT, 'assets/js/store.js'), 'utf8');
  const cloudJs = readFileSync(join(ROOT, 'assets/js/cloud.js'), 'utf8');
  const tables = (cloudJs.match(/var TABLES = \[([^\]]+)\]/) || [])[1] || '';
  const count = tables.split(',').filter((x) => x.trim()).length;
  check('جداول الإقلاع للموظف ستة كما هو متوقّع', count === 6, String(count));
  check('الصفحات العامة لا تشترك في القناة اللحظية', !/subscribeAll/.test(readFileSync(join(ROOT, 'assets/js/public.js'), 'utf8')));
  check('مساعد القراءة العامة محصور بمطلب واحد (public_jobs)',
    /from\('public_jobs'\)/.test(cloudJs) && !/from\('jobs'\)[\s\S]{0,80}fetchPublicJobs/.test(cloudJs));
  check('الإقلاع العام لا يقرأ جداول الموظفين (canReadStaffTables)', /canReadStaffTables/.test(cfgJs));
}

step(4, 'العميل المصغّر يعمل فعلاً — خادم PostgREST وهمي + index.html حقيقية');
{
  /* خادم يحاكي PostgREST: يتحقق من ترويسة السكيما ويخدم الواجهة العامة والدوال.
     الغرض: إثبات أن الزائر يرى وظائف القاعدة فعلاً بلا مكتبة سوبابيس، وأن عدد
     الطلبات المطلوب لذلك واحد — لا «ستة جداول مرفوضة» كما كان سيحدث. */
  const seen = [];
  const api = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, profile: req.headers['accept-profile'] || req.headers['content-profile'], apikey: !!req.headers.apikey });
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/rest/v1/public_jobs')) {
      if (req.headers['accept-profile'] !== 'brc') return json({ code: 'PGRST205', message: "Could not find the table 'public.public_jobs'" }, 404);
      return json([{ code: 'BRC-7777', title: 'وظيفة من الخادم الوهمي', category: 'خدمات', region: 'بابل',
        salary_min: 600000, salary_max: 800000, shift: 'صباحي', gender: 'لا فرق', vacancies: 2,
        requirements: ['خبرة'], status: 'available', description: 'وصف', image_url: '', created_at: '2026-01-01T00:00:00.000Z' }]);
    }
    if (req.url.startsWith('/rest/v1/rpc/verify_form')) {
      if (req.headers['content-profile'] !== 'brc') return json({ code: 'PGRST202', message: 'no function' }, 404);
      return json({ ok: false, error: 'لا توجد استمارة بهذا الرقم' });
    }
    if (req.url.startsWith('/rest/v1/rpc/request_form')) {
      return json({ ok: true, serial: 'HRC-NO-900777', status: 'pending' });
    }
    return json({ code: 'PGRST205', message: 'not found' }, 404);
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const apiPort = api.address().port;

  /* خادم ملفات الصفحة نفسها */
  const PORT = Number(process.env.BRC_PERF_PORT || 4331);
  const fileServer = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://localhost:' + PORT + '/'); if (r.ok) break; } catch {} await wait(150); }

  class Loader extends ResourceLoader {
    fetch(url, options) {
      /* نُعيد توجيه ملف الإعداد إلى نسخة تشير للخادم الوهمي */
      if (url.includes('/assets/js/supabase-config.js')) {
        return Promise.resolve(Buffer.from(
          "window.BRCSupabaseConfig = { url: 'http://127.0.0.1:" + apiPort + "', publishableKey: 'sb_publishable_test', schema: 'brc', enabled: true, enforceAuth: false };",
          'utf8'));
      }
      return super.fetch(url, options);
    }
  }
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    const m = String(e && (e.detail || e.message || e));
    if (/Not implemented|Could not load|Failed to load resource|NetworkError|ERR_/.test(m)) return;
    errors.push(m.split('\n')[0]);
  });
  const dom = await JSDOM.fromURL('http://localhost:' + PORT + '/index.html', {
    runScripts: 'dangerously', resources: new Loader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      /* jsdom لا يوفّر fetch أصلاً. نُمرّر fetch الخاص بـ Node ليعمل العميل
         المصغّر — وبذلك يمر الطلب على الشبكة الحقيقية إلى الخادم الوهمي،
         فالاختبار يثبت السلوك لا يحاكيه. */
      window.fetch = (url, init) => fetch(url, init);
    }
  });
  await new Promise((r) => { dom.window.addEventListener('load', r); setTimeout(r, 6000); });
  await wait(600);

  const w = dom.window, doc = w.document;
  const st = w.BRCStore.cloudStatus();
  check('لا أخطاء JS في الموقع العام', errors.length === 0, errors.join(' | '));
  check('الزائر متصل بالقاعدة (عميل مصغّر)', st.state === 'on' && st.role === 'public', JSON.stringify(st));
  check('الوظيفة القادمة من القاعدة ظاهرة في الصفحة',
    /BRC-7777/.test(doc.getElementById('jobs-grid').textContent), doc.getElementById('jobs-grid').textContent.slice(0, 80));
  const reads = seen.filter((s) => s.method === 'GET' && s.url.startsWith('/rest/v1/'));
  check('قراءة واحدة فقط لكل زيارة عامة', reads.length === 1, JSON.stringify(seen.map((s) => s.method + ' ' + s.url)));
  check('السكيما تُعلَن في الترويسة (Accept-Profile: brc)', reads.every((s) => s.profile === 'brc'),
    JSON.stringify(reads.map((s) => s.profile)));
  check('المفتاح العام يُرسل في كل طلب', seen.every((s) => s.apikey));
  check('لا قراءة لجداول الموظفين من الزائر (jobs/applicants/staff/audit)',
    !seen.some((s) => /\/(jobs|applicants|job_attempts|staff|audit_log|settings)\b/.test(s.url)),
    JSON.stringify(seen.map((s) => s.url)));

  /* الدوال: الطلب الإلكتروني والتحقق من نفس الصفحة/الصفحة المجاورة */
  const req = await w.BRCStore.submitPublicRequest({ fullName: 'علي', phone: '07701112223', address: 'بابل', gender: 'ذكر' });
  check('الطلب الإلكتروني يعمل بالعميل المصغّر (RPC)', req.ok && req.serial === 'HRC-NO-900777', JSON.stringify(req));
  const vr = await w.BRCStore.verifyCloud('HRC-NO-000000', null);
  check('التحقق يعمل بالعميل المصغّر ويُرجع «لا توجد استمارة»', vr.ok === false && /لا توجد استمارة/.test(vr.error), JSON.stringify(vr));
  check('لا محاولة تسجيل دخول من صفحة عامة', (await w.BRCStore.signIn('admin', 'x')).code === 'no_auth');

  api.close();
  fileServer.kill('SIGTERM');
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail ? '❌ ' : '✅ ') + pass + ' ناجح | ' + (fail ? '❌ ' : '') + fail + ' فاشل');
console.log('═'.repeat(74) + '\n');
if (problems.length) { console.log('  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); console.log(); }
process.exit(fail ? 1 : 0);
