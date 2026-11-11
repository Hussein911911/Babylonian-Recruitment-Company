import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let d=new PGlite(); await d.exec(`create role anon; create role authenticated; create schema auth; create schema extensions; create schema brc;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function extensions.gen_random_bytes(int) returns bytea language sql volatile as $$select decode(substr(md5(random()::text),1,$1*2),'hex')$$;
create function brc.is_staff() returns boolean language sql as $$select auth.uid() is not null$$;
create function brc.is_admin() returns boolean language sql as $$select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid$$;
create table brc.staff(id uuid,auth_id uuid); insert into brc.staff values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
create table brc.issued_serials(serial text primary key);
create table brc.applicants(id uuid default gen_random_uuid(),serial text primary key,full_name text, phone text,address text,status text,fee_paid boolean,notes text, created_by uuid,attempt_limit int default 2, archived_at timestamptz);
create table brc.job_attempts(serial text,attempt_no int, primary key(serial,attempt_no));
create function brc.makeattempts() returns trigger language plpgsql as $$begin insert into brc.job_attempts select new.serial,g from generate_series(1,new.attempt_limit)g;insert into brc.issued_serials values(new.serial); return new;end$$;
create trigger attempts after insert on brc.applicants for each row execute function brc.makeattempts();
create view brc.working_applicants with(security_invoker=true) as select a.* from brc.applicants a where a.archived_at is null;
`); await d.exec(readFileSync('supabase/migrations/20261105120000_card_issue_numbers.sql','utf8'));
await d.exec("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false)");
const q=async (sql)=>(await d.query(sql)).rows;
const call=(id,count,serial='null')=>`select brc.issue_numbered_cards('${id}',${count},${serial},'') r`;
const id1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const first=(await q(call(id1,1,"'7KQ4M9TR2X'")))[0].r;
assert.equal(first.cards[0].card_number,1);
assert.equal(first.attempts.length,2);
assert.deepEqual((await q(call(id1,1,"'7KQ4M9TR2X'")))[0].r,first,'retry must return the same cards');
await assert.rejects(q(call('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,"'7KQ4M9TR2X'")),/مستخدم/);
assert.equal((await q('select last_number from brc.card_number_counter'))[0].last_number,1,'failed issue must roll back number');
const batch=(await q(call('cccccccc-cccc-4ccc-8ccc-cccccccccccc',8)))[0].r;
assert.deepEqual(batch.cards.map(c=>c.card_number),[2,3,4,5,6,7,8,9]);
assert.equal(batch.attempts.length,16);
await assert.rejects(q(call(id1,4)),/لا يطابق/);
await d.exec("select set_config('test.uid','33333333-3333-4333-8333-333333333333',false)");
await assert.rejects(q(call('dddddddd-dddd-4ddd-8ddd-dddddddddddd',4)),/للمدير/);
await d.exec("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false)");
// Mapping is independent of the operational row: restore/reinsert resolves it
// from the durable registry, and old rows without a mapping stay unnumbered.
await d.exec("insert into brc.applicants(serial,full_name,phone,status) values('OLD','old','','active')");
assert.equal((await q("select card_number from brc.working_applicants where serial='OLD'"))[0].card_number,null);
assert.equal((await q("select card_number from brc.working_applicants where serial='7KQ4M9TR2X'"))[0].card_number,1);
// An error after the first card in a batch rolls back its number and rows too.
await d.exec(`create function brc.test_fail_second() returns trigger language plpgsql as $$ begin if new.notes='fail' and (select count(*) from brc.applicants where notes='fail')=1 then raise exception 'forced failure'; end if; return new; end $$;
create trigger zz_test_fail before insert on brc.applicants for each row execute function brc.test_fail_second()`);
await assert.rejects(q("select brc.issue_numbered_cards('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',4,null,'fail')"),/forced failure/);
assert.equal((await q("select count(*)::int n from brc.applicants where notes='fail'"))[0].n,0);
assert.equal((await q('select last_number from brc.card_number_counter'))[0].last_number,9);
// Recovery re-inserts operational data with user triggers disabled. The durable
// mapping is still attached by the working view.
await d.exec("alter table brc.applicants disable trigger user; delete from brc.applicants where serial='7KQ4M9TR2X'; insert into brc.applicants(serial,full_name,phone,status) values('7KQ4M9TR2X','','','blank'); alter table brc.applicants enable trigger user");
assert.equal((await q("select card_number from brc.working_applicants where serial='7KQ4M9TR2X'"))[0].card_number,1);
assert.equal((await q('select last_number from brc.card_number_counter'))[0].last_number,9);
await d.close();
console.log('card numbers: single, batch, rollback, retry, permissions and old cards passed');
