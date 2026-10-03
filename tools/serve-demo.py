#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""خادم معاينة تجريبي لنسخة «بطاقة التوظيف» — للتجربة أمام العميل فقط.

هذا الملف خارج الإنتاج تماماً: لا يستخدمه الموقع الحقيقي ولا أدوات البناء.
يقدّم الموقع من جذر المستودع مع حجبين للمعاينة فقط:
  1) supabase-config.js  →  enabled=false  (وضع محلي بلا أي اتصال بالقاعدة الحقيقية)
  2) config.js           →  حسابات دخول تجريبية + بذرة بيانات العرض (وظائف وبطاقات وهمية)
وفي كل صفحة HTML يحقن زر «♻️ تصفير بيانات التجربة»: كل بيع تجربة يحجز وظيفته
24 ساعة وبذرة العرض فيها وظائف متاحة معدودة — فبعد عدة تجارب ينفد المخزون
ويظن المجرّب أن المنظومة معطلة. الزر يصفّر بيانات المتصفح ويعيد البذرة الأولى.

النتيجة: المنظومة تعمل ببيانات وهمية داخل متصفح الزائر فقط — إنشاء البطاقات
والبيع والطباعة كلها تُجرَّب بأمان، ولا شيء يُكتب في قاعدة Supabase الحقيقية.

الاستخدام:  python3 tools/serve-demo.py [المنفذ]     (الافتراضي 8790)
"""
import http.server
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# بذرة العرض من ملف الاختبارات (نفس أسلوب tools/build.mjs)
with open(os.path.join(ROOT, 'tests/fixtures/demo-seed.mjs'), encoding='utf-8') as f:
    m = re.search(r'export const DEMO_SEED = ([\s\S]*?);\n', f.read())
    if not m:
        raise SystemExit('تعذّر استخراج DEMO_SEED')
DEMO_SEED = m.group(1)

CONFIG_OVERLAY = """

/* ===================== وضع المعاينة التجريبية فقط =====================
 * هذه الأسطر تُضاف بواسطة خادم المعاينة (tools/serve-demo.py) ولا وجود لها
 * في المستودع ولا في الإنتاج: حسابات دخول للتجربة + بذرة بيانات وهمية. */
HRC_CONFIG.users = [
  { username: 'admin', password: 'admin1234', name: 'مدير المعاينة', role: 'admin', title: 'مدير عام' },
  { username: 'staff', password: 'staff1234', name: 'موظف المعاينة', role: 'staff', title: 'موظف توظيف' }
];
HRC_CONFIG.seed = %s;
""" % DEMO_SEED

SUPABASE_OFF = """

/* ===================== وضع المعاينة: السحابة مطفأة =====================
 * خادم المعاينة يضيف هذا السطر حتى لا يتصل المتصفح بقاعدة Supabase الحقيقية
 * إطلاقاً — كل شيء يبقى محلياً في متصفح من يجرّب. */
window.HRCSupabaseConfig.enabled = false;
"""

RESET_JS = """(function () {
  function add() {
    if (document.getElementById('__demo_reset')) return;
    var b = document.createElement('button');
    b.id = '__demo_reset'; b.dir = 'rtl';
    b.textContent = '\\u267B\\uFE0F \\u062A\\u0635\\u0641\\u064A\\u0631 \\u0628\\u064A\\u0627\\u0646\\u0627\\u062A \\u0627\\u0644\\u062A\\u062C\\u0631\\u0628\\u0629';
    b.style.cssText = 'position:fixed;bottom:14px;left:14px;z-index:99999;direction:rtl;' +
      'font:700 13px system-ui,sans-serif;padding:10px 16px;border-radius:999px;cursor:pointer;' +
      'border:1px solid #c8a24a;background:#101b34;color:#f5d67b;box-shadow:0 8px 24px rgba(0,0,0,.35)';
    b.onclick = function () {
      if (window.confirm('\\u062A\\u0635\\u0641\\u064A\\u0631 \\u0628\\u064A\\u0627\\u0646\\u0627\\u062A \\u0627\\u0644\\u062A\\u062C\\u0631\\u0628\\u0629\\u061F\\n' +
          '\\u064A\\u062D\\u0630\\u0641 \\u0643\\u0644 \\u0628\\u0637\\u0627\\u0642\\u0627\\u062A\\u0643 \\u0648\\u062D\\u062C\\u0648\\u0632\\u0627\\u062A\\u0643 \\u0627\\u0644\\u062A\\u062C\\u0631\\u064A\\u0628\\u064A\\u0629 \\u0648\\u064A\\u0639\\u064A\\u062F \\u0628\\u064A\\u0627\\u0646\\u0627\\u062A \\u0627\\u0644\\u0639\\u0631\\u0636 \\u0627\\u0644\\u0623\\u0648\\u0644\\u0649.\\n' +
          '(\\u0632\\u0631 \\u0644\\u0644\\u0645\\u0639\\u0627\\u064A\\u0646\\u0629 \\u0641\\u0642\\u0637 \\u2014 \\u0644\\u0627 \\u0648\\u062C\\u0648\\u062F \\u0644\\u0647 \\u0628\\u0627\\u0644\\u0645\\u0648\\u0642\\u0639 \\u0627\\u0644\\u062D\\u0642\\u064A\\u0642\\u064A)')) {
        try { window.localStorage.clear(); } catch (e) { }
        window.location.reload();
      }
    };
    (document.body || document.documentElement).appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
})();
"""


def db_update_page():
    """صفحة تحديث القاعدة بأجزاء صغيرة يُنسخ كل منها بضغطة (زر للمعاينة فقط).

    لماذا أجزاء؟ النسخ الكامل (134KB) انقطع بلصق الجوال مرة (2026-10-02:
    «unterminated dollar-quoted string») — كل جزء هنا أقل من 25KB فيصل كاملاً،
    ولكل جزء «سطر الختام» يتأكد منه الملصِق قبل Run. المسار الموثق لترقية
    قاعدة قائمة هو ملفات الهجرات الأربعة؛ docs/schema.sql الكامل للقواعد
    الجديدة ولا حاجة إليه هنا.
    """
    # الجزء 0: قيم التعداد تُثبَّت بمعزل عن استخدامها — محرر Supabase يشغّل كل
    # لصقة بمعاملة واحدة، فيرفض PostgreSQL استخدام قيمة أُضيفت بالدفعة نفسها
    # (55P04 «unsafe use of new value» — فجَّر الجزء 1 عند سطر 491 من 495).
    enum_sql = ("alter type brc.slot_status add value if not exists 'critical';\n"
                "alter type brc.form_status add value if not exists 'blank';\n"
                "alter type brc.job_status  add value if not exists 'hiring';\n"
                "alter type brc.slot_status add value if not exists 'hiring';\n")
    parts = [
        ('0', 'تثبيت قيم التعداد الجديدة ★ ابدأ بهذا — 4 أسطر',
         None,
         "alter type brc.slot_status add value if not exists 'hiring';"),
        ('1', 'نظام البطاقات v1 — الحالة الحرجة ورمز الفرصة السري',
         'supabase/migrations/20260930000000_card_system_v1.sql',
         '-- سجلاً تاريخياً؛ الجديدة تُعالج بـ brc.run_auto_release() المحذَّثة (حالة حرجة).'),
        ('2', 'دفعات البطاقات الفارغة والباركودات العشوائية',
         'supabase/migrations/20260930010000_blank_batches_random_serials.sql',
         "--    الفارغة الجديدة تُدرج بـ status='blank' و issue_date=null من الواجهة."),
        ('3', 'بيع نقطة البيع باختيار الوظيفة + صفحة صاحب العمل ★ الأهم',
         'supabase/migrations/20260930020000_pos_sale_and_employer.sql',
         'grant execute on function brc.employer_decide(text, text)    to anon, authenticated;'),
        ('4', 'طلب صاحب العمل (توظيف/عدم توظيف) وقرار الشركة',
         'supabase/migrations/20260930030000_employer_request_company_decision.sql',
         "'استمارة منتهية الصلاحية (30 يوماً)' يسبقها where f.status = 'expired';"),
    ]
    cards = ''
    hidden = ''
    for num, title, rel, last_line in parts:
        if rel is None:
            sql = enum_sql
        else:
            with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
                sql = f.read()
        esc = sql.replace('&', '&amp;').replace('<', '&lt;')
        cards += ('<div class="part"><div class="phead"><span class="badge">' + num +
                  '</span><b>' + title + '</b><span class="kb">' + str(len(sql) // 1024) + 'KB</span></div>'
                  '<button onclick="cp(\'sql' + num + '\')">📋 انسخ الجزء ' + num + '</button>'
                  '<div class="ok" id="ok' + num + '">✅ اننسخ — الصقه بمحرر SQL واضغط Run</div>'
                  '<div class="verify">بعد اللصق اسحب لآخر النص وتأكد أن آخر سطر هو:<br><code dir="ltr">' +
                  last_line.replace('&', '&amp;').replace('<', '&lt;') + '</code></div></div>')
        hidden += '<textarea id="sql' + num + '" class="hidden-ta" readonly>' + esc + '</textarea>'
    notify = "notify pgrst, 'reload schema';"
    return ("""<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تحديث قاعدة بيانات Supabase — بأجزاء صغيرة</title>
<style>
body{font-family:system-ui,sans-serif;background:#f5f7fb;margin:0;padding:16px;color:#101b34}
.wrap{max-width:720px;margin:auto}
h3{margin:2px 0 8px}
.steps{background:#fff;border:1px solid #dfe4ec;border-radius:14px;padding:14px 16px;margin-bottom:14px;font-size:14.5px;line-height:2;color:#37435c}
.steps b{color:#101b34}
.part{background:#fff;border:1px solid #dfe4ec;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 6px 18px rgba(16,27,52,.04)}
.phead{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:15px}
.phead b{flex:1}
.badge{width:30px;height:30px;border-radius:50%;background:#101b34;color:#f5d67b;display:grid;place-items:center;font-weight:800;flex:none}
.kb{font-size:12px;color:#7a869c;background:#f1f3f9;border-radius:99px;padding:3px 10px;flex:none}
button{font:700 16px system-ui;padding:13px 20px;border-radius:12px;border:0;background:linear-gradient(135deg,#c8a24a,#a9852f);color:#fff;width:100%;cursor:pointer}
button:active{transform:scale(.98)}
button.final{background:linear-gradient(135deg,#3ec1a0,#1f8f96)}
.ok{color:#1f8f96;font-weight:800;margin-top:10px;text-align:center;display:none;font-size:15px}
.verify{margin-top:12px;font-size:13px;color:#5b677e;line-height:1.9;background:#fafbfe;border:1px dashed #d5dcea;border-radius:10px;padding:10px 12px}
.verify code{direction:ltr;display:block;font-size:11px;color:#8a6d1f;background:#fdf9ee;padding:6px 8px;border-radius:8px;margin-top:5px;overflow-wrap:anywhere}
.hidden-ta{position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0}
.tiny{color:#7a869c;font-size:12.5px;margin:10px 2px 0;line-height:1.9}
</style></head><body><div class="wrap">
<h3>🗄️ تحديث قاعدة بيانات Supabase — بأجزاء صغيرة</h3>
<div class="steps">
<b>الطريقة:</b> افتح <b>Supabase → مشروعك → SQL Editor → + New query</b> (نافذة جديدة فاضية — امسح أي نص قديم فيها).
بعدها شغّل الأجزاء الستة تحت <b>بالترتيب</b> — الجزء 0 أولاً لأنه يثبّت قيم التعداد بلصقة لحالها (قانون PostgreSQL: القيمة الجديدة لازم تثبت قبل استخدامها بنفس الدفعة): اضغط زر النسخ → اضغط مطولاً بمحرر SQL → لصق → <b>Run</b> → لازم تطلع خضرا <b dir="ltr">Success</b> → بعدها الجزء اللي بعده.
</div>
""" + cards + """
<div class="part"><div class="phead"><span class="badge">5</span><b>إعادة تحميل ذاكرة المخطط (سطر واحد)</b></div>
<button class="final" onclick="cp('sql5')">📋 انسخ الجزء 5 (الأخير)</button>
<div class="ok" id="ok5">✅ اننسخ — الصقه واضغط Run وخلصنا</div>
<div class="verify">آخر سطر بعد اللصق لازم يكون:<br><code dir="ltr">notify pgrst, 'reload schema';</code></div></div>
<p class="tiny">كل الأجزاء آمنة للإعادة أي عدد مرات («إن لم توجد / استبدل إن وجدت») ولا تمس بيانات الزبائن — إذا فشل جزء في منتصفه، أعِد ضغط زره ولصقه من جديد ثم Run. إذا استمر خطأ أحمر: صوّره وابعثه.</p>
""" + hidden + """
<textarea id="sql5" class="hidden-ta" readonly>""" + notify + """</textarea>
<script>
function cp(id){
  var t=document.getElementById(id);
  t.style.position='static';t.style.width='100%';t.style.height='40px';t.style.opacity='1';
  t.focus();t.select();
  var done=function(){document.getElementById('ok'+id.replace('sql','')).style.display='block';
    t.style.position='fixed';t.style.left='-9999px';t.style.width='10px';t.style.height='10px';t.style.opacity='0';};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t.value).then(done).catch(function(){try{document.execCommand('copy');done();}catch(e){}});}
  else{try{document.execCommand('copy');done();}catch(e){}}
}
</script>
</div></body></html>""")


class DemoHandler(http.server.SimpleHTTPRequestHandler):
    # ملفا الحجب للمعاينة (مساران ثابتان — لا شيء غيرهما)
    OVERLAYS = {
        '/assets/js/supabase-config.js': SUPABASE_OFF,
        '/assets/js/config.js': CONFIG_OVERLAY,
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _send(self, data, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path in ('/', '/index.html', '/preview', '/preview/', '/dashboard'):
            self.path = '/dashboard.html'
            path = '/dashboard.html'
        if path == '/__demo_reset.js':
            self._send(RESET_JS.encode('utf-8'), 'application/javascript; charset=utf-8')
            return
        if path == '/__db-update':
            self._send(db_update_page().encode('utf-8'), 'text/html; charset=utf-8')
            return
        if path in self.OVERLAYS:
            fp = os.path.join(ROOT, path.lstrip('/'))
            with open(fp, 'rb') as f:
                data = f.read() + self.OVERLAYS[path].encode('utf-8')
            self._send(data, self.guess_type(fp))
            return
        # حقن زر التصفير في كل صفحة HTML (المعاينة فقط)
        if path.endswith('.html'):
            fp = os.path.join(ROOT, path.lstrip('/'))
            if os.path.isfile(fp):
                with open(fp, 'rb') as f:
                    html = f.read()
                tag = b'<script src="/__demo_reset.js"></script>'
                if tag not in html:
                    html = html.replace(b'</body>', tag + b'</body>', 1) \
                        if b'</body>' in html else html + tag
                self._send(html, 'text/html; charset=utf-8')
                return
        super().do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), DemoHandler)
    print('[demo] serving %s on http://0.0.0.0:%d -> /dashboard.html (local demo mode + reset button)' % (ROOT, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
