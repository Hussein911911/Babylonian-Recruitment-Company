#!/usr/bin/env node
/* ===========================================================================
 *  BRC — تجميع ملفات النشر في مجلد واحد (dist/)
 *  ---------------------------------------------------------------------------
 *  الاستخدام:  node tools/dist.mjs
 *
 *  لماذا؟ المنصّة المعتمدة للنشر هي Cloudflare Pages وحدها. النشر المباشر
 *  (Direct Upload) والنشر الآلي (GitHub Actions + wrangler) كلاهما يحتاج
 *  «مجلد نشر» نظيفاً: ملفات الموقع فقط — بلا tests/ ولا src/ ولا docs/ ولا أدوات.
 *
 *  القاعدة الحاكمة: كل ملف يطلبه المتصفح فعلاً يجب أن يكون هنا. أي ملف يُضاف
 *  للجذر مستقبلاً ولا يُدرج في PUBLIC يبقى خارج النشر — فلا تُضف صفحة جديدة
 *  بلا إدراجها في هذه القائمة.
 * =========================================================================== */
import { cp, mkdir, rm, readdir, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

/* صفحات الموقع + الملفات التي يقرأها Cloudflare + المجلدات الثابتة */
const PAGES = [
  'index.html',            // الموقع العام
  'verify.html',           // أداة التحقق (للموظفين والإدارة)
  'dashboard.html',        // المنظومة الداخلية
  'brc-standalone.html',   // النسخة المستقلة (ملف واحد)
  'brc-light.html',        // النسخة الخفيفة
  'supabase-check.html',   // صفحة فحص الاتصال
  'sw.js',                 // Service Worker (يجب أن يبقى في الجذر ليعمل على كل الموقع)
  '_headers',              // ترويسات Cloudflare Pages
  '_redirects'             // مسارات Cloudflare Pages النظيفة
];
const dirs = ['assets'];
/* ملفات لا تُنشر أبداً حتى لو وُجدت في المجلدات: نسخ احتياطية متخلّفة */
const SKIP = ['.backup', '.old', '.orig', '.bak', '.tmp'];

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const missing = [];
  for (const f of PAGES) {
    if (!existsSync(join(ROOT, f))) { missing.push(f); continue; }
    await cp(join(ROOT, f), join(OUT, f));
  }
  for (const d of dirs) await cp(join(ROOT, d), join(OUT, d), {
    recursive: true,
    filter: (src) => !SKIP.some((x) => src.toLowerCase().endsWith(x))
  });
  if (missing.length) {
    console.error('✗ ملفات مفقودة من الجذر: ' + missing.join(', '));
    process.exit(1);
  }

  /* فحص ذاتي: كل أصل محلي مذكور في الصفحات يجب أن يكون موجوداً في dist —
     خطأ النسخ هنا يعني موقعاً منشوراً بصورة/سكربت ناقص. */
  const problems = [];
  const pages = (await readdir(OUT)).filter((f) => f.endsWith('.html'));
  for (const p of pages) {
    const html = await readFile(join(OUT, p), 'utf8');
    const refs = new Set();
    for (const m of html.matchAll(/(?:src|href)="((?!https?:|#|data:|mailto:|tel:)[^"]+)"/g)) refs.add(m[1]);
    for (const m of html.matchAll(/url\(['"]?((?!https?:|data:)[^'")]+)['"]?\)/g)) refs.add(m[1]);
    for (const r of refs) {
      const clean = r.split('?')[0].split('#')[0];
      /* نتجاهل الروابط الديناميكية المبنية بالكود داخل الملف المستقل
         (مثل "' + bookUrl(j.code) + '") — ليست مسارات ملفات ثابتة */
      if (!clean || /['"+$`]/.test(clean) || /\/$/.test(clean)) continue;
      if (!existsSync(join(OUT, clean))) problems.push(p + ' → ' + clean);
    }
  }

  /* فحص ملفات JS/CSS: مسارات الصور والخطوط داخلها */
  for (const sub of ['css', 'js']) {
    const base = join(OUT, 'assets', sub);
    if (!existsSync(base)) continue;
    for (const f of await readdir(base)) {
      if (!/\.(css|js)$/.test(f)) continue;
      const txt = await readFile(join(base, f), 'utf8');
      for (const m of txt.matchAll(/url\(['"]?((?!https?:|data:)[^'")]+)['"]?\)/g)) {
        const clean = m[1].split('?')[0];
        if (!/^\.{0,2}\//.test(clean) || /['"+$`]/.test(clean)) continue;
        const target = resolve(base, clean);
        if (!existsSync(target)) problems.push('assets/' + sub + '/' + f + ' → ' + clean);
      }
    }
  }

  for (const f of await walk(OUT)) {
    if (SKIP.some((x) => f.toLowerCase().endsWith(x))) problems.push('ملف غير مرغوب في النشر: ' + f.replace(OUT + '/', ''));
  }

  const size = await totalSize(OUT);
  const files = await countFiles(OUT);
  if (problems.length) {
    console.error('✗ مراجع ناقصة في مجلد النشر (' + problems.length + '):');
    problems.slice(0, 15).forEach((p) => console.error('  • ' + p));
    process.exit(1);
  }
  console.log('✓ dist/ جاهز للنشر — ' + files + ' ملفاً · ' + (size / 1048576).toFixed(2) + ' ميجابايت');
  console.log('  المحتوى: ' + pages.join(' · '));
}

async function totalSize(dir) {
  let sum = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) sum += await totalSize(full);
    else sum += (await stat(full)).size;
  }
  return sum;
}
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}
async function countFiles(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += await countFiles(join(dir, e.name));
    else n++;
  }
  return n;
}

main().catch((e) => { console.error('✗ فشل التجميع: ' + e.message); process.exit(1); });
