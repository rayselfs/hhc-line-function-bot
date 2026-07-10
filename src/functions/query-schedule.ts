import { queryScheduleArgumentsSchema } from "../function-arguments.js";
import type { AgentMemoryStore } from "../agent/memory-store.js";
import type { FunctionHandler, NotionDatabaseClient } from "../types.js";
import type { SessionStore } from "../state/session-store.js";
import { createQueryScheduleMemoryHandler } from "./schedule-memory.js";
import { createQueryServiceScheduleHandler } from "./query-service-schedule.js";

export interface QueryScheduleFunctionOptions {
  memoryStore: AgentMemoryStore;
  notion?: NotionDatabaseClient;
  databaseId?: string;
  properties?: {
    date: string;
    meeting: string;
    role: string;
    person: string;
  };
  timeZone?: string;
  sessionStore?: SessionStore;
  now?: () => Date;
  requestIdFactory?: () => string;
}

export function createQueryScheduleHandler(options: QueryScheduleFunctionOptions): FunctionHandler {
  const memoryHandler = createQueryScheduleMemoryHandler({
    memoryStore: options.memoryStore,
    now: options.now
  });
  const serviceHandler =
    options.notion && options.databaseId && options.properties
      ? createQueryServiceScheduleHandler({
          notion: options.notion,
          databaseId: options.databaseId,
          properties: options.properties,
          timeZone: options.timeZone,
          sessionStore: options.sessionStore,
          now: options.now,
          requestIdFactory: options.requestIdFactory
        })
      : undefined;

  return async (rawArgs, context) => {
    const args = queryScheduleArgumentsSchema.parse(rawArgs);
    const memorySpecific = Boolean(args.scheduleType) || isMemorySpecificRequest(args.query);
    const results = [];

    if (memorySpecific || !serviceHandler) {
      results.push(await memoryHandler(args, context));
    } else {
      const memory = await memoryHandler(args, context);
      const service = await serviceHandler(args, context);
      results.push(memory, service);
    }

    const found = results.filter((result) => !isNoScheduleResult(result.replyText));
    if (found.length === 0) {
      return {
        ok: true,
        replyText: "查不到符合的服事表。",
        quickReplies: [
          { label: "下一場", action: { type: "message", label: "下一場", text: "下一場服事" } },
          { label: "本週", action: { type: "message", label: "本週", text: "本週服事" } },
          { label: "主日", action: { type: "message", label: "主日", text: "主日服事" } }
        ]
      };
    }
    if (found.length === 1) {
      return found[0];
    }
    return {
      ok: true,
      replyText: ["我找到這些服事安排：", ...found.map((result) => result.replyText)].join("\n\n")
    };
  };
}

function isMemorySpecificRequest(query: string): boolean {
  return /舉牌|為耶穌|晨更家族|家族晨更|仙履奇緣/u.test(query);
}

function isNoScheduleResult(replyText: string): boolean {
  return /^(?:我找不到符合的服事記憶。|查不到符合的服事表。)$/u.test(replyText.trim());
}
