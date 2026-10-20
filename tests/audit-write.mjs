// Real isolated PostgreSQL: audit privileges, RLS, minimal writes and trigger-created slots.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log('  ✅ ' + name); };
const db = new PGlite();
const calls = [];
const client = { from(table) {
  assert.ok(['audit_log', 'job_attempts', 'applicants'].includes(table));
  let op = 'select', row, returning = false;
  const filters = [];
  const q = {
    insert(r) { op = 'insert'; row = r; return q; },
    select() { returning = true; return q; },
    update(r) { op = 'update'; row = r; return q; },
    eq(k, v) { filters.push([k, v]); return q; },
    then(resolve, reject) {
      calls.push({ table, op, returning });
      const run = async () => {
        try {
          let sql, params;
          if (op === 'insert') {
            const keys = Object.keys(row);
            keys.forEach((k) => assert.match(k, /^[a-z_]+$/));
            params = keys.map((k) => row[k]);
            sql = `insert into brc.${table} (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')})` + (returning ? ' returning *' : '');
          } else if (op === 'update') {
            const keys = Object.keys(row);
            params = [...keys.map((k) => row[k]), ...filters.map(([,v]) => v)];
            sql = `update brc.${table} set ` + keys.map((k,i) => `${k}=$${i+1}`).join(',') + ' where ' + filters.map(([k],i) => `${k}=$${keys.length+i+1}`).join(' and ') + (returning ? ' returning *' : '');
          } else {
            filters.forEach(([k]) => assert.match(k, /^[a-z_]+$/));
            params = filters.map(([, v]) => v);
            sql = `select * from brc.${table}` + (filters.length ? ' where ' + filters.map(([k], i) => `${k}=$${i + 1}`).join(' and ') : '');
          }
          const result = await db.query(sql, params);
          return { data: op === 'insert' && !returning ? null : result.rows, error: null };
        } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
      };
      return run().then(resolve, reject);
    }
  };
  return q;
} };
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema brc; create schema auth;
    grant usage on schema brc,auth to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_uid',true),'')::uuid $$;
    create table brc.staff(id uuid,auth_id uuid,username text,role text,active boolean);
    insert into brc.staff values ('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','employee','staff',true);
    grant select on brc.staff to authenticated;
    create function brc.is_staff() returns boolean language sql security definer as $$ select exists(select 1 from brc.staff where auth_id=auth.uid() and active) $$;
    create function brc.is_admin() returns boolean language sql security definer as $$ select exists(select 1 from brc.staff where auth_id=auth.uid() and active and role='admin') $$;
    create table brc.audit_log(id bigserial primary key,ts timestamptz default now(),username text,role text,ip text,action text,entity text,entity_id text,details text);
    alter table brc.audit_log enable row level security;
    grant select,insert on brc.audit_log to authenticated;
  `);
  const schema = read('docs/schema.sql');
  await db.exec(schema.slice(schema.indexOf('drop policy if exists audit_read'), schema.indexOf('-- 8.6')));
  await db.exec("set role authenticated; set app.test_uid='11111111-1111-4111-8111-111111111111'");
  const before = await client.from('audit_log').insert({ username: 'employee', action: 'اختبار قبل التحديث' });
  check('reproduces 42501 from missing bigserial sequence privilege despite INSERT grant', before.error?.code === '42501' && /sequence/.test(before.error.message));
  await db.exec('reset role');
  const migration = read('supabase/migrations/20261016120000_audit_insert_sequence_grant.sql');
  await db.exec(migration); await db.exec(migration);
  await db.exec('set role authenticated');
  const root = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  for (const file of ['cloud', 'cloud-sync']) new Function('window', read(`assets/js/${file}.js`))(root);
  const S = root.HRCSync;
  const event = { table: 'audit_log', op: 'insert', key: 'local-event', local: { user: 'system', role: 'system', action: 'حدث نظام محلي', entity: 'applicant', entityId: 'CARD' } };
  const returned = await client.from('audit_log').insert(root.HRCCloud.auditToDb(event.local)).select();
  check('reproduces INSERT RETURNING rejection for permitted system write hidden by read policy', returned.error?.code === '42501');
  await S.executeOne(client, event);
  check('real sync writes permitted audit event without requesting hidden row back', calls.at(-1).op === 'insert' && !calls.at(-1).returning);
  const visible = await client.from('audit_log').select();
  check('normal employee still cannot read system or other-user audit rows', !visible.error && visible.data.length === 0);
  let denied = false;
  try { await S.executeOne(client, { ...event, local: { ...event.local, user: 'another-employee' } }); } catch (e) { denied = e.__brc?.code === '42501'; }
  check('audit actor-spoofing remains rejected by RLS', denied);
  await db.exec('reset role');
  const logs = (await db.query('select * from brc.audit_log')).rows;
  check('minimal write actually persisted, rejected RETURNING did not leave duplicate rows', logs.length === 1 && logs[0].username === 'system');
  check('sequence migration grants no anonymous privilege', !(await db.query("select has_sequence_privilege('anon','brc.audit_log_id_seq','usage') as allowed")).rows[0].allowed);
  await db.exec("update brc.staff set active=false; set role authenticated");
  denied = false;
  try { await S.executeOne(client, event); } catch (e) { denied = e.__brc?.code === '42501'; }
  check('disabled staff still cannot append audit events', denied);
  await db.exec(`reset role; update brc.staff set active=true;
    create table brc.applicants(serial text primary key,attempt_limit integer);
    create table brc.job_attempts(serial text references brc.applicants(serial),attempt_no integer,
      chance_code text default '9876-AB' unique,slot_status text default 'empty',job_id uuid,job_code text,
      selected_at timestamptz,hold_expires_at timestamptz,closed_at timestamptz,outcome_note text,
      employer_decision text,decision_at timestamptz,employer_reason text,unique(serial,attempt_no));
    grant select,insert,update on brc.job_attempts to authenticated;`);
  const makeSlots = schema.match(/create or replace function brc\.trg_make_attempts\(\)[\s\S]*?end \$\$;/)[0];
  await db.exec(makeSlots + `create trigger real_make_slots after insert on brc.applicants for each row execute function brc.trg_make_attempts();
    insert into brc.applicants values ('CARD',1); set role authenticated;`);
  const slot = { table: 'job_attempts', op: 'insert', key: 'CARD:1', independentCard: true, local: { serial: 'CARD', no: 1, slotStatus: 'empty', code: '1234-CD' } };
  await S.executeOne(client, slot);
  check('new independent-code card reconciles a slot already created by the real AFTER INSERT trigger', slot.local.code === '9876-AB');
  check('slot reconciliation does not duplicate or overwrite server opportunity', (await db.query("select * from brc.job_attempts where serial='CARD'")).rows.length === 1);
  await db.exec("reset role; update brc.job_attempts set slot_status='reserved' where serial='CARD'; set role authenticated");
  denied = false;
  try { await S.executeOne(client, slot); } catch { denied = true; }
  check('a reserved opportunity cannot be mistaken for an empty new slot', denied);
  await db.exec("reset role; update brc.job_attempts set slot_status='empty' where serial='CARD'; set role authenticated");
  denied = false;
  try { await S.executeOne(client, { ...slot, independentCard: false }); } catch { denied = true; }
  check('legacy printed chance codes are never silently replaced during reconciliation', denied);
  await S.executeOne(client, { ...slot, independentCard: false, freshCard: true, local: { ...slot.local, code: '2468-CD' } });
  check('fresh original card keeps its printed chance code when the server trigger already made its slot', (await db.query("select chance_code from brc.job_attempts where serial='CARD'")).rows[0].chance_code === '2468-CD');
  await db.exec(`reset role; drop trigger real_make_slots on brc.applicants;
    alter table brc.applicants add column full_name text, add column phone text, add column address text,
      add column dob date, add column gender text, add column nationality text, add column status text,
      add column fee_amount integer, add column fee_paid boolean, add column printed_count integer,
      add column notes text, add column reject_reason text, add column requested_code text;
    grant insert,select on brc.applicants to authenticated; set role authenticated;`);
  const originalCard = { serial: 'URTA92G6E8', fullName: '', phone: '', status: 'blank', attemptLimit: 2 };
  await S.executeOne(client, { table: 'applicants', op: 'insert', key: originalCard.serial, local: originalCard });
  check('original card saves against pre-single-code PostgreSQL schema without requiring a new column', (await db.query("select serial from brc.applicants where serial='URTA92G6E8'")).rows[0].serial === originalCard.serial);
  check('old-schema compatibility retries keep the exact printed serial and only make one record', (await db.query("select count(*)::int as n from brc.applicants where serial='URTA92G6E8'")).rows[0].n === 1);
  denied = false;
  try { await S.executeOne(client, { table: 'applicants', op: 'insert', key: 'TRANSITION', local: { ...originalCard, serial: 'TRANSITION', cardPrintCode: '7A2C9E4B1D8F6C03' } }); } catch { denied = true; }
  check('a real independently printed secret is never dropped by old-schema fallback', denied && (await db.query("select serial from brc.applicants where serial='TRANSITION'")).rows.length === 0);

} finally { await db.close(); }
console.log(`Audit/issuance PostgreSQL: ${passed} checks passed.`);
