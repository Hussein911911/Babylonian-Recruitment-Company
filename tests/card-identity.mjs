// Real PostgreSQL public RPCs + real DOM: later barcode applications cannot rewrite identity.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const schema=read('docs/schema.sql');
const definition=name=>{const a=schema.indexOf('create or replace function brc.'+name+'(');assert.ok(a>=0,name);return schema.slice(a,schema.indexOf('end $$;',a)+7);};
let count=0;const check=(name,value)=>{assert.ok(value,name);count++;console.log('  ✓ '+name);};
const db=new PGlite();
const owner={fullName:'أحمد محمد علي حسن',phone:'07712345678',province:'بابل',district:'الحلة',landmark:'قرب المركز',dob:'2000-05-12',gender:'ذكر'};
const attacker={fullName:'شخص مختلف اسم آخر',phone:'07899999999',province:'بغداد',district:'الكرادة',landmark:'عنوان مختلف',dob:'1995-01-01',gender:'أنثى'};
const rpc=async(name,args)=>{await db.exec('set role anon');try{return (await db.query(`select brc.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args)).rows[0].r;}finally{await db.exec('reset role');}};
const apply=(serial,job,data)=>rpc('apply_with_card',[serial,job,JSON.stringify(data)]);
const snapshot=async serial=>(await db.query('select full_name,phone,address,dob::text,gender,self_application_data from brc.applicants where serial=$1',[serial])).rows[0];
const empty=async serial=>Number((await db.query("select count(*) as n from brc.job_attempts where serial=$1 and slot_status='empty'",[serial])).rows[0].n);
const tick=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await db.exec(`create schema brc;create role anon;create role authenticated;grant usage on schema brc to anon,authenticated;
 create type brc.job_status as enum('available','reserved','closed','hiring');
 create table brc.settings(key text,value jsonb);insert into brc.settings values('rules','{"hold_hours":24,"validity_days":30}');
 create table brc.applicants(id uuid default gen_random_uuid(),serial text primary key,full_name text default '',phone text default '',address text default '',dob date,gender text default 'ذكر',status text default 'blank',attempt_limit int default 2,issue_date timestamptz,expiry_date timestamptz,pos_name text,fee_amount int default 10000,fee_paid boolean default true,notes text,self_application_data jsonb default '{}');
 create table brc.jobs(id uuid default gen_random_uuid() primary key,code text unique,title text default 'وظيفة اختبار',category text default 'خدمات',region text default 'الحلة',governorate text default 'بابل',shift text default 'صباحي',salary_min int default 500000,salary_max int default 700000,gender text default 'لا فرق',vacancies int default 2,requirements text[] default '{}',description text default '',created_at timestamptz default now(),status brc.job_status default 'available',employer_name text default 'صاحب عمل للاختبار',employer_phone text default '07700000001',employer_address text default 'عنوان الاختبار',interview_location text default 'المقر',reserved_by text,hold_expires_at timestamptz,updated_at timestamptz,critical boolean default false,closed_at timestamptz);
 create table brc.audit_log(username text,role text,ip text,action text,entity text,entity_id text,details text);
 create table brc.job_attempts(id uuid default gen_random_uuid(),serial text,attempt_no int,slot_status text default 'empty',chance_code text,job_id uuid,job_code text,selected_at timestamptz,hold_expires_at timestamptz,closed_at timestamptz,outcome_note text,unique(serial,attempt_no));`);
 for(const name of ['chance_code','mask_name','trg_attempt_hold','ensure_card_attempts','activate_card','use_chance','self_service_card','apply_with_card'])await db.exec(definition(name));
 await db.exec(`alter table brc.job_attempts alter chance_code set default brc.chance_code();
 create trigger reserve_job before insert or update on brc.job_attempts for each row execute function brc.trg_attempt_hold();
 revoke all on function brc.self_service_card(text,text),brc.apply_with_card(text,text,jsonb) from public;
 grant execute on function brc.self_service_card(text,text),brc.apply_with_card(text,text,jsonb) to anon,authenticated;
 create view brc.public_jobs as select code,title,category,region,governorate,shift,salary_min,salary_max,gender,vacancies,requirements,description,created_at,status from brc.jobs;grant select on brc.public_jobs to anon;
 insert into brc.jobs(code) select 'J-'||n from generate_series(1,12)n;
 insert into brc.applicants(serial) values('DIRECT'),('UI'),('FAILED'),('STALE'),('LEGACY');`);
 // Upgrade must be repeatable and exactly match canonical definitions.
 const migration=read('supabase/migrations/20261017120000_lock_card_identity_after_first_application.sql');
 await db.exec(migration);await db.exec(migration);
 const latest=read('supabase/migrations/20261029100000_validity_from_first_application.sql');
 await db.exec(definition('apply_with_card'));
 check('identity and validity migrations match canonical RPC definitions',migration.includes(definition('self_service_card'))&&latest.includes(definition('apply_with_card')));
 for(const serial of ['DIRECT','UI','FAILED','STALE','LEGACY'])await rpc('self_service_card',[serial,null]);
 const failed=await apply('FAILED','DOES-NOT-EXIST',owner);
 check('failed first application does not lock identity or spend a chance',!failed.ok&&(await snapshot('FAILED')).full_name===''&&await empty('FAILED')===2&&!(await rpc('self_service_card',['FAILED',null])).card.profileLocked);
 const first=await apply('DIRECT','J-1',owner);
 check('first application succeeds with actual UI fields, without an obsolete subdistrict requirement',first.ok&&first.profile.fullName===owner.fullName&&await empty('DIRECT')===1);
 const original=await snapshot('DIRECT');
 const failedSecond=await apply('DIRECT','J-1',attacker);
 check('failed second job leaves original identity and remaining chance intact',!failedSecond.ok&&await empty('DIRECT')===1&&JSON.stringify(await snapshot('DIRECT'))===JSON.stringify(original));
 const second=await apply('DIRECT','J-2',attacker);
 check('malicious second RPC selects job using original identity',second.ok&&second.profile.fullName===owner.fullName&&second.profile.phone===owner.phone&&second.profile.gender===owner.gender);
 check('all canonical identity and metadata remain byte-for-byte unchanged',JSON.stringify(await snapshot('DIRECT'))===JSON.stringify(original));
 check('exactly two chances consumed',await empty('DIRECT')===0);
 const exhausted=await apply('DIRECT','J-3',attacker);
 check('exhausted retries cannot overwrite identity or restore chances',!exhausted.ok&&await empty('DIRECT')===0&&JSON.stringify(await snapshot('DIRECT'))===JSON.stringify(original));
 const card=(await rpc('self_service_card',['DIRECT',null])).card;
 check('rescan reports locked canonical owner and zero remaining chances',card.profileLocked&&card.profile.fullName===owner.fullName&&card.chancesLeft===0);
 await db.query("update brc.applicants set status='active',full_name=$1,phone=$2,address='عنوان قديم',dob='2000-05-12',gender='ذكر',expiry_date=now()+interval '5 days',self_application_data='{}' where serial='LEGACY'",[owner.fullName,owner.phone]);
 const legacy=await apply('LEGACY','J-3',attacker);
 check('legacy/staff-issued cards without metadata cannot be reassigned',legacy.ok&&legacy.profile.fullName===owner.fullName&&(await snapshot('LEGACY')).self_application_data.fullName===undefined);
 const staleCard=(await rpc('self_service_card',['STALE',null])).card;
 check('unused card starts unlocked',!staleCard.profileLocked);
 check('another session can perform the first successful application',(await apply('STALE','J-4',owner)).ok);
 const staleSubmit=await apply('STALE','J-5',attacker);
 check('stale first-session payload cannot replace an owner committed by another session',staleSubmit.ok&&staleSubmit.profile.fullName===owner.fullName);
 await db.exec('set role anon');let denied=false;try{await db.exec("update brc.applicants set full_name='attacker' where serial='DIRECT'");}catch(e){denied=e.code==='42501';}finally{await db.exec('reset role');}
 check('anon still cannot update card tables directly',denied);
 // Reopen a previously used card in a fresh browser, then tamper with disabled fields.
 assert.ok((await apply('UI','J-6',owner)).ok);
 const html=read('apply.html');const inline=html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
 const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://identity.example/apply.html?form=UI',runScripts:'dangerously',pretendToBeVisual:true});
 try{
  const w=dom.window,$=id=>w.document.getElementById(id);const calls=[];
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HRCHttp={createClient:()=>({from:()=>({select:async()=>({data:JSON.parse(JSON.stringify((await db.query("select * from brc.public_jobs where status='available'")).rows)),error:null})}),rpc:async(name,args)=>{calls.push({name,args});try{return{data:await rpc(name,name==='self_service_card'?[args.p_serial,args.p_code??null]:[args.p_serial,args.p_job_code,JSON.stringify(args.p_data)]),error:null};}catch(e){return{data:null,error:{message:e.message}};}}})};
  w.eval(inline);await tick(80);w.G.start();await tick(450);
  check('second scan goes directly to jobs', $('pg-jobs').classList.contains('active'));
  check('job back button remains removed and notice is absent',$('btn-jobs-back').hidden&&!$('profile-lock-notice'));
  check('all original profile fields disabled',Array.from(w.document.querySelectorAll('.step-fields input,.step-fields select')).every(e=>e.disabled));
  for(const n of [0,1,2,3,4,5,-1]){w.G.go(n);await tick(5);assert.ok($('pg-jobs').classList.contains('active'));}
  check('direct and relative navigation cannot reach identity pages',true);
  w.G.editStep(1);check('review edit route cannot bypass owner lock',$('pg-jobs').classList.contains('active'));
  $('f-name').disabled=false;$('f-name').value=attacker.fullName;$('f-phone').value=attacker.phone;
  w.G.pickGender(w.document.querySelector('.gender-opt[data-v="أنثى"]'));
  check('payload ignores tampered DOM fields and gender actions',w.G.readProfile().fullName===owner.fullName&&w.G.readProfile().phone===owner.phone&&w.G.readProfile().gender===owner.gender);
  w.G.pickJob('J-7');w.G.go(7);await tick(450);
  check('review retains original owner and allows only job editing',$('review-content').textContent.includes(owner.fullName)&&!w.document.querySelector('#review-content [onclick="G.editStep(1)"]')&&!!w.document.querySelector('#review-content [onclick="G.editStep(6)"]'));
  check('rescan review labels the actual second opportunity', $('review-content').textContent.includes('الفرصة ٢')&&$('review-content').textContent.includes('وظائف الفرص المتبقية'));
  $('f-name').value=attacker.fullName;w.G.finish();
  for(let i=0;i<100&&!$('pg-result').classList.contains('active');i++)await tick(20);
  check('second application completes with original identity', $('pg-result').classList.contains('active')&&$('result-content').textContent.includes(owner.fullName)&&!$('result-content').textContent.includes(attacker.fullName));
  check('second form prints the actual server opportunity number', $('result-content').textContent.includes('٢ من ٢'));
  check('exactly one second-job write, no owner change, no extra chance',calls.filter(c=>c.name==='apply_with_card').length===1&&await empty('UI')===0&&(await snapshot('UI')).full_name===owner.fullName);
 }finally{dom.window.close();}
 console.log(`\nCard identity: ${count} checks passed.`);
}finally{await db.close();}
