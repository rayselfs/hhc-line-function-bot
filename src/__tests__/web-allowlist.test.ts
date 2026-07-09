import { describe, expect, it } from "vitest";

import {
  InMemoryWebAllowlistStore,
  isUrlAllowedByWebAllowlist,
  type WebAllowlistStore
} from "../web/allowlist.js";

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

  it("stores and matches by root domain instead of only the submitted subdomain", async () => {
    const store = new InMemoryWebAllowlistStore();
    const entry = await store.add({
      profileName: "helper",
      domain: "www.wikipedia.org",
      createdBy: "admin"
    });

    expect(entry.domain).toBe("wikipedia.org");
    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "https://www.wikipedia.org/wiki/Test")
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "https://wikipedia.org/wiki/Test")
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "https://en.wikipedia.org/wiki/Test")
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "https://wikipedia.org.evil.example/wiki/Test")
    ).resolves.toMatchObject({ allowed: false, reason: "domain_not_allowed" });
  });

  it("matches legacy stored subdomain entries by their root domain", async () => {
    const store: WebAllowlistStore = {
      list: async () => [
        {
          id: "legacy",
          profileName: "helper",
          domain: "www.wikipedia.org",
          enabled: true,
          createdBy: "admin",
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z"
        }
      ],
      add: async () => {
        throw new Error("not_used");
      },
      setEnabled: async () => false,
      remove: async () => false
    };

    await expect(
      isUrlAllowedByWebAllowlist(store, "helper", "https://en.wikipedia.org/wiki/Test")
    ).resolves.toMatchObject({ allowed: true });
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
