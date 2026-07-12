import { extname } from "node:path";

import type { GraphDriveClient } from "../types.js";
import { catalogStorageIdentity, type CatalogSourceRecord, type CatalogStore } from "./store.js";

export interface OneDriveCatalogSyncOptions {
  catalog: CatalogStore;
  graph: GraphDriveClient;
  source: CatalogSourceRecord;
  now?: () => Date;
}

export interface OneDriveCatalogSyncResult {
  upserted: number;
  skipped: number;
  tombstoned: number;
}

export async function syncOneDriveCatalogSource(
  options: OneDriveCatalogSyncOptions
): Promise<OneDriveCatalogSyncResult> {
  const { catalog, graph, source } = options;
  if (!source.enabled || source.adapterType !== "onedrive") {
    return { upserted: 0, skipped: 0, tombstoned: 0 };
  }

  const driveId = source.rootLocation.driveId;
  const folderItemId = source.rootLocation.folderItemId;
  if (!driveId || !folderItemId) {
    throw new Error(`catalog_source_missing_onedrive_root:${source.sourceKey}`);
  }

  if (graph.listFolderDelta) {
    try {
      return await syncOneDriveDelta({ ...options, driveId, folderItemId });
    } catch (error) {
      if (isDeltaResetError(error) && source.syncCursor) {
        await catalog.updateSourceSyncCursor(source.id, undefined);
        return syncOneDriveDelta({
          ...options,
          source: { ...source, syncCursor: undefined },
          driveId,
          folderItemId
        });
      }
      if (!isDeltaUnsupportedError(error)) {
        throw error;
      }
    }
  }

  const items = graph.listFolderFilesRecursive
    ? await graph.listFolderFilesRecursive(driveId, folderItemId)
    : await graph.listFolderChildren(driveId, folderItemId);

  let upserted = 0;
  let skipped = 0;
  const liveStorageIdentities: string[] = [];
  const allowedExtensions = new Set(
    source.syncPolicy.allowedExtensions?.map((extension) => extension.toLowerCase()) ?? []
  );
  for (const item of items) {
    const extension = extname(item.name).toLowerCase();
    if (
      item.isFolder ||
      !item.id ||
      !item.name ||
      (allowedExtensions.size > 0 && !allowedExtensions.has(extension))
    ) {
      skipped += 1;
      continue;
    }
    const storageRef = {
      provider: "graph" as const,
      driveId: item.driveId ?? driveId,
      itemId: item.id
    };
    liveStorageIdentities.push(catalogStorageIdentity(storageRef));
    await catalog.upsertItem({
      sourceId: source.id,
      itemKind: source.defaultItemKind,
      domain: source.domain,
      title: item.name,
      path: item.path,
      extension,
      mimeType: guessMimeType(item.name),
      storageRef
    });
    upserted += 1;
  }

  const tombstoned = await catalog.tombstoneMissingItems({
    sourceId: source.id,
    liveStorageIdentities,
    deletedAt: (options.now ?? (() => new Date()))().toISOString()
  });

  return { upserted, skipped, tombstoned };
}

async function syncOneDriveDelta(
  options: OneDriveCatalogSyncOptions & { driveId: string; folderItemId: string }
): Promise<OneDriveCatalogSyncResult> {
  const { catalog, graph, source, driveId, folderItemId } = options;
  if (!graph.listFolderDelta) {
    throw new Error("graph_delta_unavailable");
  }
  const delta = await graph.listFolderDelta(driveId, folderItemId, source.syncCursor);
  const allowedExtensions = new Set(
    source.syncPolicy.allowedExtensions?.map((extension) => extension.toLowerCase()) ?? []
  );
  const liveStorageIdentities: string[] = [];
  const deletedStorageIdentities: string[] = [];
  let upserted = 0;
  let skipped = 0;
  for (const item of delta.items) {
    const storageRef = {
      provider: "graph" as const,
      driveId: item.driveId ?? driveId,
      itemId: item.id
    };
    const storageIdentity = catalogStorageIdentity(storageRef);
    if (item.deleted) {
      deletedStorageIdentities.push(storageIdentity);
      continue;
    }
    if (item.isFolder || !item.id || !item.name) {
      skipped += 1;
      continue;
    }
    const extension = extname(item.name).toLowerCase();
    if (allowedExtensions.size > 0 && !allowedExtensions.has(extension)) {
      skipped += 1;
      continue;
    }
    liveStorageIdentities.push(storageIdentity);
    await catalog.upsertItem({
      sourceId: source.id,
      itemKind: source.defaultItemKind,
      domain: source.domain,
      title: item.name,
      path: item.path,
      extension,
      mimeType: guessMimeType(item.name),
      storageRef
    });
    upserted += 1;
  }
  const deletedAt = (options.now ?? (() => new Date()))().toISOString();
  const tombstoned = source.syncCursor
    ? await catalog.tombstoneItemsByStorageIdentities({
        sourceId: source.id,
        storageIdentities: deletedStorageIdentities,
        deletedAt
      })
    : await catalog.tombstoneMissingItems({
        sourceId: source.id,
        liveStorageIdentities,
        deletedAt
      });
  await catalog.updateSourceSyncCursor(source.id, delta.deltaLink);
  return { upserted, skipped, tombstoned };
}

function isDeltaResetError(error: unknown): boolean {
  return Number((error as { statusCode?: unknown })?.statusCode) === 410;
}

function isDeltaUnsupportedError(error: unknown): boolean {
  return [400, 404, 405, 422].includes(Number((error as { statusCode?: unknown })?.statusCode));
}

function guessMimeType(filename: string): string | undefined {
  switch (extname(filename).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".ppt":
      return "application/vnd.ms-powerpoint";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return undefined;
  }
}
