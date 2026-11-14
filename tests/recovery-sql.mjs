// Actual PostgreSQL semantics/pgcrypto, synthetic full workflow only. NEVER live restore.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite({extensions:{pgcrypto}});let n=0;
const check=(name,v)=>{assert.ok(v,name);n++;console.log('✓ '+name);};
const owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222';
const call=async(action,id=null,name='',token='')=>(await db.query('select brc.recovery_manage($1,$2::uuid,$3,$4) r',[action,id,name,token])).rows[0].r;
const count=async(table)=>Number((await db.query('select count(*) n from brc.'+table)).rows[0].n);
const fresh=async()=>{const session=(await db.query('insert into auth.sessions(user_id) values($1) returning id',[owner])).rows[0].id;await db.exec(`set test.session='${session}'`);const c=(await db.query('select cutoff from brc.recovery_control')).rows[0].cutoff;await db.exec(`set test.actor='${owner}';set test.iat='${Math.max(Number(c)+1,Math.floor(Date.now()/1000))}'`);};
const fingerprint=async()=>(await db.query("select encode(extensions.digest(brc.recovery_capture()::text,'sha256'),'hex') h")).rows[0].h;
try{
 const fixture=read('tests/card-identity.mjs').match(/await db.exec\(`([\s\S]*?)`\);/)[1];await db.exec(fixture);
 await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('iat',nullif(current_setting('test.iat',true),'')::bigint,'session_id',nullif(current_setting('test.session',true),''))$$;
 create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid);
 create table auth.refresh_tokens(id uuid default gen_random_uuid(),user_id text);
 create table brc.staff(id uuid primary key default gen_random_uuid(),auth_id uuid,username text,role text,active boolean default true);
 insert into brc.staff(auth_id,username,role) values('${owner}','admin','admin'),('${staff}','employee','staff');
 create function brc.is_admin() returns boolean language sql security definer as $$select exists(select 1 from brc.staff where auth_id=auth.uid() and active and role='admin')$$;
 create table brc.issued_serials(serial text primary key);
 create table brc.employer_job_credentials(job_id uuid primary key references brc.jobs(id) on delete cascade,pin_hash text not null);
 create table brc.employer_otp(id uuid primary key default gen_random_uuid());
 alter table brc.jobs add column notes text, add column employer_pin_set boolean default true, add column created_by uuid references brc.staff(id);
 alter table brc.applicants add column created_by uuid references brc.staff(id),add column card_print_code text,add column printed_count int default 0;
 alter table brc.job_attempts add column staff_id uuid references brc.staff(id);
 alter table brc.jobs add foreign key(reserved_by) references brc.applicants(serial);
 alter table brc.job_attempts add primary key(id),add foreign key(serial) references brc.applicants(serial) on delete cascade,add foreign key(job_id) references brc.jobs(id) on delete set null;
 alter table brc.settings add column updated_by uuid references brc.staff(id),add column updated_at timestamptz default now();
 /* المخطط الحقيقي فيه primary key على key — النموذج المصغّر لم يكن، فأُضيف
    لأن recovery_run_scheduled يسجّل وقت آخر نسخة بـON CONFLICT (key). */
 alter table brc.settings add primary key(key);
 insert into brc.applicants(serial,status,full_name,phone) values('CARD','active','عميل وهمي','07700000000');
 insert into brc.issued_serials values('CARD');
 insert into brc.jobs(code,title) values('J-1','وظيفة أولى'),('J-2','وظيفة ثانية');
 insert into brc.job_attempts(serial,attempt_no,job_id,job_code,slot_status,chance_code) select 'CARD',1,id,code,'reserved','1234-AB' from brc.jobs where code='J-1';
 insert into brc.job_attempts(serial,attempt_no,slot_status,chance_code) values('CARD',2,'empty','5678-CD');
 insert into brc.employer_job_credentials select id,'fixture-private-hash' from brc.jobs;
 insert into brc.employer_otp default values;
 insert into auth.sessions(user_id) values('${owner}'),('${staff}');
 create table brc.office_receipts(operation_id uuid);insert into brc.office_receipts values(gen_random_uuid());`);
 const migration=read('supabase/migrations/20261019020902_managed_operational_recovery.sql');await db.exec(migration);await db.exec(migration);check('migration repeatable, no business mutation',await count('jobs')===2&&await count('job_attempts')===2);
 await assert.rejects(()=>call('create'));check('missing official identity denied',true);
 await db.exec(`set test.actor='${staff}';set test.iat='${Math.floor(Date.now()/1000)}'`);await assert.rejects(()=>call('list'));check('ordinary employee cannot list/create/restore',true);
 await fresh();const initial=await fingerprint();let copy=(await call('create',null,'نسخة اختبار')).id;
 check('snapshot captures server data with ciphertext',await count('recovery_copies')===1&&(await db.query('select octet_length(ciphertext)>0 encrypted from brc.recovery_copies')).rows[0].encrypted);
 check('all five real write-fence triggers installed',(await db.query("select count(*)::int n from pg_trigger where tgname='recovery_write_fence'")).rows[0].n===5);
 check('create does not alter business records',await fingerprint()===initial);
 await assert.rejects(()=>call('remove',copy));check('cannot delete last saved copy',await count('recovery_copies')===1);
 const disposable=(await call('create',null,'للإزالة')).id;await call('remove',disposable);check('explicit copy deletion does not delete live data',await fingerprint()===initial&&await count('recovery_copies')===1);
 const listing=await call('list');check('metadata only, no ciphertext, PIN or keys',listing.copies.length===1&&!/ciphertext|fixture-private-hash|secret/.test(JSON.stringify(listing)));
 await db.exec('set role authenticated');let denied=false;try{await db.query('select secret from brc.recovery_control');}catch{denied=true;}await db.exec('reset role');check('server encryption key inaccessible to authenticated browsers',denied);
 await db.exec('set role anon');denied=false;try{await call('list');}catch{denied=true;}await db.exec('reset role');check('anonymous execution denied',denied);
 for(const fn of ['recovery_capture()','recovery_save(text,boolean)','recovery_read(uuid)'])check('private helper not exposed: '+fn,!(await db.query(`select has_function_privilege('authenticated','brc.${fn}','EXECUTE') allowed`)).rows[0].allowed);
 // The exact incident requested: employee deletes all jobs; existing cards/slots remain.
 await db.exec('delete from brc.employer_job_credentials;update brc.job_attempts set job_id=null;delete from brc.jobs');
 let preview=await call('preview',copy);check('preview detects deleted jobs without writing business rows',preview.risks.missingJobs===2&&preview.canRestore&&await count('jobs')===0);
 await db.exec(`set test.iat='${Math.floor(Date.now()/1000)-1000}'`);await assert.rejects(()=>call('restore',copy,'',preview.token));check('destructive restore requires a fresh official access token',true);await fresh();
 let before=await fingerprint();const backups=await count('recovery_copies');const restored=await call('restore',copy,'',preview.token);
 check('restore brings deleted jobs back',restored.ok&&await count('jobs')===2);
 check('successful safety copy exists and precedes restore',await count('recovery_copies')===backups+1&&(await db.query('select safety from brc.recovery_copies where id=$1',[restored.safetyId])).rows[0].safety&&(await db.query("select encode(extensions.digest(brc.recovery_read($1)::text,'sha256'),'hex') h",[restored.safetyId])).rows[0].h===before);
 check('related chance/card identifiers restored without replenishment',(await db.query("select chance_code,slot_status from brc.job_attempts where attempt_no=1")).rows[0].chance_code==='1234-AB'&&(await db.query("select slot_status from brc.job_attempts where attempt_no=2")).rows[0].slot_status==='empty');
 check('original business content restored exactly',await fingerprint()===initial);
 check('Auth/staff not rolled back; old sessions ended',await count('staff')===2&&(await db.query('select count(*) n from auth.sessions')).rows[0].n===0);
 check('employer sessions invalidated; missing PIN credentials recovered',await count('employer_otp')===0&&await count('employer_job_credentials')===2);
 check('office receipts and audit history retained',await count('office_receipts')===1&&await count('audit_log')>=2);
 await assert.rejects(()=>db.exec("update brc.jobs set title='stale browser'"));check('old valid access JWT cannot overwrite restored data',true);
 await assert.rejects(()=>call('list'));check('old admin session also rejected by recovery endpoint',true);
 await db.exec(`set test.iat='${Math.floor(Date.now()/1000)+10}'`);await assert.rejects(()=>db.exec("update brc.jobs set title='rotated stale session'"));check('newer iat alone cannot revive an ended pre-restore session',true);
 await fresh();await assert.rejects(()=>call('restore',copy,'',preview.token));check('confirmation ticket cannot be replayed',true);
 const safetyPlan=await call('preview',restored.safetyId);await call('restore',restored.safetyId,'',safetyPlan.token);check('safety copy can undo the restore in isolation',await fingerprint()===before);await fresh();
 const returnPlan=await call('preview',copy);await call('restore',copy,'',returnPlan.token);await fresh();check('chosen copy can be restored again with a NEW approval',await fingerprint()===initial);
 // Concurrent work between preview and final confirmation invalidates the ticket.
 preview=await call('preview',copy);await db.exec("update brc.jobs set notes='عمل أحدث' where code='J-2'");before=await fingerprint();await assert.rejects(()=>call('restore',copy,'',preview.token));check('concurrent post-preview changes abort entire restore',await fingerprint()===before);
 // Never replenish a chance spent after the chosen backup, even with a ticket.
 await db.exec("update brc.job_attempts set slot_status='rejected' where attempt_no=2");preview=await call('preview',copy);before=await fingerprint();await assert.rejects(()=>call('restore',copy,'',preview.token));check('spent chance conflict blocks restore, not silent replenishment',!preview.canRestore&&preview.risks.spentChanceConflicts===1&&await fingerprint()===before);
 await db.exec("delete from brc.job_attempts where attempt_no=2");preview=await call('preview',copy);check('usage history survives deleting the spent operational row',!preview.canRestore&&preview.risks.spentChanceConflicts===1);
 await db.exec("insert into brc.job_attempts(serial,attempt_no,slot_status,chance_code) values('CARD',2,'rejected','5678-CD')");
 // Create a compatible copy of current state for the remaining isolated tests.
 copy=(await call('create',null,'نسخة أحدث')).id;
 preview=await call('preview',copy);await db.exec("update brc.recovery_tickets set expires_at=now()-interval '1 second'");await assert.rejects(()=>call('restore',copy,'',preview.token));check('expired confirmation denied',true);
 preview=await call('preview',copy);await db.exec(`set test.actor='${staff}'`);await assert.rejects(()=>call('restore',copy,'',preview.token));check('another user cannot use admin preview ticket',true);await fresh();
 await db.exec("update brc.employer_job_credentials set pin_hash='new-current-pin'");copy=(await call('create',null,'نسخة رموز')).id;await db.exec("update brc.employer_job_credentials set pin_hash='most-recent-pin'");preview=await call('preview',copy);await call('restore',copy,'',preview.token);await fresh();check('current PIN changes are not rolled back to stale PIN',(await db.query('select distinct pin_hash from brc.employer_job_credentials')).rows[0].pin_hash==='most-recent-pin');
 // Quota/cap failure must abort BEFORE destructive writes.
 preview=await call('preview',copy);await db.exec("insert into brc.recovery_copies(name,counts,schema_hash,data_hash,ciphertext) select 'filler','{}','x','x','\\x00'::bytea from generate_series(1,100-(select count(*)::int from brc.recovery_copies))");before=await fingerprint();await assert.rejects(()=>call('restore',copy,'',preview.token));check('failed pre-restore safety copy leaves business data untouched',await fingerprint()===before);
 await db.exec("delete from brc.recovery_copies where name='filler'");
 // Enforce a new constraint without changing column layout: preview can pass,
 // but insertion fails mid-restore. PostgreSQL must roll EVERYTHING back.
 await db.exec("update brc.jobs set title='اسم أحدث';alter table brc.jobs add constraint recovery_fixture_title check(title='اسم أحدث')");
 preview=await call('preview',copy);before=await fingerprint();const copiesBefore=await count('recovery_copies');await assert.rejects(()=>call('restore',copy,'',preview.token));
 check('mid-restore SQL failure rolls back deletes, safety copy and trigger changes',await fingerprint()===before&&await count('recovery_copies')===copiesBefore&&(await db.query("select count(*)::int n from pg_trigger where tgname='recovery_write_fence' and tgenabled='O'")).rows[0].n===5);
 await db.exec('alter table brc.jobs drop constraint recovery_fixture_title');
 const admin2='33333333-3333-4333-8333-333333333333';await db.query("insert into brc.staff(auth_id,username,role) values($1,'other-admin','admin')",[admin2]);
 preview=await call('preview',copy);const otherSession=(await db.query('insert into auth.sessions(user_id) values($1) returning id',[admin2])).rows[0].id;await db.exec(`set test.actor='${admin2}';set test.session='${otherSession}'`);await assert.rejects(()=>call('restore',copy,'',preview.token));check('even another admin cannot reuse someone else’s approval',true);await fresh();await db.query('delete from brc.staff where auth_id=$1',[admin2]);
 await db.query('update brc.staff set active=false where auth_id=$1',[owner]);await assert.rejects(()=>call('list'));check('disabled admin denied',true);await db.query('update brc.staff set active=true where auth_id=$1',[owner]);
 // Tampering is authenticated, not merely a checksum label.
 const good=(await db.query('select ciphertext from brc.recovery_copies where id=$1',[copy])).rows[0].ciphertext;await db.query("update brc.recovery_copies set ciphertext='\\x000102' where id=$1",[copy]);await assert.rejects(()=>call('preview',copy));check('corrupted archive cannot reach restore',true);await db.query('update brc.recovery_copies set ciphertext=$2 where id=$1',[copy,good]);
 await db.exec('alter table brc.jobs add column future_schema_field text');await assert.rejects(()=>call('preview',copy));check('schema drift rejected instead of discarding fields silently',true);
 // Scheduled runner (the one pg_cron actually calls): real pgcrypto and table locks; no live database or cron.
 /* 2026-10-25: حُذفت recovery_weekly — المنفّذ الوحيد الآن هو recovery_run_scheduled()
    (تسميه مهمة recovery-auto-backup بعد أن صارت الجدولة بيد المدير). نستخرج تعريفه
    من المصدر docs/schema.sql نفسه حتى يُفحص ما سيُنشر فعلاً. */
 const scheduledSrc=(read('docs/schema.sql').match(/create or replace function brc\.recovery_run_scheduled\(\)[\s\S]*?\nend \$\$;/)||[''])[0];
 check('تعريف recovery_run_scheduled موجود في المصدر',scheduledSrc.length>100);
 /* 2026-11-14: النسخة المجدولة صارت تستدعي brc.recovery_prune() لإبقاء آخر N
    نسخة بدل حذف كل ما قبلها. نُنشئ دالتَي التقليم من المصدر نفسه (لا نسخة
    يدوية هنا) حتى يُفحص ما سيُنشر فعلاً. */
 const keepSrc=(read('docs/schema.sql').match(/create or replace function brc\.recovery_retention_keep\(\)[\s\S]*?\n\$\$;/)||[''])[0];
 const pruneSrc=(read('docs/schema.sql').match(/create or replace function brc\.recovery_prune\(p_keep int\)[\s\S]*?\nend \$\$;/)||[''])[0];
 const pruneNoArgSrc=(read('docs/schema.sql').match(/create or replace function brc\.recovery_prune\(\) returns integer[\s\S]*?\$\$;/)||[''])[0];
 check('دالتا التقليم موجودتان في المصدر',keepSrc.length>50&&pruneSrc.length>100&&pruneNoArgSrc.length>50);
 await db.exec('create role service_role;grant usage on schema brc to service_role');
 /* recovery_run_scheduled تستدعي recovery_due_now («كل N يوم») — يجب تعريفها قبله */
 const dueSrc=(read('docs/schema.sql').match(/create or replace function brc\.recovery_due_now\(\)[\s\S]*?\nend \$\$;/)||[''])[0];
 check('تعريف recovery_due_now موجود في المصدر',dueSrc.length>300);
 await db.exec(dueSrc);
 await db.exec(keepSrc);await db.exec(pruneSrc);await db.exec(pruneNoArgSrc);
 await db.exec(scheduledSrc);await db.exec(scheduledSrc);
 await db.exec('revoke all on function brc.recovery_run_scheduled() from public,anon,authenticated,service_role');
 const weeklyCall=async()=>(await db.query('select brc.recovery_run_scheduled() id')).rows[0].id;
 before=await fingerprint();let weeklyId=await weeklyCall();
 /* 2026-11-14: الاحتفاظ صار آخر ٣ نسخ (قرار صاحب العمل) بدل واحدة. */
 /* 2026-11-14: الاحتفاظ صار آخر ٣ **نسخ مجدولة** (safety=false)، ونسخ الأمان
    (safety=true) محميّة من التقليم. فالعدّ الكلي ليس ١ — نتحقق من الصحة والحدّ. */
 {const rd=(await db.query('select brc.recovery_read($1) p',[weeklyId])).rows[0].p;
  const fp=await fingerprint();
  const keep=Number((await db.query('select brc.recovery_retention_keep() k')).rows[0].k);
  const sched=Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n);
  const safetyKept=Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=true")).rows[0].n);
  check('النسخة المجدولة تُقرأ بنجاح (format=1) ولا تمسّ البيانات التشغيلية',
    !!rd&&rd.format===1&&fp===before);
  check('عدد النسخ المجدولة لا يتجاوز حدّ الاحتفاظ',sched<=keep,'مجدولة='+sched+' حدّ='+keep);
  check('نسخ الأمان محميّة من التقليم',safetyKept>0,'أمان='+safetyKept);}
 for(const role of ['anon','authenticated','service_role']) {await db.exec('set role '+role);await assert.rejects(weeklyCall);await db.exec('reset role');check('scheduled private runner denies '+role,true);}
 await db.exec("create function brc.fixture_backup_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end$$; create trigger fixture_backup_failure before insert on brc.recovery_copies for each row execute function brc.fixture_backup_failure()");
 /* عدد النسخ المجدولة قبل الفشل — الفشل يجب ألّا يغيّره */
 {const beforeN=Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n);
  await assert.rejects(weeklyCall);
  check('failed scheduled insertion retains the prior copy and business state',
    await Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n)===beforeN
    &&await fingerprint()===before,'قبل='+beforeN);}
 await db.exec('drop trigger fixture_backup_failure on brc.recovery_copies');
 await db.exec("create function brc.fixture_backup_corrupt() returns trigger language plpgsql as $$begin NEW.ciphertext:=decode('000102','hex');return NEW;end$$;create trigger fixture_backup_corrupt before insert on brc.recovery_copies for each row execute function brc.fixture_backup_corrupt()");
 {const bN=Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n);
  await assert.rejects(weeklyCall);
  check('failed new-copy authentication rolls back insertion and retains prior copy',
    Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n)===bN,'قبل='+bN);}
 await db.exec('drop trigger fixture_backup_corrupt on brc.recovery_copies');
 await db.exec("create trigger fixture_backup_failure before delete on brc.recovery_copies for each row execute function brc.fixture_backup_failure()");
 {const bN=Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n);
  const bIds=(await db.query("select id from brc.recovery_copies where safety=false order by id")).rows.map(r=>r.id).join(',');
  await assert.rejects(weeklyCall);
  const aIds=(await db.query("select id from brc.recovery_copies where safety=false order by id")).rows.map(r=>r.id).join(',');
  check('failed old-copy prune rolls back entire scheduled replacement',aIds===bIds && Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n)===bN);}
 await db.exec('drop trigger fixture_backup_failure on brc.recovery_copies');
 const nextWeekly=await weeklyCall();/* النسخة التالية تُضاف ما دام العدد دون الحدّ — ولا تتجاوزه أبداً */
 {const n=Number((await db.query("select count(*)::int n from brc.recovery_copies where safety=false")).rows[0].n);
  const keep=Number((await db.query('select brc.recovery_retention_keep() k')).rows[0].k);
  check('next scheduled success appends and stays within retention',
    n<=keep&&nextWeekly!==weeklyId&&await fingerprint()===before,'مجدولة='+n+' حدّ='+keep);}
 console.log(`Managed recovery SQL: ${n} checks passed. No production restore executed.`);
}finally{await db.close();}
