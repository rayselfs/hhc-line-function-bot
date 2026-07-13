export interface ScheduleAssignment {
  role: string;
  assignees: string[];
  notes?: string;
  aliases?: string[];
}

export interface ScheduleMeeting {
  sourceKey?: string;
  externalId?: string;
  serviceDate: string;
  meeting: string;
  scheduleType?: string;
  assignments: ScheduleAssignment[];
}
