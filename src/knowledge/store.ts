import { randomUUID } from "node:crypto";

import { normalizeKnowledgeSourceRoutingFields } from "./routing-metadata.js";
import { knowledgeSectionKey } from "./section-key.js";

export type KnowledgeAdapterType = "notion";

export interface KnowledgeSourceInput {
  profileName: string;
  sourceKey: string;
  displayName: string;
  adapterType: KnowledgeAdapterType;
  externalRootId: string;
  rootUrl: string;
  enabled: boolean;
  expiresAt?: string;
  aliases?: string[];
  topics?: string[];
  sampleQueries?: string[];
}

export interface KnowledgeSourceRecord extends Omit<
  KnowledgeSourceInput,
  "aliases" | "topics" | "sampleQueries"
> {
  id: string;
  adminAliases: string[];
  adminTopics: string[];
  adminSampleQueries: string[];
  routingDisplayName?: string;
  aliases: string[];
  topics: string[];
  sampleQueries: string[];
  disabledAt?: string;
  purgeAfter?: string;
  lastSyncedAt?: string;
  syncStatus?: "pending" | "ready" | "embedding_pending" | "failed";
  syncErrorCode?: string;
}

export interface KnowledgeNodeInput {
  externalId: string;
  parentExternalId?: string;
  type: string;
  ordinal: number;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunkInput {
  headingPath: string[];
  sectionKey?: string;
  ordinal: number;
  content: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunkRecord extends Omit<KnowledgeChunkInput, "sectionKey"> {
  id: string;
  documentId: string;
  sectionKey: string;
}

export interface KnowledgeDocumentRecord {
  id: string;
  sourceId: string;
  externalId: string;
  title: string;
  url: string;
  properties?: Record<string, unknown>;
  nodes: Array<KnowledgeNodeInput & { id: string }>;
  chunks: KnowledgeChunkRecord[];
  deletedAt?: string;
}

export interface KnowledgeSearchResult extends KnowledgeChunkRecord {
  score: number;
  document: Pick<KnowledgeDocumentRecord, "id" | "externalId" | "title" | "url">;
  source: KnowledgeSourceRecord;
}

export interface KnowledgeStore {
  upsertSource(input: KnowledgeSourceInput): Promise<KnowledgeSourceRecord>;
  listSources(input: {
    profileName: string;
    includeDisabled?: boolean;
  }): Promise<KnowledgeSourceRecord[]>;
  updateSource(input: {
    profileName: string;
    sourceKey: string;
    enabled?: boolean;
    syncStatus?: KnowledgeSourceRecord["syncStatus"];
    syncErrorCode?: string;
    lastSyncedAt?: string;
    routingDisplayName?: string;
    aliases?: string[];
    topics?: string[];
    sampleQueries?: string[];
  }): Promise<KnowledgeSourceRecord | undefined>;
  removeSource(input: { profileName: string; sourceKey: string }): Promise<boolean>;
  replaceDocument(input: {
    sourceId: string;
    externalId: string;
    title: string;
    url: string;
    properties?: Record<string, unknown>;
    nodes: KnowledgeNodeInput[];
    chunks: KnowledgeChunkInput[];
  }): Promise<KnowledgeDocumentRecord>;
  tombstoneMissingDocuments(input: {
    sourceId: string;
    liveExternalIds: string[];
    deletedAt: string;
  }): Promise<number>;
  upsertEmbedding(input: {
    chunkId: string;
    provider: string;
    model: string;
    dimensions: number;
    embedding: number[];
    contentHash: string;
  }): Promise<void>;
  listChunksNeedingEmbedding(input: {
    chunkIds: string[];
    provider: string;
    model: string;
  }): Promise<KnowledgeChunkRecord[]>;
  hasAnchor(input: {
    profileName: string;
    sourceId: string;
    documentId: string;
    sectionKey?: string;
  }): Promise<boolean>;
  search(input: {
    profileName: string;
    query: string;
    queryEmbedding?: number[];
    embeddingProvider?: string;
    embeddingModel?: string;
    sourceId?: string;
    sourceKey?: string;
    documentId?: string;
    sectionKey?: string;
    ordinal?: number;
    limit?: number;
  }): Promise<KnowledgeSearchResult[]>;
  purgeExpired(now: Date): Promise<number>;
}

interface EmbeddingRecord {
  chunkId: string;
  provider: string;
  model: string;
  dimensions: number;
  embedding: number[];
  contentHash: string;
}

export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly sources = new Map<string, KnowledgeSourceRecord>();
  private readonly documents = new Map<string, KnowledgeDocumentRecord>();
  private readonly embeddings = new Map<string, EmbeddingRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async upsertSource(input: KnowledgeSourceInput): Promise<KnowledgeSourceRecord> {
    const existing = Array.from(this.sources.values()).find(
      (item) => item.profileName === input.profileName && item.sourceKey === input.sourceKey
    );
    const staged = normalizeKnowledgeSourceRoutingFields(input);
    const record: KnowledgeSourceRecord = {
      ...existing,
      ...input,
      sourceKey: staged.sourceKey,
      displayName: staged.displayName,
      adminAliases: staged.aliases,
      adminTopics: staged.topics,
      adminSampleQueries: staged.sampleQueries,
      routingDisplayName: existing?.routingDisplayName,
      aliases: existing?.aliases ?? [],
      topics: existing?.topics ?? [],
      sampleQueries: existing?.sampleQueries ?? [],
      id: existing?.id ?? randomUUID(),
      syncStatus: existing?.syncStatus ?? "pending"
    };
    this.sources.set(record.id, record);
    return record;
  }

  async listSources(input: {
    profileName: string;
    includeDisabled?: boolean;
  }): Promise<KnowledgeSourceRecord[]> {
    return Array.from(this.sources.values())
      .filter((source) => source.profileName === input.profileName)
      .filter((source) => input.includeDisabled || this.sourceActive(source))
      .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  }

  async updateSource(input: {
    profileName: string;
    sourceKey: string;
    enabled?: boolean;
    syncStatus?: KnowledgeSourceRecord["syncStatus"];
    syncErrorCode?: string;
    lastSyncedAt?: string;
    routingDisplayName?: string;
    aliases?: string[];
    topics?: string[];
    sampleQueries?: string[];
  }): Promise<KnowledgeSourceRecord | undefined> {
    const source = Array.from(this.sources.values()).find(
      (item) => item.profileName === input.profileName && item.sourceKey === input.sourceKey
    );
    if (!source) return undefined;
    const enabled = input.enabled ?? source.enabled;
    const shouldPromote = Boolean(input.lastSyncedAt || input.routingDisplayName);
    const promoted = shouldPromote
      ? normalizeKnowledgeSourceRoutingFields({
          sourceKey: source.sourceKey,
          displayName: input.routingDisplayName ?? source.displayName,
          aliases: input.aliases ?? source.adminAliases,
          topics: input.topics ?? source.adminTopics,
          sampleQueries: input.sampleQueries ?? source.adminSampleQueries
        })
      : undefined;
    const updated: KnowledgeSourceRecord = {
      ...source,
      enabled,
      ...(input.syncStatus ? { syncStatus: input.syncStatus } : {}),
      ...(input.syncErrorCode === undefined
        ? input.syncStatus
          ? { syncErrorCode: undefined }
          : {}
        : { syncErrorCode: input.syncErrorCode }),
      ...(input.lastSyncedAt ? { lastSyncedAt: input.lastSyncedAt } : {}),
      ...(promoted
        ? {
            routingDisplayName: promoted.displayName,
            aliases: promoted.aliases,
            topics: promoted.topics,
            sampleQueries: promoted.sampleQueries
          }
        : {}),
      disabledAt: enabled ? undefined : (source.disabledAt ?? this.now().toISOString()),
      purgeAfter: enabled ? undefined : source.purgeAfter
    };
    this.sources.set(updated.id, updated);
    return updated;
  }

  async removeSource(input: { profileName: string; sourceKey: string }): Promise<boolean> {
    const source = Array.from(this.sources.values()).find(
      (item) => item.profileName === input.profileName && item.sourceKey === input.sourceKey
    );
    if (!source) return false;
    for (const document of Array.from(this.documents.values())) {
      if (document.sourceId !== source.id) continue;
      for (const chunk of document.chunks)
        for (const key of Array.from(this.embeddings.keys()))
          if (key.startsWith(`${chunk.id}:`)) this.embeddings.delete(key);
      this.documents.delete(document.id);
    }
    this.sources.delete(source.id);
    return true;
  }

  async replaceDocument(input: {
    sourceId: string;
    externalId: string;
    title: string;
    url: string;
    properties?: Record<string, unknown>;
    nodes: KnowledgeNodeInput[];
    chunks: KnowledgeChunkInput[];
  }): Promise<KnowledgeDocumentRecord> {
    const existing = Array.from(this.documents.values()).find(
      (item) => item.sourceId === input.sourceId && item.externalId === input.externalId
    );
    const id = existing?.id ?? randomUUID();
    const oldChunks = new Map(existing?.chunks.map((chunk) => [chunk.contentHash, chunk]) ?? []);
    const record: KnowledgeDocumentRecord = {
      id,
      sourceId: input.sourceId,
      externalId: input.externalId,
      title: input.title,
      url: input.url,
      properties: input.properties,
      nodes: input.nodes.map((node) => ({ ...node, id: randomUUID() })),
      chunks: input.chunks.map((chunk) => ({
        ...chunk,
        sectionKey: knowledgeSectionKey(chunk.headingPath),
        id: oldChunks.get(chunk.contentHash)?.id ?? randomUUID(),
        documentId: id
      }))
    };
    this.documents.set(id, record);
    return record;
  }

  async tombstoneMissingDocuments(input: {
    sourceId: string;
    liveExternalIds: string[];
    deletedAt: string;
  }): Promise<number> {
    const live = new Set(input.liveExternalIds);
    let count = 0;
    for (const document of this.documents.values())
      if (
        document.sourceId === input.sourceId &&
        !live.has(document.externalId) &&
        !document.deletedAt
      ) {
        document.deletedAt = input.deletedAt;
        count += 1;
      }
    return count;
  }

  async upsertEmbedding(input: EmbeddingRecord): Promise<void> {
    this.embeddings.set(`${input.chunkId}:${input.provider}:${input.model}`, input);
  }

  async listChunksNeedingEmbedding(input: {
    chunkIds: string[];
    provider: string;
    model: string;
  }): Promise<KnowledgeChunkRecord[]> {
    const wanted = new Set(input.chunkIds);
    return Array.from(this.documents.values())
      .flatMap((document) => document.chunks)
      .filter((chunk) => {
        if (!wanted.has(chunk.id)) return false;
        const embedded = this.embeddings.get(`${chunk.id}:${input.provider}:${input.model}`);
        return !embedded || embedded.contentHash !== chunk.contentHash;
      });
  }

  async search(input: {
    profileName: string;
    query: string;
    queryEmbedding?: number[];
    embeddingProvider?: string;
    embeddingModel?: string;
    sourceId?: string;
    sourceKey?: string;
    documentId?: string;
    sectionKey?: string;
    ordinal?: number;
    limit?: number;
  }): Promise<KnowledgeSearchResult[]> {
    const normalizedQuery = normalize(input.query);
    const candidates: KnowledgeSearchResult[] = [];
    for (const document of this.documents.values()) {
      const source = this.sources.get(document.sourceId);
      if (
        !source ||
        source.profileName !== input.profileName ||
        !this.sourceEligible(source) ||
        document.deletedAt
      )
        continue;
      if (input.sourceKey && source.sourceKey !== input.sourceKey) continue;
      if (input.sourceId && source.id !== input.sourceId) continue;
      if (input.documentId && document.id !== input.documentId) continue;
      for (const chunk of document.chunks) {
        if (input.sectionKey && chunk.sectionKey !== input.sectionKey) continue;
        const lexical = lexicalScore(
          normalizedQuery,
          normalize(`${document.title} ${chunk.headingPath.join(" ")} ${chunk.content}`)
        );
        const embedding = input.queryEmbedding
          ? this.latestEmbedding(
              chunk.id,
              input.queryEmbedding.length,
              input.embeddingProvider,
              input.embeddingModel
            )
          : undefined;
        const vector =
          embedding && input.queryEmbedding ? cosine(input.queryEmbedding, embedding.embedding) : 0;
        const ordinalBoost =
          input.ordinal === undefined ? 0 : chunk.ordinal === input.ordinal ? 2 : -0.5;
        const score = lexical + vector + ordinalBoost;
        if (score <= 0) continue;
        candidates.push({
          ...chunk,
          score,
          document: {
            id: document.id,
            externalId: document.externalId,
            title: document.title,
            url: document.url
          },
          source
        });
      }
    }
    return candidates
      .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
      .slice(0, input.limit ?? 8);
  }

  async hasAnchor(input: {
    profileName: string;
    sourceId: string;
    documentId: string;
    sectionKey?: string;
  }): Promise<boolean> {
    const source = Array.from(this.sources.values()).find(
      (item) =>
        item.profileName === input.profileName &&
        item.id === input.sourceId &&
        this.sourceEligible(item)
    );
    if (!source) return false;
    const document = this.documents.get(input.documentId);
    if (!document || document.sourceId !== source.id || document.deletedAt) return false;
    return input.sectionKey
      ? document.chunks.some((chunk) => chunk.sectionKey === input.sectionKey)
      : true;
  }

  async purgeExpired(now: Date): Promise<number> {
    let purged = 0;
    for (const [id, source] of this.sources) {
      if (source.enabled && source.expiresAt && Date.parse(source.expiresAt) <= now.getTime()) {
        this.sources.set(id, {
          ...source,
          enabled: false,
          disabledAt: now.toISOString(),
          purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
      }
    }
    for (const source of Array.from(this.sources.values())) {
      if (source.purgeAfter && Date.parse(source.purgeAfter) <= now.getTime()) {
        for (const document of Array.from(this.documents.values())) {
          if (document.sourceId === source.id) {
            for (const chunk of document.chunks) {
              for (const key of Array.from(this.embeddings.keys()))
                if (key.startsWith(`${chunk.id}:`)) this.embeddings.delete(key);
            }
            this.documents.delete(document.id);
          }
        }
        this.sources.delete(source.id);
        purged += 1;
      }
    }
    return purged;
  }

  private sourceActive(source: KnowledgeSourceRecord): boolean {
    return (
      source.enabled && (!source.expiresAt || Date.parse(source.expiresAt) > this.now().getTime())
    );
  }

  private sourceEligible(source: KnowledgeSourceRecord): boolean {
    return this.sourceActive(source) && Boolean(source.lastSyncedAt && source.routingDisplayName);
  }

  private latestEmbedding(
    chunkId: string,
    dimensions: number,
    provider?: string,
    model?: string
  ): EmbeddingRecord | undefined {
    return Array.from(this.embeddings.values()).find(
      (item) =>
        item.chunkId === chunkId &&
        item.dimensions === dimensions &&
        (!provider || item.provider === provider) &&
        (!model || item.model === model)
    );
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function lexicalScore(query: string, text: string): number {
  if (!query) return 0;
  if (text.includes(query)) return 2;
  const chars = Array.from(new Set(query));
  return chars.filter((char) => text.includes(char)).length / Math.max(chars.length, 1);
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}
