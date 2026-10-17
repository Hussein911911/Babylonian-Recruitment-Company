// Actual SQL + actual Edge handler + actual browser script, using only isolated fixtures.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');let checks=0;
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('  ✓ '+name);};
const db=new PGlite();const hash='a'.repeat(64),ip='b'.repeat(64),session='c'.repeat(64);
const sql=read('supabase/migrations/20261017150000_employer_whatsapp_otp.sql');
const rpc=async(name,args)=>(await db.query(`select brc.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
try{
 await db.exec(`create schema brc;create role anon;create role authenticated;create role service_role;grant usage on schema brc to anon,authenticated,service_role;
 create table brc.applicants(serial text primary key,full_name text,phone text,address text,gender text);
 create table brc.jobs(id uuid primary key,code text,title text,region text,employer_phone text,status text default 'reserved',critical boolean default false,hold_expires_at timestamptz,updated_at timestamptz);
 create table brc.job_attempts(id uuid primary key,serial text,job_id uuid,attempt_no int,slot_status text default 'reserved',employer_decision text,employer_reason text,decision_at timestamptz,hold_expires_at timestamptz,outcome_note text);
 create table brc.audit_log(username text,role text,action text,entity text,entity_id text,details text);
 create function brc.employer_view(text) returns jsonb language sql as $$ select '{}'::jsonb $$;
 create function brc.employer_decide(text,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
 create function brc.employer_decide(text,text,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
 create function brc.employer_view_original(text,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
 grant execute on function brc.employer_view(text),brc.employer_decide(text,text),brc.employer_decide(text,text,text),brc.employer_view_original(text,text) to anon,authenticated;
 insert into brc.applicants values('CARD-TEST','اسم متقدم للاختبار','07712345678','عنوان خاص','ذكر');`);
 const j1=randomUUID(),j2=randomUUID(),a1=randomUUID(),a2=randomUUID();
 await db.query("insert into brc.jobs(id,code,title,region,employer_phone) values($1,'HRC-100','وظيفة أولى','الحلة','07712345678'),($2,'HRC-200','وظيفة ثانية','بغداد','07812345678')",[j1,j2]);
 await db.query('insert into brc.job_attempts(id,serial,job_id,attempt_no) values($1,\'CARD-TEST\',$2,1),($3,\'CARD-TEST\',$4,2)',[a1,j1,a2,j2]);
 await db.exec(sql);await db.exec(sql);
 check('migration idempotent and canonical schema includes identical OTP SQL',read('docs/schema.sql').includes(sql));
 const privileges=(await db.query("select proname,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as auth,has_function_privilege('service_role',p.oid,'execute') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='brc'")).rows;
 check('all legacy overloads/backups and OTP RPCs deny browser roles; service-only',privileges.every(r=>!r.anon&&!r.auth&&r.service));
 await db.exec('set role anon');let denied=false;try{await db.query('select * from brc.employer_otp');}catch(e){denied=e.code==='42501';}await db.exec('reset role');check('anonymous callers cannot read OTP material',denied);
 let id=randomUUID();check('unrelated job cannot request code',!(await rpc('employer_otp_issue',[id,'CARD-TEST','UNKNOWN',hash,ip])).ok);
 check('existing job sends only to its recorded normalized Iraqi WhatsApp number',(await rpc('employer_otp_issue',[id,'CARD-TEST','HRC-100',hash,ip])).phone==='9647712345678');
 check('unconfirmed delivery never verifies',!(await rpc('employer_otp_verify',[id,hash,session])).ok);
 await rpc('employer_otp_delivery',[id,true]);
 check('wrong code is rejected',!(await rpc('employer_otp_verify',[id,'d'.repeat(64),session])).ok);
 check('failed attempt count persists despite rejection',(await db.query('select failures from brc.employer_otp where id=$1',[id])).rows[0].failures===1);
 check('correct code grants a scoped session',(await rpc('employer_otp_verify',[id,hash,session])).ok);
 check('OTP replay is rejected',!(await rpc('employer_otp_verify',[id,hash,'e'.repeat(64)])).ok);
 let view=await rpc('employer_otp_action',[session,'','']);
 check('session reads first job even though second attempt is newer',view.ok&&view.job.code==='HRC-100'&&!JSON.stringify(view).includes('HRC-200'));
 check('no chance codes, OTP hashes or employer phone leak in view',!JSON.stringify(view).includes(hash)&&!JSON.stringify(view).includes('96477')&&!('chances' in view));
 check('resend cooldown is enforced',!(await rpc('employer_otp_issue',[randomUUID(),'CARD-TEST','HRC-100',hash,ip])).ok);
 check('reject requires a meaningful reason',!(await rpc('employer_otp_action',[session,'reject',''])).ok);
 check('verified rejection succeeds',(await rpc('employer_otp_action',[session,'reject','العدد مكتمل'])).ok);
 let attempts=(await db.query('select * from brc.job_attempts order by attempt_no')).rows;
 check('only scoped job changes, refusal is critical and other attempt untouched',attempts[0].slot_status==='critical'&&attempts[0].employer_reason==='العدد مكتمل'&&attempts[1].slot_status==='reserved');
 check('decision replay is refused',!(await rpc('employer_otp_action',[session,'hire',''])).ok);
 await rpc('employer_otp_action',[session,'logout','']);check('logout revokes scoped session',!(await rpc('employer_otp_action',[session,'',''])).ok);
 id=randomUUID();await rpc('employer_otp_issue',[id,'CARD-TEST','HRC-200',hash,ip]);await rpc('employer_otp_delivery',[id,true]);
 for(let i=0;i<5;i++)await rpc('employer_otp_verify',[id,'0'.repeat(64),session]);
 check('five wrong attempts lock even the correct code',!(await rpc('employer_otp_verify',[id,hash,session])).ok);
 await db.exec("update brc.employer_otp set created_at=now()-interval '61 seconds'");
 id=randomUUID();await rpc('employer_otp_issue',[id,'CARD-TEST','HRC-200',hash,ip]);await rpc('employer_otp_delivery',[id,true]);await rpc('employer_otp_verify',[id,hash,'f'.repeat(64)]);
 await db.query("update brc.jobs set employer_phone='07912345678' where id=$1",[j2]);check('changing registered employer number invalidates previous owner session',!(await rpc('employer_otp_action',['f'.repeat(64),'',''])).ok);
 await db.exec("update brc.jobs set employer_phone='07812345678' where code='HRC-200';update brc.employer_otp set created_at=now()-interval '61 seconds'");
 id=randomUUID();await rpc('employer_otp_issue',[id,'CARD-TEST','HRC-200',hash,ip]);await rpc('employer_otp_delivery',[id,true]);await db.query("update brc.employer_otp set expires_at=now()-interval '1 second' where id=$1",[id]);check('expired OTP cannot verify',!(await rpc('employer_otp_verify',[id,hash,session])).ok);

 await db.exec("update brc.employer_otp set created_at=now()-interval '61 seconds'");
 check('per-number hourly send cap also counts failed/expired challenges',(await rpc('employer_otp_issue',[randomUUID(),'CARD-TEST','HRC-200',hash,ip])).code==='rate_limit');
 check('verified hiring request is scoped and awaits company confirmation',(await rpc('employer_otp_action',['f'.repeat(64),'hire',''])).ok&&(await db.query("select slot_status from brc.job_attempts where id=$1",[a2])).rows[0].slot_status==='hiring');
 await db.exec("update brc.employer_otp set session_expires_at=now()-interval '1 second' where session_hash is not null");
 check('expired session cannot read applicant data',!(await rpc('employer_otp_action',['f'.repeat(64),'',''])).ok);
 await db.query("insert into brc.employer_otp(id,attempt_id,phone,ip_hash,code_hash) select gen_random_uuid(),$1,'budget-'||n,md5(n::text)||md5(n::text),$2 from generate_series(1,200)n",[a1,hash]);
 check('global daily budget cannot be bypassed using a fresh IP',(await rpc('employer_otp_issue',[randomUUID(),'CARD-TEST','HRC-100',hash,'9'.repeat(64)])).code==='rate_limit');
}finally{await db.close();}
// Execute TypeScript handler with real HTTP objects and crypto, mocked database/provider transport.
const settings={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key',EMPLOYER_OTP_SECRET:'test-pepper-32-characters-not-real-secret',EMPLOYER_ALLOWED_ORIGINS:'https://app.test',WHATSAPP_ACCESS_TOKEN:'provider-test-token',WHATSAPP_PHONE_NUMBER_ID:'12345',WHATSAPP_OTP_TEMPLATE:'test_auth'};
let sends=0,dbCalls=[],providerOK=true;
const ctx=vm.createContext({Request,Response,TextEncoder,TextDecoder,AbortSignal,crypto:webcrypto,Uint8Array,Uint32Array,Deno:{env:{get:k=>settings[k]},serve:fn=>{ctx.handler=fn;}},fetch:async(url,opts)=>{
 const body=JSON.parse(opts.body);if(url.startsWith('https://graph.facebook.com/')){sends++;assert.match(body.template.components[0].parameters[0].text,/^\d{6}$/);assert.equal(body.to,'9647712345678');return new Response(JSON.stringify(providerOK?{messages:[{id:'accepted'}]}:{error:{message:'sensitive-provider-error'}}),{status:providerOK?200:500});}
 dbCalls.push({url,body});if(url.endsWith('employer_otp_issue'))return new Response(JSON.stringify({ok:true,phone:'9647712345678'}));if(url.endsWith('employer_otp_delivery'))return new Response('null');if(url.endsWith('employer_otp_verify'))return new Response(JSON.stringify({ok:true}));return new Response(JSON.stringify({ok:false,code:'session_expired'}));
}});
vm.runInContext(stripTypeScriptTypes(read('supabase/functions/hrc-employer-otp/index.ts').replace('export async function handler','async function handler')),ctx);
async function call(body,origin='https://app.test'){return ctx.handler(new Request('https://edge.test',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':'1.2.3.4'},body:JSON.stringify(body)}));}
delete settings.WHATSAPP_ACCESS_TOKEN;let response=await call({action:'request',serial:'CARD-TEST',job:'HRC-100'});check('unconfigured provider fails honestly before database reservation or sending',response.status===503&&sends===0&&dbCalls.length===0);settings.WHATSAPP_ACCESS_TOKEN='provider-test-token';
response=await call({action:'request',serial:'CARD-TEST',job:'HRC-100'},'https://evil.test');check('unapproved browser origin cannot request codes',response.status===403&&sends===0);
response=await call({action:'request',serial:'CARD-TEST',job:'HRC-100',phone:'07999999999'});let result=await response.json();check('successful response contains challenge only, never code/phone/secrets',result.ok&&result.challenge&&!JSON.stringify(result).includes('96477')&&!JSON.stringify(result).includes('test-token'));
check('code and IP reach SQL as HMAC hashes',/^[a-f0-9]{64}$/.test(dbCalls[0].body.p_hash)&&/^[a-f0-9]{64}$/.test(dbCalls[0].body.p_ip));
providerOK=false;response=await call({action:'request',serial:'CARD-TEST',job:'HRC-100'});result=await response.json();check('provider failure never claims successful sending or exposes provider detail',response.status===502&&!result.ok&&!JSON.stringify(result).includes('sensitive-provider-error')&&dbCalls.at(-1).body.p_success===false);
response=await call({action:'view',token:'not-valid'});check('invalid session token cannot reach SQL action',response.status===401);
response=await call({action:'verify',challenge:randomUUID(),code:'123456'});result=await response.json();check('successful verify returns unpredictable 256-bit session token',result.ok&&/^[a-f0-9]{64}$/.test(result.token));
// UI: failed provider keeps step 1; successful verification exposes only returned scoped record.
const html=read('employer.html');const dom=new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{url:'https://app.test/employer.html?form=CARD-TEST',runScripts:'outside-only'});
try{
 const w=dom.window,$=id=>w.document.getElementById(id);let configured=false;const calls=[];
 w.HRCSupabaseConfig={enabled:true,url:'https://db.test',publishableKey:'public-key'};w.AbortSignal=AbortSignal;
 w.fetch=async(url,opts)=>{const b=JSON.parse(opts.body);calls.push(b);if(!configured)return new Response(JSON.stringify({ok:false,error:'خدمة الإرسال لم تُفعّل بعد'}),{status:503});if(b.action==='request')return new Response(JSON.stringify({ok:true,challenge:randomUUID(),expiresIn:300,resendAfter:60}));if(b.action==='verify')return new Response(JSON.stringify({ok:true,token:'a'.repeat(64)}));return new Response(JSON.stringify({ok:true,job:{title:'<img onerror=alert(1)>',code:'HRC-100',region:'الحلة'},applicant:{name:'صاحب الطلب',phone:'07700000000',address:'عنوان',gender:'ذكر'}}));};
 w.eval(read('assets/js/employer.js'));$('job').value='HRC-100';const submit=id=>$(id).dispatchEvent(new w.Event('submit',{cancelable:true}));const tick=()=>new Promise(r=>setTimeout(r,10));
 submit('job-form');await tick();check('unconfigured UI shows real error without fake OTP step',$('code-form').hidden&&!$('message').hidden&&$('details').children.length===0);
 configured=true;submit('job-form');await tick();check('successful send shows numeric six-digit input and cooldown',!$('code-form').hidden&&$('resend').disabled&&$('code').getAttribute('autocomplete')==='one-time-code');
 $('code').value='١٢٣٤٥٦';$('code').dispatchEvent(new w.Event('input'));check('OTP input normalizes Arabic digits',$('code').value==='123456');submit('code-form');await tick();
 check('after verification frontend requests scoped view with in-memory token',calls.at(-1).action==='view'&&!!calls.at(-1).token&&!$('application').hidden);
 check('returned text is rendered without markup injection',!w.document.querySelector('#job-title img')&&$('job-title').textContent.includes('<img'));
 check('no session token written to local/session storage',w.localStorage.length===0&&w.sessionStorage.length===0);
 dom.window.dispatchEvent(new dom.window.Event('pagehide'));check('leaving page clears private applicant DOM',dom.window.document.getElementById('details').textContent===''&&dom.window.document.getElementById('job-title').textContent==='');
}finally{dom.window.close();}
console.log(`\nEmployer OTP: ${checks} checks passed.`);
