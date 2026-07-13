import type { KnowledgeNodeInput, KnowledgeSourceRecord, KnowledgeStore } from "./store.js";

export interface KnowledgeRoutingMetadata {
  sourceKey: string;
  displayName: string;
  aliases: string[];
  topics: string[];
  sampleQueries: string[];
}

export interface DerivedKnowledgeRoutingMetadata {
  displayName: string;
  aliases: string[];
  topics: string[];
  sampleQueries: string[];
}

export interface KnowledgeMetadataDocument {
  title: string;
  nodes?: Array<Pick<KnowledgeNodeInput, "type" | "text">>;
  chunks?: Array<{ headingPath: string[] }>;
}

export const KNOWLEDGE_ROUTING_LIMITS = {
  sources: 20,
  itemsPerField: 20,
  itemCharacters: 100,
  totalCharacters: 6_200
} as const;

const UNSAFE_METADATA_PATTERNS = [
  /(?:https?:\/\/|www\.)/iu,
  /\bBearer\s+\S+/iu,
  /\b(?:sk-(?:proj-)?|ghp_|github_pat_|xox[bp]-)[A-Za-z0-9_-]{8,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu
];

export function deriveKnowledgeRoutingMetadata(
  displayName: string,
  documents: readonly KnowledgeMetadataDocument[]
): DerivedKnowledgeRoutingMetadata {
  const titles = documents.map(({ title }) => title);
  const headings = documents.flatMap((document) => [
    ...(document.nodes ?? [])
      .filter(({ type }) => /^heading_[1-3]$/u.test(type))
      .map(({ text }) => text),
    ...(document.chunks ?? []).flatMap(({ headingPath }) => headingPath)
  ]);
  const aliases = [displayName, ...titles].flatMap(titleVariants);
  return normalizeKnowledgeRoutingMetadata({
    sourceKey: "derived",
    displayName,
    aliases,
    topics: [...titles, ...headings],
    sampleQueries: []
  });
}

export function normalizeKnowledgeRoutingMetadata(
  input: KnowledgeRoutingMetadata
): KnowledgeRoutingMetadata {
  const budget = { remaining: KNOWLEDGE_ROUTING_LIMITS.totalCharacters };
  const sourceKey = boundedText(input.sourceKey, budget);
  const displayName = boundedText(input.displayName, budget);
  if (!sourceKey || !displayName) throw new Error("knowledge_routing_metadata_invalid");
  return {
    sourceKey,
    displayName,
    aliases: boundedList(input.aliases, budget, [displayName]),
    topics: boundedList(input.topics, budget),
    sampleQueries: boundedList(input.sampleQueries, budget)
  };
}

export function normalizeKnowledgeSourceRoutingFields(input: {
  sourceKey: string;
  displayName: string;
  aliases?: readonly string[];
  topics?: readonly string[];
  sampleQueries?: readonly string[];
}): KnowledgeRoutingMetadata {
  return normalizeKnowledgeRoutingMetadata({
    sourceKey: input.sourceKey,
    displayName: input.displayName,
    aliases: [...(input.aliases ?? [])],
    topics: [...(input.topics ?? [])],
    sampleQueries: [...(input.sampleQueries ?? [])]
  });
}

export async function listKnowledgeRoutingMetadata(
  store: KnowledgeStore,
  profileName: string,
  limit: number
): Promise<KnowledgeRoutingMetadata[]> {
  const boundedLimit = Math.max(
    0,
    Math.min(KNOWLEDGE_ROUTING_LIMITS.sources, Math.floor(Number.isFinite(limit) ? limit : 0))
  );
  if (!boundedLimit) return [];
  const sources = await store.listSources({ profileName, includeDisabled: false });
  return sources
    .filter(lastKnownGoodSource)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
    .flatMap((source) => {
      try {
        return [sourceRoutingMetadata(source)];
      } catch {
        return [];
      }
    })
    .slice(0, boundedLimit);
}

export function matchingKnowledgeRoutingMetadata(
  text: string,
  sources: readonly KnowledgeRoutingMetadata[]
): KnowledgeRoutingMetadata[] {
  const normalizedText = comparable(text);
  if (!normalizedText) return [];
  return sources.filter((source) =>
    routingTerms(source).some((term) => {
      const normalizedTerm = comparable(term);
      return normalizedTerm.length > 0 && normalizedText.includes(normalizedTerm);
    })
  );
}

function sourceRoutingMetadata(source: KnowledgeSourceRecord): KnowledgeRoutingMetadata {
  return normalizeKnowledgeSourceRoutingFields(source);
}

function lastKnownGoodSource(source: KnowledgeSourceRecord): boolean {
  return Boolean(source.enabled && source.lastSyncedAt);
}

function routingTerms(source: KnowledgeRoutingMetadata): string[] {
  return [
    source.sourceKey,
    source.displayName,
    ...source.aliases,
    ...source.topics,
    ...source.sampleQueries
  ];
}

function titleVariants(value: string): string[] {
  const normalized = safeText(value);
  if (!normalized) return [];
  const withoutYear = normalized.replace(/^\d{4}(?:\s*[-–—年]\s*|\s+)/u, "").trim();
  return withoutYear && comparable(withoutYear) !== comparable(normalized)
    ? [normalized, withoutYear]
    : [normalized];
}

function boundedList(
  values: readonly string[],
  budget: { remaining: number },
  omit: string[] = []
) {
  const seen = new Set(omit.map(comparable));
  const output: string[] = [];
  for (const value of values) {
    if (output.length >= KNOWLEDGE_ROUTING_LIMITS.itemsPerField || budget.remaining <= 0) break;
    const normalized = safeText(value);
    if (!normalized) continue;
    const key = comparable(normalized);
    if (!key || seen.has(key)) continue;
    const bounded = Array.from(normalized)
      .slice(0, Math.min(KNOWLEDGE_ROUTING_LIMITS.itemCharacters, budget.remaining))
      .join("");
    if (!bounded) break;
    seen.add(comparable(bounded));
    output.push(bounded);
    budget.remaining -= Array.from(bounded).length;
  }
  return output;
}

function boundedText(value: string, budget: { remaining: number }): string {
  const normalized = safeText(value);
  if (!normalized || budget.remaining <= 0) return "";
  const bounded = Array.from(normalized)
    .slice(0, Math.min(KNOWLEDGE_ROUTING_LIMITS.itemCharacters, budget.remaining))
    .join("");
  budget.remaining -= Array.from(bounded).length;
  return bounded;
}

function safeText(value: string): string {
  const normalized = Array.from(value.normalize("NFKC"))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("")
    .trim()
    .replace(/\s+/gu, " ");
  return UNSAFE_METADATA_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  })
    ? ""
    : normalized;
}

function comparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}
