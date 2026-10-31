// Real SQL; synthetic rows, no production requests or restores.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite();let checks=0;
function check(name,value){assert.ok(value,name);checks++;console.log('✓ '+name);}
const history=async(q='',page=0)=>(await db.query('select brc.staff_card_history($1,$2) d',[q,page])).rows[0].d;
const archived=async serial=>(await db.query('select archived_at from brc.applicants where serial=$1',[serial])).rows[0].archived_at;
try{
 const fixture=read('tests/card-identity.mjs').match(/await db.exec\(`([\s\S]*?)`\);/)[1];await db.exec(fixture);
 await db.exec(`alter table brc.applicants add created_at timestamptz default now(),add updated_at timestamptz default now(),add created_by uuid,add printed_count integer default 0;
 create table brc.staff(id uuid primary key,full_name text);create table brc.issued_serials(serial text primary key);insert into brc.issued_serials values('DELETED-CODE');
 alter table brc.jobs add filled_vacancy_numbers integer[] default '{}';
 alter table brc.job_attempts add unique(chance_code),add vacancy_no int,add employer_decision text,add employer_reason text;
 create function brc.is_staff() returns boolean language sql stable as $$select current_setting('test.staff',true)='yes'$$;
 grant select,insert,update on brc.applicants to authenticated;grant select on brc.job_attempts,brc.jobs to authenticated;
 insert into brc.jobs(code,status,created_at,closed_at,filled_vacancy_numbers) values('OLD-JOB','closed',now()-interval '100 days',now()-interval '70 days','{1,2}');
 insert into brc.applicants(serial,status,full_name,phone,expiry_date,attempt_limit) values
 ('OLD','exhausted','اسم 100% محفوظ','07700000001',now()+interval '10 days',2),
 ('RECENT','exhausted','اسم حديث','07700000002',now()-interval '10 days',2),
 ('LATE','exhausted','حسم متأخر','07700000003',now()-interval '80 days',2),
 ('EXPIRED','expired','منتهية','07700000004',now()-interval '61 days',2),
 ('BLANK','blank','','',null,2),('PENDING','pending','طلب','',now()-interval '100 days',2),
 ('MISSING','exhausted','تاريخ ناقص','',now()-interval '100 days',2),
 ('LIMIT3','active','ثلاث فرص','',now()+interval '10 days',3);
 insert into brc.job_attempts(serial,attempt_no,slot_status,closed_at,chance_code,job_id,job_code,vacancy_no)
 select a.serial,n,'succeeded',now()-interval '61 days','SECRET-'||a.serial||n,j.id,j.code,n from brc.applicants a cross join generate_series(1,2)n cross join brc.jobs j where a.serial in('OLD','RECENT','LATE','MISSING','LIMIT3');
 update brc.job_attempts set closed_at=now()-interval '59 days' where serial='RECENT';
 update brc.job_attempts set closed_at=now()-interval '1 day',selected_at=now()-interval '90 days' where serial='LATE';
 update brc.job_attempts set closed_at=null where serial='MISSING';
 insert into brc.job_attempts(serial,attempt_no,slot_status,chance_code) select serial,3,'empty','SECRET-LIMIT3' from brc.applicants where serial='LIMIT3';
 insert into brc.job_attempts(serial,attempt_no,slot_status,chance_code) select 'EXPIRED',n,'empty','SECRET-EXPIRED'||n from generate_series(1,2)n;
 insert into brc.applicants(serial,status,full_name,expiry_date) select 'WAIT-'||s,'expired','معلق',now()-interval '100 days' from unnest(array['reserved','critical','hiring'])s;
 insert into brc.job_attempts(serial,attempt_no,slot_status,selected_at,chance_code) select 'WAIT-'||s,1,s,now()-interval '90 days','SECRET-'||s from unnest(array['reserved','critical','hiring'])s;
 insert into brc.applicants(serial,status,full_name) select 'PAGE-'||n,'blank','بطاقة محفوظة' from generate_series(1,65)n;`);
 await db.exec("alter table brc.applicants enable row level security;create policy staff_cards on brc.applicants for all to authenticated using(brc.is_staff()) with check(brc.is_staff());");
 await db.exec("insert into brc.applicants(serial,status) values('REG-1','blank'),('REG-2','blank'),('REG-3','blank');insert into brc.job_attempts(serial,attempt_no,chance_code) values('REG-1',1,'1000-AA'),('REG-2',1,'9999-ZZ'),('REG-3',1,'4321-MN');");
 const before=(await db.query("select (select count(*) from brc.applicants) cards,(select md5(jsonb_agg(to_jsonb(t) order by t.serial,t.attempt_no)::text) from brc.job_attempts t) attempts,(select md5(jsonb_agg(to_jsonb(j) order by j.id)::text) from brc.jobs j) jobs")).rows[0];
 const sql=read('supabase/migrations/20261020120000_card_retention_workspace.sql');await db.exec(sql);
 check('consumed card archives 60 days after final decision, not future expiry',!!await archived('OLD'));
 check('59-day resolved card remains in working set',!await archived('RECENT'));
 check('late company decision starts a new full review period',!await archived('LATE'));
 check('expired unused card archives without consuming its empty opportunities',!!await archived('EXPIRED'));
 for(const serial of ['BLANK','PENDING','MISSING','LIMIT3','WAIT-reserved','WAIT-critical','WAIT-hiring'])check(serial+' is never prematurely archived',!await archived(serial));
 const stamp=String(await archived('OLD'));await db.exec(sql);check('reinstallation preserves original archive date',String(await archived('OLD'))===stamp);
 const after=(await db.query("select (select count(*) from brc.applicants) cards,(select md5(jsonb_agg(to_jsonb(t) order by t.serial,t.attempt_no)::text) from brc.job_attempts t) attempts,(select md5(jsonb_agg(to_jsonb(j) order by j.id)::text) from brc.jobs j) jobs")).rows[0];check('all cards, opportunity secrets/statuses and filled vacancy ledgers unchanged',JSON.stringify(after)===JSON.stringify(before));
 await db.exec("set role anon");await assert.rejects(()=>db.query('select * from brc.working_applicants'));check('anonymous cannot read working views',true);await assert.rejects(()=>history('OLD'));check('anonymous cannot call historical search',true);await assert.rejects(()=>db.query('select brc.staff_issuance_registry()'));check('anonymous cannot read printed-code registry',true);await db.exec('reset role');
 await db.exec("set role authenticated;set test.staff='yes'");
 check('working cards exclude archive',(await db.query("select count(*)::int n from brc.working_applicants where serial in('OLD','EXPIRED')")).rows[0].n===0);
 check('working chances exclude archived cards',(await db.query("select count(*)::int n from brc.working_job_attempts where serial='OLD'")).rows[0].n===0);
 const registry=(await db.query('select brc.staff_issuance_registry() d')).rows[0].d;const bitmap=Buffer.from(registry.bitmap,'base64');check('chance registry has fixed exact size and boundary bits',bitmap.length===595125&&(bitmap[0]&1)&&(bitmap[595124]&128));
 const mid=(4321-1000)*529+'ABCDEFGHJKMNPQRSTUVWXYZ'.indexOf('M')*23+'ABCDEFGHJKMNPQRSTUVWXYZ'.indexOf('N');check('SQL bitmap uses the same byte/bit mapping as browser',!!(bitmap[mid>>3]&(1<<(mid%8))));
 check('deleted printed identifiers remain reserved',(await db.query("select brc.staff_issuance_registry('DELETED-CODE') d")).rows[0].d.used);check('archived identifiers remain reserved',(await db.query("select brc.staff_issuance_registry('OLD') d")).rows[0].d.used);
 const found=await history('OLD');check('archived card still searchable with exact opportunity/vacancy',found.cards.length===1&&found.cards[0].archivedAt&&found.cards[0].attempts[1].vacancyNo===2);
 check('history search ignores serial letter case',JSON.stringify((await history('old')).cards)===JSON.stringify(found.cards) && JSON.stringify((await history('OlD')).cards)===JSON.stringify(found.cards));
 const report=(await db.query('select brc.staff_card_report() d')).rows[0].d;check('lifetime statistics include archived cards',report.stats.forms===before.cards&&report.stats.hires===10);check('financial totals include archived cards',report.rows.reduce((n,r)=>n+Number(r.forms),0)===before.cards);
 await db.exec("reset role;update brc.applicants set issue_date='2026-01-01T22:00:00Z' where serial='OLD';set role authenticated");const dated=(await db.query("select brc.staff_card_report('2026-01-02','2026-01-02') d")).rows[0].d;check('dated financial report includes archived cards using Baghdad day',dated.rows.length===1&&Number(dated.rows[0].forms)===1);
 check('history contains no chance/print/PIN secrets',!JSON.stringify(found).includes('SECRET'));
 check('search treats percent as literal, not wildcard',(await history('%')).cards.length===1);
 const first=await history(),second=await history('',1);check('server pages are bounded to 50',first.cards.length===50&&first.hasMore&&second.cards.length>0&&second.cards.length<=50);
 check('stable pages never duplicate cards',!first.cards.some(a=>second.cards.some(b=>a.serial===b.serial)));
 await assert.rejects(()=>history('',-1));check('invalid page rejected',true);
 await assert.rejects(()=>db.exec("update brc.applicants set archived_at=null where serial='OLD'"));check('staff cannot undo archive metadata',true);
 await assert.rejects(()=>db.exec("update brc.applicants set full_name='تعديل' where serial='OLD'"));check('archived card remains read-only to staff',true);
 await assert.rejects(()=>db.exec("insert into brc.applicants(serial,status,archived_at) values('FORGED','blank',now())"));check('staff cannot forge an archived card on insert',true);
 await assert.rejects(()=>db.query('select brc.archive_finished_cards()'));check('staff cannot invoke private sweep',true);
 await db.exec("set test.staff='no'");await assert.rejects(()=>history());check('disabled/unverified staff denied',true);await assert.rejects(()=>db.query('select brc.staff_card_report()'));check('disabled staff cannot read aggregate reports',true);await assert.rejects(()=>db.query('select brc.staff_issuance_registry()'));check('disabled staff cannot read printed-code registry',true);check('invoker views preserve staff RLS',(await db.query('select count(*)::int n from brc.working_applicants')).rows[0].n===0);
 await db.exec('reset role');check('sweep idempotent',(await db.query('select brc.archive_finished_cards() n')).rows[0].n===0);
 const workingCount=(await db.query('select count(*)::int n from brc.working_applicants')).rows[0].n;
 await db.exec("insert into brc.applicants(serial,status,full_name,expiry_date) select 'BULK-'||n,'exhausted','قديم محفوظ',now()-interval '90 days' from generate_series(1,6000)n;insert into brc.job_attempts(serial,attempt_no,slot_status,closed_at,chance_code) select 'BULK-'||n,k,'succeeded',now()-interval '90 days',(1000+(100000+2*(n-1)+k-1)/529)::text||'-'||substr('ABCDEFGHJKMNPQRSTUVWXYZ',((100000+2*(n-1)+k-1)%529)/23+1,1)||substr('ABCDEFGHJKMNPQRSTUVWXYZ',(100000+2*(n-1)+k-1)%23+1,1) from generate_series(1,6000)n cross join generate_series(1,2)k;");
 check('6000 old cards can be archived without deletion',(await db.query('select brc.archive_finished_cards() n')).rows[0].n===6000);
 check('working payload does not grow with archived history',(await db.query('select count(*)::int n from brc.working_applicants')).rows[0].n===workingCount);
 await db.exec("set test.staff='yes'");const bulkReport=(await db.query('select brc.staff_card_report() d')).rows[0].d;check('aggregate report retains lifetime totals after 6000 archives',bulkReport.stats.forms===before.cards+6000&&bulkReport.stats.hires===12010);
 check('12000 historical opportunities retained',(await db.query("select count(*)::int n from brc.job_attempts where serial like 'BULK-%'")).rows[0].n===12000);
 console.log('PASS '+checks+' retention/working-set SQL checks. No live database touched.');
}finally{await db.close();}
