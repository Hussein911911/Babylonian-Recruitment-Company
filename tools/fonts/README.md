# خطوط مولّد PDF

`Cairo-400.ttf` و `Cairo-700.ttf` مدموجان من ملفَّي المشروع:

    assets/fonts/cairo-arabic-{وزن}-normal.woff2   ← الحروف العربية
    assets/fonts/cairo-latin-{وزن}-normal.woff2    ← الأرقام وعلامات الترقيم

**لماذا الدمج؟** الملف العربي وحده يفتقر النقطة والقوسين والأرقام
اللاتينية، فيخرج العقد بمربّعات فارغة مكانها.

لإعادة توليدهما:

```python
from fontTools.ttLib import TTFont
from fontTools.merge import Merger
for w in ['400', '700']:
    parts = []
    for kind in ['arabic', 'latin']:
        f = TTFont(f'assets/fonts/cairo-{kind}-{w}-normal.woff2')
        f.flavor = None
        p = f'/tmp/_{kind}{w}.ttf'
        f.save(p)
        parts.append(p)
    Merger().merge(parts).save(f'tools/fonts/Cairo-{w}.ttf')
```
