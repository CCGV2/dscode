import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import type { ScheduleRow } from './render/projection.ts'

/** The native catalog owns current reminders; session events are historical only. */
export function scheduleRows(records: readonly ScheduleRecord[]): readonly ScheduleRow[] {
  return records.map(record => ({
    id: record.id, kind: record.kind, prompt: record.prompt,
    targetAt: Date.parse(record.scheduledAt),
    ...(record.kind === 'every' ? { everySeconds: record.everySeconds } : {}),
    ...(record.kind === 'daily' ? { rule: `Daily ${record.time} (${record.timeZone})` } : {}),
    ...(record.kind === 'weekly' ? { rule: `Weekly ${record.weekdays.join(', ')} ${record.time} (${record.timeZone})` } : {}),
    ...(record.kind === 'cron' ? { rule: `Cron ${record.expression} (${record.timeZone})` } : {}),
  }))
}
