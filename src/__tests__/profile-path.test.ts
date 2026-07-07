import { describe, expect, it } from "vitest";

import {
  assertCanonicalWebhookPath,
  buildWebhookPath,
  isCanonicalProfileName
} from "../profile-path.js";

describe("profile webhook path contract", () => {
  it("builds the canonical public gateway path from the profile name", () => {
    expect(buildWebhookPath("helper")).toBe("/api/line/webhook/helper");
    expect(buildWebhookPath("main-public")).toBe("/api/line/webhook/main-public");
    expect(buildWebhookPath("team_1")).toBe("/api/line/webhook/team_1");
  });

  it("accepts only lowercase URL-safe profile names", () => {
    expect(isCanonicalProfileName("helper")).toBe(true);
    expect(isCanonicalProfileName("main-public")).toBe(true);
    expect(isCanonicalProfileName("team_1")).toBe(true);

    expect(isCanonicalProfileName("Helper")).toBe(false);
    expect(isCanonicalProfileName("main public")).toBe(false);
    expect(isCanonicalProfileName("-helper")).toBe(false);
    expect(isCanonicalProfileName("helper/extra")).toBe(false);
  });

  it("rejects profile webhook paths that do not match the canonical path", () => {
    expect(() => assertCanonicalWebhookPath("helper", "/line/helper/webhook")).toThrowError(
      'Profile "helper" webhookPath must be "/api/line/webhook/helper"'
    );
  });
});
