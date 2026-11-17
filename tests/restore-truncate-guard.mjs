/* ═══════════════════════════════════════════════════════════════════════════
   الإثبات الحاسم: هل تُرسَل TRUNCATE قبل التأكيد أم لا؟

   الفحص النصّي يقول «السطر موجود». وهذا يسأل سؤالاً آخر: **هل يُنفَّذ؟**

   الطريقة: نُقحم وحدة `pg` وهمية في مسار البحث (NODE_PATH). الأداة الحقيقية
   تستوردها كما تستورد الحقيقية — **بلا تعديل سطر واحد في شيفرة الإنتاج**.
   والوحدة الوهمية تسجّل كل استعلام يُطلب منها تنفيذه في ملف.

   فإن ظهر `TRUNCATE` في السجل قبل التأكيد، فالحارس كاذب. وإن لم يظهر،
   فهو حارس حقيقي — وليس مجرّد سطر تعليق.
   ═══════════════════════════════════════════════════════════════════════════ */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

let ok = 0, bad = 0;
const check = (label, cond, extra) => {
  cond ? ok++ : bad++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}` + (cond ? '' : ' — ' + (extra || '')));
};

/* ── نسخة حقيقية ─────────────────────────────────────────────────────── */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
globalThis.window = globalThis;
new Function(readFileSync('assets/js/portable-backup.js', 'utf8'))();
const PB = globalThis.HRCPortableBackup;

const dir = mkdtempSync(join(tmpdir(), 'hrc-guard-'));
const bak = join(dir, 'b.hrcbak');
const PW = 'رمز-الحارس-الطويل-٢٠٢٦';
writeFileSync(bak, JSON.stringify(await PB.seal({
  format: 3, exportedAt: '2026-11-16', schema: 'sha256:x',
  counts: { applicants: 2, jobs: 1 },
  jobs: [{ code: 'J1', title: 'و', employer_name: 'ش', employer_phone: '0', requirements: ['ش'] }],
  applicants: [1, 2].map(i => ({
    id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    serial: 'HRC-BC-00000' + i, full_name: 'اسم ' + i, phone: '0770' + i,
    status: 'active', attempt_limit: 3, fee_amount: 5000, expiry_date: '2026-12-31'
  }))
}, PW)), 'utf8');
delete globalThis.window;

/* ── وحدة pg وهمية ─────────────────────────────────────────────────────
   ⚠ `NODE_PATH` لا يؤثر على `import` في ESM — جرّبناه وفشل (اختُبرت الحقيقية).
   فالسبيل الموثوق: نستبدل `node_modules/pg` مؤقتاً بوحدة وهمية تطيع نفس
   الواجهة، ونعيد الحقيقية في النهاية (حتى لو خرج الفحص بخطأ).
   الأداة لا تعرف الفرق: تستورد `pg` فتجد عميلاً يسجّل كل استعلام. */
const { mkdirSync, renameSync, existsSync: ex } = await import('node:fs');
const LIVE = join(process.cwd(), 'node_modules', 'pg');
const STASH = join(process.cwd(), 'node_modules', '.pg-real-stashed');
const hadReal = ex(LIVE);
if (hadReal) renameSync(LIVE, STASH);

mkdirSync(LIVE, { recursive: true });
writeFileSync(join(LIVE, 'package.json'),
  JSON.stringify({ name: 'pg', version: '0.0.0-fake', main: 'index.js' }));
writeFileSync(join(LIVE, 'index.js'), `
import { writeFileSync, existsSync } from 'node:fs';
const LOG = process.env.FAKE_PG_LOG;
const COUNTS = JSON.parse(process.env.FAKE_PG_COUNTS || '{}');
const AFTER = JSON.parse(process.env.FAKE_PG_AFTER || 'null');
let executed = false;
class Client {
  constructor(cfg) { this.cfg = cfg; }
  async connect() {}
  async query(sql) {
    /* سجل واحد لكل استعلام بمعرّف متزايد — لا يعتمد على الساعة (قد يتصادم) */
    const n = (globalThis.__q = (globalThis.__q || 0) + 1);
    writeFileSync(LOG + '.' + String(n).padStart(4, '0') + '.sql', String(sql));
    const m = /count\\(\\*\\).*?brc\\.(\\w+)/is.exec(sql);
    if (m) return { rows: [{ n: COUNTS[m[1]] != null ? COUNTS[m[1]] : 0 }] };
    return { rows: [] };
  }
  async end() {}
}
export default { Client };
export { Client };
`);

const restorePg = () => {
  try { rmSync(LIVE, { recursive: true, force: true }); } catch {}
  try { if (hadReal) renameSync(STASH, LIVE); } catch {}
};
process.on('exit', restorePg);
process.on('SIGINT', () => { restorePg(); process.exit(130); });

const FULL = JSON.stringify({ applicants: 724, jobs: 22, job_attempts: 1533, audit_log: 3775 });
const EMPTY = JSON.stringify({ applicants: 0, jobs: 0, job_attempts: 0, audit_log: 0 });

let seq = 0;
function runTool(extraArgs, opts = {}) {
  const logBase = join(dir, 'q' + (++seq));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      'tools/restore-portable.mjs', bak, '--database', 'postgres://u:p@h:5432/d',
      ...extraArgs
    ], {
      env: {
        ...process.env,
        HRC_BACKUP_PASSWORD: PW,
        FAKE_PG_LOG: logBase,
        FAKE_PG_COUNTS: opts.counts || FULL,
        FAKE_PG_AFTER: opts.afterCounts ? JSON.stringify(opts.afterCounts) : '',
        ...(opts.env || {})
      }
    });
    let out = '';
    child.stdout.on('data', d => { out += d; if (opts.onOut) opts.onOut(String(d), child); });
    child.stderr.on('data', d => { out += d; if (opts.onOut) opts.onOut(String(d), child); });
    child.on('close', code => {
      /* نجمع كل الاستعلامات المسجّلة */
      resolve({ code, out, queries: collect(logBase) });
    });
    if (opts.answer !== undefined) {
      const t = setInterval(() => {
        if (/اكتب «/.test(out)) {
          clearInterval(t);
          try { child.stdin.write(opts.answer + '\n'); } catch {}
          /* ⚠ كان هذا سبب تعليق الفحص دقيقتين: بعد الكتابة يبقى stdin مفتوحاً
             فتنتظر العملية إدخالاً آخر عند نهاية `readline`. نُغلقه فوراً
             بعد الإجابة. (ومهلة قصوى كشبكة أمان إن لم يظهر السؤال). */
          setTimeout(() => { try { child.stdin.end(); } catch {} }, 150);
        }
      }, 50);
      setTimeout(() => { clearInterval(t); try { child.stdin.end(); } catch {} }, 6000);
    } else {
      try { child.stdin.end(); } catch {}
    }
  });
}

const { readdirSync } = await import('node:fs');
function collect(base) {
  const d = base.slice(0, base.lastIndexOf('/'));
  const name = base.slice(base.lastIndexOf('/') + 1) + '.';
  try {
    return readdirSync(d)
      .filter(f => f.startsWith(name) && f.endsWith('.sql'))
      .sort()
      .map(f => readFileSync(join(d, f), 'utf8'));
  } catch { return []; }
}
const hasTruncate = (qs) => qs.some(s => /TRUNCATE/i.test(s));

console.log('\n═══ ١) قاعدة ممتلئة + Enter (إلغاء) → لا TRUNCATE ═══');
{
  const r = await runTool([], { answer: '' });
  check('رفضت المتابعة', r.code !== 0, 'exit ' + r.code);
  check('🔒 لم تُرسَل TRUNCATE', !hasTruncate(r.queries),
    'أُرسل: ' + r.queries.filter(s => /TRUNCATE/i.test(s)).join(' | ').slice(0, 80));
  check('عرضت الأعداد قبل السؤال', /724|1,533|3,775/.test(r.out), r.out.slice(-140));
  check('الإلغاء صريح', /أُلغي|لم يُمسح/.test(r.out), r.out.slice(-100));
}

console.log('\n═══ ٢) كلمة «نعم» لا تكفي ═══');
{
  const r = await runTool([], { answer: 'نعم' });
  check('رفضت', r.code !== 0);
  check('🔒 لم تُرسَل TRUNCATE', !hasTruncate(r.queries));
}

console.log('\n═══ ٣) العبارة الصحيحة → TRUNCATE يُرسل ═══');
{
  /* ⚠ بعد التنفيذ تقرأ الأداة الأعداد من القاعدة وتقارنها بالنسخة (تحقّق
     ذكي أضفناه سابقاً). والنسخة فيها ٢ بطاقة و١ وظيفة. فلو أعدنا ٧٢٤ لَفشل
     التحقّق — وهذا سلوك **صحيح**. لذا نُعيد الأعداد المطابقة بعد التنفيذ. */
  const r = await runTool([], { answer: 'أوافق على المسح',
    counts: JSON.stringify({ applicants: 2, jobs: 1, job_attempts: 0, audit_log: 0 }) });
  check('واصل وأكمل التحقّق', r.code === 0, 'exit ' + r.code + ' :: ' + r.out.slice(-120));
  check('أُرسل TRUNCATE بعد التأكيد', hasTruncate(r.queries),
    'لم يُرسل — لم ينفّذ شيئاً');
}

console.log('\n═══ ٤) قاعدة فارغة → لا سؤال ═══');
{
  /* ⚠ حدّ هذا الفحص، بصراحة: نتحقّق أن الأداة **لا تسأل** حين لا شيء يُمسح.
     ولا نتحقّق من نجاح التنفيذ الكامل هنا، لأن العميل الوهمي لا يحفظ الحالة
     (فيعيد أصفاراً بعد التنفيذ فيفشل تحقّق الأعداد). نجاح التنفيذ الكامل
     مُغطّى حيث يجب: tests/direct-restore-cli.mjs على قاعدة PostgreSQL حقيقية.
     نكتفي بما يخصّ هذا الفحص: لا سؤال حين لا خطر. */
  const r = await runTool([], { counts: EMPTY });
  check('لم تسأل (لا شيء يُمسح)', !/اكتب «/.test(r.out), r.out.slice(-160));
  check('أخبرت أن القاعدة فارغة', /فارغة|لن يُفقد شيء/.test(r.out), r.out.slice(-160));
  /* ⚠ هنا TRUNCATE **يُرسل** بلا سؤال — وهذا صحيح ومقصود: القاعدة فارغة،
     فلا شيء يُفقد. السؤال بلا خطر إزعاجٌ لا حماية. توقّعي كان خاطئاً.
     المهم أن يُنفَّذ بعد أن أخبر المستخدم أن القاعدة فارغة. */
  check('نفّذت بلا سؤال (لا خطر)', hasTruncate(r.queries),
    'لم تنفّذ — القاعدة فارغة ولا شيء يمنع');
}

console.log('\n═══ ٥) --dry-run على قاعدة ممتلئة → لا تعديل ═══');
{
  const r = await runTool(['--dry-run']);
  check('🔒 لم تُرسَل TRUNCATE', !hasTruncate(r.queries));
  check('قالت إنها معاينة', /معاينة/.test(r.out), r.out.slice(-120));
  check('لم تطلب تأكيداً', !/اكتب «/.test(r.out));
  check('عرضت ما سيُنقل', /سيُنقل|البطاقات/.test(r.out));
}

console.log('\n' + '─'.repeat(62));
console.log(bad === 0
  ? `✅ ${ok} فحصاً — لا TRUNCATE بلا تأكيد، مُثبت بالاستعلامات الفعلية`
  : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
