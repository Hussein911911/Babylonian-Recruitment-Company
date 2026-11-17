#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   يبني **ملفاً واحداً** فيه الهيكل الكامل + كل البيانات + حزام أمان.

   طلب المالك (2026-11-17): «أريد أنزّل ملف واحد يحتوي كل شي، وهذا الملف بس
   أنطيه لأداة، والأداة تبني كل شي.»

   ⚠️ المنطق كله في assets/js/full-dump.js — نفس الملف الذي يستعمله زر
   التنزيل في restore.html. فلا يوجد منطقان ينحرفان: ما يجرّبه المالك في
   المتصفح هو حرفياً ما تنتجه هذه الأداة.

   الاستخدام:
     node tools/build-full-dump.mjs --payload <payload.json> [--out <ملف>]
     node tools/build-full-dump.mjs --schema-only [--out <ملف>]
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = (n) => argv.includes('--' + n);

const outPath = resolve(opt('out', 'HRC-FULL.sql'));
const payloadPath = opt('payload', '');
const schemaOnly = flag('schema-only');

/* ── الهيكل من المصدر المباشر ── */
const schemaPath = resolve(ROOT, 'docs/schema.sql');
if (!existsSync(schemaPath)) { console.error('❌ لم أجد docs/schema.sql'); process.exit(2); }
const SCHEMA = readFileSync(schemaPath, 'utf8');

/* ── نُحمّل مولّد البيانات ومولّد الملف في نطاق واحد ──
   كلاهما ملفات متصفح (IIFE تكتب على الجذر) — لا ESM. فنُنشئ نطاقاً نُمرّر
   له الجذر ونستخرج ما يكتبه. هكذا نستعمل الكود نفسه بلا نسخة ثانية. */
function loadBrowserScript(relPath, globalName) {
  const src = readFileSync(resolve(ROOT, relPath), 'utf8');
  const sandbox = {};
  const fn = new Function('globalThis', 'module', 'exports', 'console',
    src + '\nreturn globalThis["' + globalName + '"];');
  const api = fn(sandbox, undefined, undefined, console);
  if (!api) throw new Error('تعذّر تحميل ' + relPath + ' (' + globalName + ')');
  return { api, sandbox };
}

/* restore-sql.js أولاً (full-dump يستدعيه)، وبعدها full-dump على **نفس** الجذر */
const sandbox = {};
const runner = new Function('globalThis', 'console', `
  ${readFileSync(resolve(ROOT, 'assets/js/restore-sql.js'), 'utf8')}
  ${readFileSync(resolve(ROOT, 'assets/js/full-dump.js'), 'utf8')}
  return globalThis.HRCFullDump;
`);
const FullDump = runner(sandbox, console);
if (!FullDump || !FullDump.build) {
  console.error('❌ تعذّر تحميل assets/js/full-dump.js');
  process.exit(3);
}

/* ── البيانات ── */
let payload = null;
if (payloadPath) {
  const p = resolve(payloadPath);
  if (!existsSync(p)) { console.error('❌ لم أجد ملف البيانات: ' + p); process.exit(4); }
  try {
    payload = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('❌ ملف البيانات ليس JSON صالحاً: ' + e.message);
    process.exit(5);
  }
  /* تحقّق مبكر: النسخة بلا جداول أساسية تعني ملفاً فارغاً يُنفَّذ بنجاح
     ويترك القاعدة فارغة — أخطر من خطأ صريح. */
  if (!Array.isArray(payload.applicants)) {
    console.error('❌ النسخة لا تحتوي applicants — ليست نسخة صالحة');
    process.exit(6);
  }
} else if (!schemaOnly) {
  console.error('⚠️  لم يُمرَّر --payload: الملف سيحتوي الهيكل فقط.');
}

const out = FullDump.build({ schema: SCHEMA, payload, schemaOnly });

writeFileSync(outPath, out, 'utf8');
const sum = FullDump.SUMMARY(payload || {});
const lines = out.split('\n').length;
const kb = Math.round(Buffer.byteLength(out, 'utf8') / 1024);

console.log(`✅ ${outPath}`);
console.log(`   ${lines} سطراً · ${kb} ك.ب`);
if (payload) {
  console.log('   ' + Object.keys(sum.counts).map(k => sum.counts[k] + ' ' + k).join(' · '));
  console.log('   عدّاد البطاقات: ' + sum.cardNumberCounter);
} else {
  console.log('   الهيكل فقط (بلا بيانات)');
}
