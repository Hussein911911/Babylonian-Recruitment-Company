import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try {
 await db.exec(`create schema brc;create role anon;create role authenticated;grant usage on schema brc to anon,authenticated;
 create table brc.applicants(serial text primary key,full_name text,phone text,address text,dob date,gender text,nationality text,status text,issue_date timestamptz,expiry_date timestamptz);
 create table brc.jobs(id uuid primary key,code text,title text,governorate text,employer_name text,employer_phone text,employer_address text,interview_location text,shift text,salary_min int,salary_max int);
 create table brc.job_attempts(id uuid,serial text,attempt_no int,slot_status text,job_id uuid,job_code text,selected_at timestamptz,hold_expires_at timestamptz);
 insert into brc.applicants values ('CARD1','صاحب البطاقة','07700000001','بابل','2000-01-01','ذكر','عراقي','active',now(),now()+interval '30 days'),('CARD2','زبون آخر','07700000002','بابل','2000-01-01','ذكر','عراقي','active',now(),now()),('BLANK','','','','2000-01-01','ذكر','','blank',null,null);
 insert into brc.jobs values ('00000000-0000-0000-0000-000000000001','J1','الوظيفة الأولى','بابل','جهة أولى','07711111111','عنوان أول','مقابلة أولى','صباحي',500,700),('00000000-0000-0000-0000-000000000002','J2','الوظيفة الثانية','بغداد','جهة ثانية','07722222222','عنوان ثان','مقابلة ثانية','مسائي',800,900);
 insert into brc.job_attempts values ('00000000-0000-0000-0000-000000000011','CARD1',1,'reserved','00000000-0000-0000-0000-000000000001','J1',now(),now()),('00000000-0000-0000-0000-000000000012','CARD1',2,'empty',null,null,null,null),('00000000-0000-0000-0000-000000000013','CARD2',1,'reserved','00000000-0000-0000-0000-000000000002','J2',now(),now());`);
 const sql=readFileSync(new URL('../supabase/migrations/20261030110000_customer_application_details.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 await db.exec('set role anon');
 const get=async(s,n)=>(await db.query('select brc.customer_application_details($1,$2) x',[s,n])).rows[0].x;
 const a=await get(' card1 ',1);assert.equal(a.ok,true);assert.equal(a.app.fullName,'صاحب البطاقة');assert.equal(a.attempt.employerName,'جهة أولى');assert.equal(a.attempt.interviewLocation,'مقابلة أولى');
 assert.equal((await get('CARD1',2)).ok,false);assert.equal((await get('CARD1',3)).ok,false);assert.equal((await get('BLANK',1)).ok,false);assert.equal((await get('BAD',1)).ok,false);
 const b=await get('CARD2',1);assert.equal(b.attempt.employerName,'جهة ثانية');assert.ok(!JSON.stringify(a).includes('جهة ثانية'));
 await assert.rejects(()=>db.exec('select * from brc.jobs'),/permission denied/);
 await db.exec('reset role');await db.exec("update brc.job_attempts set job_code='J2' where serial='CARD1' and attempt_no=1");assert.equal((await get('CARD1',1)).ok,false);
 await db.exec("update brc.job_attempts set job_code='J1',job_id=null where serial='CARD1' and attempt_no=1");assert.equal((await get('CARD1',1)).ok,false);
 console.log('PASS SQL: exact card and chance, two distinct jobs, no unused/other/deleted job data, no direct table access, idempotent migration.');
} finally {await db.close()}
