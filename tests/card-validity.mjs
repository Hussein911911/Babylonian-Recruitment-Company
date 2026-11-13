// First-application validity: real SQL upgrade and local store, no production database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { JSDOM } from 'jsdom';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const schema = read('docs/schema.sql');
const def = name => { const i = schema.indexOf('create or replace function brc.' + name + '('); return schema.slice(i, schema.indexOf('end $$;', i) + 7); };
const db = new PGlite();
const data = { fullName:'أحمد محمد علي', phone:'07712345678', province:'بابل', district:'الحلة', landmark:'السوق', dob:'2000-01-01', gender:'ذكر' };
const rpc = async (name, args) => (await db.query(`select brc.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
const row = async serial => (await db.query('select status, issue_date, expiry_date from brc.applicants where serial=$1', [serial])).rows[0];
try {
  const fixture = read('tests/card-identity.mjs').match(/await db.exec\(`([\s\S]*?)`\);/)[1];
  await db.exec(fixture);
  await db.exec(`alter table brc.jobs add column manual_closed boolean default false, add column filled_vacancy_numbers int[] default '{}';
    alter table brc.job_attempts add column vacancy_no int;
    create table brc.office_receipts(operation_id uuid, actor uuid, request_hash text, result jsonb);
    create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function brc.is_staff() returns boolean language sql as $$select true$$;`);
  for (const name of ['chance_code', 'mask_name', 'ensure_card_attempts', 'use_chance', 'self_service_card']) await db.exec(def(name));
  await db.exec("insert into brc.applicants(serial,status,issue_date,expiry_date) values('OLD','active','2026-01-01','2026-01-31')");
  const old = await row('OLD');
  const migration = read('supabase/migrations/20261029100000_validity_from_first_application.sql');
  await db.exec(migration); await db.exec(migration);
  // Direct sale is no longer public; callers use the validated self-service RPC.
  await db.exec('grant usage on schema brc to anon, authenticated');
  const removeSale = read('supabase/migrations/20261030100000_remove_direct_card_sale.sql');
  await db.exec(removeSale); await db.exec(removeSale);
  assert.equal((await db.query("select has_function_privilege('anon', 'brc.activate_card(text,jsonb)', 'execute') as allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_function_privilege('authenticated', 'brc.activate_card(text,jsonb)', 'execute') as allowed")).rows[0].allowed, false);
  assert.equal(String((await row('OLD')).expiry_date), String(old.expiry_date));
  await db.exec(`create trigger reserve_job before insert or update on brc.job_attempts for each row execute function brc.trg_attempt_hold();
    insert into brc.jobs(code) values('JOB-1'),('JOB-2'),('JOB-3'),('JOB-4');
    update brc.jobs set vacancies=1 where code='JOB-1';
    insert into brc.applicants(serial) values('SELF'),('SOLD'),('FAIL'),('FULL'),('ONSALE');`);
  for (const serial of ['SELF', 'SOLD', 'FAIL', 'FULL', 'ONSALE']) await rpc('self_service_card', [serial, null]);
  for (const count of [1,3,5]) {
    const serial='LIMIT'+count;
    await db.query('insert into brc.applicants(serial,attempt_limit) values($1,$2)',[serial,count]);
    const info=await rpc('self_service_card',[serial,null]);
    assert.equal(info.card.chances.length,count);assert.equal(info.card.chancesLeft,count);
    assert.equal((await row(serial)).expiry_date,null);
  }
  const bad = await rpc('apply_with_card', ['FAIL', 'MISSING', JSON.stringify(data)]);
  assert.equal(bad.ok, false); assert.equal((await row('FAIL')).expiry_date, null);
  const sale = await rpc('activate_card', ['SOLD', JSON.stringify({ ...data, posName:'نقطة بيع' })]);
  assert.equal(sale.ok, true); assert.equal((await row('SOLD')).status, 'active'); assert.equal((await row('SOLD')).expiry_date, null);
  const soldBad = await rpc('apply_with_card', ['SOLD', 'MISSING', JSON.stringify(data)]);
  assert.equal(soldBad.ok, false); assert.equal((await row('SOLD')).expiry_date, null);
  const first = await rpc('apply_with_card', ['SOLD', 'JOB-1', JSON.stringify(data)]);
  assert.equal(first.ok, true, JSON.stringify(first));
  const started = await row('SOLD');
  assert.ok(started.issue_date && started.expiry_date);
  assert.equal((new Date(started.expiry_date) - new Date(started.issue_date)) / 86400000, 30);
  const full = await rpc('apply_with_card', ['FULL', 'JOB-1', JSON.stringify(data)]);
  assert.equal(full.ok, false); assert.equal((await row('FULL')).expiry_date, null);
  const second = await rpc('apply_with_card', ['SOLD', 'JOB-2', JSON.stringify(data)]);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(String((await row('SOLD')).expiry_date), String(started.expiry_date));
  await db.exec('set role anon');
  await assert.rejects(() => rpc('activate_card', ['SELF', JSON.stringify({...data, posName:'تجربة'})]), /permission denied/);
  const self = await rpc('apply_with_card', ['SELF', 'JOB-3', JSON.stringify(data)]);
  await db.exec('reset role');
  assert.equal(self.ok, true, JSON.stringify(self)); assert.ok((await row('SELF')).expiry_date);
  await db.exec("update brc.settings set value=jsonb_set(value, '{validity_days}', '17') where key='rules'");
  const onSale = await rpc('activate_card', ['ONSALE', JSON.stringify({ ...data, posName:'نقطة بيع', jobCode:'JOB-4' })]);
  assert.equal(onSale.ok, true, JSON.stringify(onSale));
  const saleDates = await row('ONSALE');
  assert.equal((new Date(saleDates.expiry_date) - new Date(saleDates.issue_date)) / 86400000, 17);
  console.log('SQL: blank, sale without job, failure, first and second successful applications passed.');
} finally { await db.close(); }

const dom = new JSDOM('<!doctype html>', { url:'https://example.com', runScripts:'outside-only' });
try {
  const w = dom.window;
  w.__HRC_TEST_SEED__ = JSON.parse(JSON.stringify(DEMO_SEED));
  w.eval(read('assets/js/config.js')); w.HRC_CONFIG.users = [{username:'admin', password:'admin123', name:'مدير اختبار', role:'admin'}]; w.eval(read('assets/js/store.js'));
  const store = w.HRCStore; store.init(); store.login('admin','admin123');
  for (const [n, serial] of [[1,'7AAA222AAA'],[3,'7AAA333AAA'],[5,'7AAA555AAA']]) {
    store.updateSettings({attemptLimit:n});
    const c=store.createCardWithSerial(serial,'اختبار الفرص');assert.equal(c.ok,true);
    assert.equal(c.card.attemptLimit,n);assert.equal(store.getAttempts(serial).length,n);
  }
  store.updateSettings({attemptLimit:2});
  for (const [n, serial] of [[1,'7AAA222AAA'],[3,'7AAA333AAA'],[5,'7AAA555AAA']]) assert.equal(store.getAttempts(serial).length,n,'existing card count remains frozen');
  const created = store.createCardWithSerial('9TRX2KQ4M7', 'اختبار');
  assert.equal(created.ok, true);
  const sold = store.activateCard(created.card.serial, { fullName:'أحمد محمد علي', phone:'07712345678' });
  assert.equal(sold.ok, true); assert.equal(sold.app.issueDate, null); assert.equal(sold.app.expiryDate, null);
  store.runMaintenance(); assert.equal(store.formStatus(sold.app), 'active');
  assert.equal(store.selectAttempt(sold.app.serial, 'MISSING').ok, false); assert.equal(sold.app.expiryDate, null);
  const jobs = store.listJobs().filter(j => j.status === 'available').slice(0, 2);
  assert.equal(jobs.length, 2);
  assert.equal(store.selectAttempt(sold.app.serial, jobs[0].code).ok, true);
  assert.equal((new Date(sold.app.expiryDate) - new Date(sold.app.issueDate)) / 86400000, 30);
  const expiry = sold.app.expiryDate;
  assert.equal(store.selectAttempt(sold.app.serial, jobs[1].code).ok, true);
  assert.equal(sold.app.expiryDate, expiry);
  console.log('Local store: sale, failed attempt, first/second successful applications and maintenance passed.');
} finally { dom.window.close(); }
