import { describe, expect, it } from "vitest";

import { syncCatalogSources } from "../catalog/sync-service.js";
import { InMemoryCatalogStore, type CatalogSourceInput } from "../catalog/store.js";
import type { GraphDriveClient } from "../types.js";

const enabledSource: CatalogSourceInput = {
  profileName: "helper",
  sourceKey: "weekly_report_audio",
  adapterType: "onedrive",
  domain: "audio",
  defaultItemKind: "weekly_report_audio",
  rootLocation: { driveId: "drive-1", folderItemId: "folder-1" },
  enabled: true,
  syncPolicy: { mode: "scheduled", intervalMinutes: 15 },
  capabilities: { read: ["helper"], write: [] }
};

describe("catalog sync service", () => {
  it("syncs enabled OneDrive sources and skips disabled sources", async () => {
    const catalog = new InMemoryCatalogStore();
    const graph: GraphDriveClient = {
      listFolderChildren: async () => [],
      listFolderFilesRecursive: async () => [
        {
          id: "audio-1",
          driveId: "drive-1",
          name: "2026-07-週報音檔.mp3",
          path: "2026/2026-07-週報音檔.mp3"
        }
      ],
      createSharingLink: async () => "unused"
    };
    await catalog.upsertSource(enabledSource);
    await catalog.upsertSource({ ...enabledSource, sourceKey: "disabled_audio", enabled: false });

    const result = await syncCatalogSources({
      catalog,
      graph
    });

    expect(result).toEqual({
      sources: 2,
      synced: 1,
      skipped: 1,
      upserted: 1,
      itemSkipped: 0,
      tombstoned: 0,
      scheduleUpserted: 0,
      scheduleSkipped: 0,
      scheduleTombstoned: 0
    });
    await expect(
      catalog.searchItems({
        profileName: "helper",
        query: "週報音檔",
        itemKinds: ["weekly_report_audio"]
      })
    ).resolves.toHaveLength(1);
  });

  it("can sync a single source key for manual admin operations", async () => {
    const catalog = new InMemoryCatalogStore();
    const graph: GraphDriveClient = {
      listFolderChildren: async () => [],
      listFolderFilesRecursive: async (_driveId, folderItemId) => [
        {
          id: `${folderItemId}-audio`,
          driveId: "drive-1",
          name: `${folderItemId}.mp3`
        }
      ],
      createSharingLink: async () => "unused"
    };
    await catalog.upsertSource(enabledSource);
    await catalog.upsertSource({
      ...enabledSource,
      sourceKey: "second_audio",
      rootLocation: { driveId: "drive-1", folderItemId: "folder-2" }
    });

    const result = await syncCatalogSources({
      catalog,
      graph,
      sourceKeys: ["second_audio"]
    });

    expect(result.sources).toBe(1);
    expect(result.synced).toBe(1);
    await expect(
      catalog.searchItems({
        profileName: "helper",
        itemKinds: ["weekly_report_audio"],
        allowedSourceKeys: ["weekly_report_audio"]
      })
    ).resolves.toHaveLength(0);
    await expect(
      catalog.searchItems({
        profileName: "helper",
        itemKinds: ["weekly_report_audio"],
        allowedSourceKeys: ["second_audio"]
      })
    ).resolves.toHaveLength(1);
  });

  it("can restrict manual sync to one profile", async () => {
    const catalog = new InMemoryCatalogStore();
    const syncedFolders: string[] = [];
    const graph: GraphDriveClient = {
      listFolderChildren: async () => [],
      listFolderFilesRecursive: async (_driveId, folderItemId) => {
        syncedFolders.push(folderItemId);
        return [{ id: `${folderItemId}-audio`, driveId: "drive-1", name: `${folderItemId}.mp3` }];
      },
      createSharingLink: async () => "unused"
    };
    await catalog.upsertSource(enabledSource);
    await catalog.upsertSource({
      ...enabledSource,
      profileName: "main",
      rootLocation: { driveId: "drive-1", folderItemId: "main-folder" }
    });

    const result = await syncCatalogSources({
      catalog,
      graph,
      profileName: "helper",
      sourceKeys: ["weekly_report_audio"]
    });

    expect(result.sources).toBe(1);
    expect(syncedFolders).toEqual(["folder-1"]);
  });
});
