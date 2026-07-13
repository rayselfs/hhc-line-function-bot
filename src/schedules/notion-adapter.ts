import type { ScheduleAssignment, ScheduleMeeting } from "./model.js";

export interface NotionSchedulePageInput {
  pageId: string;
  serviceDate: string;
  meeting: string;
  role: string;
  person: string;
}

export interface NormalizedScheduleAssignment extends ScheduleAssignment {
  externalKey: string;
}

export interface NormalizedSchedulePage {
  meeting: Omit<ScheduleMeeting, "assignments"> & {
    assignments: NormalizedScheduleAssignment[];
  };
  malformedLines: number;
}

export function normalizeNotionSchedulePage(
  input: NotionSchedulePageInput
): NormalizedSchedulePage {
  let malformedLines = 0;
  const assignments: ScheduleAssignment[] = [];
  const role = normalizeWhitespace(input.role);

  if (role) {
    assignments.push({ role, assignees: splitAssignees(input.person) });
  } else {
    for (const rawLine of input.person.split(/\r?\n/u)) {
      const line = normalizeWhitespace(rawLine);
      if (!line) {
        continue;
      }
      const match = line.match(/^(.+?)\s*[:：]\s*(.+)$/u);
      if (match) {
        assignments.push({
          role: normalizeWhitespace(match[1]),
          assignees: splitAssignees(match[2])
        });
      } else {
        assignments.push({ role: "服事", assignees: [line] });
        malformedLines += 1;
      }
    }
  }

  return {
    meeting: {
      externalId: input.pageId,
      serviceDate: input.serviceDate,
      meeting: normalizeWhitespace(input.meeting),
      assignments: assignments.map((assignment, index) => ({
        ...assignment,
        externalKey: `${input.pageId}:${index}:${assignment.role}`
      }))
    },
    malformedLines
  };
}

function splitAssignees(value: string): string[] {
  return value
    .split(/[,，、]/u)
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function normalizeWhitespace(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}
