#!/usr/bin/env node
/* ===========================================================================
 *  BRC — مزامنة مخطط قاعدة البيانات
 *  ---------------------------------------------------------------------------
 *  docs/schema.sql هو المصدر الوحيد (single source of truth).
 *  تكاملة GitHub في Supabase تقرأ من supabase/migrations/ فقط.
 *  هذا السكربت ينسخ المصدر إلى ملف الـ migration حتى لا ينحرفا.
 *
 *  التشغيل:  npm run schema:sync
 *  (فحص الانحراف التلقائي: npm run test:schema)
 * =========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs', 'schema.sql');
const DIR = join(ROOT, 'supabase', 'migrations');

mkdirSync(DIR, { recursive: true });

/* يجب أن يبقى اسم ملف الـ migration ثابتاً: تغييره يعني أن Supabase تعتبره
   migration جديدة وتُعيد تطبيقه (آمن هنا لأن المخطط idempotent، لكنه يشوّش
   سجل الـ migrations). */
const NAME = '20260915000000_brc_initial_schema.sql';
const DEST = join(DIR, NAME);

const src = readFileSync(SRC, 'utf8');
let cur = null;
try { cur = readFileSync(DEST, 'utf8'); } catch { /* غير موجود */ }

if (cur === src) {
  console.log('✓ لا تغيير — ملف الـ migration مطابق للمصدر');
  process.exit(0);
}

writeFileSync(DEST, src);
console.log('— تمت المزامنة —');
console.log('  docs/schema.sql  →  supabase/migrations/' + NAME);
console.log('  (' + Buffer.byteLength(src, 'utf8').toLocaleString('en') + ' بايت)');

const others = readdirSync(DIR).filter((f) => f.endsWith('.sql') && f !== NAME);
if (others.length) {
  console.log('\n  ⚠️ ملفات migration أخرى موجودة (لن تُعدّل):');
  others.forEach((f) => console.log('     • ' + f));
}
