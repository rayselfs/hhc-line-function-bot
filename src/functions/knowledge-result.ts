import type { AgentEntity, AgentResultEnvelope } from "../agent/result-envelope.js";
import { normalizeKnowledgeSourceRoutingFields } from "../knowledge/routing-metadata.js";
import type { KnowledgeSearchResult, KnowledgeSourceRecord } from "../knowledge/store.js";
import type { FunctionExecutionResult } from "../types.js";

const KNOWLEDGE_OPERATIONS = ["continue", "refine", "select"];

export function knowledgeSuccessEnvelope(results: KnowledgeSearchResult[]): AgentResultEnvelope {
  const first = results[0]!;
  const section = safeLabel(first.headingPath.at(-1));
  const anchors = {
    sourceKey: first.source.sourceKey,
    documentId: first.document.id,
    ...(section ? { section } : {}),
    ordinal: first.ordinal
  };
  return {
    status: "success",
    replyText: "知識查詢完成。",
    anchors,
    entities: knowledgeEntities(results),
    evidence: results.slice(0, 8).map((result) => {
      const resultSection = safeLabel(result.headingPath.at(-1));
      return {
        kind: "knowledge_section",
        reference: {
          sourceKey: result.source.sourceKey,
          documentId: result.document.id,
          ...(resultSection ? { section: resultSection } : {}),
          ordinal: result.ordinal
        }
      };
    }),
    supportedOperations: [...KNOWLEDGE_OPERATIONS]
  };
}

export function knowledgeNotFoundResult(): FunctionExecutionResult {
  const replyText = "目前加入的知識中找不到足夠資料回答這個問題。";
  return {
    ok: true,
    executedAction: "query_knowledge",
    replyText,
    agentResult: { status: "not_found", replyText }
  };
}

export function knowledgeUnavailableResult(): FunctionExecutionResult {
  const replyText = "目前無法使用原本的知識來源，請重新指定要查的知識。";
  return {
    ok: true,
    executedAction: "query_knowledge",
    replyText,
    agentResult: { status: "unavailable", replyText }
  };
}

export function knowledgeAmbiguousResult(
  sources: KnowledgeSourceRecord[]
): FunctionExecutionResult {
  const ordered = [...sources].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  const choices = ordered.map(({ displayName }) => safeLabel(displayName) ?? "知識來源");
  const prompt = `這個問題可能屬於多個知識來源，請選擇：${choices.join("、")}。`;
  return {
    ok: true,
    executedAction: "query_knowledge",
    replyText: prompt,
    agentResult: {
      status: "ambiguous",
      replyText: prompt,
      entities: ordered.map((source) => ({
        type: "source",
        key: source.sourceKey,
        label: safeLabel(source.displayName) ?? "知識來源"
      })),
      clarification: { prompt, choices }
    }
  };
}

export function knowledgeCitationLines(
  results: KnowledgeSearchResult[]
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];
  for (const result of results) {
    if (!seen.has(result.document.id)) {
      seen.add(result.document.id);
      sources.push({ title: result.document.title, url: result.document.url });
    }
  }
  return sources;
}

export function uniqueKnowledgeResultSources(
  results: KnowledgeSearchResult[]
): KnowledgeSourceRecord[] {
  const sources = new Map<string, KnowledgeSourceRecord>();
  for (const result of results) sources.set(result.source.sourceKey, result.source);
  return Array.from(sources.values());
}

function knowledgeEntities(results: KnowledgeSearchResult[]): AgentEntity[] {
  const entities = new Map<string, AgentEntity>();
  for (const result of results) {
    const sourceLabel = safeLabel(result.source.displayName) ?? "知識來源";
    entities.set(`source:${result.source.sourceKey}`, {
      type: "source",
      key: result.source.sourceKey,
      label: sourceLabel,
      ...(result.source.aliases.length > 0 ? { aliases: result.source.aliases } : {})
    });
    entities.set(`document:${result.document.id}`, {
      type: "document",
      key: result.document.id,
      label: safeLabel(result.document.title) ?? "知識文件"
    });
    const section = safeLabel(result.headingPath.at(-1));
    if (section) {
      entities.set(`section:${section}`, { type: "section", key: section, label: section });
    }
    entities.set(`ordinal:${result.ordinal}`, {
      type: "ordinal",
      key: String(result.ordinal),
      label: `第 ${result.ordinal + 1} 項`
    });
  }
  return Array.from(entities.values()).slice(0, 20);
}

function safeLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeKnowledgeSourceRoutingFields({
      sourceKey: "safe",
      displayName: value
    }).displayName;
  } catch {
    return undefined;
  }
}
