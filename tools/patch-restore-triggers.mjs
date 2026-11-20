#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — ترقيع كتلتَي المشغّلات في ملف الاسترجاع الكامل
   ---------------------------------------------------------------------------
   لماذا: ملف الاسترجاع يعطّل/يعيد المشغّلات بـ ALTER TABLE … TRIGGER ALL،
   وهذا يتطلب superuser، ودور `postgres` في مشاريع Supabase الحديثة ليس
   superuser. النتيجة: كتلة التعطيل تُهمَل بصمت، وكتلة إعادة التفعيل تُجهض
   معاملة البيانات كاملة (‏42501) → الملف لا يكتمل أبداً.

   ماذا يفعل هذا الملف: يستبدل العبارتين فقط بنسخة تسمّي كل مشغّل صراحةً
   (من docs/sql-parts/fixes/03-restore-trigger-blocks.sql)، ويترك بقية
   الملف بايتاً ببايت. لا يلمس البيانات ولا الترتيب ولا المعاملات.

   الاستخدام:
     node tools/patch-restore-triggers.mjs <input.sql> [output.sql]
     (بلا output → يكتب إلى stdout)

   كوحدة:
     import { patchTriggerBlocks, loadBlocks } from './patch-restore-triggers.mjs'
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './sql-split-core.mjs';

const FIX_FILE = fileURLToPath(new URL('../docs/sql-parts/fixes/03-restore-trigger-blocks.sql', import.meta.url));

/* العبارتان المستهدفتان — نطابقهما بالنص الحرفي داخل العبارة */
const TARGETS = [
  { kind: 'disable', re: /ALTER TABLE brc\.%I DISABLE TRIGGER ALL/ },
  { kind: 'enable', re: /ALTER TABLE brc\.%I ENABLE TRIGGER ALL/ },
];

export function loadBlocks(file = FIX_FILE) {
  const text = readFileSync(file, 'utf8');
  const blocks = {};
  let current = null;
  let buf = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    const open = /^--\s*@block\s+([a-z0-9_-]+)\s*$/.exec(t);
    if (open) { current = open[1]; buf = []; continue; }
    if (current && /^--\s*@end\s*$/.test(t)) {
      blocks[current] = buf.join('\n').trim();
      current = null;
      continue;
    }
    if (current) buf.push(line);
  }
  for (const { kind } of TARGETS) {
    if (!blocks[kind]) throw new Error(`الكتلة «${kind}» غائبة من ${file}`);
  }
  return blocks;
}

/* نطاقات العبارات داخل النص (بدايات ونهايات بايتية) */
function statementRanges(text) {
  const stmts = splitStatements(text);
  const ranges = [];
  let cursor = 0;
  for (const s of stmts) {
    const at = text.indexOf(s, cursor);
    if (at < 0) throw new Error('تعذّر تحديد موضع عبارة — الملف غير متوقّع');
    ranges.push({ start: at, end: at + s.length, text: s });
    cursor = at + s.length;
  }
  return ranges;
}

/* العبارة قد تبدأ بتعليقات/أسطر فارغة تخصّها — نحفظها كما هي قبل الكتلة الجديدة */
function splitLeadingComments(slice) {
  const lines = slice.split('\n');
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('--')) { i++; continue; }
    break;
  }
  return { lead: i > 0 ? lines.slice(0, i).join('\n') + '\n' : '', body: lines.slice(i).join('\n') };
}

export function patchTriggerBlocks(text, blocks = loadBlocks(), { allowNone = false } = {}) {
  const ranges = statementRanges(text);
  const edits = [];
  for (const r of ranges) {
    for (const { kind, re } of TARGETS) {
      if (re.test(r.text)) {
        const line = text.slice(0, r.start).split('\n').length;
        const { lead } = splitLeadingComments(r.text);
        const after = lead + blocks[kind];
        edits.push({ kind, start: r.start, end: r.end, line, before: r.text, after });
      }
    }
  }
  /* allowNone: ملف أنشأه المولّد بعد 2026-11-20 لا يحوي TRIGGER ALL أصلاً —
     فغياب العبارتين يعني «نظيف»، لا «مرقّع سابقاً». الترقيع الناقص (عبارة
     واحدة) يبقى خطأً في كل الحالات. */
  if (allowNone && edits.length === 0) {
    return { text, replaced: [], statements: ranges.length, clean: true };
  }
  if (edits.length !== TARGETS.length) {
    throw new Error(
      `المتوقع ترقيع ${TARGETS.length} عبارة، وُجدت ${edits.length}. ` +
      'إمّا أن الملف مرقّع سابقاً أو أن نسخته مختلفة — لا تُنفَّذ بلا فحص.'
    );
  }
  /* الترتيب تنازلياً كي لا تتزحزح المواضع */
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.after + out.slice(e.end);
  }
  const afterCount = splitStatements(out).length;
  const beforeCount = ranges.length;
  if (afterCount !== beforeCount) {
    throw new Error(`عدد العبارات تغيّر: ${beforeCount} → ${afterCount} — توقف`);
  }
  return {
    text: out,
    replaced: edits.sort((a, b) => a.line - b.line).map(({ kind, line, before, after }) => ({ kind, line, before, after })),
    statements: afterCount,
    clean: false,
  };
}

/* CLI */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , input, output] = process.argv;
  if (!input) {
    console.error('الاستخدام: node tools/patch-restore-triggers.mjs <input.sql> [output.sql]');
    process.exit(2);
  }
  const src = readFileSync(input, 'utf8');
  const res = patchTriggerBlocks(src);
  for (const r of res.replaced) {
    console.error(`✔ ${r.kind}: العبارة عند السطر ${r.line} استُبدلت بنسخة تسمّي كل مشغّل صراحةً`);
  }
  console.error(`✔ إجمالي العبارات بعد الترقيع: ${res.statements} (بلا تغيير)`);
  if (output) {
    writeFileSync(output, res.text);
    console.error(`✔ كُتب: ${output}`);
  } else {
    process.stdout.write(res.text);
  }
}
