// Public bootstrap; authorization comes from rate-limited WhatsApp OTP, not anon JWTs.
// Secrets, destination phone, OTP hashes and scoped session hashes never enter frontend code.
const env = (key: string) => Deno.env.get(key) || '';
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
async function digest(value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('EMPLOYER_OTP_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}
function otp() {
  let n: number; do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= 4294000000);
  return String(n % 1000000).padStart(6, '0');
}
async function rpc(name: string, args: unknown) {
  const r = await fetch(env('SUPABASE_URL') + '/rest/v1/rpc/' + name, { method: 'POST', signal: AbortSignal.timeout(10000), headers: {
    apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'), 'Content-Type': 'application/json', 'Content-Profile': 'brc', 'Accept-Profile': 'brc'
  }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error('database_unavailable');
  return r.status === 204 ? null : r.json();
}
export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin') || '';
  const allowed = env('EMPLOYER_ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean);
  const headers: Record<string,string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', 'Access-Control-Allow-Headers': 'content-type,apikey,authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers});
  if (origin && !allowed.includes(origin)) return reply({ok:false,error:'هذا المصدر غير مسموح'},403);
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return reply({ok:false,error:'طريقة طلب غير مدعومة'},405);
  if (!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY') || env('EMPLOYER_OTP_SECRET').length < 32 || !allowed.length)
    return reply({ok:false,code:'not_configured',error:'خدمة التحقق لم تُفعّل بعد. راجع الشركة.'},503);
  try {
    if (Number(req.headers.get('content-length') || 0) > 4096) return reply({ok:false,error:'طلب غير صالح'},400);
    const reader = req.body?.getReader(); let raw = '', size = 0; const decoder = new TextDecoder();
    if (reader) { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return reply({ok:false,error:'طلب غير صالح'},413); }
      raw += decoder.decode(part.value,{stream:true}); } raw += decoder.decode(); }
    const b = JSON.parse(raw);
    if (b.action === 'request') {
      if (!env('WHATSAPP_ACCESS_TOKEN') || !/^\d+$/.test(env('WHATSAPP_PHONE_NUMBER_ID')) || !env('WHATSAPP_OTP_TEMPLATE'))
        return reply({ok:false,code:'not_configured',error:'إرسال رموز واتساب لم يُفعّل بعد. راجع الشركة.'},503);
      if (!/^[A-Z0-9-]{6,64}$/.test(b.serial || '') || !/^[A-Z0-9-]{3,40}$/.test(b.job || '')) return reply({ok:false,error:'تحقق من رقم البطاقة وكود الوظيفة'},400);
      const id = crypto.randomUUID(), code = otp();
      const hash = await digest('code:' + id + ':' + code);
      const ip = await digest('ip:' + (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',').pop()!.trim());
      const r = await rpc('employer_otp_issue',{p_id:id,p_serial:b.serial,p_job:b.job,p_hash:hash,p_ip:ip});
      if (!r?.ok) return reply({ok:false,error:'تعذّر طلب الرمز. تأكد من كود وظيفتك والبطاقة، أو انتظر قبل إعادة الطلب.'},429);
      let sent = false;
      try {
        const version = env('WHATSAPP_GRAPH_VERSION') || 'v23.0';
        if (!/^v\d+\.0$/.test(version)) throw new Error('configuration');
        const response = await fetch(`https://graph.facebook.com/${version}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env('WHATSAPP_ACCESS_TOKEN'),'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:r.phone,type:'template',template:{name:env('WHATSAPP_OTP_TEMPLATE'),language:{code:env('WHATSAPP_OTP_LANGUAGE')||'ar'},components:[{type:'body',parameters:[{type:'text',text:code}]},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:code}]}]}})});
        const result = await response.json(); sent = response.ok && typeof result.messages?.[0]?.id === 'string';
      } catch { sent = false; }
      await rpc('employer_otp_delivery',{p_id:id,p_success:sent});
      if (!sent) return reply({ok:false,error:'تعذّر إرسال الرمز عبر واتساب. حاول لاحقاً أو راجع الشركة.'},502);
      return reply({ok:true,challenge:id,expiresIn:300,resendAfter:60});
    }
    if (b.action === 'verify') {
      if (!/^[a-f0-9-]{36}$/i.test(b.challenge||'') || !/^\d{6}$/.test(b.code||'')) return reply({ok:false,error:'أدخل رمز التحقق المكوّن من ٦ أرقام'},400);
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const r = await rpc('employer_otp_verify',{p_id:b.challenge,p_hash:await digest('code:'+b.challenge+':'+b.code),p_session:await digest('session:'+token)});
      return r?.ok ? reply({ok:true,token,expiresIn:1200}) : reply({ok:false,error:'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً عند الحاجة.'},401);
    }
    if (b.action === 'view' || b.action === 'decide' || b.action === 'logout') {
      if (!/^[a-f0-9]{64}$/.test(b.token||'')) return reply({ok:false,error:'يرجى التحقق أولاً'},401);
      if (b.action==='decide' && (!['hire','reject'].includes(b.decision) || typeof b.reason!=='string' || b.reason.length>300)) return reply({ok:false,error:'بيانات القرار غير صحيحة'},400);
      const r = await rpc('employer_otp_action',{p_session:await digest('session:'+b.token),p_decision:b.action==='logout'?'logout':b.action==='decide'?b.decision:'',p_reason:b.action==='decide'?b.reason:''});
      return r?.ok ? reply(r) : reply({ok:false,code:r?.code||'denied',error:r?.code==='reason_required'?'اكتب سبباً واضحاً لا يقل عن ٣ أحرف':'تعذّر فتح الطلب أو تسجيل القرار. تحقق مجدداً أو راجع الشركة.'},403);
    }
    return reply({ok:false,error:'طلب غير صالح'},400);
  } catch { return reply({ok:false,error:'تعذّر إكمال الطلب. حاول لاحقاً أو راجع الشركة.'},503); }
}
Deno.serve(handler);
