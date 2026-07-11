import type { GraphDriveClient } from "../types.js";
import { syncOneDriveCatalogSource } from "./onedrive-sync.js";
import type { CatalogSourceInput, CatalogStore } from "./store.js";

export interface SyncCatalogSourcesOptions {
  catalog: CatalogStore;
  graph?: GraphDriveClient;
  sources: CatalogSourceInput[];
}

export interface SyncCatalogSourcesResult {
  sources: number;
  synced: number;
  skipped: number;
  upserted: number;
  itemSkipped: number;
  tombstoned: number;
}

export async function syncCatalogSources(
  options: SyncCatalogSourcesOptions
): Promise<SyncCatalogSourcesResult> {
  const result: SyncCatalogSourcesResult = {
    sources: options.sources.length,
    synced: 0,
    skipped: 0,
    upserted: 0,
    itemSkipped: 0,
    tombstoned: 0
  };

  for (const input of options.sources) {
    const source = await options.catalog.upsertSource(input);
    if (!source.enabled) {
      result.skipped += 1;
      continue;
    }
    if (source.adapterType !== "onedrive") {
      result.skipped += 1;
      continue;
    }
    if (!options.graph) {
      throw new Error(`catalog_sync_graph_required:${source.sourceKey}`);
    }
    const sync = await syncOneDriveCatalogSource({
      catalog: options.catalog,
      graph: options.graph,
      source
    });
    result.synced += 1;
    result.upserted += sync.upserted;
    result.itemSkipped += sync.skipped;
    result.tombstoned += sync.tombstoned;
  }

  return result;
}
