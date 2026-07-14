import type { MeetingWindowRule } from "../types.js";

export const DEFAULT_MEETING_WINDOWS: MeetingWindowRule[] = [
  { key: "morning_prayer", aliases: ["晨更"], weekdays: [2, 5], start: "06:30", end: "08:30" },
  { key: "cinderella", aliases: ["仙履奇緣"], weekdays: [4], start: "06:30", end: "09:00" },
  { key: "gospel_meal", aliases: ["福音餐會"], weekdays: [4], start: "12:00", end: "14:00" },
  {
    key: "discipleship_prayer",
    aliases: ["門訓禱告會"],
    weekdays: [5],
    start: "19:00",
    end: "21:30"
  },
  { key: "kingdom_prayer", aliases: ["國度禱告會"], weekdays: [6], start: "09:00", end: "11:30" },
  { key: "sunday", aliases: ["主日"], weekdays: [0], start: "09:00", end: "12:00" }
];

export interface ScheduleOccurrenceRow {
  serviceDate: string;
  meeting: string;
}

export function selectFirstUpcomingOccurrence<T extends ScheduleOccurrenceRow>(input: {
  rows: T[];
  now: Date;
  timeZone: string;
  meetingWindows?: MeetingWindowRule[];
}): T[] {
  const groups = groupRows(input.rows);
  const today = dateKey(input.now, input.timeZone);
  const first = groups
    .map((group) => ({
      group,
      window: occurrenceWindow(
        group,
        input.timeZone,
        input.meetingWindows ?? DEFAULT_MEETING_WINDOWS
      )
    }))
    .filter(({ group, window }) => {
      if (group.serviceDate > today) return true;
      if (group.serviceDate < today) return false;
      return Boolean(window && window.end > input.now);
    })
    .sort((left, right) => {
      const dateOrder = left.group.serviceDate.localeCompare(right.group.serviceDate);
      if (dateOrder !== 0) return dateOrder;
      const leftTime = left.window?.start.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.window?.start.getTime() ?? Number.MAX_SAFE_INTEGER;
      return (
        leftTime - rightTime || left.group.meeting.localeCompare(right.group.meeting, "zh-Hant")
      );
    })[0];
  return first?.group.rows ?? [];
}

interface ScheduleOccurrenceGroup<T> {
  serviceDate: string;
  meeting: string;
  rows: T[];
}

function groupRows<T extends ScheduleOccurrenceRow>(rows: T[]): Array<ScheduleOccurrenceGroup<T>> {
  const groups = new Map<string, ScheduleOccurrenceGroup<T>>();
  for (const row of rows) {
    const serviceDate = row.serviceDate.match(/\d{4}-\d{2}-\d{2}/u)?.[0] ?? row.serviceDate;
    const key = `${serviceDate}\u0000${row.meeting}`;
    const group = groups.get(key) ?? { serviceDate, meeting: row.meeting, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function occurrenceWindow<T>(
  group: ScheduleOccurrenceGroup<T>,
  timeZone: string,
  rules: MeetingWindowRule[]
): { start: Date; end: Date } | undefined {
  const explicit = parseExplicitWindow(
    (group.rows[0] as ScheduleOccurrenceRow | undefined)?.serviceDate ?? ""
  );
  if (explicit) return explicit;
  const weekday = weekdayFromDateKey(group.serviceDate);
  const rule = rules.find(
    (candidate) =>
      candidate.aliases.some((alias) => group.meeting.includes(alias)) &&
      (!candidate.weekdays || candidate.weekdays.includes(weekday))
  );
  if (!rule) return undefined;
  return {
    start: zonedDateTimeToUtc(group.serviceDate, rule.start, timeZone),
    end: zonedDateTimeToUtc(group.serviceDate, rule.end, timeZone)
  };
}

function parseExplicitWindow(value: string): { start: Date; end: Date } | undefined {
  const values = value.match(/\d{4}-\d{2}-\d{2}T[^\s~]+/gu);
  if (!values?.length) return undefined;
  const start = new Date(values[0]);
  const last = new Date(values.at(-1) ?? values[0]);
  if (Number.isNaN(start.getTime()) || Number.isNaN(last.getTime())) return undefined;
  return {
    start,
    end: values.length > 1 ? last : new Date(start.getTime() + 3 * 60 * 60 * 1000)
  };
}

function weekdayFromDateKey(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - timeZoneOffsetMs(guess, timeZone));
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((output, part) => {
      if (part.type !== "literal") output[part.type] = part.value;
      return output;
    }, {});
  return (
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    ) - date.getTime()
  );
}

function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
