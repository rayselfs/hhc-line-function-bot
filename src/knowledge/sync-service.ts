import type { EmbeddingClient } from "../clients/ollama-embedding.js";
import type { NotionKnowledgeClient } from "../clients/notion-knowledge.js";
import { chunkKnowledgeNodes } from "./chunker.js";
import type { KnowledgeSourceRecord, KnowledgeStore } from "./store.js";

export interface KnowledgeSyncResult {
  documents: number;
  chunks: number;
  embedded: number;
  status: "ready" | "embedding_pending";
}

export async function syncKnowledgeSource(input: {
  source: KnowledgeSourceRecord;
  store: KnowledgeStore;
  notion: NotionKnowledgeClient;
  embedding?: EmbeddingClient;
  batchSize?: number;
  now?: () => Date;
}): Promise<KnowledgeSyncResult> {
  const now = input.now ?? (() => new Date());
  const documents = await input.notion.fetchRoot(input.source.externalRootId);
  const chunks = [];
  for (const document of documents) {
    const record = await input.store.replaceDocument({
      sourceId: input.source.id,
      externalId: document.externalId,
      title: document.title,
      url: document.url,
      properties: document.properties,
      nodes: document.nodes,
      chunks: chunkKnowledgeNodes(document.nodes)
    });
    chunks.push(...record.chunks);
  }
  await input.store.tombstoneMissingDocuments({
    sourceId: input.source.id,
    liveExternalIds: documents.map((document) => document.externalId),
    deletedAt: now().toISOString()
  });

  let embedded = 0;
  let status: KnowledgeSyncResult["status"] = "ready";
  if (input.embedding) {
    const pending = await input.store.listChunksNeedingEmbedding({
      chunkIds: chunks.map((chunk) => chunk.id),
      provider: input.embedding.provider,
      model: input.embedding.model
    });
    const batchSize = input.batchSize ?? 16;
    try {
      for (let offset = 0; offset < pending.length; offset += batchSize) {
        const batch = pending.slice(offset, offset + batchSize);
        const vectors = await input.embedding.embed(batch.map((chunk) => chunk.content));
        for (let index = 0; index < batch.length; index += 1) {
          const chunk = batch[index]!;
          await input.store.upsertEmbedding({
            chunkId: chunk.id,
            provider: input.embedding.provider,
            model: input.embedding.model,
            dimensions: input.embedding.dimensions,
            embedding: vectors[index]!,
            contentHash: chunk.contentHash
          });
          embedded += 1;
        }
      }
    } catch {
      status = "embedding_pending";
    }
  }
  await input.store.updateSource({
    profileName: input.source.profileName,
    sourceKey: input.source.sourceKey,
    syncStatus: status,
    syncErrorCode: undefined,
    lastSyncedAt: now().toISOString()
  });
  return { documents: documents.length, chunks: chunks.length, embedded, status };
}
