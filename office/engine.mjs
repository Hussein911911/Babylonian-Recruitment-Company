import {randomBytes,randomUUID} from 'node:crypto';
import {hash,seal,unseal,atomicWrite} from './state.mjs';
import {join} from 'node:path';
import {readFileSync,readdirSync,unlinkSync} from 'node:fs';
export class OfficeEngine {
 constructor(store,cloud,{clock=()=>Date.now(),leaseMs=8*3600000,archiveDir,backupStatus=()=>null}={}){this.store=store;this.cloud=cloud;this.clock=clock;this.leaseMs=Math.min(leaseMs,8*3600000);this.archiveDir=archiveDir;this.backupStatus=backupStatus;this.state=store.state;this.state.snapshots??={};this.lastError=null;}
 session(token){const s=this.state.sessions[hash(token||'')];if(!s||s.expires<=this.clock())throw Object.assign(new Error('session_expired'),{status:401});return s;}
 async login(username,password){
  const {tokens,profile}=await this.cloud.login(username,password);
  if(profile.active!==true||!['staff','admin'].includes(profile.role))throw Object.assign(new Error('unauthorized'),{status:403});
  // No password or access token is returned to a browser or log.
  if(this.cloud.ready)await this.cloud.ready(tokens.access_token);
  const snapshot=await this.cloud.snapshot(tokens.access_token);
  return this.store.exclusive(()=>{
  const own=Object.entries(this.state.sessions).filter(([,s])=>s.profile.auth_id===profile.auth_id).sort((a,b)=>b[1].expires-a[1].expires);
  for(const [old] of own.slice(7))delete this.state.sessions[old];
  const token=randomBytes(32).toString('hex');this.state.sessions[hash(token)]={tokens,profile,expires:this.clock()+this.leaseMs,csrf:randomBytes(24).toString('hex')};
  this.state.snapshots[profile.auth_id]=snapshot;
  this.state.outbox.filter(o=>o.owner===profile.auth_id&&o.status==='blocked').forEach(o=>{o.status='pending';});
  this.store.save();return token;
 });}
 view(token){const s=this.session(token),admin=s.profile.role==='admin';return {profile:{username:s.profile.username,name:s.profile.full_name,role:s.profile.role},csrf:s.csrf,expires:s.expires,snapshot:this.state.snapshots[s.profile.auth_id]||null,
 outbox:this.state.outbox.filter(o=>admin||o.owner===s.profile.auth_id).map(({id,kind,data,status,message,createdAt})=>({id,kind,data,status,message,createdAt})),lastSync:this.state.lastSync,error:this.lastError,backup:this.state.backup,databaseBackup:this.backupStatus()};}
 logout(token){return this.store.exclusive(()=>{delete this.state.sessions[hash(token||'')];this.store.save();});}
 enqueue(token,input){return this.store.exclusive(()=>{
  const s=this.session(token),snapshot=this.state.snapshots[s.profile.auth_id];
  if(!snapshot||this.clock()-Date.parse(snapshot.at)>24*3600000)throw new Error('snapshot_too_old');
  if(!['reserve','activate','job_note'].includes(input.kind))throw new Error('invalid_kind');
  if(this.state.outbox.length>=10000||this.state.outbox.filter(o=>['pending','sending','blocked'].includes(o.status)).length>=500)throw new Error('queue_full');
  const text=(v,n=80)=>{if(typeof v!=='string'||!v.trim()||v.length>n)throw new Error('invalid_input');return v.trim();};
  const jobCode=text(input.jobCode),job=snapshot.jobs.find(j=>j.code===jobCode);if(!job)throw new Error('job_not_in_snapshot');
  const occupied=this.state.outbox.filter(o=>['pending','sending','uncertain','blocked'].includes(o.status)||(o.status==='done'&&Date.parse(o.acknowledgedAt)>Date.parse(snapshot.at)));
  if(occupied.some(o=>o.data.jobCode===jobCode))throw new Error('job_locally_pending');
  const data={jobCode},expected={job_updated_at:job.updated_at};
  if(!expected.job_updated_at)throw new Error('snapshot_missing_version');
  if(input.kind==='job_note')data.note=text(input.note,2000);
  else{
   if(job.status!=='available')throw new Error('job_unavailable');
   const serialInput=text(input.serial).toUpperCase();
   const matches=snapshot.applicants.filter(a=>typeof a.serial==='string'&&a.serial.toUpperCase()===serialInput);
   if(matches.length!==1)throw new Error(matches.length?'ambiguous_card':'card_not_in_snapshot');
   const app=matches[0];data.serial=app.serial; // keep the exact database key for queue and sync

   if(input.kind==='reserve'){
    if(app.status!=='active'||(app.expiry_date!=null&&(!Number.isFinite(Date.parse(app.expiry_date))||Date.parse(app.expiry_date)<=this.clock())))throw new Error('card_unavailable');
    const used=new Set(occupied.filter(o=>o.kind==='reserve'&&o.data.serial===data.serial).map(o=>o.expected.attempt_no));
    const next=snapshot.attempts.filter(t=>t.serial===data.serial&&t.slot_status==='empty'&&!used.has(t.attempt_no)).sort((a,b)=>a.attempt_no-b.attempt_no)[0];
    if(!next)throw new Error('no_empty_chance');expected.attempt_no=next.attempt_no;
   }else{
    if(app.status!=='blank'||occupied.some(o=>o.data.serial===data.serial))throw new Error('card_not_blank');
    if(!app.updated_at)throw new Error('snapshot_missing_version');expected.app_updated_at=app.updated_at;
    data.fullName=text(input.fullName,160);data.phone=text(input.phone,32);data.posName=text(input.posName,100);
    data.address=typeof input.address==='string'?input.address.slice(0,400):'';data.gender=['ذكر','أنثى','لا فرق'].includes(input.gender)?input.gender:'لا فرق';
   }
  }
  const op={id:randomUUID(),owner:s.profile.auth_id,kind:input.kind,data,expected,createdAt:new Date(this.clock()).toISOString(),status:'pending'};
  this.state.outbox.push(op);this.store.save();return {id:op.id,status:'pending'};
 });}
 cancel(token,id){return this.store.exclusive(()=>{const s=this.session(token),op=this.state.outbox.find(o=>o.id===id);if(!op||(op.owner!==s.profile.auth_id&&s.profile.role!=='admin'))throw new Error('unauthorized');if(op.status==='sending'||op.status==='done'||(op.attempted&&['pending','blocked'].includes(op.status)))throw new Error('cannot_cancel_committed');op.status='cancelled';this.store.save();});}
 sync(){
  if(this.syncing)return this.syncing;
  this.syncing=this.performSync().finally(()=>{this.syncing=null;});return this.syncing;
 }
 async performSync(){
  const active=()=>Object.values(this.state.sessions);
  const owners=[...new Set([...this.state.outbox.filter(o=>['pending','sending'].includes(o.status)).map(o=>o.owner),...active().filter(s=>s.expires>this.clock()).map(s=>s.profile.auth_id)])];
  for(const owner of owners){
   const session=active().filter(s=>s.profile.auth_id===owner).sort((a,b)=>b.expires-a.expires)[0];if(!session)continue;
   const stillPresent=()=>active().includes(session);
   try{
    const profile=await this.cloud.refresh(session,()=>this.store.exclusive(()=>{if(stillPresent())this.store.save();}));
    if(!stillPresent())continue;
    if(!profile||profile.active!==true||profile.auth_id!==owner||!['staff','admin'].includes(profile.role))throw Object.assign(new Error('inactive_or_unauthorized'),{status:403});
    await this.store.exclusive(()=>{session.profile=profile;this.store.save();});
    const ids=this.state.outbox.filter(o=>o.owner===owner&&['pending','sending'].includes(o.status)).map(o=>o.id);
    for(const id of ids){
     const op=await this.store.exclusive(()=>{
      if(!stillPresent())return null;
      const item=this.state.outbox.find(o=>o.id===id);if(!item||!['pending','sending'].includes(item.status))return null;
      // Never abandon an ambiguous sent request: even after 24h its receipt
      // must be reconciled, not labelled safely expired/cancelled.
      if(!item.attempted&&this.clock()-Date.parse(item.createdAt)>24*3600000){item.status='expired';item.message='انتهت مهلة الطلب؛ يحتاج مراجعة جديدة';this.store.save();return null;}
      item.status='sending';item.attempted=true;this.store.save();return JSON.parse(JSON.stringify(item));
     });
     if(!op)continue;
     // Network I/O NEVER holds the local write mutex. LAN devices can keep
     // saving while the cloud is slow/down. Stable UUID + DB receipt retries.
     const result=await this.cloud.submit(session.tokens.access_token,op);
     await this.store.exclusive(()=>{const item=this.state.outbox.find(o=>o.id===id);item.status=result.ok?'done':'conflict';item.acknowledgedAt=new Date(this.clock()).toISOString();item.message=result.ok?'تم الاعتماد في الموقع':(result.message||result.code||'تعارض يحتاج مراجعة');this.store.save();});
    }
    if(stillPresent()){
     const snapshot=await this.cloud.snapshot(session.tokens.access_token);
     await this.store.exclusive(()=>{if(stillPresent()){this.state.snapshots[owner]=snapshot;this.state.lastSync=new Date(this.clock()).toISOString();this.lastError=null;this.store.save();}});
    }
   }catch(e){
    await this.store.exclusive(()=>{
     const pending=this.state.outbox.filter(o=>o.owner===owner&&['pending','sending'].includes(o.status));
     const newer=active().some(s=>s!==session&&s.profile.auth_id===owner&&s.expires>session.expires);
     if([400,401,403].includes(e.status)&&!newer){
      pending.forEach(o=>{o.status='blocked';o.message='يلزم دخول رسمي جديد ومراجعة صلاحية الحساب';});
      Object.entries(this.state.sessions).forEach(([key,s])=>{if(s.profile.auth_id===owner)delete this.state.sessions[key];});
     }else pending.forEach(o=>{o.status='pending';});
     this.lastError='لم تكتمل المزامنة؛ الطلبات محفوظة محلياً';this.store.save();
    });
   }
  }
  return {pending:this.state.outbox.filter(o=>['pending','sending'].includes(o.status)).length};
 }

 archive(key){return this.store.exclusive(()=>{
  if(!this.archiveDir)throw new Error('archive_not_configured');const at=new Date(this.clock()).toISOString(),path=join(this.archiveDir,'office-'+at.replace(/[:.]/g,'-')+'.enc');
  // Contains the encrypted shared working state, not a full cloud DB dump.
  const copy=JSON.parse(JSON.stringify(this.state));copy.sessions={};
  atomicWrite(path,seal(copy,key));unseal(readFileSync(path),key);
  const names=readdirSync(this.archiveDir).filter(n=>/^office-[\dTZ.-]+\.enc$/.test(n)).sort();for(const old of names.slice(0,-168))unlinkSync(join(this.archiveDir,old));
  this.state.backup={at,type:'encrypted-office-state'};this.store.save();return {at};
 });}
}
