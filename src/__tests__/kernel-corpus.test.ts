import { describe, expect, it } from "vitest";

import {
  KERNEL_ACCEPTANCE_CASES,
  validateKernelCorpus
} from "../evals/kernel/corpus.js";
import { SCHEDULE_KERNEL_CASES } from "../evals/kernel/cases/schedule.js";

describe("Kernel v1 versioned acceptance corpus", () => {
  it("uses unique stable versioned case IDs", () => {
    const ids = KERNEL_ACCEPTANCE_CASES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^kernel-v1\/[a-z_]+\/[a-z0-9-]+@1$/u.test(id))).toBe(true);
    expect(KERNEL_ACCEPTANCE_CASES.every(({ version }) => version === 1)).toBe(true);
    expect(validateKernelCorpus(KERNEL_ACCEPTANCE_CASES)).toEqual([]);
  });

  it("contains fifty canonical schedule assertions and five ambiguity cases", async () => {
    const observations = await Promise.all(
      SCHEDULE_KERNEL_CASES.map((entry) => entry.run({ now: () => new Date("2026-07-16T08:00:00Z") }))
    );
    expect(observations.flatMap(({ scheduleAssertions }) => scheduleAssertions)).toHaveLength(50);
    const ambiguity = observations.filter(({ ambiguityEligible }) => ambiguityEligible);
    expect(ambiguity).toHaveLength(5);
    expect(
      ambiguity.filter(({ ambiguityResolvedWithinTwoTurns }) => ambiguityResolvedWithinTwoTurns)
    ).toHaveLength(4);
  });

  it("covers the schedule-owned recurrence families", () => {
    expect(SCHEDULE_KERNEL_CASES.map(({ recurrenceFamily }) => recurrenceFamily)).toEqual(
      expect.arrayContaining([
        "wrapper_words_hide_subject",
        "generic_schedule_domain_ambiguity",
        "explicit_domain_lost",
        "role_follow_up_lost",
        "required_slot_misrouted"
      ])
    );
  });
});
