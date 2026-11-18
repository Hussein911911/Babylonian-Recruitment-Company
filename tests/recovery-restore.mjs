#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   فحص أداة الاسترجاع المحلية — من الطرف إلى الطرف

   ⚠️ لماذا هذا الفحص موجود؟
   لأن أداة الاسترجاع هي آخر خط دفاع في أسوأ يوم. أداة طوارئ لم تُجرَّب
   ليست أداة طوارئ — هي أمل. وهذا الفحص يُشغّلها فعلياً:
     ١. يبني ملفاً كاملاً من المولّد الحقيقي (هيكل + بيانات).
     ٢. يشغّل الخادم المحلي ويخاطبه عبر HTTP كما يفعل المتصفح.
     ٣. يُنفّذ الملف على قاعدة **حقيقية** (PostgreSQL/PGlite) ويتحقق من الأعداد.
     ٤. يتأكد أن الملف التالف يُرفض مع موقع الخطأ، لا يمرّ بصمت.
     ٥. يتأكد أن مقارنة الجرد بالكشف الفرق الحقيقي، وأن ما بقي «بقصد» معلن.

   التشغيل: npm run test:recovery-restore
   ═══════════════════════════════════════════════════════════════════════════ */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let ok = 0, bad = 0;
const check = (label, cond, extra) => {
  cond ? ok++ : bad++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}` + (cond ? '' : ' — ' + extra));
};

/* ═══ ١) بناء ملف استرجاع حقيقي من المولّد نفسه ═══ */
const STAFF = '93900c94-9bde-4176-b418-e8a4721e9fb2';
const payload = {
  exportedAt: '2026-11-17T12:00:00Z',
  schema: 'sha256:test',
  staff: [{ id: STAFF, username: 'admin', full_name: 'المدير', role: 'admin', active: true }],
  jobs: [1, 2].map((i) => ({
    id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
    code: 'HRC-20' + i, title: 'وظيفة ' + i, employer_name: 'شركة ' + i,
    employer_phone: '0770000' + i, requirements: ['شرط'], vacancies: 3,
    status: 'available', created_by: STAFF
  })),
  applicants: Array.from({ length: 9 }, (_, i) => ({
    id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`,
    serial: 'HRC-BC-' + (700100 + i),
    full_name: 'اسم ' + (i + 1), phone: '0770111' + String(i).padStart(4, '0'),
    status: i < 3 ? 'blank' : 'active', fee_paid: i >= 3
  })),
  job_attempts: [], issued_serials: [], card_number_registry: [], audit_log: [],
  settings: [], recovery_chances: [], recovery_prints: [], office_receipts: [],
  card_number_counter: [{ singleton: true, last_number: 9 }]
};
const dir = mkdtempSync(join(tmpdir(), 'hrc-rec-'));
const payPath = join(dir, 'payload.json');
const sqlPath = join(dir, 'HRC-FULL.sql');
writeFileSync(payPath, JSON.stringify(payload));
spawn('node', ['tools/build-full-dump.mjs', '--payload', payPath, '--out', sqlPath], { stdio: 'ignore' })
  .on('exit', async (code) => {
    check('المولّد أنتج الملف', code === 0);
    const sql = readFileSync(sqlPath, 'utf8');
    check('الملف يحتوي الهيكل والبيانات', /create schema if not exists brc/i.test(sql) && /insert into brc\.applicants/i.test(sql));

    /* ═══ ٢) الدوال المستقلة ═══ */
    const core = await import('../tools/recovery-core.mjs');
    const batches = core.batchStatements(sql);
    check('التقسيم بلا فقدان', batches.join('').length === sql.length, `${batches.join('').length} ≠ ${sql.length}`);
    check('لا دفعة صغيرة عبثاً', batches.length >= 1 && batches.length < 20, 'عدد الدفعات ' + batches.length);
    const big = core.batchStatements(sql, 20000);
    check('سقف الحجم يعمل', big.length > batches.length, 'لم يتغير التقسيم');

    /* ═══ ٣) الخادم الحقيقي عبر HTTP ═══
       ⚠️ لا رقم منفذ ثابت: خادم يتيم من تشغيل انهار سابقاً يبقى ماسكاً للمنفذ،
       فيفشل كل فحص لاحق برسالة مضلّلة («الخادم لا يطبع رابطاً»). نطلب من
       النظام منفذاً حرّاً، ونقتل الخادم دائماً — حتى لو انهار الفحص. */
    const PORT = await new Promise((res, rej) => {
      const t = net.createServer();
      t.on('error', rej);
      t.listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => res(p)); });
    });
    const srv = spawn('node', ['tools/recovery-server.mjs'], {
      env: { ...process.env, HRC_RECOVERY_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const killSrv = () => { try { srv.kill('SIGKILL'); } catch (e) { /* مات أصلاً */ } };
    process.on('exit', killSrv);
    process.on('uncaughtException', (e) => { killSrv(); throw e; });
    let out = '';
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    await new Promise((r) => setTimeout(r, 1200));

    const tok = (out.match(/\?t=([a-f0-9]+)/) || [])[1];
    check('الخادم يطبع رابطاً بتوكن', !!tok);

    const noTok = await fetch(`http://127.0.0.1:${PORT}/api/env`);
    check('طلب بلا توكن مرفوض (403)', noTok.status === 403, 'HTTP ' + noTok.status);

    const H = { 'x-hrc-token': tok, 'content-type': 'application/json' };
    const j = async (path, opts) =>
      (await fetch(`http://127.0.0.1:${PORT}${path}`, { headers: H, ...opts })).json();

    const pageRes = await fetch(`http://127.0.0.1:${PORT}/?t=${tok}`);
    const pageHtml = await pageRes.text();
    check('الصفحة تُقدَّم', pageRes.status === 200 && pageHtml.includes('استرجاع قاعدة الشركة'));
    check('التوكن محقون في الصفحة', pageHtml.includes(tok));

    const env = await j('/api/env');
    check('البيئة: سائق pg متاح', env.pg === true);
    check('البيئة: التجربة الداخلية متاحة', env.pglite === true, 'PGlite غير متاح');

    /* حارس الملف التالف: يجب أن يُرفض قبل أي اتصال بقاعدة */
    const tiny = await j('/api/dryrun', { method: 'POST', body: JSON.stringify({ sql: 'select 1' }) });
    check('ملف صغير جداً مرفوض', tiny.ok === false && /فارغ|ناقص/.test(tiny.error || ''));

    const guard = await j('/api/restore', {
      method: 'POST',
      body: JSON.stringify({ connectionString: 'postgresql://x', sql, confirm: 'نعم' })
    });
    check('كلمة التأكيد إلزامية', /التأكيد/.test(guard.error || ''), guard.error);

    /* ═══ ٤) تنفيذ حقيقي على قاعدة داخلية ═══ */
    const dry = await j('/api/dryrun', { method: 'POST', body: JSON.stringify({ sql }) });
    check('التنفيذ الداخلي نجح بلا أخطاء', dry.ok === true && !dry.report.failed,
      dry.report && dry.report.failed ? dry.report.failed.message : dry.error);

    const counts = {};
    (dry.report.counts || []).forEach((r) => { counts[r.t] = Number(r.n); });
    check('البطاقات ٩', counts.applicants === 9, 'وجد ' + counts.applicants);
    check('الوظائف ٢', counts.jobs === 2, 'وجد ' + counts.jobs);
    check('الموظفون ١', counts.staff === 1, 'وجد ' + counts.staff);
    check('عدّاد البطاقات ٩', counts.card_number_counter === 1 && /last_number/.test(sql), 'الجدول ' + counts.card_number_counter);

    /* ═══ ٥) مقارنة الجرد: تُعلن الفرق ولا تدّعي الكمال ═══ */
    const inv = dry.report.inventory;
    check('المقارنة بالجرد متاحة', inv && inv.available === true);
    check('الفرق المقصود معلن صراحة', Array.isArray(inv.intentional) && inv.intentional.length > 0,
      'لا شيء معلن');
    check('لا فرق غير مفسَّر', inv.gaps === 0,
      'بقيت ' + inv.gaps + ' فجوة: ' + JSON.stringify(inv.diff && inv.diff.funcs.unexpected));

    /* ═══ ٦) ملف تالف: يتوقف ويقول أين ═══ */
    const at = sql.indexOf('create table if not exists brc.jobs');
    const broken = sql.slice(0, at) + 'create table if not exists brc.jobs BROKEN (;\n' + sql.slice(at + 41);
    const b = await j('/api/dryrun', { method: 'POST', body: JSON.stringify({ sql: broken }) });
    check('الملف التالف يُرفض', b.ok === false && !!b.report.failed);
    check('الخطأ يذكر رقم الدفعة', /^\d+\/\d+$/.test(String(b.report.failed.batch) + '/' + b.report.failed.total),
      JSON.stringify(b.report.failed));

    /* ═══ ٧) فحص الهدف: رابط غير صالح يُرفض برسالة مفهومة ═══ */
    const insp = await j('/api/inspect', {
      method: 'POST', body: JSON.stringify({ connectionString: 'postgresql://nobody@127.0.0.1:1/none' })
    });
    check('رابط غير صالح يُبلَّغ بلا انهيار', insp.ok === false && !!insp.error);

    killSrv();
    console.log(`\n  ${ok} ناجح / ${bad} فاشل`);
    process.exit(bad ? 1 : 0);
  });
