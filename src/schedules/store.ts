import { randomUUID } from "node:crypto";

export type ScheduleOrigin = "notion" | "line";

export interface ScheduleItemInput {
  profileName: string;
  sourceKey: string;
  origin: ScheduleOrigin;
  externalId?: string;
  externalKey?: string;
  serviceDate: string;
  meeting: string;
  role: string;
  assignee: string;
  notes?: string;
  externalUpdatedAt?: string;
  deletedAt?: string;
}

export interface ScheduleItemRecord extends ScheduleItemInput {
  id: string;
  normalizedSearchText: string;
}

export interface ScheduleSearchInput {
  profileName: string;
  sourceKeys?: string[];
  query?: string;
  serviceDate?: string;
  meeting?: string;
  role?: string;
  range?: {
    start: string;
    endExclusive: string;
  };
  limit?: number;
}

export interface ScheduleStore {
  publishSnapshot(input: {
    profileName: string;
    sourceKey: string;
    origin: ScheduleOrigin;
    revision: string;
    items: ScheduleItemInput[];
    publishedAt: string;
  }): Promise<{ published: number; replaced: number }>;
  upsertItem(input: ScheduleItemInput): Promise<ScheduleItemRecord>;
  tombstoneMissingExternalKeys(input: {
    profileName: string;
    sourceKey: string;
    origin: ScheduleOrigin;
    liveExternalKeys: string[];
    deletedAt: string;
  }): Promise<number>;
  searchItems(input: ScheduleSearchInput): Promise<ScheduleItemRecord[]>;
}

export class InMemoryScheduleStore implements ScheduleStore {
  private items = new Map<string, ScheduleItemRecord>();

  async publishSnapshot(input: {
    profileName: string;
    sourceKey: string;
    origin: ScheduleOrigin;
    revision: string;
    items: ScheduleItemInput[];
    publishedAt: string;
  }): Promise<{ published: number; replaced: number }> {
    const previous = Array.from(this.items.values()).filter(
      (item) =>
        item.profileName === input.profileName &&
        item.sourceKey === input.sourceKey &&
        item.origin === input.origin &&
        !item.deletedAt
    ).length;
    const next = new Map(
      Array.from(this.items.entries()).filter(
        ([, item]) =>
          !(
            item.profileName === input.profileName &&
            item.sourceKey === input.sourceKey &&
            item.origin === input.origin
          )
      )
    );
    for (const item of input.items) {
      if (
        item.profileName !== input.profileName ||
        item.sourceKey !== input.sourceKey ||
        item.origin !== input.origin
      ) {
        throw new Error("Schedule snapshot item scope does not match publication scope");
      }
      const record: ScheduleItemRecord = {
        ...item,
        id: randomUUID(),
        normalizedSearchText: searchableScheduleText(item)
      };
      next.set(record.id, record);
    }
    this.items = next;
    return { published: input.items.length, replaced: previous };
  }

  async upsertItem(input: ScheduleItemInput): Promise<ScheduleItemRecord> {
    const identity = scheduleItemIdentity(input);
    const existing = Array.from(this.items.values()).find(
      (item) => scheduleItemIdentity(item) === identity
    );
    const record: ScheduleItemRecord = {
      ...input,
      id: existing?.id ?? randomUUID(),
      normalizedSearchText: searchableScheduleText(input)
    };
    this.items.set(record.id, record);
    return record;
  }

  async tombstoneMissingExternalKeys(input: {
    profileName: string;
    sourceKey: string;
    origin: ScheduleOrigin;
    liveExternalKeys: string[];
    deletedAt: string;
  }): Promise<number> {
    const live = new Set(input.liveExternalKeys);
    let count = 0;
    for (const item of Array.from(this.items.values())) {
      if (
        item.profileName === input.profileName &&
        item.sourceKey === input.sourceKey &&
        item.origin === input.origin &&
        item.externalKey &&
        !item.deletedAt &&
        !live.has(item.externalKey)
      ) {
        this.items.set(item.id, { ...item, deletedAt: input.deletedAt });
        count += 1;
      }
    }
    return count;
  }

  async searchItems(input: ScheduleSearchInput): Promise<ScheduleItemRecord[]> {
    const query = normalizeScheduleText(stripGenericScheduleWords(input.query ?? ""));
    const sourceKeys = new Set(input.sourceKeys ?? []);
    return Array.from(this.items.values())
      .filter((item) => !item.deletedAt)
      .filter((item) => item.profileName === input.profileName)
      .filter((item) => sourceKeys.size === 0 || sourceKeys.has(item.sourceKey))
      .filter((item) => !input.serviceDate || item.serviceDate === input.serviceDate)
      .filter(
        (item) =>
          !input.range ||
          (item.serviceDate >= input.range.start && item.serviceDate < input.range.endExclusive)
      )
      .filter((item) => matchesText(item.meeting, input.meeting))
      .filter((item) => matchesText(item.role, input.role))
      .filter((item) => !query || item.normalizedSearchText.includes(query))
      .sort(compareScheduleItems)
      .slice(0, input.limit ?? 10);
  }
}

export function normalizeScheduleText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\\/_\-.:()（）[\]{}]+/gu, "");
}

export function scheduleItemIdentity(input: ScheduleItemInput): string {
  const externalIdentity = input.externalKey ?? input.externalId;
  if (externalIdentity) {
    return `${input.profileName}:${input.sourceKey}:${input.origin}:external:${externalIdentity}`;
  }
  return [
    input.profileName,
    input.sourceKey,
    input.origin,
    input.serviceDate,
    input.meeting,
    input.role,
    input.assignee
  ].join(":");
}

export function searchableScheduleText(input: ScheduleItemInput): string {
  return normalizeScheduleText(
    [
      input.sourceKey,
      input.origin,
      input.serviceDate,
      input.meeting,
      input.role,
      input.assignee,
      input.notes
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function stripGenericScheduleWords(value: string): string {
  return value.replace(/小哈|幫我|請|查詢|查|服事表|服事|安排/g, "");
}

function matchesText(value: string, expected?: string): boolean {
  const normalizedExpected = normalizeScheduleText(expected ?? "");
  return !normalizedExpected || normalizeScheduleText(value).includes(normalizedExpected);
}

function compareScheduleItems(left: ScheduleItemRecord, right: ScheduleItemRecord): number {
  return (
    left.serviceDate.localeCompare(right.serviceDate) ||
    left.meeting.localeCompare(right.meeting, "zh-Hant") ||
    left.role.localeCompare(right.role, "zh-Hant") ||
    left.assignee.localeCompare(right.assignee, "zh-Hant")
  );
}
