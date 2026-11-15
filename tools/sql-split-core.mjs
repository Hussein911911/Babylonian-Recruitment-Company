#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   HRC — نواة تقسيم SQL (مستعملة من split-sql.mjs ومن أدوات البناء)
   ---------------------------------------------------------------------------
   سبب وجودها: `restore.html` كان يضمّن المخطط **كملف واحد** فيُنزّل
   `1-schema.sql` بطول ٣١٥٤ سطراً — وهو نفس الحدّ الذي يقصّ محرّر Supabase
   عنده (~٢٠٠٠ سطر) بصمت. فصار زر التنزيل يعطي ملفاً ناقصاً بلا أن يشتكي.

   هنا منطق التقسيم وحده، بلا آثار جانبية ولا كتابة ملفات، كي تستورده
   أدوات البناء وتتحقق منه الاختبارات.
   ═══════════════════════════════════════════════════════════════════════════ */

export function splitStatements(text) {
  const stmts = [];
  let i = 0;
  const n = text.length;
  let start = 0;
  let inSingle = false;   // '...'
  let inDouble = false;   // "..."
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;   // '$$' أو '$tag$'

  while (i < n) {
    const c = text[i];
    const two = text.slice(i, i + 2);

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (two === '*/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inSingle) {
      /* '' داخل النص = علامة مهرّبة، لا نخرج */
      if (c === "'") {
        if (text[i + 1] === "'") { i += 2; continue; }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        if (text[i + 1] === '"') { i += 2; continue; }
        inDouble = false;
      }
      i++;
      continue;
    }
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) { i += dollarTag.length; dollarTag = null; continue; }
      i++;
      continue;
    }

    /* خارج كل شيء */
    if (two === '--') { inLineComment = true; i += 2; continue; }
    if (two === '/*') { inBlockComment = true; i += 2; continue; }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === '$') {
      /* $tag$ أو $$ — والتاج قد يحوي حروفاً وأرقاماً و_ */
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i));
      if (m) { dollarTag = m[0]; i += m[0].length; continue; }
      i++;
      continue;
    }
    if (c === ';') {
      stmts.push(text.slice(start, i + 1));
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  /* ما بقي بعد آخر فاصلة منقوطة */
  const rest = text.slice(start);
  if (rest.trim()) stmts.push(rest);

  return stmts;
}
