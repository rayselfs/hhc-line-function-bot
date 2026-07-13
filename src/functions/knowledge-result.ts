import type { AgentEntity, AgentResultEnvelope } from "../agent/result-envelope.js";
import type { KnowledgeSearchResult, KnowledgeSourceRecord } from "../knowledge/store.js";
import type { FunctionExecutionResult } from "../types.js";

const KNOWLEDGE_OPERATIONS = ["continue", "refine", "select"];

export function knowledgeSuccessEnvelope(results: KnowledgeSearchResult[]): AgentResultEnvelope {
  const first = results[0]!;
  const anchors = {
    sourceId: first.source.id,
    documentId: first.document.id,
    sectionKey: first.sectionKey,
    ordinal: first.ordinal
  };
  return {
    status: "success",
    replyText: "知識查詢完成。",
    anchors,
    entities: knowledgeEntities(results),
    evidence: results.slice(0, 8).map((result) => ({
      kind: "knowledge_section",
      reference: {
        sourceId: result.source.id,
        documentId: result.document.id,
        sectionKey: result.sectionKey,
        ordinal: result.ordinal
      }
    })),
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
  const publicChoices = ordered.map(
    ({ routingDisplayName, displayName }) => routingDisplayName ?? displayName
  );
  const choices = ordered.map((_, index) => `知識來源 ${index + 1}`);
  const prompt = `這個問題可能屬於多個知識來源，請選擇：${publicChoices.join("、")}。`;
  const agentPrompt = "這個問題可能屬於多個知識來源，請選擇知識來源。";
  return {
    ok: true,
    executedAction: "query_knowledge",
    replyText: prompt,
    agentResult: {
      status: "ambiguous",
      replyText: agentPrompt,
      entities: ordered.map((source) => ({
        type: "source",
        key: source.id,
        label: "知識來源"
      })),
      clarification: { prompt: agentPrompt, choices }
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

function knowledgeEntities(results: KnowledgeSearchResult[]): AgentEntity[] {
  const entities = new Map<string, AgentEntity>();
  for (const result of results) {
    entities.set(`source:${result.source.id}`, {
      type: "source",
      key: result.source.id,
      label: "知識來源"
    });
    entities.set(`document:${result.document.id}`, {
      type: "document",
      key: result.document.id,
      label: "知識文件"
    });
    entities.set(`section:${result.sectionKey}`, {
      type: "section",
      key: result.sectionKey,
      label: "知識段落"
    });
    entities.set(`ordinal:${result.ordinal}`, {
      type: "ordinal",
      key: String(result.ordinal),
      label: `第 ${result.ordinal + 1} 項`
    });
  }
  return Array.from(entities.values()).slice(0, 20);
}
