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
    """صفحة نسخ ملف تحديث القاعدة بضغطة واحدة (زر للمعاينة فقط)."""
    with open(os.path.join(ROOT, 'docs', 'UPDATE-2026-10-02.sql'), encoding='utf-8') as f:
        sql = f.read()
    esc = sql.replace('&', '&amp;').replace('<', '&lt;')
    return ("""<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تحديث قاعدة بيانات Supabase — نسخ بضغطة</title>
<style>
body{font-family:system-ui,sans-serif;background:#f5f7fb;margin:0;padding:18px}
.card{max-width:880px;margin:auto;background:#fff;border:1px solid #dfe4ec;border-radius:16px;padding:20px;box-shadow:0 10px 30px rgba(16,27,52,.06)}
h3{margin:0 0 10px;color:#101b34}
ol{margin:8px 0 14px;padding-inline-start:22px;color:#37435c;font-size:15px;line-height:2}
button{font:700 17px system-ui;padding:15px 22px;border-radius:12px;border:0;background:linear-gradient(135deg,#c8a24a,#a9852f);color:#fff;width:100%;cursor:pointer}
button:active{transform:scale(.98)}
.ok{color:#1f8f96;font-weight:800;margin-top:12px;text-align:center;display:none;font-size:16px}
textarea{width:100%;height:36vh;margin-top:14px;font:11px/1.45 monospace;direction:ltr;border:1px solid #dfe4ec;border-radius:10px;padding:10px;box-sizing:border-box;background:#fafbfe;color:#37435c}
.tiny{color:#7a869c;font-size:12.5px;margin-top:10px;line-height:1.8}
</style></head><body><div class="card">
<h3>🗄️ تحديث قاعدة بيانات Supabase (2026-10-02)</h3>
<ol>
<li>اضغط الزر تحت — ينسخ ملف SQL كاملاً للحافظة</li>
<li>افتح <b>supabase.com</b> → مشروعك → من القائمة: <b>SQL Editor</b> → <b>New query</b></li>
<li>ضغط مطول بمربع الكود → <b>لصق</b> → اضغط <b>Run</b></li>
<li>النجاح: رسالة خضراء <b dir="ltr">Success. No rows returned</b></li>
</ol>
<button onclick="navigator.clipboard.writeText(document.getElementById('sql').value).then(function(){document.getElementById('ok').style.display='block'}).catch(function(){document.getElementById('sql').select()})">📋 انسخ ملف SQL كاملاً بضغطة</button>
<div class="ok" id="ok">✅ اننسخ — الحين الصقه بمحرر SQL عند Supabase واضغط Run</div>
<textarea id="sql" readonly onfocus="this.select()">""" + esc + """</textarea>
<p class="tiny">آمن للإعادة أي عدد من المرات · لا يحذف جدولاً ولا يمس بيانات الزبائن · كل جملة إما «إن لم تكن موجودة» أو «استبدل إن وجدت». إذا ظهر خطأ أحمر بمحرر SQL صوّره وابعثه — لا شيء ينكسر.</p>
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
