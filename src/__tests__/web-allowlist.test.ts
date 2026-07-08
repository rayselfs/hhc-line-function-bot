import { describe, expect, it } from "vitest";

import { InMemoryWebAllowlistStore, isUrlAllowedByWebAllowlist } from "../web/allowlist.js";

describe("controlled web allowlist", () => {
  it("allows only enabled profile-scoped https entries", async () => {
    const store = new InMemoryWebAllowlistStore();
    await store.add({
      profileName: "helper",
      domain: "example.org",
      pathPrefix: "/news",
      label: "news",
      createdBy: "admin"
    });

    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "https://example.org/news/post")
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      isUrlAllowedByWebAllowlist(store, "main", "https://example.org/news/post")
    ).resolves.toMatchObject({ allowed: false, reason: "domain_not_allowed" });
    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "http://example.org/news/post")
    ).resolves.toMatchObject({ allowed: false, reason: "https_required" });
  });

  it("blocks localhost and private network targets even if a domain is present", async () => {
    const store = new InMemoryWebAllowlistStore();
    await store.add({
      profileName: "helper",
      domain: "127.0.0.1",
      label: "bad",
      createdBy: "admin"
    });

    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "https://127.0.0.1/admin")
    ).resolves.toMatchObject({ allowed: false, reason: "private_target_denied" });
  });
});
