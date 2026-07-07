import { retrieveMemoryArgumentsSchema, saveMemoryArgumentsSchema } from "../function-arguments.js";
import type { AgentMemoryStore } from "../agent/memory-store.js";
import type { FunctionHandler } from "../types.js";

const TEXT_MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AgentMemoryFunctionOptions {
  memoryStore: AgentMemoryStore;
  now?: () => Date;
}

export function createSaveMemoryHandler(options: AgentMemoryFunctionOptions): FunctionHandler {
  const now = options.now ?? (() => new Date());
  return async (rawArgs, context) => {
    const args = saveMemoryArgumentsSchema.parse(rawArgs);
    const content = (args.content || args.query || "").trim();
    if (!content) {
      return { ok: true, replyText: "請直接告訴我要記住的內容。" };
    }
    await options.memoryStore.saveTextMemory({
      profileName: context.profile.name,
      source: context.event.source,
      createdBy: context.event.source.userId,
      title: args.title?.trim() || inferTitle(content),
      content,
      query: args.query,
      expiresAt: new Date(now().getTime() + TEXT_MEMORY_TTL_MS).toISOString()
    });
    return { ok: true, replyText: "已記住，之後你可以請我查這段資訊。" };
  };
}

export function createRetrieveMemoryHandler(options: AgentMemoryFunctionOptions): FunctionHandler {
  return async (rawArgs, context) => {
    const args = retrieveMemoryArgumentsSchema.parse(rawArgs);
    const memories = await options.memoryStore.searchTextMemories({
      profileName: context.profile.name,
      source: context.event.source,
      query: args.query,
      limit: 3
    });
    if (memories.length === 0) {
      return { ok: true, replyText: "我目前找不到符合的記憶。" };
    }
    return {
      ok: true,
      replyText: ["我找到這些記住的資訊：", ...memories.map(formatTextMemory)].join("\n")
    };
  };
}

function inferTitle(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 20) || "記憶";
}

function formatTextMemory(memory: { id: string; title?: string; content: string }): string {
  const title = memory.title?.trim() || memory.content.slice(0, 16);
  return `- ${title} (${memory.id})\n${memory.content}`;
}
