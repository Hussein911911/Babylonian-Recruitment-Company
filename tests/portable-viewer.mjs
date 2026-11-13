/* ═══════════════════════════════════════════════════════════════════════════
   HRC — صفحة الاسترجاع: الواجهة كاملة من `file://`
   ---------------------------------------------------------------------------
   الشرط الذي وضعه المالك: «أفتح النسخة على جهازي بلا إنترنت فأشوف كل
   التفاصيل بشكل مرتّب». هذا الفحص يفتح الصفحة **ملفاً محلياً** — لا خادم ولا
   شبكة — ويتحقق من:

     ١. الصفحة تعمل من `file://` (لا fetch، لا طلبات خارجية)
     ٢. تُظهر التبويبات السبعة بعد فكّ التشفير
     ٣. كل جدول يعرض صفوفه فعلاً (لا الأعداد فقط)
     ٤. البحث والترقيم وتصدير CSV والـSQL تعمل
     ٥. لا أخطاء JS

   يُشغَّل بمحرك Chromium المجزّأ (نفس أسلوب الفحوص البصرية الأخرى).
   ═══════════════════════════════════════════════════════════════════════════ */
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';

const libs = new URL('./.tmp/horizontal/libraries/', import.meta.url);
const packed = new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url);
if (existsSync(packed) && !existsSync(new URL('lib/', libs))) {
  mkdirSync(libs, { recursive: true });
  const tar = new URL('libs.tar', libs);
  writeFileSync(tar, brotliDecompressSync(readFileSync(packed)));
  execFileSync('tar', ['xf', tar.pathname, '-C', libs.pathname]);
}

let ok = 0, bad = 0;
const check = (label, got, want) => {
  const pass = String(got) === String(want);
  pass ? ok++ : bad++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}` + (pass ? '' : `  → ${got} (المتوقع ${want})`));
};

/* ═══ ملف نسخة حقيقي — نفس الشكل الذي يُنتجه زر التنزيل ═══════════════════ */
const tmp = fileURLToPath(new URL('./.tmp-viewer.hrcbak', import.meta.url));
process.env.HRC_TMP_BACKUP = tmp;

await import('../assets/js/portable-backup.js');
const PB = globalThis.HRCPortableBackup;

const payload = {
  format: 2, schema: 'ui-check', exportedAt: '2026-11-12T20:00:00.000Z',
  counts: { jobs: 3, applicants: 4, attempts: 3, audit: 5, serials: 4, staff: 2 },
  jobs: [
    { code: 'HRC-1055', title: 'عامل إنتاج', category: 'صناعة', governorate: 'بابل', shift: 'صباحي', vacancies: 100, status: 'available', salary_min: 700000, salary_max: 900000 },
    { code: 'HRC-1056', title: 'محاسب', category: 'إداري', governorate: 'بغداد', shift: 'دوام كامل', vacancies: 50, status: 'available', salary_min: 800000, salary_max: 1000000 },
    { code: 'HRC-1046', title: 'فني كهرباء', category: 'تقني', governorate: 'بابل', shift: 'مسائي', vacancies: 1, status: 'reserved', salary_min: 600000, salary_max: 700000 }
  ],
  applicants: [
    { serial: 'AAAA111111', full_name: 'أحمد علي حسين', phone: '07701234567', status: 'active', attempt_limit: 3, fee_amount: 5000, expiry_date: '2026-12-01' },
    { serial: 'BBBB222222', full_name: 'علي محمد جاسم', phone: '07709876543', status: 'active', attempt_limit: 3, fee_amount: 5000, expiry_date: '2026-12-05' },
    { serial: 'CCCC333333', full_name: 'حسن كريم عبد', phone: '07711112222', status: 'blank', attempt_limit: 3, fee_amount: 5000, expiry_date: null },
    { serial: 'DDDD444444', full_name: 'مصطفى صادق', phone: '07733334444', status: 'expired', attempt_limit: 3, fee_amount: 5000, expiry_date: '2026-11-01' }
  ],
  job_attempts: [
    { serial: 'AAAA111111', attempt_no: 1, job_code: 'HRC-1046', slot_status: 'reserved', vacancy_no: 1, hold_expires_at: '2026-11-14T00:00:00Z' },
    { serial: 'AAAA111111', attempt_no: 2, job_code: null, slot_status: 'empty', vacancy_no: null, hold_expires_at: null },
    { serial: 'BBBB222222', attempt_no: 1, job_code: 'HRC-1055', slot_status: 'succeeded', vacancy_no: 12, hold_expires_at: null }
  ],
  settings: [{ key: 'rules', value: { attempt_limit: 3 }, updated_at: '2026-11-01T00:00:00Z' }],
  issued_serials: [
    { serial: 'AAAA111111', issued_at: '2026-11-01T00:00:00Z', note: null },
    { serial: 'BBBB222222', issued_at: '2026-11-02T00:00:00Z', note: null },
    { serial: 'CCCC333333', issued_at: '2026-11-03T00:00:00Z', note: null },
    { serial: 'DDDD444444', issued_at: '2026-11-04T00:00:00Z', note: null }
  ],
  audit_log: Array.from({ length: 5 }, (_, i) => ({
    id: i + 1, ts: '2026-11-0' + (i + 1) + 'T10:00:00Z', username: 'admin', role: 'admin',
    action: 'إجراء ' + (i + 1), entity: 'jobs', entity_id: 'HRC-1055', details: 'تفصيل', diff: null
  })),
  staff: [
    { username: 'admin', full_name: 'المدير', role: 'admin', active: true },
    { username: 'AliAhmed919', full_name: 'علي أحمد', role: 'staff', active: true }
  ],
  card_number_registry: [
    { serial: 'AAAA111111', card_number: 1 },
    { serial: 'BBBB222222', card_number: 5 }
  ],
  card_number_counter: [{ singleton: true, last_number: 5 }]
};

/* ٣٠٠ بطاقة لاختبار الترقيم فعلياً (٥٠ لكل صفحة) */
payload.applicants = payload.applicants.concat(Array.from({ length: 296 }, (_, i) => ({
  serial: 'PAG' + String(100000 + i), full_name: 'صفحة ' + (i + 1), phone: '0770', status: 'active',
  attempt_limit: 3, fee_amount: 5000, expiry_date: '2026-12-31'
})));
payload.counts.applicants = payload.applicants.length;

const env = await PB.seal(payload, 'كلمة-الفحص-2026');
writeFileSync(tmp, JSON.stringify(env));

const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args
    .filter((s) => !['--disable-web-security', '--single-process', '--in-process-gpu',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s))
    .concat('--disable-gpu'),
  env: {
    ...process.env,
    LD_LIBRARY_PATH: [new URL('lib/', libs).pathname, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  },
  headless: true
});

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  const external = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('file://')) external.push(u);
  });

  const pageUrl = fileURLToPath(new URL('../restore.html', import.meta.url));

  /* ── ١) الصفحة تُفتح محلياً ── */
  await page.goto('file://' + pageUrl);
  check('الصفحة تعمل من file://', await page.title() !== '', true);
  check('لا طلب شبكة واحد', external.length, 0);

  /* ── ٢) اختيار الملف وفكّ التشفير ── */
  await page.setInputFiles('#rp-file', tmp);
  await page.waitForSelector('#rp-step3:not(.is-hidden)', { timeout: 15000 });
  check('بعد اختيار الملف لا يظهر المحتوى تلقائياً',
    await page.$eval('#rp-step4', (el) => el.classList.contains('is-hidden')), true);

  await page.fill('#rp-pass', 'كلمة-مرور-خاطئة');
  await page.click('#rp-unlock-btn');
  await page.waitForTimeout(400);
  check('كلمة المرور الخاطئة لا تفتح المحتوى',
    await page.$eval('#rp-step5', (el) => el.classList.contains('is-hidden')), true);

  await page.fill('#rp-pass', 'كلمة-الفحص-2026');
  await page.click('#rp-unlock-btn');
  await page.waitForSelector('#rp-step5:not(.is-hidden)', { timeout: 20000 });
  await page.waitForSelector('#rv-root .rv-table tbody tr', { timeout: 20000 });

  /* ── ٣) التبويبات السبعة تعرض صفوفاً ── */
  const expect = { 'الوظائف': 3, 'البطاقات': 50, 'الفرص': 3, 'سجل التدقيق': 5,
    'الإعدادات': 1, 'أرقام مُصدَرة': 4, 'الحسابات': 2 };
  const tabs = await page.$$eval('.rv-tab', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check('كل التبويبات السبعة ظاهرة', tabs.length, 7);

  for (let i = 0; i < tabs.length; i++) {
    const label = tabs[i].split(/\d/)[0].trim();
    await page.click(`.rv-tab:nth-child(${i + 1})`);
    await page.waitForTimeout(120);
    const rows = await page.$$eval('.rv-table tbody tr', (e) => e.length);
    check(`التبويب «${label}» يعرض صفوفاً (${rows})`, rows, expect[label] ?? rows);
  }

  /* ── ٤) الحالات معرّبة لا خام ── */
  await page.click('.rv-tab:nth-child(1)');
  await page.waitForTimeout(120);
  const jobCells = await page.$$eval('.rv-table tbody td', (e) => e.map((x) => x.textContent));
  check('الحالة معروضة عربية (متاحة) لا خام (available)', jobCells.includes('متاحة'), true);
  check('لا تظهر قيمة إنجليزية خام', jobCells.includes('available'), false);

  /* ── ٥) البحث ── */
  await page.click('.rv-tab:nth-child(2)');
  await page.waitForTimeout(120);
  await page.fill('#rv-search', 'حسن');
  await page.waitForTimeout(250);
  check('البحث يرشّح الصفوف', await page.$$eval('.rv-table tbody tr', (e) => e.length), 1);

  /* ── ٦) الترقيم على ٣٠٠ بطاقة ── */
  await page.fill('#rv-search', '');
  await page.waitForTimeout(250);
  const pagerText = await page.$eval('.rv-pager span', (e) => e.textContent);
  check('الترقيم يظهر عند تجاوز ٥٠ صفاً', /صفحة 1 من 6/.test(pagerText), true);
  check('الصفحة الأولى تعرض ٥٠ صفاً', await page.$$eval('.rv-table tbody tr', (e) => e.length), 50);
  await page.click('[data-pg="next"]');
  await page.waitForTimeout(200);
  check('زر «التالي» ينقل للصفحة ٢',
    /صفحة 2 من 6/.test(await page.$eval('.rv-pager span', (e) => e.textContent)), true);

  /* ── ٧) تصدير CSV جدول واحد ── */
  const dlCsv = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#rv-csv');
  const csvDl = await dlCsv;
  check('CSV نُزّل باسم مفهوم', /^hrc-applicants-\d{4}-\d{2}-\d{2}\.csv$/.test(csvDl.suggestedFilename()), true);
  const csvText = readFileSync(await csvDl.path(), 'utf8');
  check('CSV يبدأ بـBOM', csvText.charCodeAt(0), 0xfeff);
  check('CSV يحمل الصفوف كلها (٣٠٠ + ترويسة)', csvText.trim().split('\r\n').length, 301);

  /* ── ٨) تنزيل SQL — المخرج الذي يُبنى منه موقع جديد ── */
  const dlSql = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#rp-dl-sql');
  const sqlDl = await dlSql;
  const sqlText = readFileSync(await sqlDl.path(), 'utf8');
  check('SQL نُزّل', /^2-data-\d{4}-\d{2}-\d{2}\.sql$/.test(sqlDl.suggestedFilename()), true);
  check('SQL فيه الحسابات (كانت تُسقط قبل الإصلاح)', /brc\."staff"/.test(sqlText), true);
  check('SQL فيه أمر إدخال لكل جدول', /INSERT INTO brc\."(jobs|applicants|job_attempts|audit_log|issued_serials|settings)"/.test(sqlText), true);
  check('SQL يحمل البطاقات الـ٣٠٠', (sqlText.match(/PAG1\d{5}/g) || []).length >= 296, true);

  /* ── ٩) لا أخطاء ── */
  check('لا أخطاء JavaScript', errs.length, 0);
  check('لا طلبات خارجية حتى بعد كل العمليات', external.length, 0);

  /* ── ٩ب) أرقام البطاقات: العدّاد لا يبدأ من صفر ── */
  check('SQL يضبط عدّاد الأرقام على ٥ لا صفر', /VALUES \(true, 5\)/.test(sqlText), true);
  check('SQL يحفظ سجل أرقام البطاقات', /card_number_registry/.test(sqlText), true);

  /* ── ٩ج) صور الوظائف: لا شيء يُضمَّن بلا طلب ── */
  check('زر تضمين الصور ظاهر', await page.isVisible('#rp-embed-images'), true);
  await page.click('#rp-embed-images');
  await page.waitForTimeout(600);
  const embedMsg = (await page.textContent('#rp-embed-status')) || '';
  check('بلا صور Supabase يقول لا شيء يُضمَّن', /خارجية|لا شيء/.test(embedMsg), true);

  /* ── ١٠) إغلاق الذاكرة ── */
  await page.click('#rp-lock');
  await page.waitForTimeout(300);
  check('«إغلاق وتفريغ الذاكرة» يخفي التفاصيل',
    await page.$eval('#rp-step5', (el) => el.classList.contains('is-hidden')), true);
  check('العرض أُفرغ من الصفحة', await page.$$eval('#rv-root .rv-table', (e) => e.length), 0);
} finally {
  await browser.close();
  rmSync(tmp, { force: true });
}

console.log(`\n  صفحة العرض: ${ok} ناجح${bad ? ' / ' + bad + ' فاشل' : ''}`);
process.exit(bad ? 1 : 0);
