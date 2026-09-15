#!/usr/bin/env node
/* ===========================================================================
 *  BRC — خادم معاينة محلي (بدون أي حزم خارجية)
 *  ---------------------------------------------------------------------------
 *  التشغيل:  node tools/serve.mjs  [المنفذ]
 *  يخدم الملفات الثابتة من جذر المشروع ويفتح الموقع على http://localhost:PORT
 * =========================================================================== */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    // مسارات نظيفة مطابقة لإعداد Render (render.yaml) — لتعمل المعاينة المحلية مثل الإنتاج
    const CLEAN_ROUTES = {
      '/verify': '/verify.html',
      '/dashboard': '/dashboard.html',
      '/standalone': '/brc-standalone.html',
      '/light': '/brc-light.html'
    };
    const clean = CLEAN_ROUTES[pathname.replace(/\/+$/, '') || pathname];
    if (clean) pathname = clean;
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(ROOT, safe);

    // خدمة المجلدات
    try {
      const st = await stat(filePath);
      if (st.isDirectory()) filePath = join(filePath, 'index.html');
    } catch { /* غير موجود */ }

    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': data.length
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8">' +
      '<body style="font-family:sans-serif;padding:40px;background:#0b1a3a;color:#fff">' +
      '<h1>404 — الصفحة غير موجودة</h1><p><a style="color:#e8d089" href="/">العودة إلى الموقع</a></p></body></html>');
  }
});

server.listen(PORT, HOST, () => {
  console.log('— خادم معاينة شركة بابل للتوظيف يعمل —');
  console.log('  الموقع العام   : http://localhost:' + PORT + '/');
  console.log('  صفحة التحقق    : http://localhost:' + PORT + '/verify.html?form=BRC-NO-000120');
  /* لا نطبع بيانات دخول في الطرفية: من يرى الشاشة يرى ما لا يحق له، ونفس
     السبب الذي أوجب حذف الحسابات التجريبية من الشاشة ينطبق على السجل. */
  console.log('  لوحة الموظفين  : http://localhost:' + PORT + '/dashboard.html');
  console.log('  الملف المستقل  : http://localhost:' + PORT + '/brc-standalone.html');
  console.log('  مسارات نظيفة   : /verify  ·  /dashboard  ·  /standalone  ·  /light   (مثل Render)');
});
