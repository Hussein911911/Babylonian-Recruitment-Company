#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
md2pdf-ar.py — تحويل عقد Markdown العربي إلى PDF جاهز للطباعة والتوقيع.

لماذا سكربت خاص ولا أداة جاهزة؟
  البيئة بلا pandoc/wkhtmltopdf/chromium، والأهم أن العربية تحتاج معالجتين
  لا توفّرهما مولّدات PDF البسيطة:
    1) تشكيل الحروف (reshaping): ربط الحروف بأشكالها الأولية/الوسطية/النهائية.
    2) الاتجاه الثنائي (bidi): ترتيب العرض من اليمين لليسار مع إبقاء الأرقام
       والكلمات اللاتينية بترتيبها الصحيح.
  بدونهما تخرج الحروف منفصلة ومقلوبة.

يدعم: العناوين · القوائم · الجداول · الاقتباسات · الفواصل · النص الغليظ.
"""
import re
import sys
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import Align

# خطّا Cairo مدموجان (عربي + لاتيني) — انظر tools/fonts/README.md
FONT_DIR = Path(__file__).parent / 'fonts'
PAGE_W, MARGIN = 210, 18
CONTENT_W = PAGE_W - 2 * MARGIN

INK = (28, 32, 38)
MUTED = (110, 118, 128)
ACCENT = (26, 61, 122)      # لازوردي قريب من هوية الموقع
LINE = (214, 219, 226)
BAND = (243, 246, 250)
WARN_BG = (253, 242, 242)
WARN_BD = (220, 160, 160)


def ar(text: str) -> str:
    """النص كما هو: التشكيل والاتجاه يتكفّل بهما HarfBuzz داخل fpdf2.

    ⚠️ لا تُعِد arabic_reshaper + bidi هنا: الخط يحمل ميزات الربط
    (init/medi/fina/rlig) وHarfBuzz يطبّقها على الحروف الأساسية. التشكيل
    اليدوي يحوّل النص إلى «الأشكال المقدَّمة» (U+FE70+) وهي ناقصة في الخط،
    فتظهر مربّعات فارغة ويُطبع تحذير missing glyphs.
    """
    return str(text) if text else ''


def strip_md(s: str) -> str:
    """يزيل ترميز Markdown المضمّن ويُبقي النص."""
    s = re.sub(r'\*\*(.+?)\*\*', r'\1', s)
    s = re.sub(r'\*(.+?)\*', r'\1', s)
    s = re.sub(r'`(.+?)`', r'\1', s)
    s = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', s)
    return s.strip()


class Contract(FPDF):
    def __init__(self, title_ar='عقد تصميم وتسليم نظام إلكتروني'):
        super().__init__(orientation='P', unit='mm', format='A4')
        self.set_margins(MARGIN, 16, MARGIN)
        self.set_auto_page_break(True, margin=18)
        self.add_font('Cairo', '', str(FONT_DIR / 'Cairo-400.ttf'))
        self.add_font('Cairo', 'B', str(FONT_DIR / 'Cairo-700.ttf'))
        self.set_font('Cairo', '', 10.5)
        # تشكيل عربي صحيح + ترتيب ثنائي الاتجاه (يتطلب uharfbuzz)
        self.set_text_shaping(True, direction='rtl', script='Arab',
                              language='ar')
        # ترويسة الصفحات الداخلية — تُمرَّر من build() لأن الأداة تُستخدم
        # لأكثر من مستند (عقد التسليم · أوراق العرض للإدارة).
        self.title_ar = title_ar

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font('Cairo', '', 8)
        self.set_text_color(*MUTED)
        self.cell(0, 6, ar(self.title_ar), align=Align.R)
        self.ln(7)
        self.set_draw_color(*LINE)
        self.set_line_width(0.2)
        self.line(MARGIN, self.get_y(), PAGE_W - MARGIN, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-14)
        self.set_font('Cairo', '', 8)
        self.set_text_color(*MUTED)
        total = getattr(self, 'total_pages', None)
        txt = (f'صفحة {self.page_no()} من {total}' if total
               else f'صفحة {self.page_no()}')
        self.cell(0, 5, ar(txt), align=Align.C)

    # ── عناصر المستند ────────────────────────────────────────────────
    def h1(self, txt):
        self.ln(2)
        self.set_font('Cairo', 'B', 17)
        self.set_text_color(*ACCENT)
        self.multi_cell(CONTENT_W, 9, ar(txt), align=Align.C)
        self.ln(1)
        self.set_draw_color(*ACCENT)
        self.set_line_width(0.6)
        y = self.get_y()
        self.line(MARGIN + 35, y, PAGE_W - MARGIN - 35, y)
        self.ln(5)

    def h2(self, txt):
        if self.get_y() > 245:
            self.add_page()
        self.ln(3)
        self.set_fill_color(*BAND)
        self.set_text_color(*ACCENT)
        self.set_font('Cairo', 'B', 12.5)
        self.multi_cell(CONTENT_W, 8, ar(txt), align=Align.R, fill=True)
        self.ln(2)

    def h3(self, txt):
        if self.get_y() > 252:
            self.add_page()
        self.ln(1.5)
        self.set_font('Cairo', 'B', 11)
        self.set_text_color(*INK)
        self.multi_cell(CONTENT_W, 6.5, ar(txt), align=Align.R)
        self.ln(0.5)

    def para(self, txt, size=10.5, color=INK):
        self.set_font('Cairo', '', size)
        self.set_text_color(*color)
        self.multi_cell(CONTENT_W, 6, ar(txt), align=Align.R)
        self.ln(1)

    def bullet(self, txt, marker='•', indent=0):
        self.set_font('Cairo', '', 10.5)
        self.set_text_color(*INK)
        w = CONTENT_W - 6 - indent
        x0 = MARGIN
        y0 = self.get_y()
        # النص أولاً (يمين)، ثم العلامة على يمينه
        self.set_xy(x0, y0)
        self.multi_cell(w, 6, ar(txt), align=Align.R)
        y1 = self.get_y()
        self.set_xy(PAGE_W - MARGIN - 6 - indent + 1.5, y0)
        self.cell(5, 6, ar(marker), align=Align.R)
        self.set_xy(x0, y1)

    def quote(self, lines):
        txt = ' '.join(lines)
        self.set_font('Cairo', '', 9.8)
        self.set_fill_color(*WARN_BG)
        self.set_draw_color(*WARN_BD)
        self.set_text_color(90, 40, 40)
        self.set_line_width(0.3)
        # لا تُقسم الصناديق التنبيهية القصيرة بين صفحتين
        n = max(1, len(self.multi_cell(
            CONTENT_W, 6, ar(txt), align=Align.R,
            dry_run=True, output='LINES')))
        if self.get_y() + n * 6 > 272:
            self.add_page()
        x, y = MARGIN, self.get_y()
        self.multi_cell(CONTENT_W, 6, ar(txt), align=Align.R,
                        fill=True, border=1)
        self.ln(2)
        self.set_text_color(*INK)

    def hr(self):
        self.ln(2)
        self.set_draw_color(*LINE)
        self.set_line_width(0.3)
        y = self.get_y()
        self.line(MARGIN, y, PAGE_W - MARGIN, y)
        self.ln(3)

    def _table_widths(self, rows):
        """عرض الأعمدة تقديرياً حسب أطول محتوى، مع حدّ أدنى."""
        ncol = max(len(r) for r in rows)
        rows = [r + [''] * (ncol - len(r)) for r in rows]
        weights = []
        for c in range(ncol):
            longest = max(len(strip_md(r[c])) for r in rows)
            weights.append(max(longest, 6))
        total = sum(weights)
        widths = [max(CONTENT_W * w / total, 16) for w in weights]
        scale = CONTENT_W / sum(widths)
        return [w * scale for w in widths]

    def _table_row_h(self, cells, widths):
        self.set_font('Cairo', '', 9.2)
        line_h = 5.4
        h = 0
        for i, cell in enumerate(cells):
            txt = strip_md(cell)
            n = max(1, len(self.multi_cell(
                widths[i], line_h, ar(txt), align=Align.R,
                dry_run=True, output='LINES')))
            h = max(h, n * line_h)
        return h + 1.6

    def _nlines(self, w, h, txt, size, bold=False):
        self.set_font('Cairo', 'B' if bold else '', size)
        return max(1, len(self.multi_cell(
            w, h, ar(txt), align=Align.R, dry_run=True, output='LINES')))

    def est_h(self, kind, val):
        """الارتفاع التقديري لعنصر (مم) — يُستخدم لمنع انقسام المادة
        بين صفحتين: تُقاس المادة كاملة قبل رسمها."""
        if kind == 'h1':
            return 8 + self._nlines(CONTENT_W, 9, val, 17, True) * 9
        if kind == 'h2':
            return 5 + self._nlines(CONTENT_W, 8, val, 12.5, True) * 8
        if kind == 'h3':
            return 2 + self._nlines(CONTENT_W, 6.5, val, 11, True) * 6.5
        if kind == 'p':
            return self._nlines(CONTENT_W, 6, val, 10.5) * 6 + 1
        if kind == 'li':
            txt, mark, indent = val
            return self._nlines(CONTENT_W - 6 - indent, 6, txt, 10.5) * 6
        if kind == 'quote':
            return self._nlines(CONTENT_W, 6, ' '.join(val), 9.8) * 6 + 2
        if kind == 'hr':
            return 5
        if kind == 'table':
            widths = self._table_widths(val)
            ncol = len(widths)
            padded = [r + [''] * (ncol - len(r)) for r in val]
            return sum(self._table_row_h(r, widths) for r in padded) + 3
        return 0

    def table(self, rows):
        """rows[0] رأس الجدول. الأعمدة تُعرض من اليمين لليسار."""
        if not rows:
            return
        ncol = max(len(r) for r in rows)
        rows = [r + [''] * (ncol - len(r)) for r in rows]
        widths = self._table_widths(rows)

        self.set_font('Cairo', '', 9.2)
        line_h = 5.4

        def row_height(cells):
            return self._table_row_h(cells, widths)

        # لا نبدأ جدولاً في ذيل الصفحة: الرأس وحده (أو مع صف واحد) في أسفل
        # الورقة يُنتج جدولاً مقطوعاً يصعب قراءته على من يستلم المستند.
        head_h = row_height(rows[0])
        first_h = row_height(rows[1]) if len(rows) > 1 else 0
        # جدول صغير يسع صفحة كاملة يُنقل بأكمله بدل أن يُقسَم — مهم في
        # المستندات التعاقدية حيث الجدول وحدة معنى واحدة (مراحل، دفعات، مهل).
        total_h = sum(row_height(r) for r in rows)
        usable = 272 - MARGIN
        keep_together = total_h <= usable and self.get_y() + total_h > 272
        if keep_together or self.get_y() + head_h + first_h > 272:
            self.add_page()

        for ri, cells in enumerate(rows):
            head = ri == 0
            h = row_height(cells)
            if self.get_y() + h > 272:
                self.add_page()
                # تكرار رأس الجدول عند الامتداد لصفحة جديدة حتى تبقى
                # الأعمدة مفهومة بلا رجوع للصفحة السابقة.
                if not head:
                    hy = self.get_y()
                    hx = PAGE_W - MARGIN
                    self.set_font('Cairo', 'B', 9.2)
                    self.set_fill_color(*BAND)
                    self.set_text_color(*ACCENT)
                    self.set_draw_color(*LINE)
                    self.set_line_width(0.2)
                    for i, hc in enumerate(rows[0]):
                        hx -= widths[i]
                        self.set_xy(hx, hy)
                        self.multi_cell(widths[i], head_h, '', border=1, fill=True)
                        self.set_xy(hx, hy + 0.8)
                        self.multi_cell(widths[i], line_h, ar(strip_md(hc)),
                                        align=Align.R)
                    self.set_y(hy + head_h)
            y = self.get_y()
            # الرسم من اليمين لليسار
            x = PAGE_W - MARGIN
            self.set_font('Cairo', 'B' if head else '', 9.2)
            self.set_fill_color(*(BAND if head else (255, 255, 255)))
            self.set_text_color(*(ACCENT if head else INK))
            self.set_draw_color(*LINE)
            self.set_line_width(0.2)
            for i, cell in enumerate(cells):
                x -= widths[i]
                self.set_xy(x, y)
                self.multi_cell(widths[i], h, '', border=1, fill=True)
                self.set_xy(x, y + 0.8)
                self.multi_cell(widths[i], line_h, ar(strip_md(cell)),
                                align=Align.R)
            self.set_y(y + h)
        self.ln(3)
        self.set_text_color(*INK)


def parse(md: str):
    """يحوّل Markdown إلى قائمة عناصر (نوع، محتوى)."""
    out = []
    lines = md.split('\n')
    i = 0
    while i < len(lines):
        ln = lines[i].rstrip()

        if not ln.strip():
            i += 1
            continue

        if re.match(r'^---+$', ln.strip()):
            out.append(('hr', None))
            i += 1
            continue

        m = re.match(r'^(#{1,4})\s+(.*)', ln)
        if m:
            lvl = len(m.group(1))
            out.append((f'h{min(lvl,3)}', strip_md(m.group(2))))
            i += 1
            continue

        if ln.lstrip().startswith('>'):
            block = []
            while i < len(lines) and lines[i].lstrip().startswith('>'):
                block.append(strip_md(lines[i].lstrip()[1:].strip()))
                i += 1
            out.append(('quote', [b for b in block if b]))
            continue

        # جدول
        if ln.strip().startswith('|') and i + 1 < len(lines) \
                and re.match(r'^\s*\|[\s:|-]+\|\s*$', lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                raw = lines[i].strip().strip('|')
                if not re.match(r'^[\s:|-]+$', raw):
                    rows.append([c.strip() for c in raw.split('|')])
                i += 1
            out.append(('table', rows))
            continue

        # قائمة
        m = re.match(r'^(\s*)([-*+]|\d+\.)\s+(.*)', ln)
        if m:
            indent = len(m.group(1))
            marker = m.group(2)
            txt = strip_md(m.group(3))
            mark = marker if re.match(r'\d', marker) else '•'
            out.append(('li', (txt, mark, indent)))
            i += 1
            continue

        # فقرة (تُجمع الأسطر المتتابعة)
        buf = []
        while i < len(lines) and lines[i].strip() \
                and not re.match(r'^(#{1,4}\s|\s*[-*+]\s|\s*\d+\.\s|\||>|---)',
                                 lines[i]):
            buf.append(lines[i].strip())
            i += 1
        if buf:
            out.append(('p', strip_md(' '.join(buf))))
    return out


def first_title(md: str, fallback: str) -> str:
    """عنوان الترويسة = أول عنوان H1 في الملف، وإلا القيمة الافتراضية."""
    m = re.search(r'^#\s+(.+)$', md, re.M)
    return strip_md(m.group(1)) if m else fallback


def render(md: str, total=None, title_ar=None) -> Contract:
    doc = Contract(title_ar) if title_ar else Contract()
    doc.total_pages = total
    doc.add_page()
    first_h1 = True

    elements = parse(md)

    # تجميع العناصر: كل مادة (h2) أو ملحق (h1 لاحق) وحدة واحدة —
    # تُقاس قبل رسمها، فإن لم تسع المتبقي من الصفحة انتقلت كاملةً
    # إلى صفحة جديدة، فلا تبدأ مادة بذيل صفحة وتكتمل في التالية.
    groups, cur = [], []
    h1_seen = False
    for el in elements:
        if el[0] == 'h1':
            if h1_seen and cur:
                groups.append(cur)
                cur = []
            h1_seen = True
        elif el[0] == 'h2' and cur:
            groups.append(cur)
            cur = []
        cur.append(el)
    if cur:
        groups.append(cur)

    for g in groups:
        # الملحق (h1) يبدأ صفحة جديدة بنفسه؛ المواد (h2) هي التي
        # تحتاج القياس. المادة الأطول من صفحة كاملة تُترك تسيل
        # طبيعياً (لا مفرّ من تقسيمها).
        if g[0][0] == 'h2':
            h = sum(doc.est_h(k, v) for k, v in g)
            if doc.get_y() + h > 272 and h <= 240:
                doc.add_page()
        for kind, val in g:
            if kind == 'h1':
                if first_h1:
                    doc.h1(val)
                    first_h1 = False
                else:
                    # كل عنوان رئيسي لاحق (الملاحق عادةً) يبدأ صفحة جديدة
                    # بعنوان بارز — يفصل أقسام المستند الكبرى بشكل لا يلتبس.
                    doc.add_page()
                    doc.h1(val)
            elif kind == 'h2':
                doc.h2(val)
            elif kind == 'h3':
                doc.h3(val)
            elif kind == 'p':
                doc.para(val)
            elif kind == 'li':
                txt, mark, indent = val
                doc.bullet(txt, mark, indent)
            elif kind == 'table':
                doc.table(val)
            elif kind == 'quote':
                doc.quote(val)
            elif kind == 'hr':
                doc.hr()

    return doc


def build(md_path: Path, pdf_path: Path):
    """مروران: الأول لمعرفة عدد الصفحات، الثاني لكتابته في التذييل.
    (alias_nb_pages لا يصلح هنا: تشكيل HarfBuzz يحوّل {nb} إلى مسارات
    فلا يبقى نصاً قابلاً للاستبدال لاحقاً.)"""
    md = md_path.read_text(encoding='utf-8')
    title = first_title(md, 'عقد تصميم وتسليم نظام إلكتروني')
    n = render(md, title_ar=title).page_no()
    doc = render(md, total=n, title_ar=title)
    doc.output(str(pdf_path))
    return pdf_path


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('الاستعمال: md2pdf-ar.py <مصدر.md> [ناتج.pdf]')
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2] if len(sys.argv) > 2
               else src.with_suffix('.pdf'))
    p = build(src, dst)
    print(f'✅ {p}  ({p.stat().st_size/1024:.0f} ك.ب)')
