import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for (const file of ['src/partials/public.html', 'index.html', 'hrc-light.html', 'hrc-standalone.html']) {
  const content = readFileSync(file, 'utf8');
  assert.ok(content.includes('حفظ الخصوصية'), `${file}: privacy card restored`);
  assert.ok(content.includes('جميع البيانات والمعلومات الشخصية آمنة ولا تُشارك للعامة.'), `${file}: updated privacy text`);
  assert.doesNotMatch(content, /نحافظ على خصوصية بيانات الباحثين عن عمل/, file);
  assert.ok(content.includes('حجز مؤقت عادل'), `${file}: other services remain`);
}
console.log('PASS privacy service card restored with updated text.');
