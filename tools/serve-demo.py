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
