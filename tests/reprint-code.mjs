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
      entity text, entity_id text, details text
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
  await db.exec('set role anon');
  let denied = false;
  try { await query('select * from brc.applicants'); } catch (e) { denied = e.message.includes('permission denied'); }
  check('anonymous caller cannot read private applicants directly', denied);
  check('both codes on already-printed legacy cards still verify', (await rpc('LEGACY', '1234-AB')).ok && (await rpc('LEGACY', '5678-CD')).ok);
  check('new cards reject their old-style opportunity codes', !(await rpc('NEW', '2468-EF')).ok && !(await rpc('NEW', '1357-GH')).ok);
  check('another card secret cannot authorize a reprint', !(await rpc('NEW', cards[1].card_print_code)).ok);
  const verified = await rpc(' new ', secret.toLowerCase().match(/.{4}/g).join('-'));
  check('normalized independent code unlocks the protected print payload', verified.ok && verified.data.fullName === 'اسم خاص بالزبون' && verified.data.cardPrintCode === secret && verified.data.attempts.length === 2 && verified.data.address === 'عنوان خاص');
  const lookup = (await query("select brc.lookup_card('NEW') as r"))[0].r;
  check('public barcode lookup exposes capability but no secret or full PII', lookup.usesCardPrintCode === true && !JSON.stringify(lookup).includes(secret) && !JSON.stringify(lookup).includes('2468-EF') && lookup.fullName !== verified.data.fullName && lookup.phone !== verified.data.phone);
  const bad = await rpc('NEW', '0000000000000000');
  check('wrong code returns no protected payload', !bad.ok && !bad.data && !JSON.stringify(bad).includes(secret));
  check('unknown serial fails without protected payload', !(await rpc('MISSING', secret)).ok);
  // NEW has four failures above; four more reach the shared eight-attempt cap.
  for (let i = 0; i < 4; i++) await rpc('NEW', 'FFFFFFFFFFFFFFFF');
  const locked = await rpc('NEW', secret);
  check('eight failed attempts lock even a correct code for ten minutes', !locked.ok && /10/.test(locked.error));
  await db.exec('reset role');
  const logs = await query('select * from brc.audit_log');
  check('audit records never contain submitted or successful verification secrets', !JSON.stringify(logs).includes(secret) && !JSON.stringify(logs).includes('FFFFFFFFFFFFFFFF') && !JSON.stringify(logs).includes('1234-AB'));
  await db.exec("update brc.audit_log set ts=now()-interval '11 minutes' where action='فشل تحقق إعادة الطباعة'");
  await db.exec('set role authenticated');
  check('authenticated callers can reprint after the lockout expires', (await rpc('NEW', secret)).ok);
  await db.exec('reset role');
  check('verifier has no implicit PUBLIC execute privilege', !(await query("select has_function_privilege('public','brc.verify_card_code(text,text)','execute') as allowed"))[0].allowed);
} finally { await db.close(); }

const dom = new JSDOM('<html><head></head><body><div id="modal-root"></div><div id="jobs-grid"></div><div id="print-root"></div></body></html>', { url: 'https://test.invalid/', runScripts: 'outside-only' });
try {
  const w = dom.window;
  for (const file of ['config', 'store', 'cloud', 'qr', 'ui', 'voucher', 'booking']) w.eval(read('assets/js/' + file + '.js'));
  await w.HRCStore.init({ cloud: false });
  const S = w.HRCStore;
  const app = S.createApplicant({ fullName: 'اسم خاص للاختبار', phone: '07700000002' });
  const other = S.createApplicant({ fullName: 'اسم آخر للاختبار', phone: '07700000003' });
  const attempts = S.getAttempts(app.serial);
  check('local issuance generates an independent, unique secure secret', /^[A-F0-9]{16}$/.test(app.cardPrintCode) && app.cardPrintCode !== other.cardPrintCode && attempts.every((a) => a.code !== app.cardPrintCode));
  check('local new cards reject every chance code and another card secret', attempts.every((a) => !S.cardVerifyCode(app.serial, a.code).ok) && !S.cardVerifyCode(app.serial, other.cardPrintCode).ok);
  check('local formatted independent code authorizes reprint', S.cardVerifyCode(app.serial, app.cardPrintCode.toLowerCase().match(/.{4}/g).join('-')).ok);
  const safe = S.lookupCard(app.serial).card;
  check('local barcode lookup marks new flow without leaking secrets', safe.usesCardPrintCode === true && !JSON.stringify(safe).includes(app.cardPrintCode));
  const html = w.HRCVoucher.buildHtml(app);
  check('wallet prints exactly one secret, no chance codes or customer PII', (html.match(/class="code"/g) || []).length === 1 && html.includes(app.cardPrintCode.match(/.{4}/g).join('-')) && attempts.every((a) => !html.includes(a.code)) && !html.includes(app.fullName) && !html.includes(app.phone));
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
  w.document.querySelector('#bk-print').click(); await pause();
  check('public reprint dialog rejects opportunity codes on new cards', printed === 0 && /رمز التحقق غير صحيح/.test(w.document.querySelector('[data-bk-err="rcode"]').textContent));
  input.value = app.cardPrintCode.match(/.{4}/g).join('-');
  w.document.querySelector('#bk-print').click(); await waitForPrint(1);
  check('public dialog prints the wallet with its one independent code', printed === 1 && w.document.querySelector('#print-root').innerHTML.includes(input.value));
  w.document.querySelector('#bk-print-form').click(); await waitForPrint(2);
  check('the same independent code protects A4 data as well', printed === 2 && w.document.querySelector('#print-root').innerHTML.includes(app.fullName));
  // RPC-only visitors have no private attempt cache. Use the verified attempts.
  const a4 = w.HRCVoucher.formHtml(other, null, [{ no: 1, slotStatus: 'reserved', jobCode: 'TEST-JOB', jobTitle: 'وظيفة من الخادم', location: 'بغداد' }]);
  check('A4 uses verified server attempts without requiring a staff/private cache', a4.includes('وظيفة من الخادم') && a4.includes('TEST-JOB') && !a4.includes(other.cardPrintCode));
  w.HRCBooking.close();
  app.cardPrintCode = null;
  check('local legacy cards accept either previously printed opportunity code', attempts.every((a) => S.cardVerifyCode(app.serial, a.code).ok));
  const C = w.HRCCloud;
  const row = C.applicantToDb(other);
  check('cloud write/read round trip retains the independent code', row.card_print_code === other.cardPrintCode && C.applicantFromDb(row).cardPrintCode === other.cardPrintCode);
  check('legacy updates omit secret, never silently rotate existing printed cards', !Object.hasOwn(C.applicantToDb(app), 'card_print_code'));
  const payload = { serial: other.serial, fullName: other.fullName, cardPrintCode: other.cardPrintCode, attempts: [] };
  const client = { rpc: async () => ({ data: { ok: true, data: payload } }) };
  const result = await C.verifyCardCode(client, other.serial, other.cardPrintCode);
  check('cloud verifier unwraps the real SQL payload correctly', result.ok && result.data.serial === other.serial && result.data.cardPrintCode === other.cardPrintCode);
  client.rpc = async () => ({ data: { ok: false, error: 'denied' } });
  check('cloud verifier never grants protected data on server rejection', !(await C.verifyCardCode(client, other.serial, other.cardPrintCode)).ok);
  client.rpc = async () => { throw new Error('offline'); };
  check('cloud verifier fails closed on network failure', !(await C.verifyCardCode(client, other.serial, other.cardPrintCode)).ok);
  check('new-card legacy wizard routes to barcode-first application without asking for a chance code', /if \(card\.usesCardPrintCode\) \{ location\.assign\('apply\.html\?form='/.test(read('assets/js/booking.js')));
} finally { dom.window.close(); }
console.log(`\nIndependent reprint code: ${checks} checks passed.`);
