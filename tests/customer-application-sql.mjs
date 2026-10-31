import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try {
 await db.exec(`create schema brc;create role anon;create role authenticated;grant usage on schema brc to anon,authenticated;
 create table brc.applicants(serial text primary key,full_name text,phone text,address text,dob date,gender text,nationality text,status text,issue_date timestamptz,expiry_date timestamptz);
 create table brc.jobs(id uuid primary key,code text,title text,governorate text,employer_name text,employer_phone text,employer_address text,interview_location text,shift text,salary_min int,salary_max int);
 create table brc.job_attempts(id uuid primary key,serial text,attempt_no int,slot_status text,job_id uuid references brc.jobs(id) on delete set null,job_code text,selected_at timestamptz,hold_expires_at timestamptz, outcome_note text default '');
 create view brc.working_applicants as select * from brc.applicants;
 create view brc.working_job_attempts with(security_invoker=true) as select t.* from brc.job_attempts t join brc.working_applicants a on a.serial=t.serial;
 create table brc.audit_log(username text,role text,action text,entity text,entity_id text,details text);
 create function brc.mask_name(text) returns text language sql as $$select 'masked'::text$$;
 create function brc.mask_phone(text) returns text language sql as $$select 'masked'::text$$;
 insert into brc.applicants values ('CARD1','صاحب البطاقة','07700000001','بابل','2000-01-01','ذكر','عراقي','active',now(),now()+interval '30 days'),('CARD2','زبون آخر','07700000002','بابل','2000-01-01','ذكر','عراقي','active',now(),now()),('BLANK','','','','2000-01-01','ذكر','','blank',null,null);
 insert into brc.jobs values ('00000000-0000-0000-0000-000000000001','J1','الوظيفة الأولى','بابل','جهة أولى','07711111111','عنوان أول','مقابلة أولى','صباحي',500,700),('00000000-0000-0000-0000-000000000002','J2','الوظيفة الثانية','بغداد','جهة ثانية','07722222222','عنوان ثان','مقابلة ثانية','مسائي',800,900);
 insert into brc.job_attempts(id,serial,attempt_no,slot_status,job_id,job_code,selected_at,hold_expires_at) values ('00000000-0000-0000-0000-000000000011','CARD1',1,'reserved','00000000-0000-0000-0000-000000000001','J1',now(),now()),('00000000-0000-0000-0000-000000000012','CARD1',2,'empty',null,null,null,null),('00000000-0000-0000-0000-000000000013','CARD2',1,'reserved','00000000-0000-0000-0000-000000000002','J2',now(),now());`);
 await db.exec(`create table brc.test_trigger_events(name text);
 create function brc.test_update_trigger() returns trigger language plpgsql as $$begin insert into brc.test_trigger_events values(TG_NAME);return new;end$$;
 create trigger trg_audit_attempts after update on brc.job_attempts for each row execute function brc.test_update_trigger();
 create trigger recovery_remember_chances after update on brc.job_attempts for each row execute function brc.test_update_trigger();
 create trigger trg_sync_vacancies after update on brc.job_attempts for each row execute function brc.test_update_trigger();
 alter table brc.job_attempts enable always trigger trg_audit_attempts;`);
 const sql=readFileSync(new URL('../supabase/migrations/20261030110000_customer_application_details.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 const preserve=readFileSync(new URL('../supabase/migrations/20261030120000_preserve_application_job_details.sql',import.meta.url),'utf8');await db.exec(preserve);await db.exec(preserve);
 const blankLookup=readFileSync(new URL('../supabase/migrations/20261031120000_blank_card_lookup.sql',import.meta.url),'utf8');await db.exec(blankLookup);await db.exec(blankLookup);
 assert.equal(Number((await db.query('select count(*) n from brc.test_trigger_events')).rows[0].n),0,'backfill must not fire audit or job sync');
 const states=(await db.query("select tgname,tgenabled from pg_trigger where tgrelid='brc.job_attempts'::regclass and tgname in ('recovery_remember_chances','trg_audit_attempts','trg_sync_vacancies') order by tgname")).rows;
 assert.deepEqual(states.map(x=>x.tgenabled),['O','A','O']);

 await db.exec("update brc.applicants set full_name='SECRET',phone='SECRET' where serial='BLANK'");
 await db.exec("insert into brc.job_attempts(id,serial,attempt_no,slot_status) values ('00000000-0000-0000-0000-000000000014','BLANK',1,'empty'),('00000000-0000-0000-0000-000000000015','BLANK',2,'empty')");
 await db.exec('set role anon');
 const blank=(await db.query("select brc.lookup_card(' blank ') as x")).rows[0].x;
 assert.equal(blank.ok,true);assert.equal(blank.status,'blank');assert.equal(blank.chancesLeft,2);assert.equal(blank.chances.length,2);assert.ok(!JSON.stringify(blank).includes('SECRET'));assert.equal(blank.issueDate,null);
 assert.equal((await db.query("select brc.lookup_card('MISSING') as x")).rows[0].x.ok,false);

 const get=async(s,n)=>(await db.query('select brc.customer_application_details($1,$2) x',[s,n])).rows[0].x;
 const a=await get(' card1 ',1);assert.equal(a.ok,true);assert.equal(a.app.fullName,'صاحب البطاقة');assert.equal(a.attempt.employerName,'جهة أولى');assert.equal(a.attempt.interviewLocation,'مقابلة أولى');
 assert.equal((await get('CARD1',2)).ok,false);assert.equal((await get('CARD1',3)).ok,false);assert.equal((await get('BLANK',1)).ok,false);assert.equal((await get('BAD',1)).ok,false);
 const b=await get('CARD2',1);assert.equal(b.attempt.employerName,'جهة ثانية');assert.ok(!JSON.stringify(a).includes('جهة ثانية'));
 await assert.rejects(()=>db.exec('select * from brc.jobs'),/permission denied/);
 await db.exec('reset role');await db.exec("update brc.job_attempts set job_code='J2' where serial='CARD1' and attempt_no=1");assert.equal((await get('CARD1',1)).ok,false);
 await db.exec("update brc.job_attempts set job_code='J1' where serial='CARD1' and attempt_no=1");
 await db.exec("delete from brc.jobs where code='J1'");
 const archived=await get('CARD1',1);assert.equal(archived.ok,true);assert.equal(archived.attempt.employerName,'جهة أولى');assert.equal(archived.attempt.interviewLocation,'مقابلة أولى');
 const lookup=(await db.query("select brc.lookup_card('CARD1') as x")).rows[0].x;
 assert.equal(lookup.chances[0].jobTitle,'الوظيفة الأولى');
 await db.exec("insert into brc.jobs(id,code,title,employer_name) values('00000000-0000-0000-0000-000000000003','J1','مختلفة','جهة خاطئة')");
 assert.equal((await get('CARD1',1)).attempt.employerName,'جهة أولى');
 await db.exec("update brc.job_attempts set job_snapshot=null where serial='CARD1' and attempt_no=1");
 assert.equal((await get('CARD1',1)).attempt.employerName,'جهة أولى');
 // A fresh application is snapshotted by the trigger and keeps its own job.
 await db.exec("update brc.job_attempts set job_id='00000000-0000-0000-0000-000000000002',job_code='J2',slot_status='reserved',selected_at=now() where serial='CARD1' and attempt_no=2");
 assert.equal((await get('CARD1',2)).attempt.employerName,'جهة ثانية');
 await db.exec("delete from brc.jobs where code='J2'");
 assert.equal((await get('CARD1',2)).attempt.employerName,'جهة ثانية');
 assert.equal((await get('CARD1',1)).attempt.employerName,'جهة أولى');
 // Backup restoration of a deleted job keeps its original snapshot on INSERT.
 const saved=(await db.query("select row_to_json(a) x from brc.job_attempts a where serial='CARD1' and attempt_no=2")).rows[0].x;
 await db.exec("delete from brc.job_attempts where serial='CARD1' and attempt_no=2");
 await db.query("insert into brc.job_attempts select * from jsonb_populate_record(null::brc.job_attempts,$1::jsonb)",[JSON.stringify(saved)]);
 assert.equal((await get('CARD1',2)).attempt.employerName,'جهة ثانية');
 console.log('PASS SQL: exact card and chance, two distinct jobs, unused/other jobs blocked, deleted job retained, reused code isolated, no direct table access, idempotent migration.');
} finally {await db.close()}
