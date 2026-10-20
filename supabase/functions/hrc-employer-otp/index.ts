// Retired: employer verification now uses per-job PIN RPCs, never WhatsApp.
// Keep the endpoint fail-closed so cached clients cannot send messages or authenticate.
export async function handler(req: Request): Promise<Response> {
  const origin=req.headers.get('origin');
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin','Access-Control-Allow-Headers':'content-type,apikey,authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(origin)headers['Access-Control-Allow-Origin']=origin;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  return new Response(JSON.stringify({ok:false,code:'retired',error:'انتقل الدخول إلى الرمز السري الخاص بالوظيفة. أعد تحميل صفحة صاحب العمل.'}),{status:410,headers});
}
Deno.serve(handler);
