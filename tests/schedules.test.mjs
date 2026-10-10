process.env.DSCODE_LANGUAGE = 'en';

import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRows } from '../packages/tui/src/schedules.ts';
import { SchedulePanel, scheduleFrequency } from '../packages/tui/src/kernel-panels.ts';
import { mount, assertFits, tick } from './fixtures/tui-mount.mjs';

const record = { id: 'reminder', kind: 'after', title: 'Task', prompt: 'Current reminder', scheduledAt: '2099-01-01T00:00:00Z', afterSeconds: 60 };

async function waitFor(check) {
  const deadline = Date.now() + 4000;
  while (!check() && Date.now() < deadline) await tick(25);
  assert(check(), 'panel did not refresh');
}

test('native calendar reminders retain their rule and next occurrence in the terminal', () => {
  const rows = scheduleRows([
    record,
    { ...record, kind: 'every', everySeconds: 120 },
    { ...record, kind: 'daily', time: '09:00:00', timeZone: 'America/Los_Angeles' },
    { ...record, kind: 'weekly', time: '10:00:00', timeZone: 'UTC', weekdays: [1, 5] },
    { ...record, kind: 'cron', expression: '0 9 * * 1', timeZone: 'UTC' },
  ]);
  assert(rows.every(row => row.targetAt === Date.parse(record.scheduledAt)));
  assert.deepEqual(rows.map(scheduleFrequency), ['Once', 'Every 2m', 'Daily 09:00:00 (America/Los_Angeles)', 'Weekly 1, 5 10:00:00 (UTC)', 'Cron 0 9 * * 1 (UTC)']);
});

test('schedule panel reads the current catalog and removes delivered or deleted reminders', async t => {
  let records = [record];
  let closed = false;
  const ui = await mount(SchedulePanel, { loadRows: async () => scheduleRows(records), close: () => { closed = true; } });
  t.after(() => ui.close());
  await waitFor(() => ui.frame().includes('Current reminder'));
  records = [];
  await waitFor(() => ui.frame().includes('no active reminders'));
  assert(!ui.frame().includes('Current reminder'));
  assertFits(ui);
  await ui.write('q');
  assert.equal(closed, true);
});

test('schedule read failures are visible and recover on the next catalog read', async t => {
  let fail = true;
  const ui = await mount(SchedulePanel, { loadRows: async () => { if (fail) throw Error('Schedule storage unavailable'); return scheduleRows([record]); }, close() {} });
  t.after(() => ui.close());
  await waitFor(() => ui.frame().includes('Schedule storage unavailable'));
  assert(!ui.frame().includes('no active reminders'));
  fail = false;
  await waitFor(() => ui.frame().includes('Current reminder'));
  assert(!ui.frame().includes('Schedule storage unavailable'));
  assertFits(ui);
});
