/* ═══════════════════════════════════════════════════════════════════════════
   جولة المتصفح: صلاحيات الموظف الكاملة (قرار المالك 2026-11-11)

   يثبت في Chromium حقيقي على شاشة اللوحة الفعلية أن الموظف:
     • ينشئ وظيفة        • يعدّلها        • يحذفها
     • ينشئ بطاقة      • يصدر دفعة      • يعتمد/يرفض طلباً
   والزائر المجهول يُرفض في كل واحدة.

   سبب وجوده: jsdom يختبر الدوال، لكنه لا يحمّل اللوحة كاملة كما يفعل
   الموظف — فأي إخفاء زر أو بوابة صلاحية في dashboard.js لا يظهر له.
   ═══════════════════════════════════════════════════════════════════════════ */
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';

const libs = new URL('./.tmp/horizontal/libraries/', import.meta.url);
const packed = new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url);
if (existsSync(packed) && !existsSync(new URL('lib/', libs))) {
  mkdirSync(libs, { recursive: true });
  const tar = new URL('libs.tar', libs);
  writeFileSync(tar, brotliDecompressSync(readFileSync(packed)));
  execFileSync('tar', ['xf', tar.pathname, '-C', libs.pathname]);
}

const BASE = process.env.HRC_BASE || 'http://127.0.0.1:4173';
let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (d ? '  :: ' + d : '')); }
};

const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter((s) => !['--disable-web-security', '--single-process', '--in-process-gpu',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),
  env: { ...process.env, LD_LIBRARY_PATH: [new URL('lib/', libs).pathname, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  headless: true
});

/* الجلسة الحقيقية كما يكتبها applyStaffSession: cloud:true إلزامي وإلا
   مسحها currentUser() بسبب enforceAuth. */
async function rolePage(role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/demo', { waitUntil: 'domcontentloaded' });
  if (role) {
    await p.evaluate((r) => {
      const u = r === 'admin'
        ? { username: 'admin', name: 'مدير', role: 'admin', cloud: true }
        : { username: 'staff', name: 'موظف', role: 'staff', cloud: true };
      sessionStorage.setItem('hrc_session_v2', JSON.stringify(u));
    }, role);
  }
  await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1400);
  return { ctx, p };
}

console.log('\n' + '═'.repeat(74));
console.log('  صلاحيات الموظف الكاملة — متصفح حقيقي');
console.log('═'.repeat(74));

/* ── 1) الموظف: الوظائف ─────────────────────────────────────────────────── */
console.log('\n▌ 1 — الموظف والوظائف\n');
{
  const { ctx, p } = await rolePage('staff');
  const r = await p.evaluate(() => {
    const S = window.HRCStore;
    if (!S) return { err: 'no store' };
    const n0 = S.db().jobs.length;

    const created = S.createJob({
      title: 'وظيفة اختبار الموظف', category: 'خدمات', governorate: 'بابل',
      shift: 'دوام كامل', salaryMin: 500000, salaryMax: 700000, vacancies: 1,
      employerName: 'شركة اختبار', employerPhone: '07700000000'
    });
    if (!created) return { err: 'createJob رجع null للموظف' };

    const edited = S.updateJob(created.code, { title: 'عنوان معدَّل' });
    const statused = S.setJobStatus(created.code, 'closed', 'اختبار');
    const deleted = S.deleteJob(created.code);

    return {
      created: !!created, code: created.code,
      editedTitle: edited && edited.title,
      statused: !!(statused && statused.status === 'closed'),
      deleted: deleted === true,
      n0, n1: S.db().jobs.length
    };
  });
  check('الموظف ينشئ وظيفة', r.created === true, JSON.stringify(r));
  check('الموظف يعدّل الوظيفة', r.editedTitle === 'عنوان معدَّل', String(r.editedTitle));
  check('الموظف يغيّر حالة الوظيفة', r.statused === true);
  check('الموظف يحذف الوظيفة', r.deleted === true);
  check('العدد عاد كما كان بعد الحذف', r.n0 === r.n1, `${r.n0} → ${r.n1}`);
  await ctx.close();
}

/* ── 2) البطاقات: الإصدار حصرياً للمدير (قرار المالك 2026-11-11) ─────────── */
console.log('\n▌ 2 — إصدار البطاقات: مدير فقط\n');
{
  /* الموظف: يُرفض */
  const ws = await rolePage('staff');
  const rs = await ws.p.evaluate(() => {
    const S = window.HRCStore;
    const one = S.createCardWithSerial('7KQ4M9TR5A', 'اختبار موظف');
    const batch = S.createCardBatch(2, 'دفعة موظف');
    return { oneOk: one && one.ok === true, batchLen: batch.length };
  });
  check('الموظف لا ينشئ بطاقة بكودها', rs.oneOk === false, JSON.stringify(rs));
  check('الموظف لا يصدر دفعة بطاقات', rs.batchLen === 0, String(rs.batchLen));
  await ws.ctx.close();

  /* المدير: ينجح */
  const wa = await rolePage('admin');
  const ra = await wa.p.evaluate(() => {
    const S = window.HRCStore;
    const one = S.createCardWithSerial('7KQ4M9TR5B', 'بطاقة مدير');
    const batch = S.createCardBatch(2, 'دفعة مدير');
    return { oneOk: one && one.ok === true, batchLen: batch.length };
  });
  check('المدير ينشئ بطاقة بكودها', ra.oneOk === true, JSON.stringify(ra));
  check('المدير يصدر دفعة بطاقات', ra.batchLen === 2, String(ra.batchLen));
  await wa.ctx.close();
}

/* ── 3) الموظف: اعتماد ورفض الطلبات ─────────────────────────────────────── */
console.log('\n▌ 3 — الموظف والطلبات\n');
{
  const { ctx, p } = await rolePage('staff');
  const r = await p.evaluate(() => {
    const S = window.HRCStore;
    /* البيانات الوهمية لا تحوي طلبات قيد المراجعة — نزرع واحداً من داخل
       المتجر كما يفعل نموذج الزائر (request_form يُنشئ pending). */
    const db = S.db();
    const serial = 'HRC-NO-900120';
    if (!db.applicants.some((a) => a.serial === serial)) {
      db.applicants.push({
        serial, fullName: 'باحث اختبار الموظف', phone: '07701112233', address: 'بابل — الحلة',
        dob: '1996-03-04', gender: 'ذكر', nationality: 'عراقي',
        status: 'pending', issueDate: null, expiryDate: null, attemptLimit: 2,
        feeAmount: 2000, feePaid: false, printedCount: 0, requestedCode: 'HRC-1001',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        notes: '', posName: '', archivedAt: null
      });
      db.attempts = db.attempts || [];
      for (let i = 1; i <= 2; i++) db.attempts.push({ serial, no: i, slotStatus: 'empty', jobId: null });
    }
    const res = S.approveApplicant(serial);
    const after = S.getApplicant(serial);
    return { ok: res && res.ok === true, serial, status: after && after.status, expiry: !!(after && after.expiryDate) };
  });
  check('الموظف يعتمد طلب بطاقة قيد المراجعة', r.ok === true && r.status === 'active' && r.expiry === true, JSON.stringify(r));
  await ctx.close();
}

/* ── 4) الزائر المجهول: كل شيء مرفوض ────────────────────────────────────── */
console.log('\n▌ 4 — الزائر المجهول\n');
{
  const { ctx, p } = await rolePage(null);
  const r = await p.evaluate(() => {
    const S = window.HRCStore;
    if (!S) return { err: 'no store' };
    const job = S.db().jobs[0];
    return {
      createJob: S.createJob({ title: 'x', category: 'c', shift: 's', employerName: 'e', employerPhone: '0' }),
      updateJob: S.updateJob(job.code, { title: 'مخترق' }),
      setJobStatus: S.setJobStatus(job.code, 'closed', 'x'),
      deleteJob: S.deleteJob(job.code),
      card: S.createCardWithSerial('7KQ4M9TR7B', 'زائر'),
      batch: S.createCardBatch(1, 'زائر'),
      approve: S.approveApplicant('HRC-BC-000120')
    };
  });
  check('الزائر لا ينشئ وظيفة', r.createJob === null);
  check('الزائر لا يعدّل وظيفة', r.updateJob === null);
  check('الزائر لا يغيّر حالة وظيفة', r.setJobStatus === false);
  check('الزائر لا يحذف وظيفة', r.deleteJob === false);
  check('الزائر لا ينشئ بطاقة', !(r.card && r.card.ok));
  check('الزائر لا يصدر دفعة', Array.isArray(r.batch) && r.batch.length === 0);
  check('الزائر لا يعتمد طلباً', !(r.approve && r.approve.ok));
  await ctx.close();
}

/* ── 5) الأزرار ظاهرة للموظف في الشاشة ──────────────────────────────────── */
console.log('\n▌ 5 — الأزرار في الواجهة\n');
{
  const { ctx, p } = await rolePage('staff');
  await p.evaluate(() => document.querySelector('#side-nav button[data-view="jobs"]')?.click());
  await p.waitForTimeout(1200);
  const buttons = await p.evaluate(() => ({
    edit: document.querySelectorAll('[data-job-edit]').length,
    del: document.querySelectorAll('[data-job-del]').length,
    assign: document.querySelectorAll('[data-job-assign]').length
  }));
  check('أزرار التعديل ظاهرة للموظف', buttons.edit > 0, JSON.stringify(buttons));
  check('أزرار الحذف ظاهرة للموظف', buttons.del > 0, JSON.stringify(buttons));
  check('أزرار الترشيح ظاهرة للموظف', buttons.assign > 0, JSON.stringify(buttons));
  await ctx.close();
}

/* ── 6) المدير يملك كل صلاحيات الموظف + الخاصة به ──────────────────────── */
console.log('\n▌ 6 — المدير ⊇ الموظف\n');
{
  const staffCtx = await rolePage('staff');
  const adminCtx = await rolePage('admin');
  const read = async (p) => p.evaluate(() => {
    const nav = [...document.querySelectorAll('#side-nav button[data-view]')]
      .filter((b) => !b.classList.contains('hidden')).map((b) => b.getAttribute('data-view'));
    return {
      nav,
      newCard: !!document.getElementById('btn-new-card') && !document.getElementById('btn-new-card').classList.contains('hidden'),
      newBatch: !!document.getElementById('btn-new-batch') && !document.getElementById('btn-new-batch').classList.contains('hidden')
    };
  });
  const st = await read(staffCtx.p);
  const ad = await read(adminCtx.p);

  const missingForAdmin = st.nav.filter((v) => !ad.nav.includes(v));
  check('المدير يرى كل شاشات الموظف', missingForAdmin.length === 0, 'ناقص: ' + missingForAdmin.join(', '));
  check('الموظف يرى شاشة البطاقات', st.nav.includes('applicants'), st.nav.join(','));
  /* قرار المالك: إصدار البطاقات حصرياً للمدير العام. */
  check('زر إضافة بطاقة مخفي عن الموظف (إصدار مدير فقط)', st.newCard === false);
  check('زر إصدار دفعة مخفي عن الموظف (إصدار مدير فقط)', st.newBatch === false);
  check('المدير يرى زر إضافة بطاقة', ad.newCard === true);
  check('المدير يرى زر إصدار دفعة', ad.newBatch === true);
  check('المدير وحده يرى سجل التدقيق والمالية والإعدادات',
    ad.nav.includes('audit') && ad.nav.includes('finance') && ad.nav.includes('settings') &&
    !st.nav.includes('audit') && !st.nav.includes('finance') && !st.nav.includes('settings'),
    'موظف: ' + st.nav.join(',') + ' | مدير: ' + ad.nav.join(','));

  /* وعلى مستوى الدوال: الأدوار تحقّق isStaffSession للمدير أيضاً */
  const fnLevel = await adminCtx.p.evaluate(() => {
    const S = window.HRCStore;
    const u = S.currentUser();
    return {
      role: u && u.role,
      isStaffSession: S.isStaffSession ? S.isStaffSession() : null,
      isAdmin: S.isAdmin ? S.isAdmin() : null,
      canDeleteJob: typeof S.deleteJob === 'function'
    };
  });
  check('المدير يمرّ من حارس isStaffSession', fnLevel.isStaffSession === true && fnLevel.isAdmin === true, JSON.stringify(fnLevel));

  await staffCtx.ctx.close();
  await adminCtx.ctx.close();
}

await browser.close();
console.log('\n' + '═'.repeat(74));
console.log(`  النتيجة: ✅ ${pass} ناجح | ❌ ${fail} فاشل`);
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
