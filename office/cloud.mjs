// Public project key only. User tokens stay encrypted on the laptop, not in JS.
export class Cloud {
 constructor(url,key,fetcher=fetch){this.url=new URL(url);if(this.url.protocol!=='https:')throw new Error('https_required');this.key=key;this.fetch=fetcher;}
 async request(path,token,method='GET',body){
  const r=await this.fetch(new URL(path,this.url),{method,signal:AbortSignal.timeout(15000),headers:{apikey:this.key,Authorization:'Bearer '+(token||this.key),'Content-Type':'application/json','Accept-Profile':'brc','Content-Profile':'brc'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Object.assign(new Error('cloud_request_failed'),{status:r.status});return r.status===204?null:r.json();
 }
 async profile(token){const user=await this.request('/auth/v1/user',token);const rows=await this.request('/rest/v1/staff?auth_id=eq.'+encodeURIComponent(user.id)+'&select=id,auth_id,username,full_name,role,active',token);const p=rows[0];if(!p||p.active!==true||!['admin','staff'].includes(p.role))throw Object.assign(new Error('inactive_or_unauthorized'),{status:403});return p;}
 async login(username,password){const email=username.includes('@')?username:username+'@hrc-babil.com';const tokens=await this.request('/auth/v1/token?grant_type=password',null,'POST',{email,password});return {tokens,profile:await this.profile(tokens.access_token)};}
 async refresh(session,onTokens=()=>{}){
  if(!session.tokens.expires_at || session.tokens.expires_at*1000<Date.now()+60000){
   session.tokens=await this.request('/auth/v1/token?grant_type=refresh_token',null,'POST',{refresh_token:session.tokens.refresh_token});
   await onTokens(); // fsync rotated token BEFORE any subsequent network request
  }
  return this.profile(session.tokens.access_token);
 }
 async all(table,fields,token){let rows=[];for(let offset=0;offset<100000;offset+=500){const page=await this.request('/rest/v1/'+table+'?select='+fields+'&order='+({jobs:'code',applicants:'serial',job_attempts:'id'}[table])+'&offset='+offset+'&limit=500',token);rows.push(...page);if(page.length<500)return rows;}throw new Error('snapshot_limit');}
 async ready(token){const r=await this.submit(token,{id:'00000000-0000-0000-0000-000000000000',kind:'capability',data:{},expected:{}});if(r.code!=='invalid_request')throw new Error('office_rpc_unavailable');}
 async snapshot(token){const [jobs,applicants,attempts]=await Promise.all([
  this.all('jobs','code,title,status,notes,updated_at',token),
  this.all('applicants','serial,full_name,phone,status,expiry_date,updated_at',token),
  this.all('job_attempts','id,serial,attempt_no,job_code,slot_status',token)]);
  return {at:new Date().toISOString(),jobs,applicants,attempts};
 }
 submit(token,op){return this.request('/rest/v1/rpc/office_submit',token,'POST',{p_id:op.id,p_kind:op.kind,p_data:op.data,p_expected:op.expected});}
}
