import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for (const file of ['src/partials/public.html', 'index.html', 'hrc-light.html', 'hrc-standalone.html']) {
  const content = readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /حفظ الخصوصية|نحافظ على خصوصية بيانات الباحثين عن عمل/, file);
  assert.ok(content.includes('حجز مؤقت عادل'), `${file}: other services remain`);
}
console.log('PASS privacy service card removed from source and built pages.');
