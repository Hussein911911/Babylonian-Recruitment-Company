#!/usr/bin/env node
/* ===========================================================================
 *  HRC — تقسيم ملفات SQL الكبيرة إلى أجزاء تُلصق في محرّر Supabase
 *  ---------------------------------------------------------------------------
 *  ⚠️ المشكلة الحقيقية (بلاغ المدير 2026-11-16):
 *    «الكيوري يستقبل فقط ٢٠٠٠ سطر والملف الأول بي أكثر من الفين والثاني
 *     بحدود الـ٦٠٠٠ أو أكثر».
 *
 *  فحصنا الحدود الفعلية:
 *    • محرّر Supabase لا يفرض حدّ **أسطر** موثّقاً، لكنه يرفض البصق الكبير
 *      عملياً، وأهمّه **مهلة ٦٠ ثانية** للاستعلام الواحد على الخطة المجانية.
 *    • `1-schema.sql` = ٣٠٥٤ سطراً / ١٨٤ ك.ب — قد ينتهي قبل المهلة، لكن
 *      السَّبب الذي يقتل العملية ليس الحجم بل **الاعتماد على ترتيب**.
 *    • `2-data.sql` = ٣٥٣٤ سطراً / ٢٠٥ ك.ب في نسخة ب٤٤٠ بطاقة، وأكبر
 *      كتلة `INSERT` واحدة (سجل التدقيق) ١٠٦ ك.ب — وحدها تُلصق في محرّر.
 *
 *  ⚠️ والأخطر — عطل حقيقي كشفه هذا العمل:
 *    مخطط القاعدة **يُدرج** `brc.settings` الافتراضية (السطور ٣٠٠-…)،
 *    وملف البيانات يبدأ بـ`TRUNCATE … brc.settings`. فلو شغّلت المخطط
 *    مرتين (وهو ما يفعله كل من يقسّم الملف ويضيع)، ثم شغّلت البيانات،
 *    تُمسح الإعدادات ولا يُعاد إدراجها إلا ما كان في النسخة.
 *    وكذلك `select brc.archive_finished_cards()` عند نهاية المخطط.
 *
 *  ⚠️ وثالثاً: البيانات تبدأ بـ`TRUNCATE` ويشير بعضها إلى `brc.staff`
 *    بمفاتيح أجنبية. إدخال البيانات **بالترتيب** شرط، ولهذا يأتي
 *    `staff` أولاً في `TABLES` داخل restore-sql.js — ونحافظ على ذلك هنا.
 *
 *  ═══ لماذا هذا الملف موجود؟ ═══
 *  لأن المدير واجه جداراً حقيقياً في منتصف عملية استرجاع، والأسوأ من
 *  الفشل هو الفشل في منتصفه بلا خريطة. هذا الأمر يُنتج خريطة:
 *
 *      node tools/split-sql.mjs 1-schema.sql --lines 700
 *      node tools/split-sql.mjs 2-data.sql   --lines 700
 *
 *  فيُخرج:
 *      out/1-schema-part-01.sql … part-NN.sql  + INDEX.md
 *      out/2-data-part-01.sql   … part-NN.sql  + INDEX.md
 *
 *  ═══ قواعد التقسيم — ليست عدّ أسطر ═══
 *  لا يجوز قطع ملف SQL عند سطر عشوائي: القطع داخل دالة `$$…$$` أو داخل
 *  قوس `INSERT` ينتج خطأ صياغة. لذلك:
 *
 *    ١. نقرأ الملف ونتتبّع العمق: `$$` (dollar-quote)، `'…'`، `"…"`،
 *       `(…)`، و`begin…end` داخل الدوال.
 *    ٢. نقطة القطع الوحيدة المسموحة: نهاية **جملة كاملة** خارج كل عمق.
 *    ٣. نُجمّع الجمل حتى السقف المطلوب، ولا نتجاوز سقفاً يستحيل تحته
 *       القطع (جملة واحدة طويلة ← جزء وحيد أكبر من السقف، مع تحذير).
 *
 *  ═══ وضمان الترتيب ═══
 *  كل جزء يحمل في أوله تعليقاً يقول رقمه وما قبله، وآخر الملف `INDEX.md`
 *  يشرح الترتيب ونقاط التحقق بين الأجزاء. لا يُشغَّل جزء قبل سابقه.
 * =========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { splitStatements } from './sql-split-core.mjs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

if (!file || args.includes('--help') || args.includes('-h')) {
  console.log(`
HRC — تقسيم ملف SQL كبير إلى أجزاء تُلصق في محرّر Supabase

  node tools/split-sql.mjs <ملف.sql> [خيارات]

الخيارات:
  --lines <رقم>     سقف أسطر كل جزء (افتراضي 700)
  --bytes <رقم>     سقف بايتات كل جزء (افتراضي 180000)
  --out <مجلد>      مجلد الإخراج (افتراضي out-sql)
  --quiet           بلا تفاصيل

أمثلة:
  node tools/split-sql.mjs 1-schema.sql
  node tools/split-sql.mjs 2-data.sql --lines 500
`);
  process.exit(file ? 0 : 1);
}

const LIMIT_LINES = Math.max(50, Number(opt('lines', 700)) || 700);
const LIMIT_BYTES = Math.max(5000, Number(opt('bytes', 180000)) || 180000);
const OUT_DIR = resolve(opt('out', 'out-sql'));
const QUIET = args.includes('--quiet');

const src = readFileSync(resolve(file), 'utf8');
if (!src.trim()) {
  console.error('الملف فارغ: ' + file);
  process.exit(1);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ١) مُحلّل بسيط: يمشي على النص ويقول عند كل موضع هل نحن «خارج كل عمق».
 *  ---------------------------------------------------------------------------
 *  لا نحتاج محلّلاً نحوياً كاملاً لـPostgreSQL — نحتاج فقط أن نعرف أين
 *  تنتهي الجملة بأمان. الحالات التي تكسر التقسيم الساذج أربع:
 *
 *    $$ … $$            كتلة دالة: قد تحتوي `;` بالعشرات
 *    '…'                نص: قد يحتوي `;` و`--` و`$$`
 *    "…"                معرّف
 *    -- … \n            تعليق سطر
 *    /* … *\/           تعليق كتلة
 *
 *  ونعتبر `;` عند العمق صفر = نهاية جملة.
 * ═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
 *  ١.٥) وسم المعاملات — أهمّ إصلاح في هذه الأداة
 *
 *  ⚠️ السبب الحقيقي لفشل اللصق المتعدّد: ملف البيانات يبدأ بـ`BEGIN;` وينتهي
 *     بـ`COMMIT;`. والمعاملة **لا تعبر بين لصقتين** — محرّر Supabase يُغلق
 *     الاتصال (أو يُنهي الجلسة) بين تنفيذ وآخر، فتبقى معاملة مفتوحة ومعلّقة.
 *     النتيجة: بيانات لا تُثبَّت، أو قفل على الجداول، أو `idle in transaction`.
 *
 *  الحل: كل جزء يصبح **معاملة مستقلّة مغلقة** — يبدأ بـ`BEGIN` وينتهي بـ`COMMIT`
 *  إن كان في وسط معاملة الأصل. البيانات النهائية متطابقة تماماً؛ الذي يتغيّر
 *  هو أنّ الإلغاء عند الخطأ يخصّ الجزء الحالي فقط، لا الملف كله. هذا **أفضل**
 *  عملياً: خطأ في الجزء ٧ لا يُلغي ما نجح في ١–٦.
 * ═══════════════════════════════════════════════════════════════════════════ */
const TX_BEGIN_RE = /^(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|START\s+TRANSACTION)\s*;?\s*$/i;
const TX_END_RE =
  /^(?:COMMIT(?:\s+(?:WORK|TRANSACTION))?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?|END(?:\s+(?:WORK|TRANSACTION))?)\s*;?\s*$/i;

/* نصّ الجملة بلا تعليقاتها البادئة */
function bareStatement(stmt) {
  let s = stmt;
  for (;;) {
    const m = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)/.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s.trim();
}

/* يرجع مصفوفة: 'begin' | 'end' | 'inside' | 'outside' لكل جملة */
function markTransactions(stmts) {
  const marks = new Array(stmts.length).fill('outside');
  let open = false;
  for (let i = 0; i < stmts.length; i++) {
    const b = bareStatement(stmts[i]);
    if (TX_BEGIN_RE.test(b)) { marks[i] = 'begin'; open = true; continue; }
    if (TX_END_RE.test(b)) { marks[i] = 'end'; open = false; continue; }
    marks[i] = open ? 'inside' : 'outside';
  }
  return marks;
}

/* يُغلق كل جزء كمعاملة مستقلّة. `chunks` = مصفوفة من مصفوفات {text, idx}. */
/* تعطيل المشغّلات داخل معاملة الجزء — يُحقن في بداية كل جزء تالٍ للجزء
   الذي فعّله أصلاً. `SET LOCAL` يُلغى تلقائياً عند COMMIT. */
const REPLICA_PREFIX =
  '\n-- تعطيل المشغّلات داخل هذه المعاملة (كما في الملف الأصلي)\n' +
  'DO $$ BEGIN SET LOCAL session_replication_role = replica;\n' +
  'EXCEPTION WHEN insufficient_privilege OR others THEN NULL; END $$;\n\n';

function closeTransactions(chunks, marks) {
  const out = [];
  let openOrig = false;   /* حالة معاملة **الأصل** عند بداية الجزء */
  let replicaActive = false; /* هل عُطّلت المشغّلات؟ يجب أن تستمر عبر الأجزاء */

  for (let k = 0; k < chunks.length; k++) {
    const chunk = chunks[k];
    const isLast = k === chunks.length - 1;

    /* هل يحوي الجزء جملة داخل معاملة الأصل؟ */
    const firstInRegion = chunk.findIndex((o) => marks[o.idx] !== 'outside');
    const needsOwnBegin =
      openOrig && firstInRegion >= 0 && marks[chunk[firstInRegion].idx] !== 'begin';

    /* حالة الأصل عند نهاية هذا الجزء */
    let openAtEnd = openOrig;
    for (const o of chunk) {
      if (marks[o.idx] === 'begin') openAtEnd = true;
      else if (marks[o.idx] === 'end') openAtEnd = false;
    }
    /* نغلق إن كانت المعاملة مفتوحة في نهاية الجزء وثمّة جزء تالٍ */
    const needsCommit = openAtEnd && !isLast;

    const pieces = chunk.map((o) => o.text);

    /* تتبّع `session_replication_role = replica` عبر الأجزاء */
    if (chunk.some((o) => /session_replication_role\s*=\s*replica/i.test(o.text))) {
      replicaActive = true;
    }

    /* ═══ تعطيل المشغّلات يجب أن يُكرَّر في **كل** جزء ═══════════════════════
       ⚠️ عطل حقيقي كشفه الاختبار التنفيذي: ملف البيانات يبدأ بـ
          `DO $$ BEGIN SET LOCAL session_replication_role = replica; …`
       وكان `SET LOCAL` يسري على الملف **كله** لأنه داخل معاملة واحدة. بعد
       التقسيم صار سريانه ينتهي عند الجزء ١، فاشتغلت مشغّلات `audit_log`
       في الأجزاء التالية وأدخلت صفوفاً إضافية (١٤٦٦ بدل ١٢٤٠) وضاعفت
       المفاتيح. الحل: إعادة السطر في كل جزء داخل معاملته. */

    if (needsOwnBegin) {
      /* إن كان التعطيل فعّالاً من جزء سابق، أعِده داخل هذه المعاملة:
         `SET LOCAL` يُلغى عند COMMIT فلا يورَّث. */
      pieces.unshift(replicaActive ? '\nBEGIN;\n' + REPLICA_PREFIX : '\nBEGIN;\n');
    }
    if (needsCommit) pieces.push('\nCOMMIT;\n');

    /* تنظيف: لا نترك أكثر من سطر فارغ واحد متتالٍ */
    out.push(pieces.join('').replace(/\n{3,}/g, '\n\n'));
    openOrig = openAtEnd;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ٢) تجميع الجمل في أجزاء وفق السقفين
 * ═══════════════════════════════════════════════════════════════════════════ */
/* هامش الترويسة: ١٣ سطراً تُضاف لكل جزء **بعد** التخطيط، وكذلك أغلفة
   المعاملة (٢–٤ أسطر). بدون طرحها يتجاوز الملف النهائي السقف المعلن. */
const HEADER_RESERVE_LINES = 20;

function planChunks(stmts, limitLines) {
  const chunks = [];
  let cur = [];
  let curLines = 0;
  let curBytes = 0;

  const countLines = (s) => (s.match(/\n/g) || []).length;

  const flush = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
    curLines = 0;
    curBytes = 0;
  };

  for (let idx = 0; idx < stmts.length; idx++) {
    const st = stmts[idx];
    const lines = countLines(st);
    const bytes = Buffer.byteLength(st, 'utf8');

    /* ⚠️ جملة واحدة أطول من السقف — وهي الحالة التي أنتجت جزءاً بـ١٢٤٤ سطراً.
       السبب: ملف البيانات يُولّد `INSERT … VALUES (…),(…),…` كجملة **واحدة**
       لكل جدول. سجل التدقيق (١٢٤٠ صفاً) جملة واحدة = ١٢٤٤ سطراً، فيتجاوز
       السقف ولا يمكن قطعه من الداخل بالطريقة الحالية.
       الحل: نقسم قائمة VALUES إلى جمل INSERT متعدّدة — وهذا آمن تماماً لأن
       كل `INSERT` مستقلّ داخل نفس المعاملة (BEGIN…COMMIT)، فالنتيجة النهائية
       متطابقة. لا نلمس قوائم VALUES التي فيها سلاسل طويلة معقّدة: نقسم على
       حدود الصفوف `),\n  (` فقط، وهي فاصل ينتجه المولّد نفسه. */
    if (lines > limitLines || bytes > LIMIT_BYTES) {
      const pieces = splitLargeInsert(st, limitLines, LIMIT_BYTES, countLines);
      if (pieces) {
        flush();
        for (const piece of pieces) {
          chunks.push([{ text: piece, idx }]);
        }
        continue;
      }
    }

    const wouldExceed =
      cur.length > 0 && (curLines + lines > limitLines || curBytes + bytes > LIMIT_BYTES);

    if (wouldExceed) flush();
    cur.push({ text: st, idx });
    curLines += lines;
    curBytes += bytes;
  }
  flush();
  return chunks;
}

/* يقسم جملة `INSERT … VALUES` ضخمة إلى عدة جمل متطابقة المعنى.
 * يرجع مصفوفة نصوص، أو null إن لم تكن الجملة قابلة للتقسيم بأمان. */
function splitLargeInsert(stmt, limitLines, limitBytes, countLines) {
  /* ⚠️ الجملة تبدأ غالباً بتعليق يشرح عدد الصفوف:
       -- 1240 صفاً في audit_log (8 عموداً)
       INSERT INTO …
     نفصله ونضعه في أول جزء فقط. */
  const lead = /^(\s*(?:(?:--[^\n]*\n)|(?:\/\*[\s\S]*?\*\/\s*)*)*)(INSERT\s+INTO[\s\S]*)$/i.exec(stmt);
  if (!lead) return null;
  const leadComments = lead[1];
  const body0 = lead[2];

  const m = /^(INSERT\s+INTO\s+[\s\S]*?\nVALUES\s*\n)([\s\S]*?)(;\s*)$/i.exec(body0)
         || /^(INSERT\s+INTO\s+[\s\S]*?\sVALUES\s+)([\s\S]*?)(;\s*)$/i.exec(body0);
  if (!m) return null;
  const prefix = m[1];
  const tail = m[3];
  const list = m[2];

  /* ═══ القطع بين الصفوف — لا داخل الصف ═══════════════════════════════════
     الصفوف ينتجها المولّد بهذا الشكل:
         VALUES
           (…), 
           (…),
           (…)
     أي أن الصف **كامل** بين قوسين، والفاصل بينهما `,` + سطر جديد + مسافات.
     فالنمط الصحيح للقطع هو الفاصلة التي **يتبعها** قوس فتح — لا الفاصلة
     التي تسبقها. القطع السابق كان على `),(` فيحذف القوسين ويحتاج ترميماً
     خاطئاً. الآن: `,\s*\n\s*(?=\()` ⇒ كل صف يبقى `(…)` سليماً. */
  const sepMatch = /,\s*\n\s*(?=\()/.exec(list) || /,(?=\()/.exec(list);
  if (!sepMatch) return null;
  const sep = sepMatch[0];

  const rows = list.split(new RegExp(sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  if (rows.length < 2) return null;
  /* تحقّق أمان: كل صف يجب أن يبدأ بـ`(` وينتهي بـ`)` */
  if (!rows.every((r) => /^\s*\(/.test(r) && /\)\s*$/.test(r))) return null;

  const pieces = [];
  let buf = [];
  let bufBytes = 0;
  const prefixLines = countLines(prefix);
  const baseBytes = Buffer.byteLength(prefix + tail, 'utf8');

  const emit = () => {
    if (!buf.length) return;
    pieces.push((pieces.length === 0 ? leadComments : '') + prefix + buf.join(sep) + tail);
    buf = [];
    bufBytes = 0;
  };

  for (const row of rows) {
    const rowBytes = Buffer.byteLength(row + sep, 'utf8');
    const wouldExceed =
      buf.length > 0 &&
      (prefixLines + buf.length + 1 > limitLines ||
        baseBytes + bufBytes + rowBytes > limitBytes);
    if (wouldExceed) emit();
    buf.push(row);
    bufBytes += rowBytes;
  }
  emit();

  return pieces.length > 1 ? pieces : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ٣) ملاحظات ذكية: نُسمّي ما يفعله كل جزء كي يعرف المدير أين يلصقه
 * ═══════════════════════════════════════════════════════════════════════════ */
function describeChunk(text) {
  const notes = [];
  const add = (re, label) => {
    if (re.test(text) && !notes.includes(label)) notes.push(label);
  };
  add(/create\s+schema/i, 'إنشاء السكيما');
  add(/create\s+extension/i, 'الإضافات');
  add(/create\s+type/i, 'الأنواع');
  add(/create\s+table/i, 'الجداول');
  add(/create\s+(unique\s+)?index/i, 'الفهارس');
  add(/create\s+or\s+replace\s+function|create\s+function/i, 'الدوال');
  add(/create\s+(or\s+replace\s+)?view/i, 'العروض');
  add(/create\s+trigger|drop\s+trigger/i, 'المشغّلات');
  add(/create\s+policy|alter\s+\w+\s+enable\s+row\s+level/i, 'سياسات RLS');
  add(/cron\.schedule/i, 'المهام المجدولة');
  add(/^\s*insert\s+into\s+brc\./im, 'إدخال بيانات');
  add(/truncate/i, 'تفريغ الجداول');
  add(/^\s*begin\s*;/im, 'بداية معاملة');
  add(/^\s*commit\s*;/im, 'إغلاق معاملة');
  add(/setval/i, 'ضبط التسلسلات');
  add(/^do\s+\$/im, 'كتل تنفيذية (DO)');
  return notes.length ? notes.join(' · ') : 'أوامر متفرّقة';
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ٤) التنفيذ
 * ═══════════════════════════════════════════════════════════════════════════ */
const stmts = splitStatements(src);
const txMarks = markTransactions(stmts);
const chunks = planChunks(stmts, Math.max(50, LIMIT_LINES - HEADER_RESERVE_LINES));
const bodies = closeTransactions(chunks, txMarks);
const txCount = txMarks.filter((m) => m === 'begin').length;
const wrapped = bodies.filter((b) => /^\s*BEGIN;/m.test(b)).length;

if (!QUIET) {
  const totalLines = (src.match(/\n/g) || []).length + 1;
  console.log('════════════════════════════════════════════════════════════');
  console.log('  تقسيم ' + basename(file));
  console.log('════════════════════════════════════════════════════════════');
  console.log('  أسطر الملف      : ' + totalLines);
  console.log('  حجم الملف       : ' + (Buffer.byteLength(src, 'utf8') / 1024).toFixed(0) + ' ك.ب');
  console.log('  جمل SQL         : ' + stmts.length);
  console.log('  سقف الجزء       : ' + LIMIT_LINES + ' سطراً / ' + (LIMIT_BYTES / 1024).toFixed(0) + ' ك.ب');
  console.log('  الأجزاء الناتجة : ' + chunks.length);
  if (txCount) console.log('  معاملات الأصل   : ' + txCount + ' — وُزّعت كمعاملات مغلقة لكل جزء');
  console.log('════════════════════════════════════════════════════════════\n');
}

mkdirSync(OUT_DIR, { recursive: true });

const stem = basename(file).replace(/\.sql$/i, '');
const manifest = [];
let partNo = 0;

for (let ci = 0; ci < bodies.length; ci++) {
  partNo++;
  const no = String(partNo).padStart(2, '0');
  const body = bodies[ci];
  const bodyLines = (body.match(/\n/g) || []).length;
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  const desc = describeChunk(body);

  const header =
    '-- ═══════════════════════════════════════════════════════════════════════\n' +
    '--  ' + stem + ' — الجزء ' + no + ' من ' + String(bodies.length).padStart(2, '0') + '\n' +
    '--  يفعّل: ' + desc + '\n' +
    '--  أسطر: ' + bodyLines + ' · حجم: ' + (bodyBytes / 1024).toFixed(0) + ' ك.ب\n' +
    '--  ---------------------------------------------------------------------\n' +
    (partNo > 1
      ? '--  ⚠ لا تلصق هذا الجزء قبل تنفيذ الجزء ' + String(partNo - 1).padStart(2, '0') + ' بنجاح.\n'
      : '--  ابدأ من هنا. هذا أول جزء.\n') +
    (partNo < bodies.length
      ? '--  بعد «Success» انتقل إلى الجزء ' + String(partNo + 1).padStart(2, '0') + '.\n'
      : '--  هذا آخر جزء. بعد «Success» تحقّق من الأعداد في INDEX.md.\n') +
    '-- ═══════════════════════════════════════════════════════════════════════\n\n';

  const name = stem + '-part-' + no + '.sql';
  writeFileSync(join(OUT_DIR, name), header + body, 'utf8');
  manifest.push({ no, name, lines: bodyLines, kb: (bodyBytes / 1024).toFixed(0), desc });

  if (!QUIET) {
    console.log(
      '  ✅ ' + name.padEnd(28) +
      String(bodyLines).padStart(5) + ' سطراً  ' +
      String((bodyBytes / 1024).toFixed(0)).padStart(4) + ' ك.ب   ' + desc
    );
  }
}

/* ═══ خريطة اللصق — أهم مخرَج، لأنها تمنع الخطأ في الترتيب ═══════════════ */
const isData = /truncate/i.test(src) || /^\s*insert\s+into\s+brc\./im.test(src);
const index = [
  '# خريطة اللصق — ' + basename(file),
  '',
  '> أُنشئت بـ`node tools/split-sql.mjs` بتاريخ ' + new Date().toISOString().slice(0, 10) + '.',
  '',
  '## كيف تستخدمها',
  '',
  '1. افتح **Supabase → SQL Editor → New query**.',
  '2. الصق محتوى الجزء **01** كاملاً ← **Run** ← انتظر `Success`.',
  '3. **New query** جديد (لا تكتب فوق السابق) ← الصق **02** ← Run.',
  '4. وهكذا بالترتيب. **لا تقفز ولا تعكس.**',
  '',
  '> ⚠️ إن ظهر خطأ في جزء، **توقّف**. لا تلصق الذي بعده. أرسل نص الخطأ.',
  '',
  '## الأجزاء',
  '',
  '| # | الملف | أسطر | حجم | يفعّل |',
  '|---|---|---|---|---|'
];
for (const m of manifest) {
  index.push('| ' + m.no + ' | `' + m.name + '` | ' + m.lines + ' | ' + m.kb + ' ك.ب | ' + m.desc + ' |');
}
index.push('');
if (isData) {
  index.push('## ⚠️ خصائص هذا الملف (بيانات)');
  index.push('');
  index.push('- أول جزء فيه `TRUNCATE` — **يُفرّغ الجداول**. لا تشغّله على قاعدة فيها بيانات حقيقية.');
  index.push('- **كل جزء معاملة مستقلّة مغلقة** (`BEGIN` … `COMMIT`). الأداة أضافت هذه الأغلفة، لأن المعاملة في الأصل كانت تعبر الملف كله، **والمعاملة لا تعبر بين لصقتين**.');
  index.push('  - النتيجة: لو فشل الجزء ٧، تبقى الأجزاء ١–٦ **مثبّتة**، وتُكمل من ٧ بعد إصلاح السبب. هذا أفضل من إلغاء كل شيء.');
  index.push('  - البيانات النهائية **متطابقة تماماً** مع الأصل — التقسيم لا يغيّر صفاً واحداً.');
  index.push('- الترتيب يحترم المفاتيح الأجنبية: `staff` ← `applicants` ← `jobs` ← `job_attempts` ← الباقي.');
  index.push('- **تحقّق بعد كل جزء**: يجوز لك أن تتوقّف في أي جزء وتفحص الأعداد، ثم تُكمل.');
} else {
  index.push('## ⚠️ خصائص هذا الملف (هيكل)');
  index.push('');
  index.push('- الأجزاء مترابطة: الجداول قبل الدوال، والدوال قبل المشغّلات.');
  index.push('- `pgcrypto` و`pg_cron` يجب أن تكونا مفعّلتين **قبل الجزء 01**.');
  index.push('- في نهاية الملف الأصلي: `select brc.archive_finished_cards();` — قد يستغرق وقتاً. إن انتهت المهلة، شغّله وحده في استعلام منفصل.');
}
index.push('');
index.push('## تحقّق بعد الانتهاء');
index.push('');
index.push('```sql');
index.push('select');
index.push("  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace");
index.push("   where n.nspname='brc') as دوال,");
index.push('  (select count(*) from cron.job) as مهام_مجدولة,');
index.push("  (select count(*) from brc.settings) as إعدادات;");
index.push('```');
index.push('');
index.push('المتوقع: **دوال ≥ ٤٨** · **مهام = ٤** · **إعدادات = ٢**.');
index.push('');
index.push('> لو `المهام = 0` ← `pg_cron` غير مفعّلة. لو `الدوال = 0` ← الأجزاء لم تُنفَّذ.');
index.push('');

writeFileSync(join(OUT_DIR, 'INDEX-' + stem + '.md'), index.join('\n'), 'utf8');

if (!QUIET) {
  console.log('\n  📄 خريطة اللصق: ' + join(OUT_DIR, 'INDEX-' + stem + '.md'));
  console.log('\n  الخطوة التالية: افتح الخريطة واتبع الترتيب.');
}
