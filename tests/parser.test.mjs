// Unit tests for the Quick Import parser. Run: node tests/parser.test.mjs
import assert from 'node:assert/strict';
import { parseQuickImport, extractTime, extractDate } from '../src/js/parser.js';
const today = new Date(2026, 9, 20);
const students = [{ id: 'a', name: 'Sample Student A', label: 'Ava' }, { id: 'c', name: 'Casey Example' }, { id: 'd', name: 'Dana Demo', label: 'Dana D' }];
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('date formats', () => {
  assert.equal(extractDate('Monday, 12 October', today).date, '2026-10-12');
  assert.equal(extractDate('2026-10-15 10:00', today).date, '2026-10-15');
  assert.equal(extractDate('14/10/2026', today).date, '2026-10-14');
  assert.equal(extractDate('October 22', today).date, '2026-10-22');
  assert.equal(extractDate('3 Jan', today).date, '2027-01-03'); // nearest year
  assert.equal(extractDate('tomorrow', today).date, '2026-10-21');
});
t('time formats', () => {
  assert.deepEqual([extractTime('16:00 - 17:00 Ava').start, extractTime('16:00 - 17:00 Ava').duration], [960, 60]);
  assert.equal(extractTime('4:30pm-5:30pm').start, 990);
  assert.equal(extractTime('4-5pm').start, 960);
  assert.equal(extractTime('3.30pm').start, 930);
  assert.equal(extractTime('11:30-1pm').duration, 90);
  assert.equal(extractTime('16:00 - 17:00 Amanda').duration, 60); // "Am…" must not be read as am
});
t('full paste', () => {
  const text = `Monday, 12 October\n16:00 - 17:00 Ava\n18:00–19:30 Casey Example (Biology)\nTue 13 Oct 4:30pm-5:30pm Dana D\n14/10/2026 4pm Ava 90m\n2026-10-15 10:00 Unknown kid\nWed 21 Oct\n• 4-5pm Casey\nOctober 22 3.30pm Ava cancelled\nrandom note line`;
  const r = parseQuickImport(text, { students, existing: [{ studentId: 'a', date: '2026-10-12', start: '16:00' }], today });
  const rows = r.items.map(i => [i.date, i.start, i.duration, i.studentId, i.duplicate, i.cancelled]);
  assert.deepEqual(rows, [
    ['2026-10-12', '16:00', 60, 'a', true, false],
    ['2026-10-12', '18:00', 90, 'c', false, false],
    ['2026-10-13', '16:30', 60, 'd', false, false],
    ['2026-10-14', '16:00', 90, 'a', false, false],
    ['2026-10-15', '10:00', 60, null, false, false],
    ['2026-10-21', '16:00', 60, 'c', false, false],
    ['2026-10-22', '15:30', 60, 'a', false, true],
  ]);
  assert.deepEqual(r.skipped, ['random note line']);
  assert.equal(r.items.filter(i => i.include).length, 5);
});
console.log(`\n${n} parser test groups passed`);
