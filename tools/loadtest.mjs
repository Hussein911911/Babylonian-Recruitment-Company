#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار الحمل (عدد الزوار المتزامنين) وحجم ما يُنزّله الزائر
 *  ---------------------------------------------------------------------------
 *  ماذا يقيس هذا الملف؟
 *    1) الحِمل: عدد الزوار المتزامنين الذين يخدمهم الخادم، وزمن الاستجابة
 *       (متوسط · وسيط · p95 · p99) ونسبة الأخطاء.
 *    2) الوزن: كم يُنزّل الزائر فعلاً لكل صفحة (خام ومضغوط gzip) وكم طلباً.
 *    3) ميزانية القاعدة: كم طلباً يصل لـ Supabase لكل زيارة — لأن هذا ما
 *       يُستهلك من حصة المشروع، لا سرعة الخادم وحده.
 *
 *  التشغيل:
 *      node tools/loadtest.mjs                    (افتراضي: 50 مشترك · 6 ثوانٍ)
 *      node tools/loadtest.mjs --users=200 --secs=10
 *      node tools/loadtest.mjs --base=http://localhost:4173
 *
 *  ⚠️ قراءة صادقة للنتائج: هذا يقيس خادم الملفات (tools/serve.mjs) وهو خادم
 *     Node واحد بخيط واحد. في الإنتاج (Render/Netlify/CDN) الملفات الثابتة
 *     تُخدَم من شبكة توزيع، فالأرقام هناك أعلى بكثير. الفائدة الحقيقية هنا:
 *     (أ) حجم كل صفحة وعدد طلباتها — وهذا لا يتغيّر بين البيئات،
 *     (ب) ألا يعتمد الموقع على أي حساب على الخادم لكل زيارة — وهو ثابت.
 * =========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : dflt;
};
const USERS = Number(arg('users', 50));
const SECS = Number(arg('secs', 6));
const PORT = Number(arg('port', 4390));
const BASE = arg('base', 'http://localhost:' + PORT);

/* ------------------------------ أدوات ------------------------------ */
const ASSET_RE = /(?:src|href)="([^"]+?\.(?:js|css))(?:\?[^"]*)?"/g;
function payloadOf(page) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const files = [...new Set([...html.matchAll(ASSET_RE)].map((m) => m[1]))];
  let raw = Buffer.byteLength(html), gz = gzipSync(html).length;
  let big = { path: '(html)', raw, gz };
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    const b = readFileSync(join(ROOT, f));
    const g = gzipSync(b).length;
    raw += b.length; gz += g;
    if (b.length > big.raw) big = { path: f, raw: b.length, gz: g };
  }
  return { page, requests: files.length + 1, raw, gz, big };
}

function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0; }

async function loadTest(paths) {
  const lat = new Map(paths.map((p) => [p, []]));
  let ok = 0, bad = 0, bytes = 0;
  const stop = Date.now() + SECS * 1000;
  let running = true;

  async function worker() {
    while (running && Date.now() < stop) {
      const p = paths[(ok + bad) % paths.length];
      const t0 = performance.now();
      try {
        const r = await fetch(BASE + p, { headers: { 'accept-encoding': 'gzip' } });
        const buf = Buffer.from(await r.arrayBuffer());
        bytes += buf.length;
        if (r.ok) ok++; else bad++;
      } catch { bad++; }
      lat.get(p).push(performance.now() - t0);
    }
  }
  await Promise.all(Array.from({ length: USERS }, worker));
  running = false;

  const all = [...lat.values()].flat().sort((a, b) => a - b);
  const elapsed = SECS;
  return {
    ok, bad, elapsed, bytes,
    rps: ok / elapsed,
    mbps: bytes / 1024 / 1024 / elapsed,
    mean: all.reduce((a, b) => a + b, 0) / (all.length || 1),
    p50: pct(all, 0.5), p95: pct(all, 0.95), p99: pct(all, 0.99), max: all[all.length - 1] || 0
  };
}

/* ------------------------------ التشغيل ------------------------------ */
const own = !process.argv.some((a) => a.startsWith('--base='));
let server = null;
if (own) {
  server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
}

console.log('\n' + '═'.repeat(74));
console.log('  BRC — اختبار الحمل ووزن الصفحات');
console.log('═'.repeat(74));

const PAGES = ['index.html', 'verify.html', 'dashboard.html'];
console.log('\n▌ 1) وزن كل صفحة على الزائر (ما يُنزّله فعلاً)');
const rows = PAGES.map(payloadOf);
console.log('   ' + 'الصفحة'.padEnd(18) + 'طلبات'.padStart(8) + 'خام'.padStart(12) + 'gzip'.padStart(12) + '   أثقل ملف');
for (const r of rows) {
  console.log('   ' + r.page.padEnd(18) + String(r.requests).padStart(8) +
    ((r.raw / 1024).toFixed(0) + 'KB').padStart(12) + ((r.gz / 1024).toFixed(0) + 'KB').padStart(12) +
    '   ' + r.big.path + ' (' + (r.big.raw / 1024).toFixed(0) + 'KB)');
}

console.log('\n▌ 2) الحِمل — ' + USERS + ' زائراً متزامناً لمدة ' + SECS + ' ثوانٍ');
const paths = ['/', '/verify.html', '/dashboard.html', '/assets/js/store.js', '/assets/css/style.css'];
const res = await loadTest(paths);
console.log('   طلبات ناجحة : ' + res.ok + '   فاشلة: ' + res.bad);
console.log('   معدّل        : ' + res.rps.toFixed(0) + ' طلب/ثانية   ·   ' + res.mbps.toFixed(1) + ' MB/ثانية');
console.log('   الاستجابة    : متوسط ' + res.mean.toFixed(1) + 'ms  ·  وسيط ' + res.p50.toFixed(1) +
  'ms  ·  p95 ' + res.p95.toFixed(1) + 'ms  ·  p99 ' + res.p99.toFixed(1) + 'ms  ·  أقصى ' + res.max.toFixed(0) + 'ms');

console.log('\n▌ 3) ميزانية القاعدة (طلبات Supabase لكل زيارة)');
console.log('   زائر للموقع العام   : طلب واحد (public_jobs) + لا اتصال لحظي');
console.log('   زائر صفحة التحقق    : لا قراءة جداول — استدعاء الدالة عند التحقق فقط');
console.log('   موظف في اللوحة      : ‎6 قراءات عند الإقلاع + قناة لحظية + دفعة كتابة مؤجَّلة لكل حفظ');
console.log('   (مفصّلة ومُختبرة آلياً في tests/perf.mjs)');

console.log('\n' + '═'.repeat(74) + '\n');
if (server) server.kill('SIGTERM');
process.exit(res.bad > 0 ? 1 : 0);
