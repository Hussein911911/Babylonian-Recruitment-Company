/* ═══ هل «الملف الواحد» يعمل فعلاً من أوله لآخره؟ ═════════════════════════
   طلب المالك (2026-11-17): ملف واحد فيه كل شي، تعطيه لأداة تبني كل شي.

   ⚠️ وهنا العطل الذي وقعتُ فيه: قصصتُ رأس الملف المولّد لأخذ «الجسم فقط»،
   فسقط معه `session_replication_role = replica` — وهو الذي يعطّل المشغّلات
   أثناء التحميل. وبدونه تُنشئ مشغّلات البطاقات صفوف issued_serials
   والمحاولات بنفسها، فتصطدم بصفوفنا وتفشل بـ:
       duplicate key value violates unique constraint ...
   وكانت النتيجة: الملف يفشل عند job_attempts ولا صف واحد يدخل — أي «ملف
   كامل» صورته حلوة ونتيجته صفر.

   هذا الفحص يبني الملف من الصفر ببيانات تجريبية، يُنفّذه كاملاً، ثم
   **يقارن الأعداد** — لأن «بلا خطأ» وحدها لا تكفي.
   ═══════════════════════════════════════════════════════════════════════════ */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

import { SHIM } from './pg-shim.mjs';
import { headerCounts } from '../tools/dump-header.mjs';

/* ── بيانات تجريبية بالشكل الحقيقي ── */
const N_CARDS = 12, N_ATT = 20, N_AUDIT = 30;
const applicants = [];
for (let i = 1; i <= N_CARDS; i++) {
  applicants.push({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    serial: 'HRC-BC-' + (100000 + i), full_name: 'باحث ' + i, phone: '0770000' + (1000 + i),
    address: 'بابل', dob: null, gender: 'ذكر', nationality: 'عراقي',
    issue_date: '2026-11-01T00:00:00Z', expiry_date: '2026-12-01T00:00:00Z',
    attempt_limit: 2, status: 'active', fee_amount: 10000, fee_paid: true,
    pos_name: '', printed_count: 1, requested_code: null, reject_reason: '',
    created_by: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    notes: '', self_application_data: {}, card_print_code: 'ABC' + i,
  });
}
/* بلا تكرار (serial, attempt_no) — القيد يمنعه */
const attempts = [];
const used = new Set();
for (let i = 1; i <= N_ATT; i++) {
  let n = (i % N_CARDS) + 1, att = i <= N_CARDS ? 1 : 2;
  while (used.has(n + '-' + att)) { n = (n % N_CARDS) + 1; att = att === 1 ? 2 : 1; }
  used.add(n + '-' + att);
  attempts.push({
    id: `00000000-0000-0000-0001-${String(i).padStart(12, '0')}`,
    serial: 'HRC-BC-' + (100000 + n), attempt_no: att,
    job_id: null, job_code: null, job_snapshot: null, slot_status: 'empty',
    chance_code: 'X' + i, selected_at: null, hold_expires_at: null, closed_at: null,
    outcome_note: '', staff_id: null, employer_decision: null, decision_at: null,
    employer_reason: null,
  });
}
const audit_log = [];
for (let i = 1; i <= N_AUDIT; i++) {
  audit_log.push({
    id: i, ts: '2026-11-01T00:00:00Z', user_id: null, username: 'admin', role: 'admin',
    ip: null, action: 'اختبار ' + i, entity: 'test', entity_id: String(i),
    details: '', diff: null,
  });
}
const payload = {
  exportedAt: '2026-11-17T00:00:00Z', schema: 'test',
  counts: { applicants: N_CARDS, jobs: 0, job_attempts: N_ATT, audit_log: N_AUDIT },
  staff: [{ id: '11111111-1111-1111-1111-111111111111', auth_id: null, username: 'admin',
    full_name: 'المدير', role: 'admin', job_title: '', phone: '', active: true,
    created_at: '2026-01-01T00:00:00Z' }],
  applicants, jobs: [], job_attempts: attempts, settings: [], employer_job_credentials: [],
  issued_serials: applicants.map((a) => ({ serial: a.serial, issued_at: a.created_at, note: '' })),
  card_number_registry: applicants.map((a, i) => ({ serial: a.serial, card_number: i + 1 })),
  card_number_counter: [{ singleton: true, last_number: N_CARDS }],
  audit_log, card_issue_requests: [], recovery_chances: [], recovery_prints: [], office_receipts: [],
};

const PAY = '/tmp/hrc-payload-test.json';
const SQL = '/tmp/hrc-full-test.sql';
writeFileSync(PAY, JSON.stringify(payload));

console.log('\n═══ بناء الملف الواحد ═══');
try {
  execFileSync(process.execPath, ['tools/build-full-dump.mjs', '--payload', PAY, '--out', SQL],
    { stdio: 'pipe' });
  const txt = readFileSync(SQL, 'utf8');
  check('الملف بُني', txt.length > 100000, txt.length + ' بايت');
  check('فيه الهيكل', /create table if not exists brc\.applicants/i.test(txt));
  check('فيه البيانات', /INSERT INTO brc\."applicants"/.test(txt));
  /* ⚠️ هذا الفحص تغيّر 2026-11-18 بقصد. كان يطلب
     `session_replication_role = replica` — وهي تحتاج superuser وغير مضمونة
     على Supabase. البديل المضمون هو تعطيل صريح لكل مشغّلات brc ثم إعادتها.
     الفحص الآن يطلب الطرفين معاً: تعطيلاً **وإعادة تفعيل**، لأن التعطيل
     وحده يترك قاعدة الإنتاج بلا تدقيق وبلا إصدار أرقام بطاقات. */
  check('فيه تعطيل صريح للمشغّلات (باسم كل مشغّل)', /ALTER TABLE brc\.%I DISABLE TRIGGER %I/.test(txt),
    'غائب — المشغّلات ستُنشئ صفوفاً تتعارض مع صفوفنا');
  /* 2026-11-20: `… TRIGGER ALL` يتطلب superuser، ودور postgres في مشاريع
     Supabase الحديثة ليس superuser — فكان التعطيل يُهمَل والإعادة تُجهض
     البيانات. الممنوع الآن هو ALL نفسها، لا USER. */
  /* نفحص الكود لا التعليقات: التعليقات تشرح العطب القديم وتسمّيه. */
  const codeOnly = txt.replace(/^\s*--[^\n]*$/gm, '');
  check('لا يستعمل TRIGGER ALL في الكود (ALL يتطلب superuser)', !/TRIGGER\s+ALL/i.test(codeOnly),
    'ALL يتطلب superuser فيفشل الاسترجاع على Supabase');
  check('تعطيلها بالمشغّل لا USER الجماعي', !/DISABLE TRIGGER USER/.test(txt),
    'USER يُبقي فحص الفواصل الأجنبية فعّالاً فيفشل التحميل');
  /* الإعادة يجب أن تكون قبل COMMIT: بعدها تصبح معاملة ثانية، ولو رجع
     الملف لبقي الإنتاج بمشغّلات معطّلة. */
  const iDis = txt.indexOf('DISABLE TRIGGER %I');
  const iEn = txt.indexOf('ENABLE TRIGGER %I');
  const iCom = txt.search(/^COMMIT;$/m);
  check('تُعاد المشغّلات قبل COMMIT',
    iDis > 0 && iEn > iDis && iCom > iEn,
    `disable=${iDis} enable=${iEn} commit=${iCom}`);
  check('فيه فحص الأعداد في النهاية', /الفحص الأخير/.test(txt));
  /* الترويسة هي شهادة الملف عن محتواه — أداة الاسترجاع تقرأ منها أعداد
     النسخ الأحدث. فلو انحرفت الترويسة عن البيانات لصار التحقّق كذباً. */
  const hdr = headerCounts(txt);
  check('الترويسة تحمل أعداداً مقروءة', !!hdr);
  if (hdr) {
    const want = { staff: 1, applicants: N_CARDS, jobs: 0, job_attempts: N_ATT, audit_log: N_AUDIT,
      issued_serials: N_CARDS, card_number_registry: N_CARDS, counter: N_CARDS };
    const bad = Object.entries(want).filter(([k, v]) => hdr[k] !== v);
    check('أعداد الترويسة تطابق الحمولة', bad.length === 0,
      bad.map(([k, v]) => `${k}: ترويسة ${hdr[k]} ≠ ${v}`).join(' · '));
  }
  /* لم يعد «BEGIN واحد» عيباً: التصميم الحالي معاملة واحدة للبيانات،
     وكل شيء داخلها (تفريغ، تعطيل، إدخال، إعادة تفعيل) — فالتراجع ممكن.
     المطلوب: BEGIN واحد يُغلق بـ COMMIT واحد، ولا معاملة معلّقة. */
  const nBegin = (txt.match(/^BEGIN;$/gm) || []).length;
  const nCommit = (txt.match(/^COMMIT;$/gm) || []).length;
  check('معاملة واحدة متوازنة', nBegin === 1 && nCommit === 1,
    `BEGIN=${nBegin} COMMIT=${nCommit}`);
  check('التفريغ ديناميكي لا بأسماء صريحة',
    /TRUNCATE brc\.%I RESTART IDENTITY CASCADE/.test(txt),
    'أسماء صريحة تُفشل الملف على مخطط ناقص');
} catch (e) {
  check('الملف بُني', false, String(e.stderr || e.message).slice(0, 200));
}

console.log('\n═══ تنفيذه كاملاً كما تفعل الأداة ═══');
const db = new PGlite(); await db.waitReady; await db.exec(SHIM);
let execErr = null;
try { await db.exec(readFileSync(SQL, 'utf8')); } catch (e) { execErr = e.message.split('\n')[0]; }
check('نُفِّذ من أوله لآخره', !execErr, execErr);

console.log('\n═══ الأعداد — «بلا خطأ» وحدها لا تكفي ═══');
const expect = {
  staff: 1, applicants: N_CARDS, job_attempts: N_ATT,
  issued_serials: N_CARDS, card_number_registry: N_CARDS, audit_log: N_AUDIT,
};
for (const [t, want] of Object.entries(expect)) {
  let got = -1;
  try {
    const r = await db.query(`select count(*)::int n from brc.${t}`);
    got = r.rows[0].n;
  } catch (e) { got = -1; }
  check(`${t} = ${want}`, got === want, 'وجدنا ' + got);
}

console.log('\n═══ العدّاد والصلاحيات ═══');
try {
  const c = await db.query('select last_number from brc.card_number_counter');
  check(`عدّاد البطاقات = ${N_CARDS}`, Number(c.rows[0].last_number) === N_CARDS, c.rows[0].last_number);
} catch (e) { check('عدّاد البطاقات', false, e.message.slice(0, 80)); }
for (const seq of ['audit_log_id_seq', 'job_code_seq', 'form_serial_seq']) {
  const r = await db.query(`select has_sequence_privilege('authenticated','brc.${seq}','USAGE') as u`);
  check(`${seq} ممنوح`, r.rows[0].u === true, 'مفقود');
}

await db.close();
for (const f of [PAY, SQL]) { try { unlinkSync(f); } catch (e) {} }

console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً — الملف الواحد يعمل من أوله لآخره` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
