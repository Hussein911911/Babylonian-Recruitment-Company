#!/usr/bin/env node
/* ===========================================================================
 *  حارس: لا زر «هامبرغر» ميت في الترويسة
 *  ---------------------------------------------------------------------------
 *  كان #nav-toggle يظهر على الجوال في /dashboard و/verify و/404 بلا أي معالج
 *  (معالجه الوحيد في public.js التي تُحمَّل في index.html وحدها، والترويسة
 *  هناك تُخفى أصلاً على الجوال). حُذف الزر وغلافه والقواعد/المعالجات الميتة.
 *  هذا الفحص يمنع عودته، ويثبت أن بقية الترويسة وشاشة الدخول سليمة وبلا أخطاء.
 *
 *  التشغيل: npm run test:header-nav
 * =========================================================================== */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let checks = 0;
const check = (label, condition) => {
  assert.ok(condition, label);
  console.log('  ✓ ' + label);
  checks++;
};

const PAGES = ['index.html', 'verify.html', 'dashboard.html', '404.html',
  'hrc-standalone.html', 'hrc-light.html'];

/* 1) الصفحات المنشورة: اختفاء الزر الميت، وبقاء الترويسة وروابطها */
for (const p of PAGES) {
  const html = read(p);
  check(p + ': لا #nav-toggle ولا .header-actions',
    !/id="nav-toggle"/.test(html) && !/class="nav-toggle"/.test(html) &&
    !/class="header-actions"/.test(html));
  check(p + ': قائمة الترويسة وروابطها ما زالت موجودة',
    /id="main-nav"/.test(html) &&
    (/href="\/?index\.html#jobs"/.test(html) || /href="#jobs"/.test(html)));
}

/* 2) لا بقايا في الأنماط أو السكربتات */
const css = read('assets/css/style.css');
const pubJs = read('assets/js/public.js');
const navJs = read('assets/js/nav.js');
check('style.css بلا قاعدة .nav-toggle ولا .main-nav.open',
  !/\.nav-toggle\s*\{/.test(css) && !/\.main-nav\.open/.test(css));
check('public.js و nav.js بلا getElementById(\'nav-toggle\')',
  !/getElementById\(['"]nav-toggle['"]\)/.test(pubJs) &&
  !/getElementById\(['"]nav-toggle['"]\)/.test(navJs));
check('#hamburger-btn (قائمة اللوحة بعد الدخول) ما زال موجوداً',
  /id="hamburger-btn"/.test(read('src/partials/dashboard.html')) &&
  /getElementById\(['"]hamburger-btn['"]\)/.test(read('assets/js/dashboard.js')));

/* 3) تشغيل فعلي لكل صفحة: لا أخطاء JS، ولا عنصر ميت، وشاشة الدخول سليمة.
   نُشغّل خادماً محلياً صغيراً لأن 404.html تشير إلى /assets/… بمسار جذري
   (كما تُخدَم فعلياً على الاستضافة) ولا يصلح ذلك مع file:// في jsdom. */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  const file = join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch (e) { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';

class OfflineLoader extends ResourceLoader {
  fetch(url, options) {
    const u = String(url);
    if (/supabase-config\.js/.test(u)) {
      return Promise.resolve(Buffer.from('window.HRCSupabaseConfig={enabled:false,enforceAuth:false};'));
    }
    return super.fetch(url, options);
  }
}

async function load(file) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String(e && (e.detail || e.message || e));
    if (/Not implemented|Could not load|Failed to load resource|NetworkError|ERR_/.test(m)) return;
    errors.push(m.split('\n')[0]);
  });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ').split('\n')[0]));
  const dom = await JSDOM.fromURL(BASE + file, {
    runScripts: 'dangerously', resources: new OfflineLoader(),
    pretendToBeVisual: true, virtualConsole: vc
  });
  let timer;
  await new Promise((r) => {
    if (dom.window.document.readyState === 'complete') return r();
    const done = () => { clearTimeout(timer); r(); };
    timer = setTimeout(done, 4000);
    dom.window.addEventListener('load', done, { once: true });
  });
  await new Promise((r) => setTimeout(r, 60));
  return { dom, doc: dom.window.document, errors };
}

for (const p of ['index.html', 'verify.html', 'dashboard.html', '404.html']) {
  const { dom, doc, errors } = await load(p);
  try {
    check(p + ': تحميل بلا أخطاء JavaScript' + (errors.length ? ' — ' + errors.join(' | ') : ''),
      errors.length === 0);
    check(p + ': لا زر هامبرغر ولا غلافه في DOM',
      !doc.getElementById('nav-toggle') && doc.querySelectorAll('.nav-toggle, .header-actions').length === 0);
    check(p + ': الترويسة والعلامة التجارية وروابط التنقل باقية',
      !!doc.querySelector('.site-header .brand[data-staff-gate]') &&
      !!doc.getElementById('main-nav') &&
      doc.querySelectorAll('#main-nav a').length >= 6);
    if (p === 'dashboard.html') {
      check('شاشة الدخول سليمة (نموذج + رابط العودة + زر قائمة اللوحة)',
        !!doc.getElementById('login-wrap') && !!doc.getElementById('login-form') &&
        !!doc.querySelector('.login-back-link') && !!doc.getElementById('hamburger-btn'));
    }
    if (p === '404.html') check('قسم 404 باقٍ', !!doc.getElementById('notfound'));
  } finally {
    dom.window.close();
  }
}

server.close();
console.log(`\nالترويسة بلا زر ميت: ${checks} فحصاً ناجحاً.`);
