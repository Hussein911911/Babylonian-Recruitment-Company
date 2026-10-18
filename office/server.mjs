import http from 'node:http';
import https from 'node:https';
import {readFileSync,existsSync,mkdirSync,writeFileSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Cloud} from './cloud.mjs';
import {openState,acquireLock} from './state.mjs';
import {OfficeEngine} from './engine.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export function makeServer(engine,{hosts,tls,clock=()=>Date.now()}={}){
 const failures=new Map();
 const handler=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   const host=String(req.headers.host||'').toLowerCase();if(!hosts?.includes(host))return send(403,{error:'host_denied'});
   const path=new URL(req.url,'https://'+host).pathname;
   if(req.method==='GET'&&['/','/app.js','/style.css'].includes(path)){
    const file=path==='/'?'index.html':path.slice(1);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});return res.end(readFileSync(join(root,'public',file)));
   }
   if(!path.startsWith('/api/'))return send(404,{error:'not_found'});
   const origin=(tls?'https://':'http://')+host;
   if(req.method!=='GET'&&req.headers.origin!==origin)return send(403,{error:'origin_denied'});
   let body={};if(req.method!=='GET'){
    if(!String(req.headers['content-type']).startsWith('application/json'))return send(415,{error:'json_required'});
    let bytes=0,data='';for await(const part of req){bytes+=part.length;if(bytes>16000)throw Object.assign(new Error('body_too_large'),{status:413});data+=part;}
    body=JSON.parse(data||'{}');
   }
   const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('hrc_office='));const token=cookie?.slice(11)||'';
   if(path==='/api/login'&&req.method==='POST'){
    const ip=req.socket.remoteAddress,now=clock(),attempt=failures.get(ip)||{n:0,start:now};
    if(now-attempt.start>15*60000){attempt.n=0;attempt.start=now;}
    if(attempt.n>=5)return send(429,{error:'محاولات كثيرة؛ انتظر 15 دقيقة'});
    attempt.n++;failures.set(ip,attempt);if(failures.size>2000)failures.delete(failures.keys().next().value);
    if(typeof body.username!=='string'||body.username.length>160||typeof body.password!=='string'||body.password.length>500)return send(400,{error:'invalid_credentials'});
    const value=await engine.login(body.username.trim(),body.password);failures.delete(ip);
    res.setHeader('Set-Cookie','hrc_office='+value+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(tls?'; Secure':''));return send(200,engine.view(value));
   }
   const session=engine.session(token);
   if(req.method!=='GET'&&req.headers['x-csrf-token']!==session.csrf)return send(403,{error:'csrf_denied'});
   if(path==='/api/state'&&req.method==='GET')return send(200,engine.view(token));
   if(path==='/api/logout'&&req.method==='POST'){
    await engine.logout(token);res.setHeader('Set-Cookie','hrc_office=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(tls?'; Secure':''));return send(200,{ok:true});
   }
   if(path==='/api/operations'&&req.method==='POST'){const result=await engine.enqueue(token,body);send(202,result);void engine.sync().catch(()=>{});return;}
   if(path==='/api/cancel'&&req.method==='POST'){await engine.cancel(token,body.id);return send(200,{ok:true});}
   if(path==='/api/sync'&&req.method==='POST'){await engine.sync();return send(200,engine.view(token));}
   return send(404,{error:'not_found'});
  }catch(e){return send(e.status||400,{error:({'session_expired':'الجلسة المحلية انتهت؛ يلزم دخول رسمي مع الإنترنت','job_locally_pending':'الوظيفة محجوزة محلياً بطلب معلق','no_empty_chance':'لا توجد فرصة فارغة غير مستخدمة محلياً','initial_snapshot_failed':'تعذر تحميل بيانات الحساب؛ لا دخول محلي جديد دون تحقق','job_unavailable':'الوظيفة غير متاحة','card_unavailable':'البطاقة غير سارية','card_not_blank':'البطاقة ليست فارغة أو عليها طلب معلق','snapshot_too_old':'البيانات قديمة؛ يلزم اتصال وتحديث','unauthorized':'غير مصرح','cloud_request_failed':'تعذر التحقق من الحساب عبر الإنترنت','inactive_or_unauthorized':'الحساب غير فعال أو غير مصرح'}[e.message]||'تعذر تنفيذ الطلب بأمان')});}
 };
 return tls?https.createServer(tls,handler):http.createServer(handler);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const home=resolve(process.env.HRC_OFFICE_HOME||'.office');mkdirSync(home,{recursive:true,mode:0o700});
 if(process.argv.includes('--init')){
  const key=join(home,'state.key');if(existsSync(key))throw new Error('Key exists; never replace a working key.');
  writeFileSync(key,randomBytes(32),{flag:'wx',mode:0o600});
  writeFileSync(join(home,'config.example.json'),JSON.stringify({cloudUrl:'https://YOUR-PROJECT.supabase.co',publishableKey:'PUBLIC_KEY_ONLY',hosts:['office.company.local:8443'],port:8443,tlsPfx:'C:/HRC/private/office.pfx',tlsPasswordFile:'C:/HRC/private/tls-password.txt'},null,2),{flag:'wx',mode:0o600});
  console.log('Created local key and config.example.json. Configure HTTPS and Windows ACLs before starting.');
 }else{
  const cfg=JSON.parse(readFileSync(join(home,'config.json')));if(!cfg.hosts?.length||!cfg.tlsPfx||!cfg.tlsPasswordFile)throw new Error('HTTPS and host allowlist required');
  const cleanup=acquireLock(join(home,'server.lock'));process.on('exit',cleanup);
  const key=readFileSync(join(home,'state.key')),store=openState(join(home,'state.enc'),key);
  const engine=new OfficeEngine(store,new Cloud(cfg.cloudUrl,cfg.publishableKey),{archiveDir:join(home,'archives'),backupStatus:()=>{try{const b=JSON.parse(readFileSync(join(home,'backup-status.json')));return {state:b.state,lastSuccess:b.lastSuccess,lastAttempt:b.lastAttempt,nextPlanned:b.nextPlanned,type:b.type,validation:b.validation,restoreDrill:b.restoreDrill===true};}catch{return null;}}});
  const server=makeServer(engine,{hosts:cfg.hosts.map(s=>s.toLowerCase()),tls:{pfx:readFileSync(cfg.tlsPfx),passphrase:readFileSync(cfg.tlsPasswordFile,'utf8').trim()}});
  server.listen(cfg.port||8443,'0.0.0.0',()=>console.log('Office HTTPS server listening; local drafts are not final cloud bookings.'));
  const sync=setInterval(()=>void engine.sync().catch(()=>{}),60000);
  const archive=setInterval(()=>void engine.archive(key).catch(()=>{}),3600000);
  void engine.archive(key).catch(()=>{});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(sync);clearInterval(archive);server.close(()=>process.exit(0));});
 }
}
