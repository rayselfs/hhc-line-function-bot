import { describe, expect, it, vi } from "vitest";

import { runAgentMemoryMigrations } from "../agent/migrations.js";

describe("agent memory migrations", () => {
  it("never applies the retired schedule visibility constraint before profile visibility", async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await runAgentMemoryMigrations({ query });

    const statements = query.mock.calls.map(([statement]) => String(statement));
    const scheduleVisibilityConstraints = statements.filter((statement) =>
      statement.includes("add constraint agent_schedule_memories_visibility_check")
    );

    expect(scheduleVisibilityConstraints).toHaveLength(1);
    expect(scheduleVisibilityConstraints[0]).toContain("'private', 'group', 'profile'");
  });
});
