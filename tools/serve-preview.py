#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""خادم معاينة بسيط لصفحات التصميم.

يقدّم جذر المستودع كملفات ثابتة، ويحوّل المسار الجذر (/) إلى صفحة المعاية
المطلوبة حتى تفتح مباشرة في نافذة المعاينة الحية.

الاستخدام:
    python3 tools/serve-preview.py [المنفذ] [صفحة المعاينة]
    python3 tools/serve-preview.py 8788 card-design.html
"""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    """يقدّم ملفات المستودع ويحوّل الجذر إلى صفحة المعاينة."""

    target = "card-design.html"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path in ("/", "/index.html", "/preview", "/preview/"):
            self.path = "/" + self.target
        return super().do_GET()

    def end_headers(self):
        # تعطيل التخزين المؤقت حتى تظهر التعديلات فوراً أثناء المعاينة
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[preview] %s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
    if len(sys.argv) > 2:
        PreviewHandler.target = sys.argv[2].strip("/")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), PreviewHandler)
    print("[preview] serving %s on http://0.0.0.0:%d -> /%s" % (ROOT, port, PreviewHandler.target))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
