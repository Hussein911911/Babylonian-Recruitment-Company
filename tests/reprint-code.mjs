// Isolated real PostgreSQL execution plus browser/store/cloud regression checks.
// No network, production database, or customer data is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { JSDOM } from 'jsdom';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let checks = 0;
function check(name, test) { assert.ok(test, name); checks++; console.log('  ✅ ' + name); }
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create schema brc;
    grant usage on schema brc to anon, authenticated;
    create table brc.applicants (
      id uuid default gen_random_uuid(), serial text unique, full_name text, phone text,
      address text default 'عنوان خاص', dob date, gender text default 'ذكر', nationality text default 'عراقي',
      status text default 'active', issue_date timestamptz, expiry_date timestamptz, pos_name text
    );
    create table brc.audit_log (
      ts timestamptz default now(), username text, role text, action text,
      entity text, entity_id text, details text, ip text, diff jsonb
    );
    create table brc.jobs (id uuid, title text, region text);
    create table brc.job_attempts (
      serial text, attempt_no integer, chance_code text, slot_status text default 'empty',
      job_code text, job_id uuid, selected_at timestamptz, hold_expires_at timestamptz,
      closed_at timestamptz, outcome_note text
    );
    insert into brc.applicants(serial, full_name, phone) values ('LEGACY', 'اسم قديم', '07700000001');
    insert into brc.job_attempts(serial, attempt_no, chance_code) values
      ('LEGACY', 1, '1234-AB'), ('LEGACY', 2, '5678-CD');
  `);
  const schema = read('docs/schema.sql');
  for (const name of ['mask_name', 'mask_phone']) {
    const fn = schema.match(new RegExp('create or replace function brc\\.' + name + '\\([\\s\\S]*?\\$\\$;'));
    assert.ok(fn, name); await db.exec(fn[0]);
  }
  const migration = read('supabase/migrations/20261016090000_card_print_verification_code.sql');
  await db.exec(migration);

  // Reproduce the real automatic audit trigger, not just the RPC's manual logs.
  const auditFn = schema.match(/create or replace function brc\.trg_audit\(\)[\s\S]*?end \$\$;/)[0];
  const oldAuditFn = auditFn.replace("  before_row := before_row - 'card_print_code' - 'chance_code';", '')
    .replace("  after_row := after_row - 'card_print_code' - 'chance_code';", '');
  await db.exec(oldAuditFn + `
    create trigger test_audit_applicants after insert or update or delete on brc.applicants for each row execute function brc.trg_audit();
    create trigger test_audit_attempts after insert or update or delete on brc.job_attempts for each row execute function brc.trg_audit();
    insert into brc.applicants(serial,full_name,card_print_code) values ('HISTORY','تاريخ يجب حفظه','A1B2C3D4E5F6789');
    insert into brc.job_attempts(serial,attempt_no,chance_code) values ('HISTORY',1,'9876-ZZ');
  `);
  const correction = read('supabase/migrations/20261016103000_card_print_code_audit_privacy.sql');
  check('regression fixture reproduces historical audit secret leakage', JSON.stringify((await db.query("select diff from brc.audit_log where entity_id='HISTORY'")).rows).includes('A1B2C3D4E5F6789'));
  await db.exec(correction); await db.exec(correction);
  const history = JSON.stringify((await db.query("select diff from brc.audit_log where entity_id='HISTORY'")).rows);
  check('corrective migration is repeatable and redacts historical secrets only', !history.includes('A1B2C3D4E5F6789') && !history.includes('9876-ZZ') && history.includes('تاريخ يجب حفظه') && history.includes('HISTORY'));
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const rpc = async (serial, code) => (await query('select brc.verify_card_code($1, $2) as r', [serial, code]))[0].r;
  check('migration does not invalidate any previously printed card', (await query("select card_print_code from brc.applicants where serial='LEGACY'"))[0].card_print_code === null);
  await db.exec(`insert into brc.applicants(serial, full_name, phone) values
    ('NEW', 'اسم خاص بالزبون', '07700000002'), ('OTHER', 'اسم آخر', '07700000003');
    insert into brc.job_attempts(serial, attempt_no, chance_code) values
    ('NEW',1,'2468-EF'),('NEW',2,'1357-GH');`);
  const cards = await query("select serial, card_print_code from brc.applicants where serial in ('NEW','OTHER') order by serial");
  const secret = cards[0].card_print_code;
  check('new server-issued cards receive distinct 64-bit random codes', /^[A-F0-9]{16}$/.test(secret) && secret !== cards[1].card_print_code);
  await db.exec(migration);
  check('reapplying migration does not rotate existing new or old codes', (await query("select card_print_code from brc.applicants where serial='NEW'"))[0].card_print_code === secret && (await query("select card_print_code from brc.applicants where serial='LEGACY'"))[0].card_print_code === null);
  await db.exec(`insert into brc.applicants(serial, full_name, card_print_code) values ('RESTORED','بطاقة مسترجعة',null);
    insert into brc.job_attempts(serial,attempt_no,chance_code) values ('RESTORED',1,'8888-AB');
    insert into brc.applicants(serial,full_name) values ('AUDIT','قبل التعديل');
    update brc.applicants set full_name='بعد التعديل' where serial='AUDIT';
    delete from brc.applicants where serial='AUDIT';`);
  const auditChanges = await query("select action, diff from brc.audit_log where entity_id='AUDIT' order by ts");
  check('insert/update/delete audit diffs retain evidence without secret keys', auditChanges.length === 3 && !JSON.stringify(auditChanges).includes('card_print_code') && JSON.stringify(auditChanges).includes('قبل التعديل') && JSON.stringify(auditChanges).includes('بعد التعديل'));
  check('restoring legacy cards with explicit NULL preserves their printed code', (await rpc('RESTORED','8888-AB')).ok);
  await db.exec('set role anon');
  let denied = false;
  try { await query('select * from brc.applicants'); } catch (e) { denied = e.message.includes('permission denied'); }
  check('anonymous caller cannot read private applicants directly', denied);
  check('both codes on already-printed legacy cards still verify', (await rpc('LEGACY', '1234-AB')).ok && (await rpc('LEGACY', '5678-CD')).ok);
  check('new cards reject their old-style opportunity codes', !(await rpc('NEW', '2468-EF')).ok && !(await rpc('NEW', '1357-GH')).ok);
  check('another card secret cannot authorize a reprint', !(await rpc('NEW', cards[1].card_print_code)).ok);
  const verified = await rpc(' new ', secret.toLowerCase().match(/.{4}/g).join('-'));
  check('normalized independent code unlocks the protected print payload', verified.ok && verified.data.fullName === 'اسم خاص بالزبون' && verified.data.cardPrintCode === secret && verified.data.attempts.length === 2 && verified.data.address === 'عنوان خاص');
  await db.exec("reset role; update brc.job_attempts set slot_status='rejected' where serial='NEW' and attempt_no=1; set role anon");
  check('consuming an opportunity neither rotates nor invalidates the independent reprint code', (await rpc('NEW',secret)).ok && !(await rpc('NEW','2468-EF')).ok);
  const lookup = (await query("select brc.lookup_card('NEW') as r"))[0].r;
  check('public barcode lookup exposes capability but no secret or full PII', lookup.usesCardPrintCode === true && !JSON.stringify(lookup).includes(secret) && !JSON.stringify(lookup).includes('2468-EF') && lookup.fullName !== verified.data.fullName && lookup.phone !== verified.data.phone);
  const bad = await rpc('NEW', '0000000000000000');
  check('wrong code returns no protected payload', !bad.ok && !bad.data && !JSON.stringify(bad).includes(secret));
  check('unknown serial fails without protected payload', !(await rpc('MISSING', secret)).ok);
  // NEW has five failures above; three more reach the shared eight-attempt cap.
  for (let i = 0; i < 3; i++) await rpc('NEW', 'FFFFFFFFFFFFFFFF');
  const locked = await rpc('NEW', secret);
  check('eight failed attempts lock even a correct code for ten minutes', !locked.ok && /10/.test(locked.error));
  await db.exec('reset role');
  const logs = await query('select * from brc.audit_log');
  check('audit records never contain submitted or successful verification secrets', !JSON.stringify(logs).includes(secret) && !JSON.stringify(logs).includes('FFFFFFFFFFFFFFFF') && !JSON.stringify(logs).includes('1234-AB'));
  await db.exec("update brc.audit_log set ts=now()-interval '11 minutes' where action='فشل تحقق إعادة الطباعة'");
  await db.exec('set role authenticated');
  check('authenticated callers can reprint after the lockout expires', (await rpc('NEW', secret)).ok);
  await db.exec('reset role');
  await db.exec(read('supabase/migrations/20261016140000_restore_original_card_issuance.sql'));
  await db.exec("insert into brc.applicants(serial) values ('RESTORED-DEFAULT')");
  check('rollback restores NULL default without rotating existing printed secrets', (await query("select card_print_code from brc.applicants where serial='RESTORED-DEFAULT'"))[0].card_print_code === null && (await query("select card_print_code from brc.applicants where serial='NEW'"))[0].card_print_code === secret);
  check('verifier has no implicit PUBLIC execute privilege', !(await query("select has_function_privilege('public','brc.verify_card_code(text,text)','execute') as allowed"))[0].allowed);
} finally { await db.close(); }

const dom = new JSDOM('<html><head></head><body><div id="modal-root"></div><div id="jobs-grid"></div><div id="print-root"></div></body></html>', { url: 'https://test.invalid/', runScripts: 'outside-only' });
try {
  const w = dom.window;
  for (const file of ['config', 'store', 'cloud', 'cloud-sync', 'qr', 'ui', 'voucher', 'booking']) w.eval(read('assets/js/' + file + '.js'));
  await w.HRCStore.init({ cloud: false });
  const S = w.HRCStore;
  /* إنشاء الاستمارات صار محمياً بجلسة موظف (2026-11-11) — نزرع جلسة
     كما يفعل الموظف على جهازه. رفض الزائر يُثبَت في client-authz. */
  const sess = { username: 'staff', name: 'موظف', role: 'staff', cloud: true };
  S.login && S.login('staff', 'staff123');
  try {
    w.sessionStorage.setItem('hrc_session_v2', JSON.stringify(sess));
  } catch (e) {
    Object.defineProperty(w, 'sessionStorage', { configurable: true, value: new Map() });
  }
  const app = S.createApplicant({ fullName: 'اسم خاص للاختبار', phone: '07700000002' });
  const other = S.createApplicant({ fullName: 'اسم آخر للاختبار', phone: '07700000003' });
  app.cardPrintCode = '7A2C9E4B1D8F6C03'; other.cardPrintCode = '8B3DAF5C2E906D14'; // Already-printed transition cards.
  const attempts = S.getAttempts(app.serial);
  check('already-issued independent-code fixtures retain their distinct verification codes', /^[A-F0-9]{16}$/.test(app.cardPrintCode) && app.cardPrintCode !== other.cardPrintCode && attempts.every((a) => a.code !== app.cardPrintCode));
  check('local new cards reject every chance code and another card secret', attempts.filter((a) => a.code).every((a) => !S.cardVerifyCode(app.serial, a.code).ok) && !S.cardVerifyCode(app.serial, other.cardPrintCode).ok);
  check('local formatted independent code authorizes reprint', S.cardVerifyCode(app.serial, app.cardPrintCode.toLowerCase().match(/.{4}/g).join('-')).ok);
  const safe = S.lookupCard(app.serial).card;
  check('local barcode lookup marks new flow without leaking secrets', safe.usesCardPrintCode === true && !JSON.stringify(safe).includes(app.cardPrintCode));
  const html = w.HRCVoucher.buildHtml(app);
  check('wallet prints exactly one secret, no chance codes or customer PII', (html.match(/class="code"/g) || []).length === 1 && html.includes(app.cardPrintCode.match(/.{4}/g).join('-')) && attempts.map((a) => a.code).filter(Boolean).every((c) => !html.includes(c)) && !/رمز الفرصة/.test(html) && !html.includes(app.fullName) && !html.includes(app.phone));
  // Exercise the actual public dialog with the newly issued card, not just APIs.
  let printed = 0;
  w.print = () => { printed++; };
  const pause = (ms = 25) => new Promise((r) => setTimeout(r, ms));
  const waitForPrint = async (count) => {
    for (let i = 0; i < 50 && printed < count; i++) await pause(20);
    assert.equal(printed, count, 'print callback must run');
  };
  w.HRCBooking.open({ serial: app.serial }); await pause();
  check('new-card status screen contains no verification secret', !w.document.querySelector('#bk-wrap').textContent.includes(app.cardPrintCode));
  w.document.querySelector('#bk-reprint').click(); await pause();
  const input = w.document.querySelector('#bk-rcode');
  input.value = attempts[0].code;
  w.document.querySelector('#bk-print-form').click(); await pause();
  check('public reprint dialog rejects opportunity codes on new cards', printed === 0 && /رمز التحقق غير صحيح/.test(w.document.querySelector('[data-bk-err="rcode"]').textContent));
  check('public customer dialog has no wallet-print button', !w.document.querySelector('#bk-print'));
  input.value = app.cardPrintCode.match(/.{4}/g).join('-');
  w.document.querySelector('#bk-print-form').click(); await waitForPrint(1);
  check('the independent code protects A4 data and prints only the form', printed === 1 && w.document.querySelector('#print-root').innerHTML.includes(app.fullName) && !w.document.querySelector('#print-root .hrc-card'));
  // RPC-only visitors have no private attempt cache. Use the verified attempts.
  const a4 = w.HRCVoucher.formHtml(other, null, [{ no: 1, slotStatus: 'reserved', jobCode: 'TEST-JOB', jobTitle: 'وظيفة من الخادم', location: 'بغداد' }]);
  const fragment = JSDOM.fragment(a4);
  const sections = [...fragment.querySelectorAll('.ff-section')];
  check('A4 has three independent numbered data sections in the right order', sections.length === 3 && sections.every((el, i) => el.querySelector('.ff-section-no').textContent === ['01', '02', '03'][i]) && sections[0].classList.contains('ff-customer') && sections[1].classList.contains('ff-job') && sections[2].classList.contains('ff-employer'));
  check('customer, job and employer fields are not mixed between sections', sections[0].textContent.includes(other.fullName) && !sections[1].textContent.includes(other.fullName) && sections[1].textContent.includes('TEST-JOB') && !sections[2].textContent.includes('TEST-JOB'));
  check('missing job and employer retain separately labelled empty sections', JSDOM.fragment(w.HRCVoucher.formHtml({ ...other, serial: 'MISSING' }, null, [])).querySelectorAll('.ff-section .ff-empty').length === 2);
  const unsafe = w.HRCVoucher.formHtml({ ...other, fullName: '<img src=x onerror=alert(1)>', address: 'عنوان '.repeat(100) }, null, []);
  check('long values wrap without truncation and user HTML stays escaped', !unsafe.includes('<img') && unsafe.includes('&lt;img') && unsafe.includes('عنوان '.repeat(100)));

  check('A4 uses verified server attempts without requiring a staff/private cache', a4.includes('وظيفة من الخادم') && a4.includes('TEST-JOB') && !a4.includes(other.cardPrintCode));
  w.HRCBooking.close();
  app.cardPrintCode = null;
  check('local legacy cards accept either previously printed opportunity code', attempts.every((a) => S.cardVerifyCode(app.serial, a.code).ok));
  const restored = S.createApplicant({ fullName: 'إصدار أصلي', phone: '07700000004' });
  const restoredAttempts = S.getAttempts(restored.serial);
  const restoredHtml = w.HRCVoucher.buildHtml(restored);
  check('new issuance uses the original opportunity codes, not an independent code', !restored.cardPrintCode && restoredAttempts.length === 2 && restoredAttempts.every((a) => restoredHtml.includes(a.code)));
  check('both original printed codes authorize reprint', restoredAttempts.every((a) => S.cardVerifyCode(restored.serial, a.code).ok));
  const C = w.HRCCloud;
  const row = C.applicantToDb(other);
  check('cloud write/read round trip retains the independent code', row.card_print_code === other.cardPrintCode && C.applicantFromDb(row).cardPrintCode === other.cardPrintCode);
  check('legacy updates omit secret, never silently rotate existing printed cards', !Object.hasOwn(C.applicantToDb(app), 'card_print_code'));
  const oldInsert = w.HRCSync.toRow({ table: 'applicants', op: 'insert', local: app });
  const oldUpdate = w.HRCSync.toRow({ table: 'applicants', op: 'update', local: app });
  const newInsert = w.HRCSync.toRow({ table: 'applicants', op: 'insert', local: other });
  check('legacy backup/import INSERT explicitly preserves NULL instead of invoking the new-code default', Object.hasOwn(oldInsert, 'card_print_code') && oldInsert.card_print_code === null);
  check('an absent code on UPDATE cannot clear an existing remote secret', !Object.hasOwn(oldUpdate, 'card_print_code'));
  check('new-card synchronization INSERT retains the already printed independent code', newInsert.card_print_code === other.cardPrintCode);
  check('original issuance UI has no confirmation gate', !/confirmIssuedCards|finishCardIssuance|confirmCardResult/.test(read('assets/js/dashboard.js')));
  const payload = { serial: other.serial, fullName: other.fullName, cardPrintCode: other.cardPrintCode, attempts: [] };
  const client = { rpc: async () => ({ data: { ok: true, data: payload } }) };
  const result = await C.verifyCardCode(client, other.serial, other.cardPrintCode);
  check('cloud verifier unwraps the real SQL payload correctly', result.ok && result.data.serial === other.serial && result.data.cardPrintCode === other.cardPrintCode);
  client.rpc = async () => ({ data: { ok: false, error: 'denied' } });
  check('cloud verifier never grants protected data on server rejection', !(await C.verifyCardCode(client, other.serial, other.cardPrintCode)).ok);
  client.rpc = async () => { throw new Error('offline'); };
  check('cloud verifier fails closed on network failure', !(await C.verifyCardCode(client, other.serial, other.cardPrintCode)).ok);
  /* البطاقات الجديدة تُوجَّه إلى صفحة التقديم التي تقرأ الباركود (لا رمز فرصة).
     المسار صار عبر goApply(s) الموحّد: يفتح apply.html?form=… مع كود الوظيفة
     إن وُجد، ويتنحّى في الملف المستقل/القرص حيث لا صفحة تقديم. */
  const bookingSrc = read('assets/js/booking.js');
  check('new-card legacy wizard routes to barcode-first application without asking for a chance code',
    /if \(card\.usesCardPrintCode && goApply\(serial\)\) return;/.test(bookingSrc) &&
    /apply\.html\?form=' \+ encodeURIComponent\(s\)/.test(bookingSrc) &&
    /function applyPageAvailable\(\)/.test(bookingSrc));
} finally { dom.window.close(); }
console.log(`\nIndependent reprint code: ${checks} checks passed.`);
