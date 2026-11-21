/* ═══════════════════════════════════════════════════════════════════════════
 *  HRC — استرجاع النسخة الاحتياطية من داخل Supabase نفسه (Edge Function)
 *  ---------------------------------------------------------------------------
 *  لماذا هذه الدالة موجودة؟
 *  كان الاسترجاع يحتاج حاسوباً فيه Node أو psql وكلمة مرور القاعدة. والدالة
 *  هذه تلغي الثلاثة معاً: تُنشَر داخل المشروع، فتصل إلى قاعدته بمتغيّر
 *  SUPABASE_DB_URL الذي يضخّه Supabase في بيئة كل دالة تلقائياً — بلا كلمة
 *  مرور ولا طرفية ولا تثبيت شيء.
 *
 *  الطريق كاملاً من المتصفّح:
 *    ١) أنشئ مشروع Supabase جديداً (فارغاً) واحفظ كلمة مروره.
 *    ٢) Storage → New bucket بالاسم restore-tmp (خاص/private) → ارفع ملف
 *       HRC-FULL-<التاريخ>.sql المنزَّل من صفحة النسخ الاحتياطي.
 *    ٣) Edge Functions → Deploy a new function → بالاسم hrc-restore →
 *       الصق هذا الملف → Deploy.
 *    ٤) Secrets → أضف سرّاً باسم RESTORE_TOKEN بقيمة تختارها أنت (٢٠ حرفاً+).
 *    ٥) افتح في المتصفّح:
 *         https://<REF>.supabase.co/functions/v1/hrc-restore?key=<RESTORE_TOKEN>&dry=1
 *       هذه «تجربة جافّة»: تقرأ الملف وتُعدّ العبارات وتُرِي الأعداد الحالية،
 *       ولا تكتب حرفاً واحداً.
 *    ٦) ثم بلا dry:
 *         https://<REF>.supabase.co/functions/v1/hrc-restore?key=<RESTORE_TOKEN>&confirm=RESTORE
 *       جوابها JSON فيه verdict وعدّ كل جدول مقابل ترويسة الملف.
 *
 *  ⚠️ الحمايات — كلها داخل الكود لا في إعدادات يمكن نسيانها:
 *    ١) RESTORE_TOKEN إلزامي: بلا ضبطه في أسرار الدالة ترفض العمل (500).
 *       فلو نُشرت هذه الدالة على مشروع الإنتاج بالخطأ فهي خامدة هناك.
 *    ٢) حاجز المشروع: إن كان SUPABASE_URL أو الـDSN يشير إلى مشروع الإنتاج
 *       (vqsvztudvfukyuerzcgx) ترفض وتُرجع 403 — دائماً، بلا استثناء.
 *    ٣) حاجز «القاعدة غير فارغة»: إن كانت brc.applicants فيها صفوف ترفض
 *       المتابعة إلا بتمرير force=YES صراحةً. فإعادة فتح الرابط بالخطأ
 *       لا تمحو قاعدة تعمل.
 *    ٤) حاجز الملف: ترفض أي ملف لا يبدو ملف استرجاع HRC، وترفض النسخ
 *       القديمة التي تستعمل TRIGGER ALL (تفشل على Supabase بلا superuser).
 *    ٥) لا تُطبع كلمة المرور ولا الـDSN في أي سطر — الرسائل عربية ومقنّعة.
 *
 *  التشغيل:
 *    • من اللوحة: Edge Functions → Deploy a new function → الاسم hrc-restore
 *      → الصق الملف → Deploy (أطفئ «Verify JWT» — الحماية بالرمز لا بالجلسة).
 *    • أو من الطرفية:  supabase functions deploy hrc-restore --no-verify-jwt
 *  الدليل الكامل خطوة خطوة: docs/rescue/RESTORE-VIA-EDGE-FUNCTION-AR.md
 *
 *  ⚠️ ما لم يُختبر: التشغيل داخل بيئة Deno الحقيقية على مشروع Supabase حقيقي
 *     (لا شبكة لهذا الصندوق إلى *.supabase.co). المُختبَر محلياً بالكامل:
 *     منطق التقسيم والتنفيذ والتحقّق على PostgreSQL 17 (PGlite) بنفس كود
 *     العبارات — tests/restore-edge-function.mjs. انظر قسم «ما لم يُختبر».
 * ═══════════════════════════════════════════════════════════════════════════ */

const PRODUCTION_REF = 'vqsvztudvfukyuerzcgx';
const DEFAULT_BUCKET = 'restore-tmp';
const MAX_BYTES = 64 * 1024 * 1024;
/* حدّ دالة Edge على الخطة المجانية ١٥٠ ثانية. نُبقي هامشاً للتنظيف والرد. */
const DEADLINE_MS = 120_000;

/* الجداول التي تكتب أعدادها ترويسة الملف — نقارنها كلها بعد التنفيذ */
const TABLES = [
  'staff', 'applicants', 'jobs', 'job_attempts', 'issued_serials',
  'card_number_registry', 'audit_log', 'settings', 'recovery_chances',
  'recovery_prints', 'office_receipts',
];

/* ── أنواع خفيفة (الحقن في الاختبارات يجعل نفس الملف قابلاً للتشغيل في Node) ── */
type Env = (k: string) => string | null;

interface Driver {
  run(sql: string): Promise<void>;
  runWith(sql: string, params: unknown[]): Promise<void>;
  query(sql: string): Promise<Record<string, unknown>[]>;
  end(): Promise<void>;
}

export interface Deps {
  env?: Env;
  fetchImpl?: typeof fetch;
  connect?: (dsn: string) => Promise<Driver>;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  ١) تقسيم الملف إلى عبارات
 *  ---------------------------------------------------------------------------
 *  السبب: بروتوكول الاستعلام البسيط يقبل ملفاً كاملاً، لكن السائق الذي نستعمله
 *  (postgres.js) أرسل كل عبارة وحدها. والتقسيم يجب أن يحترم:
 *    • النصوص بين '…' و"…" (وفيها قد يكون ';')
 *    • تعليقات السطر -- وتعليقات الكتلة /* … *\/
 *    • كتل $$ … $$ و$tag$ … $tag$ (وفيها أجسام الدوال ومئات الفواصل المنقوطة)
 *  أي تقطيع أعمى عند كل ';' يهدم أجسام الدوال ويُفشل الاسترجاع كله.
 *  الاختبار يقارن مخرج هذه النسخة بمخرج tools/sql-split-core.mjs حرفاً بحرف.
 * ═══════════════════════════════════════════════════════════════════════════ */
/* @inline:begin splitStatements */
function splitStatements(text) {
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
  /* ما بقي بعد آخر فاصلة منقوطة — لا نُدخل ذيلاً فارغاً */
  const rest = text.slice(start);
  if (rest.trim()) stmts.push(rest);
  return stmts;
}
/* @inline:end splitStatements */

/* ═══════════════════════════════════════════════════════════════════════════
 *  ٢) أعداد الترويسة — الملف يشهد عن محتواه
 *  ---------------------------------------------------------------------------
 *  المولّد يكتب في أعلى الملف:  --  الأعداد : 3 staff · 726 applicants · …
 *  فنقرأها من الملف بدل تثبيت أرقام نسخة قديمة (فتغدو النسخة الأحدث «فشلاً»).
 *  نسخة مطابقة لـtools/dump-header.mjs — والاختبار يقارن الاثنين.
 * ═══════════════════════════════════════════════════════════════════════════ */
/* @inline:begin headerCounts */
function headerCounts(text) {
  const out = {};
  const line = /^--\s*الأعداد\s*:\s*(.+)$/m.exec(text);
  if (line) {
    for (const part of line[1].split('·')) {
      const m = /^\s*(\d+)\s+([a-z_]+)\s*$/.exec(part);
      if (m) out[m[2]] = Number(m[1]);
    }
  }
  const counter = /^--\s*عدّاد البطاقات\s*:\s*(\d+)/m.exec(text);
  if (counter) out.counter = Number(counter[1]);
  return Object.keys(out).length ? out : null;
}
/* @inline:end headerCounts */

/* ── أدوات مساعدة عامة ─────────────────────────────────────────────────── */

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/* مقارنة بزمن ثابت تقريباً — لا تكشف طول الرمز الصحيح ولا موضع أول حرف مختلف */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', buf));
}

/* العبارة قد تسبقها تعليقات وسطور فارغة — لا تُرسَل للقاعدة، تُعدّ فقط */
function isCommentOnly(s: string): boolean {
  return s.split('\n').every((l) => {
    const t = l.trim();
    return t === '' || t.startsWith('--');
  });
}

/* ── ٣) تنزيل الملف من Storage ────────────────────────────────────────── */

interface Stored {
  name: string;
  bytes: Uint8Array;
}

async function downloadDump(
  f: typeof fetch,
  base: string,
  serviceKey: string,
  bucket: string,
  wanted: string | null,
): Promise<Stored> {
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

  /* بلا اسم ملف: نكتشف الملف الوحيد داخل الوعاء. أقل عرضة لخطأ إملائي. */
  let file = wanted;
  if (!file) {
    const res = await f(`${base}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) {
      throw new Error(
        `تعذّر قراءة الوعاء «${bucket}» (HTTP ${res.status}). ` +
        'تأكّد من إنشائه في Storage بهذا الاسم بالضبط، ومن رفع الملف داخله لا في مجلّد فرعي.',
      );
    }
    const list = await res.json() as { name: string }[];
    const sqlFiles = (list || []).filter((o) => /\.sql$/i.test(o.name || ''));
    if (sqlFiles.length === 0) {
      throw new Error(`الوعاء «${bucket}» لا يحوي أي ملف .sql — ارفع ملف HRC-FULL-<التاريخ>.sql داخله.`);
    }
    if (sqlFiles.length > 1) {
      throw new Error(
        `الوعاء «${bucket}» يحوي ${sqlFiles.length} ملفات .sql: ` +
        sqlFiles.map((o) => o.name).join(' · ') +
        ' — حدّد الأحدث بتمرير &file=<الاسم>.',
      );
    }
    file = sqlFiles[0].name;
  }

  const res = await f(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${file.split('/').map(encodeURIComponent).join('/')}`, { headers });
  if (!res.ok) {
    throw new Error(`تعذّر تنزيل «${file}» من الوعاء «${bucket}» (HTTP ${res.status}). تحقّق من الاسم حرفياً.`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`الملف ${(buf.byteLength / 1048576).toFixed(1)} م.ب وأكبر من الحدّ المسموح — رُفض.`);
  }
  return { name: file, bytes: buf };
}

/* ── ٤) السائق: postgres.js فوق SUPABASE_DB_URL ────────────────────────── */

async function connectPostgres(dsn: string): Promise<Driver> {
  const { default: postgres } = await import('npm:postgres@3.4.5');
  const opts: Record<string, unknown> = {
    max: 1,               // اتصال واحد: كل العبارات على نفس الجلسة (BEGIN…COMMIT يعمل)
    prepare: false,       // Supavisor (الـpooler) في وضع transaction لا يقبل العبارات المُعدّة
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},   // RAISE NOTICE من الملف ليست أخطاء
  };
  if (!/sslmode=/.test(dsn)) opts.ssl = 'require';
  const sql = postgres(dsn, opts);
  return {
    async run(stmt: string) { await sql.unsafe(stmt); },
    async runWith(stmt: string, params: unknown[]) { await sql.unsafe(stmt, params as never[]); },
    async query(stmt: string) { return await sql.unsafe(stmt) as unknown as Record<string, unknown>[]; },
    async end() { try { await sql.end({ timeout: 5 }); } catch { /* لا شيء */ } },
  };
}

/* ── ٥) قراءة أعداد القاعدة الحالية (تُستعمل قبل وبعد) ─────────────────── */

interface Counts { tables: Record<string, number | null>; counter: number | null; disabledTriggers: number | null; secret: 'set' | 'missing' | 'unknown' }

async function readCounts(d: Driver): Promise<Counts> {
  const tables: Record<string, number | null> = {};
  for (const t of TABLES) {
    try {
      const rows = await d.query(`select count(*)::int as n from brc.${t}`);
      tables[t] = Number(rows[0]?.n ?? NaN);
    } catch { tables[t] = null; }   // الجدول غير موجود (استرجاع لم يكتمل) ⇒ null لا انفجار
  }
  let counter: number | null = null;
  try {
    const rows = await d.query('select last_number::int as n from brc.card_number_counter');
    counter = Number(rows[0]?.n ?? NaN);
  } catch { counter = null; }

  let disabledTriggers: number | null = null;
  try {
    const rows = await d.query(`
      select count(*)::int as n
        from pg_trigger g
        join pg_class c on c.oid = g.tgrelid
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'brc' and not g.tgisinternal and g.tgenabled <> 'O'`);
    disabledTriggers = Number(rows[0]?.n ?? NaN);
  } catch { disabledTriggers = null; }

  let secret: 'set' | 'missing' | 'unknown' = 'unknown';
  try {
    const rows = await d.query("select count(*)::int as n from brc.app_secrets where name = 'brc_secret'");
    secret = Number(rows[0]?.n ?? 0) > 0 ? 'set' : 'missing';
  } catch { secret = 'unknown'; }

  return { tables, counter, disabledTriggers, secret };
}

/* ── ٦) المعالج نفسه ──────────────────────────────────────────────────── */

interface Ctx {
  env: Env;
  f: typeof fetch;
  connect: (dsn: string) => Promise<Driver>;
}

function fail(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, verdict: 'FAIL', message, ...extra }, status);
}

export async function handle(req: Request, deps: Deps = {}): Promise<Response> {
  const t0 = Date.now();
  if (req.method.toUpperCase() === 'OPTIONS') return new Response('ok', { headers: cors() });

  const env: Env = deps.env ?? ((k) => {
    const d = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
    return d?.env?.get ? (d.env.get(k) ?? null) : null;
  });
  const f = deps.fetchImpl ?? fetch;
  const ctx: Ctx = { env, f, connect: deps.connect ?? connectPostgres };

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method.toUpperCase() === 'POST') {
    try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }
  }
  const qp = (k: string) => url.searchParams.get(k);
  const pick = (k: string) => (body[k] !== undefined && body[k] !== null && body[k] !== '' ? String(body[k]) : (qp(k) ?? ''));
  const flag = (k: string) => {
    const v = pick(k).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'نعم';
  };

  /* ١) الرمز — إلزامي: بلا ضبطه في الأسرار ترفض الدالة العمل */
  const token = pick('key') || pick('token');
  const expectToken = (env('RESTORE_TOKEN') || '').trim();
  if (!expectToken) {
    return fail(500, 'الدالة معطّلة عن قصد: السرّ RESTORE_TOKEN غير مضبوط في أسرار هذه الدالة. أضفه من Edge Functions → Secrets ثم أعد المحاولة.');
  }
  if (!safeEqual(token.trim(), expectToken)) {
    return fail(401, 'مفتاح التشغيل (?key=) غير صحيح أو غائب.');
  }

  /* ٢) حاجز الإنتاج — ما يُلمس مشروع الإنتاج أبداً */
  const base = (env('SUPABASE_URL') || '').replace(/\/+$/, '');
  const dsn = env('SUPABASE_DB_URL') || '';
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (base.includes(PRODUCTION_REF) || dsn.includes(PRODUCTION_REF)) {
    return fail(403, `هذه الدالة ترفض العمل على مشروع الإنتاج (${PRODUCTION_REF}) — دائماً وبلا استثناء.`);
  }
  if (!base || !serviceKey) {
    return fail(500, 'بيئة الدالة ناقصة (SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY). أعد نشر الدالة من جديد.');
  }
  if (!dsn) {
    return fail(500, 'متغيّر SUPABASE_DB_URL غير متوفّر في بيئة الدالة — لا سبيل للوصول إلى القاعدة. أعد نشرها.');
  }

  const dry = flag('dry');
  const bucket = pick('bucket') || DEFAULT_BUCKET;
  const wanted = pick('file') || null;

  /* ٣) الملف: تنزيل + بصمة + فحوص شكلية */
  let stored: Stored;
  let text: string;
  let sha: string;
  try {
    stored = await downloadDump(f, base, serviceKey, bucket, wanted);
    sha = await sha256Hex(stored.bytes.buffer.slice(stored.bytes.byteOffset, stored.bytes.byteOffset + stored.bytes.byteLength) as ArrayBuffer);
    text = new TextDecoder('utf-8', { fatal: false }).decode(stored.bytes);
  } catch (e) {
    return fail(400, (e as Error).message, { bucket });
  }

  if (!/brc\.staff/i.test(text) || !/create table if not exists brc\./i.test(text)) {
    return fail(400, 'هذا لا يبدو ملف استرجاع HRC (لا يحوي هيكل brc). ارفع ملف HRC-FULL-<التاريخ>.sql لا ملفاً آخر.', { file: stored.name });
  }
  if (/\b(DISABLE|ENABLE)\s+TRIGGER\s+ALL\b/i.test(text)) {
    return fail(400, 'الملف نسخة قديمة تستعمل TRIGGER ALL — تفشل على Supabase بلا superuser. نزّل نسخة جديدة من صفحة النسخ الاحتياطي (ما بعد 2026-11-20).', { file: stored.name });
  }

  const all = splitStatements(text);
  const stmts = all.filter((s) => !isCommentOnly(s));
  const expected = headerCounts(text);
  if (!expected) {
    return fail(400, 'ترويسة الملف لا تحمل سطر «--  الأعداد :» — بلا هذه الأعداد لا يمكن التحقّق من الاسترجاع. رُفض التنفيذ.', { file: stored.name });
  }

  const head = {
    file: stored.name,
    bytes: stored.bytes.byteLength,
    sha256: sha,
    statements: stmts.length,
  };

  let driver: Driver;
  try {
    driver = await ctx.connect(dsn);
  } catch (e) {
    return fail(500, `تعذّر الاتصال بقاعدة المشروع: ${(e as Error).message}`, head);
  }

  try {
    const before = await readCounts(driver);
    const nonEmpty = Number(before.tables.applicants ?? 0) > 0;

    /* ٤) تجربة جافّة: كل الفحوص ولا كتابة واحدة */
    if (dry) {
      return json({
        ok: true, mode: 'dry-run', verdict: 'READY', ...head,
        message: 'كل شيء جاهز: الرمز صحيح، الملف وصل، والقاعدة مقروءة. لم نكتب حرفاً واحداً.',
        willRun: { statements: stmts.length, expected, dryRunOnly: true },
        current: before,
        needsForce: nonEmpty,
        next: nonEmpty
          ? [
            'القاعدة تحوي بيانات بالفعل. إن أردت استبدالها فعلاً فأضف &force=YES إلى الرابط.',
            'وإن كانت نسخة سابقة من المخطط موجودة (استرجاع قديم) فأضف أيضاً &reset=YES ليمحو brc ويبنيه من الصفر.',
          ]
          : ['افتح الرابط نفسه بلا dry=1 وأضف &confirm=RESTORE لبدء الاسترجاع الحقيقي.'],
      });
    }

    /* ٥) بوّابتان قبل أي كتابة */
    if (pick('confirm').toUpperCase() !== 'RESTORE') {
      return fail(400, 'لم يبدأ شيء: التنفيذ يتطلّب &confirm=RESTORE صراحةً (حماية من فتح الرابط بالخطأ).', { ...head, current: before });
    }
    if (nonEmpty && pick('force').toUpperCase() !== 'YES') {
      return fail(409, 'القاعدة ليست فارغة — فيها ' + before.tables.applicants + ' متقدماً. الاسترجاع يبدأ بـTRUNCATE فيمحوها. إن كان هذا مقصوداً فأضف &force=YES.', { ...head, current: before });
    }

    /* إعادة البناء من الصفر: الملف يفترض قاعدة نظيفة. فإن كان المخطط موجوداً
       بشكل مختلف (نسخة أقدم، أو محاولة سابقة انقطعت) يفشل phase ١ بـ42P16
       «cannot drop columns from view» — وهذا يحدث على PostgreSQL الحقيقي أيضاً.
       فيُمرَّر reset=YES صراحةً (مع force=YES) لمحو مخطط brc وإعادة بنائه. */
    const reset = pick('reset').toUpperCase() === 'YES';
    if (reset && pick('force').toUpperCase() !== 'YES') {
      return fail(400, 'reset=YES يمحو مخطط brc كاملاً — لا يُقبل بلا &force=YES معه.', head);
    }
    if (reset) {
      try { await driver.run('drop schema if exists brc cascade'); }
      catch (e) { return fail(500, `تعذّر محو المخطط القديم: ${(e as Error).message}`, head); }
    }

    /* ٦) التنفيذ: عبارة عبارة، وسجل أوّل خطأ بموضعه */
    const deadline = t0 + DEADLINE_MS;
    let done = 0;
    try {
      for (let i = 0; i < stmts.length; i++) {
        if (Date.now() > deadline) {
          throw Object.assign(new Error('تجاوزنا مهلة الدالة. أعد المحاولة — الملف يبدأ بـTRUNCATE فالإعادة آمنة، أو استعمل طريق Google Colab للنسخ الكبيرة.'), { at: i, snippet: '' });
        }
        try {
          await driver.run(stmts[i]);
        } catch (e) {
          throw Object.assign(e as Error, { at: i, snippet: stmts[i].replace(/\s+/g, ' ').slice(0, 220) });
        }
        done++;
      }
    } catch (e) {
      try { await driver.run('ROLLBACK'); } catch { /* قد لا تكون هناك معاملة مفتوحة */ }
      const err = e as Error & { at?: number; snippet?: string; code?: string };
      const partial = await readCounts(driver).catch(() => null);
      /* 42P16/42P07/42710/42P06 = المخطط موجود بشكل مختلف ⇒ الحل reset=YES */
      const drift = ['42P16', '42P07', '42710', '42P06', '42704'].includes(String(err.code));
      const hint = drift
        ? 'السبب: مخطط brc موجود مسبقاً بشكل مختلف (نسخة أقدم أو محاولة سابقة). أعد الرابط نفسه مع &force=YES&reset=YES ليمحو المخطط ويبنيه من الصفر.'
        : 'لم تُكتب أي عبارة بعد تلك النقطة. أصلح السبب ثم أعد المحاولة؛ فإن كانت المحاولة السابقة قد كتبت جزءاً من المخطط فأضف &reset=YES (مع &force=YES).';
      return fail(500,
        `توقّف التنفيذ عند العبارة ${(err.at ?? 0) + 1} من ${stmts.length} بعد ${done} عبارة ناجحة.\n` +
        `${err.message}\n${hint}`,
        { ...head, failedAt: (err.at ?? 0) + 1, succeeded: done, snippet: err.snippet, pgCode: err.code ?? null, partial, seconds: (Date.now() - t0) / 1000, schemaDrift: drift },
      );
    }

    /* ٧) مفتاح البصمة (اختياري): يُمرَّر في جسم POST فقط، لا في الرابط */
    let secretState: string = 'missing';
    const bodySecret = String(body.brcSecret ?? '').trim();
    if (bodySecret) {
      if (!/^[A-Za-z0-9+/=_-]{16,200}$/.test(bodySecret)) {
        secretState = 'rejected-shape';
      } else {
        try {
          await driver.runWith(
            `insert into brc.app_secrets (name, value) values ($1, $2)
             on conflict (name) do update set value = excluded.value, updated_at = now()`,
            ['brc_secret', bodySecret],
          );
          secretState = 'set-now';
        } catch { secretState = 'write-failed'; }
      }
    }

    /* ٨) التحقّق: كل عدد مقابل ترويسة الملف */
    const after = await readCounts(driver);
    const checks: { name: string; expected: number | null; actual: number | null; ok: boolean }[] = [];
    for (const t of TABLES) {
      if (expected[t] === undefined) continue;
      const actual = after.tables[t] ?? null;
      checks.push({ name: t, expected: expected[t], actual, ok: actual === expected[t] });
    }
    if (expected.counter !== undefined) {
      checks.push({ name: 'counter', expected: expected.counter, actual: after.counter, ok: after.counter === expected.counter });
    }
    checks.push({ name: 'disabled_triggers', expected: 0, actual: after.disabledTriggers, ok: after.disabledTriggers === 0 });

    const passed = checks.every((c) => c.ok);
    let secretLen: number | null = null;
    try {
      const rows = await driver.query("select length(brc.verify_token('HRC-BC-000120'))::int as n");
      secretLen = Number(rows[0]?.n ?? NaN);
    } catch { secretLen = null; }
    const secretOk = secretLen === 64;

    const failedChecks = checks.filter((c) => !c.ok).map((c) => c.name);

    return json({
      ok: passed,
      mode: 'restore',
      verdict: passed ? 'PASS' : 'FAIL',
      ...head,
      seconds: Number(((Date.now() - t0) / 1000).toFixed(2)),
      executed: done,
      before,
      after,
      checks,
      failedChecks,
      appSecret: { state: secretState, verifyTokenLength: secretLen, ok: secretOk },
      warnings: passed ? [] : ['بعض الأعداد لا يطابق ترويسة الملف — لا تعتمد النسخة قبل معالجة ذلك.'],
      next: secretOk
        ? [
          'أضف brc إلى Exposed schemas (Project Settings → API).',
          'اضبط site_url وuri_allow_list في Authentication → URL Configuration.',
          'نفّذ config/recreate-cron.sql لإعادة مهام pg_cron الأربع.',
          'أنشئ الحسابات الثلاثة من Authentication واربطها بـbrc.staff.auth_id (config/accounts.json).',
          'احذف الدالة hrc-restore والوعاء restore-tmp بعد أن تُنهي — انتهى دورهما.',
        ]
        : [
          'مفتاح البصمة غير مضبوط: أعد التنفيذ بـPOST يحمل {"brcSecret":"…"}، أو نفّذ في محرّر SQL سطراً واحداً: insert into brc.app_secrets (name,value) values (\'brc_secret\',\'<القيمة>\');',
          'ثم أضف brc إلى Exposed schemas · اضبط site_url · نفّذ config/recreate-cron.sql · أنشئ الحسابات الثلاثة.',
        ],
    }, passed ? 200 : 500);
  } finally {
    await driver.end().catch(() => {});
  }
}

/* Deno يشغّل الدالة؛ وفي Node (لاختبارات المستودع) لا يوجد Deno فلا يُسجَّل أي خادم */
const maybeDeno = (globalThis as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => unknown } }).Deno;
if (maybeDeno?.serve) maybeDeno.serve((req: Request) => handle(req));
