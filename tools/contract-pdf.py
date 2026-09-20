#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
contract-pdf.py — يبني عقد التسليم كوثيقة احترافية بهوية بصرية كاملة.

لماذا مولّد مخصّص لا md2pdf العام؟
  العقد وثيقة تفاوض تُقدَّم لمشترٍ، ومظهرها جزء من قيمة ما يُباع. فبدل
  رصف نصّ Markdown، يُبنى هنا تخطيط مصمَّم: غلاف بالشعار، شريط جانبي
  ملوّن لكل بند، بطاقات للمبالغ، صناديق تحذير، وجدول تواقيع رسمي.

الهوية مأخوذة من الموقع نفسه:
  لازوردي #0b1a3a · ذهبي #c8a24a · نجمة عشتار الثمانية.

العربية: التشكيل والاتجاه عبر HarfBuzz في fpdf2 (يتطلب uharfbuzz).
لا تستعمل arabic_reshaper هنا — الخط يفتقر الأشكال المقدَّمة.
"""
import math
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos

FONT_DIR = Path(__file__).parent / 'fonts'
OUT = Path(__file__).parent.parent / 'docs' / 'عقد-التسليم.pdf'

# ── الهوية البصرية (من assets/css/style.css) ──────────────────────────
LAPIS = (11, 26, 58)
LAPIS2 = (16, 42, 86)
LAPIS3 = (23, 55, 108)
GOLD = (200, 162, 74)
GOLD_L = (232, 208, 137)
GOLD_D = (138, 109, 44)
INK = (20, 32, 58)
MUTED = (107, 119, 147)
HAIR = (222, 226, 235)
CREAM = (250, 248, 243)
BAND = (245, 247, 251)
WARN_BG = (253, 245, 233)
WARN_BD = (214, 168, 84)

W, H = 210, 297
M = 17
CW = W - 2 * M


def ar(t) -> str:
    """HarfBuzz يتكفّل بالتشكيل والاتجاه — نمرّر النص كما هو."""
    return str(t) if t else ''


class Doc(FPDF):
    def __init__(self):
        super().__init__('P', 'mm', 'A4')
        self.set_margins(M, 18, M)
        self.set_auto_page_break(True, 20)
        self.add_font('C', '', str(FONT_DIR / 'Cairo-400.ttf'))
        self.add_font('C', 'B', str(FONT_DIR / 'Cairo-700.ttf'))
        self.set_text_shaping(True, direction='rtl', script='Arab',
                              language='ar')
        self.total = None
        self.cover = True

    # ── ترويسة وتذييل ────────────────────────────────────────────────
    def header(self):
        if self.page_no() == 1:
            return
        self.set_fill_color(*LAPIS)
        self.rect(0, 0, W, 13, 'F')
        self.set_fill_color(*GOLD)
        self.rect(0, 13, W, 0.8, 'F')
        self.set_xy(M, 3.2)
        self.set_font('C', 'B', 8.5)
        self.set_text_color(*GOLD_L)
        self.cell(CW / 2, 6, ar('عقد تصميم وتسليم نظام إلكتروني'),
                  align=Align.R)
        self.set_xy(M, 3.2)
        self.set_font('C', '', 8)
        self.set_text_color(190, 200, 220)
        self.cell(CW / 2, 6, ar('شركة الهدف للتوظيف'), align=Align.L)
        self.set_y(22)

    def footer(self):
        # الغلاف بلا تذييل: نقارن برقم صفحته لا بعلم يتغيّر بعد رسمها
        if self.page_no() == 1:
            return
        self.set_y(-15)
        self.set_draw_color(*HAIR)
        self.set_line_width(0.2)
        self.line(M, self.get_y(), W - M, self.get_y())
        self.ln(1.5)
        self.set_font('C', '', 7.8)
        self.set_text_color(*MUTED)
        n = f'{self.page_no()} / {self.total}' if self.total else str(self.page_no())
        self.cell(CW / 2, 5, ar(n), align=Align.R)
        self.set_x(M)
        self.cell(CW / 2, 5, ar('نسخة الطرف:  الأول  /  الثاني'),
                  align=Align.L)

    # ── الشعار: نجمة عشتار الثمانية داخل دائرة ──────────────────────
    def emblem(self, cx, cy, r, ring=True):
        if ring:
            # ⚠️ fpdf2.circle(x, y, radius) يأخذ **المركز** ونصف القطر.
            #    تمرير (cx-r, cy-r, 2r) يزيح الشكل بمقدار r ويضاعف حجمه.
            self.set_draw_color(*GOLD)
            self.set_line_width(r * 0.055)
            self.circle(cx, cy, r)
            self.set_line_width(r * 0.018)
            self.set_draw_color(*GOLD_D)
            self.circle(cx, cy, r * 0.88)
        # ⚠️ circle(x, y, d) يأخذ الزاوية العليا اليسرى لا المركز، بينما
        #    polygon يأخذ إحداثيات مطلقة — فلا تخلط بينهما.
        pts = []
        for i in range(16):
            a = math.pi / 8 * i - math.pi / 2
            rr = r * (0.62 if i % 2 == 0 else 0.26)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        self.set_fill_color(*GOLD)
        self.set_draw_color(*GOLD)
        self.set_line_width(0.1)
        self.polygon(pts, style='DF')

    # ── الغلاف ───────────────────────────────────────────────────────
    def cover_page(self):
        self.add_page()
        self.set_fill_color(*LAPIS)
        self.rect(0, 0, W, H, 'F')
        # تدرّج علوي خفيف
        for i in range(60):
            t = i / 60
            self.set_fill_color(
                int(LAPIS[0] + (LAPIS3[0] - LAPIS[0]) * (1 - t) * 0.55),
                int(LAPIS[1] + (LAPIS3[1] - LAPIS[1]) * (1 - t) * 0.55),
                int(LAPIS[2] + (LAPIS3[2] - LAPIS[2]) * (1 - t) * 0.55))
            self.rect(0, i * 1.5, W, 1.6, 'F')

        self.emblem(W / 2, 58, 21)

        self.set_xy(M, 88)
        self.set_font('C', 'B', 26)
        self.set_text_color(*GOLD_L)
        self.cell(CW, 13, ar('عقد تصميم وتسليم'), align=Align.C,
                  new_y=YPos.NEXT, new_x=XPos.LMARGIN)
        self.cell(CW, 13, ar('نظام إلكتروني متكامل'), align=Align.C,
                  new_y=YPos.NEXT, new_x=XPos.LMARGIN)

        self.ln(4)
        self.set_draw_color(*GOLD)
        self.set_line_width(0.7)
        self.line(W / 2 - 28, self.get_y(), W / 2 + 28, self.get_y())

        self.ln(9)
        self.set_font('C', '', 13)
        self.set_text_color(225, 232, 245)
        self.cell(CW, 9, ar('شركة الهدف للتوظيف'), align=Align.C,
                  new_y=YPos.NEXT, new_x=XPos.LMARGIN)
        self.set_font('C', '', 10)
        self.set_text_color(150, 165, 195)
        self.cell(CW, 7, 'Al-Hadaf Recruitment Company', align=Align.C,
                  new_y=YPos.NEXT, new_x=XPos.LMARGIN)

        # بطاقة موجز النظام
        y = 172
        self.set_fill_color(18, 38, 74)
        self.set_draw_color(*GOLD_D)
        self.set_line_width(0.3)
        self.rect(M + 8, y, CW - 16, 58, 'DF')
        self.set_xy(M + 8, y + 5)
        self.set_font('C', 'B', 9.5)
        self.set_text_color(*GOLD)
        self.cell(CW - 16, 6, ar('موجز النظام'), align=Align.C,
                  new_y=YPos.NEXT)
        specs = [('6', 'جداول'), ('19', 'دالة'), ('18', 'سياسة حماية'),
                 ('133', 'فحص آلي')]
        cw = (CW - 26) / 4
        for i, (num, lbl) in enumerate(specs):
            x = M + 13 + (3 - i) * cw
            self.set_xy(x, y + 16)
            self.set_font('C', 'B', 17)
            self.set_text_color(*GOLD_L)
            self.cell(cw, 9, num, align=Align.C, new_y=YPos.NEXT)
            self.set_x(x)
            self.set_font('C', '', 8)
            self.set_text_color(165, 180, 208)
            self.cell(cw, 5, ar(lbl), align=Align.C)
        self.set_xy(M + 12, y + 40)
        self.set_font('C', '', 8.6)
        self.set_text_color(185, 198, 222)
        self.multi_cell(CW - 24, 5.2, ar(
            'موقع عام للباحثين عن عمل · منظومة داخلية لإدارة الوظائف '
            'والاستمارات · كيو آر كود موقَّع تشفيرياً · قاعدة بيانات سحابية'),
            align=Align.C)

        self.set_xy(M, 246)
        self.set_font('C', '', 9.5)
        self.set_text_color(160, 174, 202)
        self.cell(CW, 6, ar('حُرِّر في الحلة — بابل'), align=Align.C,
                  new_y=YPos.NEXT, new_x=XPos.LMARGIN)
        self.cell(CW, 6, ar('بتاريخ ......... / ......... / 20.........'),
                  align=Align.C, new_y=YPos.NEXT, new_x=XPos.LMARGIN)

        self.set_fill_color(*GOLD)
        self.rect(0, H - 5, W, 5, 'F')
        self.cover = False

    # ── عناصر المحتوى ────────────────────────────────────────────────
    def need(self, h):
        if self.get_y() + h > H - 24:
            self.add_page()

    def section(self, num, title):
        """عنوان بند برقم في مربّع ذهبي وشريط لازوردي."""
        self.need(22)
        self.ln(3)
        y = self.get_y()
        self.set_fill_color(*LAPIS)
        self.rect(M, y, CW, 11, 'F')
        self.set_fill_color(*GOLD)
        self.rect(W - M - 11, y, 11, 11, 'F')
        self.set_xy(W - M - 11, y)
        self.set_font('C', 'B', 10.5)
        self.set_text_color(*LAPIS)
        self.cell(11, 11, str(num), align=Align.C)
        self.set_xy(M, y)
        self.set_font('C', 'B', 12)
        self.set_text_color(*GOLD_L)
        self.cell(CW - 14, 11, ar(title), align=Align.R)
        self.set_y(y + 11)
        self.ln(3.5)

    def sub(self, txt, color=None):
        self.need(12)
        self.ln(1)
        self.set_font('C', 'B', 10.5)
        self.set_text_color(*(color or LAPIS2))
        y = self.get_y()
        self.set_fill_color(*GOLD)
        self.rect(W - M - 2, y + 1, 2, 5.5, 'F')
        self.set_xy(M, y)
        self.multi_cell(CW - 4, 6.5, ar(txt), align=Align.R)
        self.ln(1)

    def p(self, txt, size=10, color=INK, gap=1.5):
        self.set_font('C', '', size)
        self.set_text_color(*color)
        self.multi_cell(CW, 5.8, ar(txt), align=Align.R)
        self.ln(gap)

    def li(self, txt, mark='•', size=10, color=INK):
        self.need(8)
        self.set_font('C', '', size)
        self.set_text_color(*color)
        y0 = self.get_y()
        self.set_xy(M, y0)
        self.multi_cell(CW - 7, 5.6, ar(txt), align=Align.R)
        y1 = self.get_y()
        self.set_font('C', 'B', size - 0.5)
        self.set_text_color(*GOLD_D)
        self.set_xy(W - M - 6.5, y0)
        self.cell(5.5, 5.6, ar(mark), align=Align.R)
        self.set_xy(M, y1)

    def note(self, txt, kind='warn'):
        """صندوق تنبيه أو شرط جوهري."""
        self.need(16)
        self.ln(1)
        bg, bd, fg = ((WARN_BG, WARN_BD, (120, 78, 20)) if kind == 'warn'
                      else (BAND, HAIR, INK))
        self.set_font('C', '', 9.3)
        self.set_fill_color(*bg)
        self.set_draw_color(*bd)
        self.set_line_width(0.3)
        self.set_text_color(*fg)
        y = self.get_y()
        self.multi_cell(CW, 5.6, ar(txt), align=Align.R, fill=True, border=1)
        self.set_fill_color(*bd)
        self.rect(W - M - 1.6, y, 1.6, self.get_y() - y, 'F')
        self.ln(2.5)
        self.set_text_color(*INK)

    def table(self, rows, widths=None, head_dark=True):
        if not rows:
            return
        n = max(len(r) for r in rows)
        rows = [list(r) + [''] * (n - len(r)) for r in rows]
        if widths:
            ws = [CW * w / sum(widths) for w in widths]
        else:
            wt = [max(max(len(str(r[c])) for r in rows), 5)
                  for c in range(n)]
            ws = [CW * w / sum(wt) for w in wt]

        lh = 5.3
        self.set_font('C', '', 9)

        def hgt(cells, bold):
            self.set_font('C', 'B' if bold else '', 9)
            m = 0
            for i, c in enumerate(cells):
                k = len(self.multi_cell(ws[i], lh, ar(c), align=Align.R,
                                        dry_run=True, output='LINES'))
                m = max(m, max(k, 1))
            return m * lh + 2

        for ri, cells in enumerate(rows):
            head = ri == 0
            h = hgt(cells, head)
            self.need(h + 2)
            y = self.get_y()
            x = W - M
            self.set_font('C', 'B' if head else '', 9)
            if head:
                self.set_fill_color(*LAPIS)
                self.set_text_color(*GOLD_L)
            else:
                self.set_fill_color(*(CREAM if ri % 2 else (255, 255, 255)))
                self.set_text_color(*INK)
            self.set_draw_color(*HAIR)
            self.set_line_width(0.2)
            for i, c in enumerate(cells):
                x -= ws[i]
                self.set_xy(x, y)
                self.multi_cell(ws[i], h, '', border=1, fill=True)
                self.set_xy(x, y + 1)
                self.multi_cell(ws[i], lh, ar(c), align=Align.R)
            self.set_y(y + h)
        self.ln(2.5)
        self.set_text_color(*INK)

    def fill_line(self, label, width=None, size=10):
        """سطر بيانات يُملأ بالقلم."""
        self.set_font('C', '', size)
        self.set_text_color(*INK)
        self.cell(0, 7, ar(f'{label}: ' + '.' * (width or 46)),
                  align=Align.R, new_y=YPos.NEXT, new_x=XPos.LMARGIN)

    def sign_block(self):
        """جدول تواقيع رسمي."""
        self.need(58)
        self.ln(2)
        y = self.get_y()
        bw = (CW - 6) / 2
        for i, who in enumerate(['الطرف الأول (المطوِّر)',
                                 'الطرف الثاني (المالك)']):
            x = M + i * (bw + 6) if i == 0 else M
            x = (W - M - bw) if i == 0 else M
            self.set_fill_color(*BAND)
            self.set_draw_color(*GOLD)
            self.set_line_width(0.35)
            self.rect(x, y, bw, 46, 'DF')
            self.set_fill_color(*LAPIS)
            self.rect(x, y, bw, 8, 'F')
            self.set_xy(x, y)
            self.set_font('C', 'B', 9.3)
            self.set_text_color(*GOLD_L)
            self.cell(bw, 8, ar(who), align=Align.C)
            self.set_font('C', '', 9)
            self.set_text_color(*INK)
            for k, lbl in enumerate(['الاسم', 'التوقيع', 'التاريخ']):
                self.set_xy(x + 3, y + 12 + k * 11)
                self.cell(bw - 6, 6, ar(f'{lbl}: ' + '.' * 22),
                          align=Align.R)
        self.set_y(y + 50)


def build():
    d = Doc()
    d.cover_page()

    # ═══ البند 1 — الأطراف ═══
    d.add_page()
    d.note('هذه صيغة استرشادية أعدّها المطوِّر لتنظيم الاتفاق، وليست '
           'استشارة قانونية. يُستحسن عرضها على محامٍ قبل التوقيع.')

    d.section(1, 'أطراف العقد')
    d.sub('الطرف الأول — المطوِّر والمنفِّذ')
    d.table([
        ['البيان', 'التفصيل'],
        ['الاسم الثلاثي', '.' * 34],
        ['رقم الهاتف', '.' * 34],
        ['العنوان', '.' * 34],
        ['رقم الهوية', '.' * 34],
    ], widths=[34, 66])

    d.sub('الطرف الثاني — المالك والمشتري')
    d.table([
        ['البيان', 'التفصيل'],
        ['الاسم الثلاثي', '.' * 34],
        ['اسم الشركة', 'شركة الهدف للتوظيف'],
        ['رقم الهاتف', '.' * 34],
        ['العنوان', '.' * 34],
        ['رقم الهوية / إجازة العمل', '.' * 34],
    ], widths=[34, 66])

    # ═══ البند 2 — الموضوع ═══
    d.section(2, 'موضوع العقد')
    d.p('اتفق الطرفان على قيام الطرف الأول بتسليم نظام إدارة توظيف '
        'إلكتروني متكامل إلى الطرف الثاني، يشمل موقعاً عامّاً للباحثين عن '
        'عمل ومنظومة داخلية لإدارة الوظائف والاستمارات، مع قاعدة بيانات '
        'سحابية وحماية على مستوى الصفوف.')
    d.p('النظام مُنجَز وجاهز للعمل قبل توقيع هذا العقد، وقد عاينه الطرف '
        'الثاني واختبره بنفسه.', color=MUTED, size=9.4)

    # ═══ البند 3 — الوصف ═══
    d.section(3, 'وصف النظام المُسلَّم')

    d.sub('أولاً · الموقع العام للباحثين عن عمل')
    for t in [
        'لوحة وظائف تُحدَّث لحظياً بحالات: متاحة · محجوزة مؤقتاً · مغلقة',
        'بحث وتصفية: 13 منطقة · 6 أنواع دوام · 8 تصنيفات مهنية · الحالة',
        'بحث سريع بكود الوظيفة، وماسح كيو آر كود بالكاميرا',
        'حجب بيانات صاحب العمل (الاسم والهاتف والعنوان) عن العرض العام',
        'تصميم عربي متجاوب يعمل على الهاتف والحاسوب',
        'يعمل دون إنترنت بعد أول زيارة',
    ]:
        d.li(t)

    d.sub('ثانياً · المنظومة الداخلية للموظفين والإدارة')
    for t in [
        'بوابة دخول مخفية بضغطة مطوّلة على اسم الشركة — لا زر ظاهر للزائر',
        'إدارة الوظائف: إضافة وتعديل وتغيير الحالة والحذف',
        'إصدار الاستمارات بترقيم تسلسلي تلقائي غير قابل للتكرار',
        'نظام المحاولات: خمس محاولات لكل استمارة بصلاحية ثلاثين يوماً',
        'حجز مؤقت 24 ساعة مع إفراج تلقائي عند انتهاء المهلة',
        'تثبيت النتيجة وتفعيل المحاولة التالية تلقائياً',
        'سجل تدقيق يوثّق كل عملية بالثانية: المستخدم والوقت وعنوان الجلسة',
        'لوحة مالية تُظهر الاستمارات الصادرة والمبالغ المتوقعة لكل موظف',
        'إدارة المستخدمين والصلاحيات: مدير عام وموظف',
        'إعدادات قابلة للتعديل: المحاولات والصلاحية ومدة الحجز والرسم',
    ]:
        d.li(t)

    d.sub('ثالثاً · الاستمارة المطبوعة والتحقق')
    for t in [
        'قالب استمارة رسمية جاهز للطباعة ببيانات الشركة وشعارها',
        'كيو آر كود موقَّع تشفيرياً يمنع التزوير',
        'صفحة تحقق تُظهر حالة الاستمارة والمحاولات فوراً',
        'التحقق مقصور على الموظفين ومحمي بصلاحية',
    ]:
        d.li(t)

    d.sub('رابعاً · قاعدة البيانات والحماية')
    d.table([
        ['المكوّن', 'العدد', 'الوظيفة'],
        ['الجداول', '6', 'وظائف · استمارات · محاولات · موظفون · تدقيق · إعدادات'],
        ['الدوال والمُشغِّلات', '19', 'توليد الأكواد · الحجز · الإفراج · التحقق'],
        ['سياسات الحماية', '18', 'حماية على مستوى الصف لكل جدول'],
    ], widths=[26, 14, 60])
    d.p('مزامنة لحظية بين الأجهزة، وعمل دون اتصال مع مزامنة تلقائية عند '
        'عودة الشبكة.', size=9.4, color=MUTED)

    d.sub('خامساً · النسخ الاحتياطي')
    for t in [
        'نسخة سريعة داخل المتصفح · تصدير JSON · نسخة مشفّرة بكلمة مرور',
        'استيراد واسترجاع كامل أو بنطاق تاريخي محدد',
        'جدولة نسخ تلقائية مع حدّ أقصى عشرين نسخة محفوظة',
    ]:
        d.li(t)

    d.sub('سادساً · مخرجات إضافية وضمان الجودة')
    for t in [
        'صفحة «غير موجود» بهوية الشركة',
        'نسخة بملف واحد تعمل بلا إنترنت — تُنسخ على فلاش أو تُرسل بالبريد',
        'صفحة فحص الاتصال بقاعدة البيانات',
        '13 ملف اختبار آلي يضم 133 فحصاً — جميعها ناجحة',
        'توثيق فني كامل للنظام وقاعدة البيانات',
    ]:
        d.li(t)

    # ═══ البند 4 — المالي ═══
    d.section(4, 'المقابل المالي')
    d.table([
        ['البند', 'المبلغ (دينار عراقي)'],
        ['قيمة النظام الأساسية', '.' * 26],
        ['الكود المصدري (اختياري — البند 7)', '.' * 26],
        ['المجموع', '.' * 26],
    ], widths=[62, 38])
    d.fill_line('المبلغ كتابةً', 44)
    d.ln(2)

    d.sub('جدول الدفع')
    d.table([
        ['الدفعة', 'النسبة', 'المبلغ', 'الاستحقاق'],
        ['الأولى (عربون)', '50%', '.' * 16, 'عند التوقيع'],
        ['الثانية', '50%', '.' * 16, 'عند التسليم النهائي'],
    ], widths=[24, 12, 34, 30])
    d.note('شرط جوهري: لا تُنقل ملكية أي حساب قبل سداد كامل المبلغ.')

    # ═══ البند 5 — النطاق ═══
    d.section(5, 'نطاق الخدمة')
    d.sub('ما يشمله السعر', (22, 101, 52))
    for i, t in enumerate([
        'النظام كاملاً بجميع مكوّناته الموصوفة في البند الثالث',
        'نقل مشروع قاعدة البيانات إلى حساب الطرف الثاني',
        'إعداد الاستضافة وربط النطاق',
        'إدخال بيانات الشركة: الاسم والأرقام والعنوان وأوقات العمل',
        'إنشاء حساب مدير للطرف الثاني',
        'تدريب عملي لمدة ساعة على تشغيل النظام',
        'دعم مجاني لمدة شهر من تاريخ التسليم',
    ], 1):
        d.li(t, f'{i}.')

    d.sub('ما لا يشمله السعر', (153, 27, 27))
    for i, t in enumerate([
        'رسوم النطاق السنوية (تقديرياً 40,000 – 60,000 دينار) — يشتريه '
        'الطرف الثاني باسمه',
        'رسوم الاستضافة أو قاعدة البيانات إن تجاوز الاستخدام الحدود المجانية',
        'ميزات جديدة غير مذكورة في البند الثالث',
        'إدخال بيانات الوظائف والاستمارات — من عمل موظفي الطرف الثاني',
        'تصميم شعار أو هوية بصرية جديدة',
        'تطبيق هاتف لنظامي أندرويد أو iOS',
        'الدعم بعد انتهاء الشهر المجاني — يخضع للبند التاسع',
    ], 1):
        d.li(t, f'{i}.')

    # ═══ البند 6 — التسليم ═══
    d.section(6, 'التسليم')
    d.table([
        ['#', 'البند المُسلَّم', 'تم'],
        ['1', 'مشروع قاعدة البيانات منقول لحساب الطرف الثاني', '[  ]'],
        ['2', 'الموقع يعمل على الاستضافة', '[  ]'],
        ['3', 'النطاق مربوط ويعمل', '[  ]'],
        ['4', 'حساب مدير وكلمة مرور', '[  ]'],
        ['5', 'سرّ توقيع الكيو آر كود مضبوط ومحفوظ', '[  ]'],
        ['6', 'بيانات العرض التجريبية مُفرَّغة', '[  ]'],
        ['7', 'نسخة احتياطية أولى', '[  ]'],
        ['8', 'التدريب العملي', '[  ]'],
        ['9', 'الكود المصدري (إن شُمل بالسعر)', '[  ]'],
    ], widths=[8, 80, 12])
    d.fill_line('تاريخ التسليم الفعلي', 30)
    d.ln(2)

    d.sub('تنبيهات فنية جوهرية')
    d.note('أولاً — تثبيت النطاق قبل الطباعة: رابط التحقق داخل الكيو آر '
           'كود يُبنى من نطاق الموقع لحظة إصدار الاستمارة. لذلك يجب تثبيت '
           'النطاق النهائي قبل طباعة أول استمارة رسمية. أي استمارة تُطبع '
           'قبل ذلك يتوقف الكيو آر كود الخاص بها عن العمل عند النقل.')
    d.p('أقرّ الطرف الثاني باطّلاعه على هذا التنبيه:   التوقيع ' + '.' * 22,
        size=9.3)
    d.ln(1)
    d.note('ثانياً — سرّ توقيع الكيو آر كود: ضياع المفتاح أو تغييره يُبطل '
           'التحقق من جميع الاستمارات المطبوعة سابقاً. يلتزم الطرف الثاني '
           'بحفظه في مكان آمن خارج النظام.')
    d.note('ثالثاً — النسخ الاحتياطي: النسخ المحفوظة داخل المتصفح تُفقد عند '
           'مسح بياناته. يُنصح بتفعيل النسخ التلقائي من لوحة قاعدة '
           'البيانات وتصدير نسخة دورية تُحفظ خارجياً. المسؤولية تقع على '
           'الطرف الثاني بعد التسليم.')

    # ═══ البند 7 — الملكية ═══
    d.section(7, 'الملكية الفكرية')
    d.p('يُختار أحد الخيارين ويُشطب الآخر:', color=MUTED, size=9.4)

    d.sub('▪ الخيار (أ) — بدون الكود المصدري')
    for t in [
        'يملك الطرف الثاني: النظام شغّالاً وجميع بياناته والحسابات باسمه',
        'يحتفظ الطرف الأول بملكية الكود المصدري وحقه في إعادة استخدام '
        'أجزائه في مشاريع أخرى',
        'لا يجوز للطرف الأول بيع نسخة من النظام لمنافس مباشر للطرف الثاني '
        'داخل محافظة بابل لمدة .......... سنة',
    ]:
        d.li(t)
    d.note('شرط الحماية: إذا توقف الطرف الأول عن تقديم الخدمة أو تعذّر '
           'التواصل معه مدة تتجاوز ستين يوماً، يلتزم بتسليم الكود المصدري '
           'كاملاً إلى الطرف الثاني دون مقابل إضافي.')

    d.sub('▪ الخيار (ب) — مع الكود المصدري')
    for t in [
        'تنتقل ملكية الكود المصدري كاملاً إلى الطرف الثاني',
        'يحق له التعديل والتطوير بواسطة أي جهة يختارها',
        'يحتفظ الطرف الأول بحق ذكر المشروع ضمن أعماله السابقة دون بيانات سرية',
        'لا يتحمل الطرف الأول مسؤولية أي عطل ينشأ عن تعديل يجريه طرف آخر',
    ]:
        d.li(t)
    d.note('في الحالتين: بيانات الوظائف والمتقدمين وأصحاب العمل ملك خالص '
           'للطرف الثاني، ولا يجوز للطرف الأول استخدامها أو الاحتفاظ بنسخة '
           'منها بعد التسليم.', kind='info')

    # ═══ البند 8 — الضمان ═══
    d.section(8, 'الضمان')
    d.p('يضمن الطرف الأول خلوّ النظام من الأعطال البرمجية لمدة شهر واحد من '
        'تاريخ التسليم، ويلتزم بإصلاح أي عطل خلالها مجاناً وفي مدة أقصاها '
        'ثلاثة أيام عمل من تاريخ الإبلاغ.')
    d.sub('لا يشمل الضمان')
    for t in [
        'أعطالاً ناتجة عن تعديل أجراه الطرف الثاني أو طرف آخر',
        'انقطاع خدمة مزوّدي الاستضافة أو قاعدة البيانات',
        'فقدان بيانات بسبب إهمال في النسخ الاحتياطي',
        'سوء الاستخدام أو إدخال بيانات خاطئة',
        'انتهاء اشتراك النطاق أو عدم تجديده',
    ]:
        d.li(t)

    # ═══ البند 9 — الصيانة ═══
    d.section(9, 'الصيانة والدعم بعد الضمان')
    d.p('بعد انتهاء الشهر المجاني، يُخيَّر الطرف الثاني بين:')
    d.p('▪ عقد صيانة سنوي بمبلغ ................................ دينار، يشمل:',
        size=10)
    for t in [
        'إصلاح الأعطال الطارئة',
        'التحديثات الأمنية',
        'الدعم الفني هاتفياً خلال أوقات العمل',
        'التعديلات البسيطة: الأرقام والنصوص والصور',
    ]:
        d.li(t)
    d.p('لا يشمل عقد الصيانة ميزات جديدة.', size=9.3, color=MUTED)
    d.p('▪ الدفع حسب الطلب — تُسعَّر كل مهمة على حدة قبل تنفيذها.')
    d.p('تُقدَّر كل ميزة جديدة بعرض سعر مستقل يوافق عليه الطرفان كتابةً قبل '
        'البدء.', size=9.3, color=MUTED)

    # ═══ البند 10 — الالتزامات ═══
    d.section(10, 'التزامات الطرفين')
    d.sub('يلتزم الطرف الأول بـ')
    for i, t in enumerate([
        'تسليم النظام عاملاً وفق الوصف في البند الثالث',
        'نقل الحسابات خلال سبعة أيام من سداد كامل المبلغ',
        'تقديم التدريب والدعم المتفق عليهما',
        'الحفاظ على سرّية بيانات الشركة والمتقدمين وعدم إفشائها',
        'عدم الاحتفاظ بنسخة من بيانات العملاء بعد التسليم',
        'عدم تضمين أي وسيلة تعطيل أو إيقاف عن بُعد في النظام',
    ], 1):
        d.li(t, f'{i}.')

    d.sub('يلتزم الطرف الثاني بـ')
    for i, t in enumerate([
        'سداد المبالغ في مواعيدها',
        'شراء النطاق باسمه وتجديده سنوياً',
        'حفظ كلمات المرور وسرّ التوقيع في مكان آمن',
        'أخذ نسخ احتياطية دورية وحفظها خارج النظام',
        'عدم مطالبة الطرف الأول بأعطال ناتجة عن تعديل طرف آخر',
        'حماية بيانات المتقدمين وعدم مشاركتها خارج نطاق العمل',
    ], 1):
        d.li(t, f'{i}.')

    # ═══ البند 11 — الإنهاء ═══
    d.section(11, 'إنهاء العقد وتسوية النزاعات')
    for t in [
        'إذا تأخر الطرف الثاني عن السداد أكثر من ثلاثين يوماً من '
        'الاستحقاق، يحق للطرف الأول إيقاف الدعم دون إيقاف النظام',
        'إذا تعذّر على الطرف الأول التسليم لسبب يعود إليه، يُعاد العربون كاملاً',
        'عند الفسخ بالتراضي يُحتسب المستحق بقدر ما أُنجز فعلاً',
    ]:
        d.li(t)
    d.p('يسعى الطرفان لحل أي خلاف ودّياً خلال خمسة عشر يوماً. وإن تعذّر، '
        'يُحال النزاع إلى القضاء المختص في محافظة بابل، ويُطبَّق القانون '
        'العراقي النافذ.')

    # ═══ البند 12 — الختامية ═══
    d.section(12, 'أحكام ختامية')
    for i, t in enumerate([
        'حُرِّر هذا العقد من نسختين أصليتين، بيد كل طرف نسخة',
        'لا يُعتدّ بأي تعديل شفهي — كل تعديل يكون كتابياً وموقَّعاً',
        'الملاحق المرفقة جزء لا يتجزأ من هذا العقد',
        'أقرّ الطرفان بقراءة العقد وفهم بنوده والموافقة عليها',
    ], 1):
        d.li(t, f'{i}.')

    d.ln(3)
    d.sign_block()
    d.ln(1)
    d.set_font('C', '', 9)
    d.set_text_color(*INK)
    d.cell(0, 7, ar('الشاهد الأول:  الاسم ' + '.' * 20 +
                    '   التوقيع ' + '.' * 16),
           align=Align.R, new_y=YPos.NEXT, new_x=XPos.LMARGIN)
    d.cell(0, 7, ar('الشاهد الثاني: الاسم ' + '.' * 20 +
                    '   التوقيع ' + '.' * 16),
           align=Align.R, new_y=YPos.NEXT, new_x=XPos.LMARGIN)

    # ═══ الملحق ═══
    d.add_page()
    d.section('أ', 'ملحق — بيانات الحسابات المنقولة')
    d.p('يُملأ عند التسليم ويوقَّع من الطرفين.', color=MUTED, size=9.4)
    d.table([
        ['الخدمة', 'المعرّف / الرابط', 'تاريخ النقل', 'توقيع المستلم'],
        ['قاعدة البيانات', '.' * 20, '..../....', '.' * 14],
        ['الاستضافة', '.' * 20, '..../....', '.' * 14],
        ['النطاق', '.' * 20, '..../....', '.' * 14],
        ['مستودع الكود', '.' * 20, '..../....', '.' * 14],
        ['حساب المدير', '.' * 20, '..../....', '.' * 14],
    ], widths=[24, 38, 18, 20])
    d.ln(2)
    d.p('أقرّ الطرف الثاني باستلام ما ورد أعلاه وبتغيير كلمات المرور:')
    d.ln(4)
    d.fill_line('التوقيع', 30)
    d.fill_line('التاريخ', 30)

    return d


if __name__ == '__main__':
    # مروران: الأول لمعرفة عدد الصفحات، والثاني لكتابته في التذييل.
    # (alias_nb_pages لا يصلح مع تشكيل HarfBuzz: النص يتحوّل إلى مسارات
    #  فلا يبقى قابلاً للاستبدال بعد الرسم.)
    pages = build().page_no()
    Doc._total_pages = pages
    _orig_init = Doc.__init__

    def _init_with_total(self):
        _orig_init(self)
        self.total = pages

    Doc.__init__ = _init_with_total
    doc = build()
    doc.output(str(OUT))
    print(f'✅ {OUT.name} — {pages} صفحة — '
          f'{OUT.stat().st_size / 1024:.0f} ك.ب')
