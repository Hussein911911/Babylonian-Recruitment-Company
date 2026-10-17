// Actual pgcrypto bcrypt + actual SQL + real browser DOM. No live service/provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite({extensions:{pgcrypto}});let count=0;
const check=(name,v)=>{assert.ok(v,name);count++;console.log('✓ '+name);};
const rpc=async(n,a)=>(await db.query(`select brc.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')}) r`,a)).rows[0].r;
const data={title:'موظف مبيعات',region:'الحلة',requirements:[],employerPhone:'07700000000'};
try{
 const fixture=read('tests/card-identity.mjs').match(/await db.exec\(`([\s\S]*?)`\);/)[1];await db.exec(fixture);
 await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role service_role;
 alter table brc.jobs add column image_url text;alter table brc.jobs add check(salary_max>=salary_min);alter table brc.job_attempts add primary key(id);alter table brc.jobs alter employer_name drop default,alter employer_name set not null,alter employer_phone drop default,alter employer_phone set not null;alter table brc.job_attempts add column employer_decision text,add column employer_reason text,add column decision_at timestamptz;
 create table brc.staff(id uuid default gen_random_uuid(),username text,role text);insert into brc.staff(username,role) values('test-staff','staff');
 create function brc.is_staff() returns boolean language sql as $$select current_setting('test.staff',true)='yes'$$;
 create function brc.current_staff_id() returns uuid language sql as $$select id from brc.staff limit 1$$;
 create sequence brc.job_code_seq start 1000;`);
 const schema=read('docs/schema.sql');let a=schema.indexOf('create or replace function brc.next_job_code()');await db.exec(schema.slice(a,schema.indexOf('end $$;',a)+7));
 await db.exec(read('supabase/migrations/20261017150000_employer_whatsapp_otp.sql'));
 const migration=read('supabase/migrations/20261017190000_employer_job_pin.sql');await db.exec(migration);await db.exec(migration);
 check('PIN migration is idempotent and canonical',schema.includes(migration));
 check('old WhatsApp gateway cannot issue or verify even using service role',(await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='brc' and p.proname like 'employer_otp_%' and has_function_privilege('service_role',p.oid,'execute')")).rows[0].n===0);
 check('inactive staff cannot set a PIN',!(await rpc('staff_save_job_pin',['',JSON.stringify(data),'012345'])).ok);
 await db.exec("set test.staff='yes'");
 check('new jobs require an explicit PIN',!(await rpc('staff_save_job_pin',['',JSON.stringify(data),''])).ok);
 let first=await rpc('staff_save_job_pin',['',JSON.stringify(data),'012345']);assert.ok(first.ok);let second=await rpc('staff_save_job_pin',['',JSON.stringify(data),'654321']);assert.ok(second.ok);
 check('each job has a distinct credential; no raw PIN in job response',first.job.employer_pin_set&&second.job.employer_pin_set&&!JSON.stringify(first).includes('012345'));
 const hashes=(await db.query('select pin_hash from brc.employer_job_credentials')).rows;
 check('real salted bcrypt hashes used, cost 10',hashes.length===2&&hashes.every(r=>/^\$2[aby]\$10\$/.test(r.pin_hash))&&hashes[0].pin_hash!==hashes[1].pin_hash);
 const beforeJobs=(await db.query('select count(*) n from brc.jobs')).rows[0].n;let rolledBack=false;
 try{await rpc('staff_save_job_pin',['',JSON.stringify({...data,salaryMin:100,salaryMax:1}),'999000']);}catch(e){rolledBack=e.code==='23514';}
 check('failed atomic save creates neither partial job nor credential',rolledBack&&(await db.query('select count(*) n from brc.jobs')).rows[0].n===beforeJobs&&(await db.query('select count(*) n from brc.employer_job_credentials')).rows[0].n===2);

 await db.exec("insert into brc.applicants(serial,full_name,phone,address) values('CARD-TEST','صاحب الطلب','07700000001','الحلة'),('OTHER-CARD','آخر','07700000002','بغداد')");
 await db.query("insert into brc.job_attempts(serial,job_id,attempt_no,slot_status) values('CARD-TEST',$1,1,'reserved'),('CARD-TEST',$2,2,'reserved')",[first.job.id,second.job.id]);
 await db.exec("update brc.jobs set status='reserved'");
 await db.exec('set role anon');let denied=false;try{await db.query('select * from brc.employer_job_credentials');}catch(e){denied=e.code==='42501';}await db.exec('reset role');check('browser cannot read private credentials',denied);
 check('browser has no staff-save privilege',(await db.query("select has_function_privilege('anon','brc.staff_save_job_pin(text,jsonb,text)','execute') p")).rows[0].p===false);
 check('wrong card cannot authenticate even with correct PIN',!(await rpc('employer_pin_login',['OTHER-CARD',first.job.code,'012345'])).ok);
 check('PIN of second job does not open first',!(await rpc('employer_pin_login',['CARD-TEST',first.job.code,'654321'])).ok);
 await db.exec('set role anon');let login=await rpc('employer_pin_login',['CARD-TEST',first.job.code,'012345']);await db.exec('reset role');check('leading-zero PIN grants a 256-bit token',login.ok&&/^[a-f0-9]{64}$/.test(login.token));
 let view=await rpc('employer_pin_action',[login.token,'','']);check('session opens exact first opportunity, never newer second',view.ok&&view.job.code===first.job.code&&!JSON.stringify(view).includes(second.job.code));
 check('rejection requires a reason',!(await rpc('employer_pin_action',[login.token,'reject',''])).ok);
 check('scoped rejection succeeds',(await rpc('employer_pin_action',[login.token,'reject','العدد مكتمل'])).ok);
 check('rejection does not release job or restore opportunity',(await db.query('select slot_status from brc.job_attempts order by attempt_no')).rows.map(r=>r.slot_status).join(',')==='critical,reserved');
 check('decision replay is blocked',!(await rpc('employer_pin_action',[login.token,'hire',''])).ok);
 await rpc('employer_pin_action',[login.token,'logout','']);check('logout revokes token',!(await rpc('employer_pin_action',[login.token,'',''])).ok);
 login=await rpc('employer_pin_login',['CARD-TEST',second.job.code,'654321']);
 check('verified hiring remains pending company confirmation',(await rpc('employer_pin_action',[login.token,'hire',''])).ok);
 const otherSession=await rpc('employer_pin_login',['CARD-TEST',first.job.code,'012345']);
 await rpc('staff_save_job_pin',[second.job.code,JSON.stringify(data),'111222']);
 check('reset does not revoke another job session',(await rpc('employer_pin_action',[otherSession.token,'',''])).ok);
 check('PIN reset revokes existing job sessions',!(await rpc('employer_pin_action',[login.token,'',''])).ok);
 check('old PIN fails after reset',!(await rpc('employer_pin_login',['CARD-TEST',second.job.code,'654321'])).ok);
 login=await rpc('employer_pin_login',['CARD-TEST',second.job.code,'111222']);check('new PIN opens recorded result without another decision',login.ok&&(await rpc('employer_pin_action',[login.token,'',''])).decision==='hire');
 await rpc('staff_save_job_pin',[second.job.code,JSON.stringify({...data,title:'عنوان جديد'}),'']);
 check('blank PIN on edit preserves credential',(await rpc('employer_pin_login',['CARD-TEST',second.job.code,'111222'])).ok);
 for(let i=0;i<5;i++)await rpc('employer_pin_login',['CARD-TEST',first.job.code,'999999']);
 check('five wrong attempts lock even correct PIN',(await rpc('employer_pin_login',['CARD-TEST',first.job.code,'012345'])).code==='rate_limit');
 await db.exec("update brc.employer_job_credentials set window_start=now()-interval '16 minutes'");check('job lock expires after cooldown',(await rpc('employer_pin_login',['CARD-TEST',first.job.code,'012345'])).ok);
 await db.exec("update brc.employer_otp set session_expires_at=now()-interval '1 second'");check('expired sessions cannot read applicant',!(await rpc('employer_pin_action',[otherSession.token,'',''])).ok);
 await db.exec('update brc.employer_login_budget set requests=300');check('global budget limits unknown targets too',(await rpc('employer_pin_login',['OTHER-CARD','UNKNOWN','000000'])).code==='rate_limit');
 const log=JSON.stringify((await db.query('select * from brc.audit_log')).rows);check('audit never includes PIN values',!['012345','654321','111222'].some(p=>log.includes(p)));
}finally{await db.close();}
const html=read('employer.html'),dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://app.test/employer.html?form=CARD-TEST',runScripts:'outside-only'});
try{
 const w=dom.window,$=id=>w.document.getElementById(id);w.AbortSignal=AbortSignal;w.HRCSupabaseConfig={enabled:true,url:'https://db.test',publishableKey:'public'};
 let mode='fail';const calls=[];w.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});if(mode==='fail')throw new TypeError('Failed to fetch');if(mode==='denied')return new Response(JSON.stringify({ok:false,error:'خطأ في الرمز'}));if(url.endsWith('employer_pin_login'))return new Response(JSON.stringify({ok:true,token:'a'.repeat(64)}));return new Response(JSON.stringify({ok:true,job:{title:'<img onerror=x>',code:'HRC-1000'},applicant:{name:'صاحب الطلب'}}));};
 w.eval(read('assets/js/employer.js'));$('job').value='HRC-1000';$('code').value='٠١٢٣٤٥';$('code').dispatchEvent(new w.Event('input'));check('Arabic PIN digits normalize without losing zero',$('code').value==='012345');
 const submit=async()=>{$('job-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,20));};await submit();check('network failure is Arabic and never grants access',!$('message').textContent.includes('Failed to fetch')&&$('application').hidden);
 mode='denied';await submit();check('wrong PIN stays at login',$('application').hidden&&!$('job-form').hidden);
 mode='ok';await submit();check('successful browser login uses direct PIN RPCs, no WhatsApp gateway',!$('application').hidden&&calls.every(c=>c.url.includes('/rest/v1/rpc/employer_pin_'))&&calls.at(-1).body.p_session==='a'.repeat(64));
 check('browser clears PIN and renders returned text safely',$('code').value===''&&!$('job-title').querySelector('img'));
 check('credentials and tokens never persisted',w.localStorage.length===0&&w.sessionStorage.length===0);
 w.dispatchEvent(new w.Event('pagehide'));check('leaving page clears private content',$('details').textContent===''&&$('application').hidden);
}finally{dom.window.close();}
console.log(`Employer PIN: ${count} checks passed.`);
