/* ═══════════════════════════════════════════════════════════════════════════
   HRC — حقائق تُقرأ من ملف الاسترجاع نفسه (بلا قاعدة بيانات)
   ---------------------------------------------------------------------------
   لماذا: حزمة الطوارئ تُبنى على جهاز قد لا يملك اتصالاً بقاعدة البيانات.
   فكل ما نعرفه عن المحتوى يجب أن يُستخرج من الملف: أعداد الترويسة، صفوف
   الموظفين (لإنشاء accounts.json)، ومسارات ملفات التخزين المطلوبة.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── تقسيم صف VALUES إلى حقول، مع احترام التنصيص والأقواس ─────────────── */
function splitTuples(valuesBlock) {
  const rows = [];
  let depth = 0, inQuote = false, cur = '', started = false;
  for (let i = 0; i < valuesBlock.length; i++) {
    const ch = valuesBlock[i];
    if (inQuote) {
      cur += ch;
      if (ch === "'") {
        if (valuesBlock[i + 1] === "'") { cur += "'"; i++; } else { inQuote = false; }
      }
      continue;
    }
    if (ch === "'") { inQuote = true; cur += ch; started = true; continue; }
    if (ch === '(') { depth++; if (depth === 1) { cur = ''; started = true; continue; } }
    if (ch === ')') {
      depth--;
      if (depth === 0 && started) { rows.push(cur); started = false; cur = ''; continue; }
    }
    if (depth === 1) cur += ch;
  }
  return rows;
}

function splitFields(row) {
  const out = [];
  let inQuote = false, cur = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuote) {
      if (ch === "'") {
        if (row[i + 1] === "'") { cur += "'"; i++; } else { inQuote = false; }
      } else cur += ch;
      continue;
    }
    if (ch === "'") { inQuote = true; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function cast(v) {
  if (v === 'NULL') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

/* صفوف جدول واحد من عبارة INSERT INTO brc."<table>" — بلا قاعدة بيانات */
export function tableRows(text, table) {
  const re = new RegExp(`INSERT INTO brc\\."${table}"\\s*\\(([^)]*)\\)\\s*\\nVALUES`, 'i');
  const head = re.exec(text);
  if (!head) return [];
  const cols = head[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const start = head.index + head[0].length;
  const stop = text.indexOf(';', start);
  let block = text.slice(start, stop < 0 ? undefined : stop);
  /* لا تلتقط "ON CONFLICT (\"username\")" كأنه صف */
  const oc = block.search(/ON\s+CONFLICT/i);
  if (oc >= 0) block = block.slice(0, oc);
  return splitTuples(block)
    .map((row) => splitFields(row))
    .filter((vals) => vals.length === cols.length)
    .map((vals) => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = cast(vals[i]); });
      return obj;
    });
}

/* مسارات ملفات التخزين التي تشير إليها البيانات (bucket/key) */
export function storagePaths(text, bucket = 'job-images') {
  const re = new RegExp(`(?:object/public/)?${bucket}/([A-Za-z0-9._\\/-]+)`, 'g');
  const seen = new Set();
  let m;
  while ((m = re.exec(text))) {
    const p = m[1].replace(/["'\\]+$/, '');
    if (p && /\.[a-z0-9]{2,5}$/i.test(p)) seen.add(p);
  }
  return [...seen].sort();
}
