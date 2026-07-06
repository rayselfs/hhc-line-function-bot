import { randomUUID } from "node:crypto";

import fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { hashInviteCode } from "./access/invite-code.js";
import { InMemoryAccessStore } from "./access/memory-access-store.js";
import type { AccessPrincipalType, AccessStore } from "./access/types.js";
import { createLineSdkReplyClient } from "./clients/line.js";
import { createIntroReply } from "./intro.js";
import { buildFunctionQuickReplies } from "./line-reply.js";
import { verifyLineSignature } from "./line-signature.js";
import { messages } from "./messages.js";
import {
  formatLastErrors,
  InMemoryLastErrorStore,
  type LastErrorStore
} from "./observability/last-error-store.js";
import {
  formatLastRoutes,
  InMemoryLastRouteStore,
  type LastRouteRecord,
  type LastRouteStore
} from "./observability/last-route-store.js";
import { InMemoryRateLimiter, type RateLimiter } from "./rate-limit.js";
import type {
  AppConfig,
  AdminHandlerRegistry,
  BotProfileConfig,
  FunctionExecutionResult,
  FunctionRegistry,
  FunctionRouterPort,
  LineEvent,
  LineMessage,
  LineReplyClient,
  LineWebhookPayload,
  JsonRecord,
  PostbackHandlerRegistry,
  PostbackRequest,
  RouteObserver,
  RouteObserverEvent,
  TextMessageHandlerRegistry
} from "./types.js";

export interface AppDependencies {
  router: FunctionRouterPort;
  functionRegistry?: FunctionRegistry;
  postbackHandlers?: PostbackHandlerRegistry;
  textMessageHandlers?: TextMessageHandlerRegistry;
  adminHandlers?: AdminHandlerRegistry;
  createLineReplyClient?: (profile: BotProfileConfig) => LineReplyClient;
  routeObserver?: RouteObserver;
  requestIdFactory?: () => string;
  lastErrorStore?: LastErrorStore;
  lastRouteStore?: LastRouteStore;
  rateLimiter?: RateLimiter;
  accessStore?: AccessStore;
}

interface AllowResult {
  allowed: boolean;
  reason: string;
}

interface ParsedAdminCommand {
  command: string;
  args: string[];
}

interface AdminCommandHelpEntry {
  usage: string;
  description: string;
}

const builtInAdminCommands: AdminCommandHelpEntry[] = [
  { usage: "/help-admin", description: "列出可用 admin 指令" },
  { usage: "/status", description: "查看目前 profile 狀態" },
  { usage: "/profile", description: "查看目前 LINE 來源與 profile 設定摘要" },
  { usage: "/route-test <text>", description: "測試一段文字會 route 到哪個 function" },
  { usage: "/last-errors", description: "查看最近錯誤" },
  { usage: "/last-routes", description: "查看最近 route/function 結果" },
  { usage: "/whoami", description: "顯示目前 LINE user/group 與權限狀態" },
  { usage: "/access-requests", description: "列出待審核使用者申請" },
  { usage: "/access-approve <requestId>", description: "核准使用者申請" },
  { usage: "/access-deny <requestId>", description: "拒絕使用者申請" },
  { usage: "/access-list", description: "列出已開通的 user/group/admin" },
  { usage: "/allow-user-add <userId>", description: "開通使用者" },
  { usage: "/allow-user-remove <userId>", description: "停用使用者" },
  { usage: "/allow-group-add <groupId>", description: "開通群組" },
  { usage: "/allow-group-remove <groupId>", description: "停用群組" },
  { usage: "/register-this-group", description: "將目前群組加入可使用清單" },
  { usage: "/invite-code-create <code> [maxUses] [expiresDays]", description: "建立邀請碼" },
  { usage: "/invite-code-list", description: "列出有效邀請碼摘要" },
  { usage: "/invite-code-disable <id>", description: "停用邀請碼" },
  { usage: "/admin-add <userId>", description: "superadmin 新增 admin" },
  { usage: "/admin-remove <userId>", description: "superadmin 停用 admin" }
];

export function createApp(config: AppConfig, deps: AppDependencies): FastifyInstance {
  const app = fastify({
    logger: false,
    bodyLimit: config.maxBodyBytes
  });
  const functionRegistry = deps.functionRegistry ?? {};
  const createReplyClient = deps.createLineReplyClient ?? createLineSdkReplyClient;
  const requestIdFactory = deps.requestIdFactory ?? randomUUID;
  const accessStore = deps.accessStore ?? new InMemoryAccessStore();
  const lastErrorStore =
    deps.lastErrorStore ?? new InMemoryLastErrorStore(config.lastErrors?.maxEntries ?? 20);
  const lastRouteStore =
    deps.lastRouteStore ?? new InMemoryLastRouteStore(config.lastErrors?.maxEntries ?? 20);
  const rateLimiter =
    deps.rateLimiter ??
    new InMemoryRateLimiter(
      config.rateLimit ?? { enabled: true, windowMs: 60_000, maxRequests: 20 }
    );

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.get(config.healthPath, async () => ({
    ok: true,
    service: config.serviceName,
    timeZone: config.timeZone,
    profiles: config.profiles.map((profile) => ({
      name: profile.name,
      webhookPath: profile.webhookPath,
      enabledFunctions: profile.enabledFunctions
    })),
    llm: {
      primary: "ollama",
      model: config.llm.ollamaModel,
      fallback: config.llm.keywordFallbackEnabled ? "keyword" : "disabled"
    }
  }));

  for (const profile of config.profiles) {
    app.post(profile.webhookPath, async (request, reply) => {
      await handleWebhook(
        request,
        reply,
        profile,
        deps.router,
        functionRegistry,
        deps.postbackHandlers ?? {},
        deps.textMessageHandlers ?? {},
        deps.adminHandlers ?? {},
        createReplyClient,
        deps.routeObserver,
        requestIdFactory,
        lastErrorStore,
        lastRouteStore,
        rateLimiter,
        accessStore,
        config.access?.inviteCodeSecret
      );
    });
  }

  return app;
}

async function handleWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
  profile: BotProfileConfig,
  router: FunctionRouterPort,
  functionRegistry: FunctionRegistry,
  postbackHandlers: PostbackHandlerRegistry,
  textMessageHandlers: TextMessageHandlerRegistry,
  adminHandlers: AdminHandlerRegistry,
  createReplyClient: (profile: BotProfileConfig) => LineReplyClient,
  routeObserver: RouteObserver | undefined,
  requestIdFactory: () => string,
  lastErrorStore: LastErrorStore,
  lastRouteStore: LastRouteStore,
  rateLimiter: RateLimiter,
  accessStore: AccessStore,
  inviteCodeSecret: string | undefined
) {
  const signature = getHeaderValue(request.headers["x-line-signature"]);
  if (!signature) {
    return reply.code(400).send({ ok: false, error: "missing_line_signature" });
  }

  const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from("");
  if (!verifyLineSignature(body, signature, profile.channelSecret)) {
    return reply.code(401).send({ ok: false, error: "invalid_line_signature" });
  }

  const payload = parseWebhookPayload(body);
  if (!payload) {
    return reply.code(400).send({ ok: false, error: "invalid_line_payload" });
  }

  const allowedEvents: LineEvent[] = [];
  const ignoredCounts = new Map<string, number>();

  for (const event of payload.events) {
    const allow = await allowEvent(profile, event, textMessageHandlers, accessStore);
    if (allow.allowed) {
      allowedEvents.push(event);
    } else {
      ignoredCounts.set(allow.reason, (ignoredCounts.get(allow.reason) ?? 0) + 1);
    }
  }

  if (allowedEvents.length === 0) {
    return reply.send({
      ok: true,
      ignored: true,
      reason: formatIgnoredSummary(ignoredCounts)
    });
  }

  const line = createReplyClient(profile);
  for (const event of allowedEvents) {
    const requestId = requestIdFactory();

    if (event.type === "postback") {
      if (!event.replyToken) {
        continue;
      }
      const startedAt = Date.now();
      const result = await handlePostbackEvent(event, profile, postbackHandlers, requestId);
      await emitRouteEvent(routeObserver, {
        kind: "postback",
        profileName: profile.name,
        sourceType: event.source.type,
        requestId,
        action: parsePostbackData(event.postback?.data ?? "")?.action,
        ok: result.ok,
        durationMs: elapsedMs(startedAt)
      });
      await line.replyText(
        event.replyToken,
        result.replyText,
        result.quickReplies ? { quickReplies: result.quickReplies } : undefined
      );
      continue;
    }

    if (event.type !== "message" || event.message?.type !== "text" || !event.message.text) {
      continue;
    }

    if (!event.replyToken) {
      continue;
    }

    const rateLimit = await rateLimiter.check({ profileName: profile.name, source: event.source });
    if (!rateLimit.allowed) {
      await line.replyText(event.replyToken, "你傳得太快了，請稍後再試。", undefined);
      await emitRouteEvent(routeObserver, {
        kind: "rate_limited",
        profileName: profile.name,
        sourceType: event.source.type,
        requestId,
        ok: false
      });
      continue;
    }

    if (isAdminCommand(event.message.text)) {
      const parsedAdminCommand = parseAdminCommand(event.message.text);
      const accessCommandResult = await handlePublicAccessCommand(
        event.message.text,
        profile,
        event,
        accessStore,
        inviteCodeSecret
      );
      if (accessCommandResult) {
        await line.replyText(event.replyToken, accessCommandResult.replyText, undefined);
        continue;
      }
      const adminStartedAt = Date.now();
      let adminResult: FunctionExecutionResult;
      try {
        adminResult = await handleAdminCommand(
          event.message.text,
          profile,
          event,
          adminHandlers,
          router,
          lastErrorStore,
          lastRouteStore,
          accessStore,
          inviteCodeSecret,
          requestId
        );
      } catch (error) {
        await lastErrorStore.record({
          requestId,
          occurredAt: new Date().toISOString(),
          profileName: profile.name,
          sourceType: event.source.type,
          phase: "admin",
          command: parsedAdminCommand?.command,
          errorName: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : String(error)
        });
        adminResult = { ok: false, replyText: messages.requestFailed };
      }
      await emitRouteEvent(routeObserver, {
        kind: "admin_command",
        profileName: profile.name,
        sourceType: event.source.type,
        requestId,
        command: parsedAdminCommand?.command ?? "unknown",
        authorized: await adminAllowed(profile, event, accessStore, parsedAdminCommand?.command),
        ok: adminResult.ok,
        durationMs: elapsedMs(adminStartedAt)
      });
      await line.replyText(event.replyToken, adminResult.replyText, undefined);
      continue;
    }

    if (await shouldPromptManagedRegistration(profile, event, accessStore)) {
      await line.replyText(event.replyToken, registrationPrompt(profile), undefined);
      continue;
    }

    const intro = createIntroReply(profile, event.message.text);
    if (intro) {
      await line.replyText(
        event.replyToken,
        intro.replyText,
        intro.quickReplies ? { quickReplies: intro.quickReplies } : undefined
      );
      continue;
    }

    const textMessageHandler = await matchingTextMessageHandler(
      event,
      profile,
      textMessageHandlers
    );
    if (textMessageHandler) {
      const handlerStartedAt = Date.now();
      const result = await textMessageHandler.handler.handle(
        { text: event.message.text },
        { profile, event, requestId }
      );
      await emitRouteEvent(routeObserver, {
        kind: "text_handler",
        profileName: profile.name,
        sourceType: event.source.type,
        requestId,
        handler: textMessageHandler.name,
        ok: result?.ok,
        durationMs: elapsedMs(handlerStartedAt)
      });
      if (result) {
        await line.replyText(
          event.replyToken,
          result.replyText,
          result.quickReplies ? { quickReplies: result.quickReplies } : undefined
        );
      }
      continue;
    }

    const routeStartedAt = Date.now();
    let route;
    try {
      route = await router.route({
        profileName: profile.name,
        text: event.message.text,
        enabledFunctions: profile.enabledFunctions,
        source: event.source
      });
    } catch (error) {
      await lastErrorStore.record({
        requestId,
        occurredAt: new Date().toISOString(),
        profileName: profile.name,
        sourceType: event.source.type,
        phase: "router",
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error)
      });
      await line.replyText(event.replyToken, messages.requestFailed);
      continue;
    }
    await emitRouteEvent(routeObserver, {
      kind: "route",
      profileName: profile.name,
      sourceType: event.source.type,
      requestId,
      provider: route.provider,
      outcome: route.type,
      action: route.type === "execute" ? route.action : undefined,
      reason: route.type === "deny" ? route.reason : undefined,
      confidence: route.type === "execute" ? route.confidence : undefined,
      fallbackProvider: route.fallbackProvider,
      fallbackReason: route.fallbackReason,
      durationMs: elapsedMs(routeStartedAt)
    });
    await lastRouteStore.record({
      requestId,
      occurredAt: new Date().toISOString(),
      profileName: profile.name,
      sourceType: event.source.type,
      phase: "route",
      provider: route.provider,
      outcome: route.type,
      action: route.type === "execute" ? route.action : undefined,
      reason: route.type === "deny" ? route.reason : undefined,
      fallbackProvider: route.fallbackProvider,
      fallbackReason: route.fallbackReason,
      ...(route.type === "execute" ? summarizeRouteArguments(route.arguments) : {}),
      durationMs: elapsedMs(routeStartedAt)
    });

    if (route.type === "deny") {
      const quickReplies = buildFunctionQuickReplies(profile);
      await line.replyText(
        event.replyToken,
        quickReplies.length > 0 ? messages.unsupportedWithSuggestions : messages.unsupported,
        quickReplies.length > 0 ? { quickReplies } : undefined
      );
      continue;
    }

    const handler = functionRegistry[route.action];
    if (!handler) {
      await line.replyText(event.replyToken, messages.functionNotConfigured);
      continue;
    }

    const functionStartedAt = Date.now();
    try {
      const result = await handler(route.arguments, { profile, event, requestId });
      await emitRouteEvent(routeObserver, {
        kind: "function_result",
        profileName: profile.name,
        sourceType: event.source.type,
        requestId,
        action: route.action,
        ok: result.ok,
        durationMs: elapsedMs(functionStartedAt)
      });
      await lastRouteStore.record({
        requestId,
        occurredAt: new Date().toISOString(),
        profileName: profile.name,
        sourceType: event.source.type,
        phase: "function",
        action: route.action,
        ok: result.ok,
        durationMs: elapsedMs(functionStartedAt)
      });
      await line.replyText(
        event.replyToken,
        result.replyText,
        result.quickReplies ? { quickReplies: result.quickReplies } : undefined
      );
    } catch (error) {
      await lastErrorStore.record({
        requestId,
        occurredAt: new Date().toISOString(),
        profileName: profile.name,
        sourceType: event.source.type,
        phase: "function",
        action: route.action,
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error)
      });
      await emitRouteEvent(routeObserver, {
        kind: "function_error",
        profileName: profile.name,
        sourceType: event.source.type,
        requestId,
        action: route.action,
        ok: false,
        errorName: error instanceof Error ? error.name : typeof error,
        durationMs: elapsedMs(functionStartedAt)
      });
      await lastRouteStore.record({
        requestId,
        occurredAt: new Date().toISOString(),
        profileName: profile.name,
        sourceType: event.source.type,
        phase: "function",
        action: route.action,
        ok: false,
        errorName: error instanceof Error ? error.name : typeof error,
        durationMs: elapsedMs(functionStartedAt)
      });
      await line.replyText(event.replyToken, messages.requestFailed);
    }
  }

  return reply.send({
    ok: true,
    allowedEvents: allowedEvents.length,
    ignored: ignoredCounts.size > 0 ? formatIgnoredSummary(ignoredCounts) : undefined
  });
}

async function handlePostbackEvent(
  event: LineEvent,
  profile: BotProfileConfig,
  postbackHandlers: PostbackHandlerRegistry,
  requestId: string
) {
  const request = parsePostbackData(event.postback?.data ?? "");
  if (!request) {
    return { ok: true, replyText: messages.postbackUnsupported };
  }
  const handler = postbackHandlers[request.action];
  if (!handler) {
    return { ok: true, replyText: messages.postbackUnsupported };
  }
  return handler(request, { profile, event, requestId });
}

function parsePostbackData(data: string): PostbackRequest | null {
  const params = Object.fromEntries(new URLSearchParams(data));
  const action = params.action;
  if (!action) {
    return null;
  }
  return { action, params };
}

function parseWebhookPayload(body: Buffer): LineWebhookPayload | null {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as LineWebhookPayload;
    if (!parsed || !Array.isArray(parsed.events)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function allowEvent(
  profile: BotProfileConfig,
  event: LineEvent,
  textMessageHandlers: TextMessageHandlerRegistry,
  accessStore: AccessStore
): Promise<AllowResult> {
  const eventType = event.type?.trim().toLowerCase();
  const sourceType = event.source?.type?.trim().toLowerCase();
  const command = parseAdminCommand(event.message?.text)?.command;

  switch (sourceType) {
    case "room":
      if (!profile.allowRooms) {
        return { allowed: false, reason: "room_blocked" };
      }
      return { allowed: false, reason: "room_not_implemented" };

    case "group":
      if (groupAccessPolicy(profile) === "blocked") {
        return { allowed: false, reason: "group_blocked" };
      }
      if (command === "register-this-group") {
        return { allowed: true, reason: "group_registration_command_allowed" };
      }
      if (!(await isGroupAllowed(profile, event.source.groupId, accessStore))) {
        return { allowed: false, reason: "group_not_allowed" };
      }
      if (eventType === "postback") {
        return { allowed: true, reason: "group_postback_allowed" };
      }
      if (eventType !== "message") {
        return { allowed: false, reason: "event_type_not_allowed" };
      }
      if (!messageTypeAllowed(profile, event)) {
        return { allowed: false, reason: "message_type_not_allowed" };
      }
      if (command) {
        return { allowed: true, reason: "group_admin_command_allowed" };
      }
      if (!profile.groupRequireWakeWord || matchesWakeRule(profile, event.message)) {
        return { allowed: true, reason: "group_wake_matched" };
      }
      if (await matchingTextMessageHandler(event, profile, textMessageHandlers)) {
        return { allowed: true, reason: "group_text_message_handler_matched" };
      }
      return { allowed: false, reason: "wake_word_missing" };

    case "user":
      if (command === "whoami" || command === "register") {
        return { allowed: true, reason: "direct_access_command_allowed" };
      }
      if (command) {
        return { allowed: true, reason: "direct_admin_command_allowed" };
      }
      if (directAccessPolicy(profile) === "blocked") {
        return { allowed: false, reason: "direct_user_blocked" };
      }
      if (
        directAccessPolicy(profile) === "managed" &&
        !(await isDirectUserAllowed(profile, event.source.userId, accessStore))
      ) {
        if (profile.registration?.enabled && eventType === "message") {
          return { allowed: true, reason: "direct_registration_prompt_allowed" };
        }
        return { allowed: false, reason: "user_not_allowed" };
      }
      if (eventType === "postback") {
        return { allowed: true, reason: "direct_user_postback_allowed" };
      }
      if (eventType !== "message") {
        return { allowed: false, reason: "event_type_not_allowed" };
      }
      if (!messageTypeAllowed(profile, event)) {
        return { allowed: false, reason: "message_type_not_allowed" };
      }
      return { allowed: true, reason: "direct_user_allowed" };

    default:
      return { allowed: false, reason: "source_type_not_supported" };
  }
}

function isAdminCommand(text: string | undefined): boolean {
  return Boolean(parseAdminCommand(text));
}

async function handlePublicAccessCommand(
  text: string,
  profile: BotProfileConfig,
  event: LineEvent,
  accessStore: AccessStore,
  inviteCodeSecret: string | undefined
): Promise<FunctionExecutionResult | undefined> {
  const parsed = parseAdminCommand(text);
  if (!parsed) {
    return undefined;
  }
  if (parsed.command === "whoami") {
    return handleWhoamiCommand(profile, event, accessStore);
  }
  if (parsed.command !== "register") {
    return undefined;
  }
  return handleRegisterCommand(parsed.args, profile, event, accessStore, inviteCodeSecret);
}

async function handleWhoamiCommand(
  profile: BotProfileConfig,
  event: LineEvent,
  accessStore: AccessStore
): Promise<FunctionExecutionResult> {
  const userId = event.source.userId ?? "(none)";
  const groupId = event.source.groupId ?? "(none)";
  return {
    ok: true,
    replyText: [
      "Who am I",
      `profile: ${profile.name}`,
      `source: ${event.source.type}`,
      `userId: ${userId}`,
      `groupId: ${groupId}`,
      `directPolicy: ${directAccessPolicy(profile)}`,
      `groupPolicy: ${groupAccessPolicy(profile)}`,
      `superadmin: ${isBootstrapSuperAdmin(profile, event.source.userId)}`,
      `admin: ${await isAdminUser(profile, event.source.userId, accessStore)}`,
      `userAllowed: ${await isDirectUserAllowed(profile, event.source.userId, accessStore)}`,
      `groupAllowed: ${await isGroupAllowed(profile, event.source.groupId, accessStore)}`
    ].join("\n")
  };
}

async function handleRegisterCommand(
  args: string[],
  profile: BotProfileConfig,
  event: LineEvent,
  accessStore: AccessStore,
  inviteCodeSecret: string | undefined
): Promise<FunctionExecutionResult> {
  if (event.source.type !== "user" || !event.source.userId) {
    return { ok: true, replyText: "請在個人聊天室使用 /register。" };
  }
  if (!profile.registration?.enabled) {
    return { ok: true, replyText: "這個 bot 目前沒有開放自行申請。" };
  }
  if (await isDirectUserAllowed(profile, event.source.userId, accessStore)) {
    return { ok: true, replyText: "你已經可以使用小哈。" };
  }

  const inviteCodeRequired = profile.registration.inviteCodeRequired;
  const inviteCode = inviteCodeRequired ? args[0] : undefined;
  const displayName = args
    .slice(inviteCodeRequired ? 1 : 0)
    .join(" ")
    .trim();
  if (inviteCodeRequired && !inviteCode) {
    return { ok: true, replyText: "請輸入 /register <邀請碼> <你的名字>。" };
  }

  if (inviteCodeRequired) {
    if (!inviteCodeSecret) {
      return { ok: false, replyText: messages.requestFailed };
    }
    const matchedInviteCode = await accessStore.findInviteCode(
      profile.name,
      hashInviteCode(inviteCode ?? "", inviteCodeSecret),
      new Date()
    );
    if (!matchedInviteCode) {
      return { ok: true, replyText: "邀請碼無效、已過期，或已達使用次數上限。" };
    }
    const created = await createUserAccessRequest(
      accessStore,
      profile,
      event.source.userId,
      displayName || undefined
    );
    if (created.created) {
      await accessStore.incrementInviteCodeUse(matchedInviteCode.id);
    }
    return formatRegistrationResult(created.request.id, created.created);
  }

  const created = await createUserAccessRequest(
    accessStore,
    profile,
    event.source.userId,
    displayName || undefined
  );
  return formatRegistrationResult(created.request.id, created.created);
}

function createUserAccessRequest(
  accessStore: AccessStore,
  profile: BotProfileConfig,
  userId: string,
  displayName: string | undefined
) {
  return accessStore.createAccessRequest({
    profileName: profile.name,
    sourceType: "user",
    sourceId: userId,
    displayName,
    requestedBy: userId
  });
}

function formatRegistrationResult(requestId: string, created: boolean): FunctionExecutionResult {
  return {
    ok: true,
    replyText: created
      ? ["已送出申請。", `requestId: ${requestId}`, "管理同工審核後就可以使用。"].join("\n")
      : ["你已經有一筆待審核申請。", `requestId: ${requestId}`].join("\n")
  };
}

function registrationPrompt(profile: BotProfileConfig): string {
  if (profile.registration?.enabled) {
    return "你尚未開通小哈。請先用 /register <邀請碼> <你的名字> 送出申請。";
  }
  return "你尚未開通小哈，請聯絡管理同工協助。";
}

async function shouldPromptManagedRegistration(
  profile: BotProfileConfig,
  event: LineEvent,
  accessStore: AccessStore
): Promise<boolean> {
  return (
    event.source.type === "user" &&
    directAccessPolicy(profile) === "managed" &&
    !(await isDirectUserAllowed(profile, event.source.userId, accessStore))
  );
}

async function handleAdminCommand(
  text: string,
  profile: BotProfileConfig,
  event: LineEvent,
  adminHandlers: AdminHandlerRegistry,
  router: FunctionRouterPort,
  lastErrorStore: LastErrorStore,
  lastRouteStore: LastRouteStore,
  accessStore: AccessStore,
  inviteCodeSecret: string | undefined,
  requestId: string
): Promise<FunctionExecutionResult> {
  const parsed = parseAdminCommand(text);
  if (!parsed) {
    return { ok: true, replyText: "目前不支援這個 admin 指令。" };
  }

  if (!(await adminAllowed(profile, event, accessStore, parsed.command))) {
    return { ok: true, replyText: messages.adminUnauthorized };
  }

  if (parsed.command === "status") {
    return {
      ok: true,
      replyText: [
        "Admin status",
        `profile: ${profile.name}`,
        `functions: ${profile.enabledFunctions.join(", ") || "(none)"}`,
        `source: ${event.source.type}`
      ].join("\n")
    };
  }

  if (parsed.command === "profile") {
    return {
      ok: true,
      replyText: [
        "Profile",
        `name: ${profile.name}`,
        `source: ${event.source.type}`,
        `functions: ${profile.enabledFunctions.join(", ") || "(none)"}`,
        `adminDirectOnly: ${profile.adminDirectOnly !== false}`
      ].join("\n")
    };
  }

  if (["help-admin", "admin-help", "commands"].includes(parsed.command)) {
    return {
      ok: true,
      replyText: formatAdminCommandHelp(adminHandlers)
    };
  }

  if (parsed.command === "route-test") {
    return handleRouteTestCommand(parsed.args, profile, event, router);
  }

  if (parsed.command === "last-errors") {
    return lastErrorStore.list().then((errors) => ({
      ok: true,
      replyText: formatLastErrors(errors)
    }));
  }

  if (parsed.command === "last-routes") {
    return lastRouteStore.list().then((routes) => ({
      ok: true,
      replyText: formatLastRoutes(routes)
    }));
  }

  const accessResult = await handleAdminAccessCommand(
    parsed.command,
    parsed.args,
    profile,
    event,
    accessStore,
    inviteCodeSecret
  );
  if (accessResult) {
    return withPendingAccessNotice(profile, event, accessStore, accessResult);
  }

  const handler = adminHandlers[parsed.command];
  if (handler) {
    return withPendingAccessNotice(
      profile,
      event,
      accessStore,
      await handler({ profile, event, command: parsed.command, args: parsed.args, requestId })
    );
  }

  return { ok: true, replyText: "目前不支援這個 admin 指令。" };
}

async function handleAdminAccessCommand(
  command: string,
  args: string[],
  profile: BotProfileConfig,
  event: LineEvent,
  accessStore: AccessStore,
  inviteCodeSecret: string | undefined
): Promise<FunctionExecutionResult | undefined> {
  const actorUserId = event.source.userId;
  if (!actorUserId) {
    return { ok: true, replyText: messages.adminUnauthorized };
  }

  if (command === "access-requests") {
    const requests = await accessStore.listPendingRequests(profile.name);
    if (requests.length === 0) {
      return { ok: true, replyText: "Access requests\n(none)" };
    }
    return {
      ok: true,
      replyText: [
        "Access requests",
        ...requests.map((request) =>
          [
            `id: ${request.id}`,
            `source: ${request.sourceType}:${request.sourceId}`,
            request.displayName ? `name: ${request.displayName}` : undefined,
            `createdAt: ${request.createdAt}`
          ]
            .filter(Boolean)
            .join(" | ")
        )
      ].join("\n")
    };
  }

  if (command === "access-approve") {
    const requestId = args[0];
    if (!requestId) {
      return { ok: true, replyText: "Usage: /access-approve <requestId>" };
    }
    const approved = await accessStore.approveAccessRequest({
      profileName: profile.name,
      requestId,
      approvedBy: actorUserId
    });
    if (!approved) {
      return { ok: true, replyText: "找不到待核准申請。" };
    }
    await accessStore.recordAudit({
      profileName: profile.name,
      actorUserId,
      action: "access.approve",
      targetType: approved.sourceType,
      targetId: approved.sourceId
    });
    return { ok: true, replyText: `已核准 ${approved.sourceType}:${approved.sourceId}` };
  }

  if (command === "access-deny") {
    const requestId = args[0];
    if (!requestId) {
      return { ok: true, replyText: "Usage: /access-deny <requestId>" };
    }
    const denied = await accessStore.denyAccessRequest({
      profileName: profile.name,
      requestId,
      deniedBy: actorUserId
    });
    if (!denied) {
      return { ok: true, replyText: "找不到待拒絕申請。" };
    }
    await accessStore.recordAudit({
      profileName: profile.name,
      actorUserId,
      action: "access.deny",
      targetType: denied.sourceType,
      targetId: denied.sourceId
    });
    return { ok: true, replyText: `已拒絕 ${denied.sourceType}:${denied.sourceId}` };
  }

  if (command === "access-list") {
    const principals = await accessStore.listPrincipals(profile.name);
    if (principals.length === 0) {
      return { ok: true, replyText: "Access list\n(none)" };
    }
    return {
      ok: true,
      replyText: [
        "Access list",
        ...principals.map(
          (principal) =>
            `${principal.type}: ${principal.principalId}${
              principal.displayName ? ` (${principal.displayName})` : ""
            }`
        )
      ].join("\n")
    };
  }

  if (command === "register-this-group") {
    if (event.source.type !== "group" || !event.source.groupId) {
      return { ok: true, replyText: "請在要開通的群組裡使用 /register-this-group。" };
    }
    await accessStore.addPrincipal({
      profileName: profile.name,
      type: "group",
      principalId: event.source.groupId,
      createdBy: actorUserId
    });
    return { ok: true, replyText: `已加入 group ${event.source.groupId}` };
  }

  if (command === "allow-user-add" || command === "allow-group-add") {
    const principalId = args[0];
    if (!principalId) {
      return { ok: true, replyText: `Usage: /${command} <id>` };
    }
    const type: AccessPrincipalType = command === "allow-user-add" ? "user" : "group";
    await accessStore.addPrincipal({
      profileName: profile.name,
      type,
      principalId,
      createdBy: actorUserId
    });
    return { ok: true, replyText: `已加入 ${type} ${principalId}` };
  }

  if (command === "allow-user-remove" || command === "allow-group-remove") {
    const principalId = args[0];
    if (!principalId) {
      return { ok: true, replyText: `Usage: /${command} <id>` };
    }
    const type: AccessPrincipalType = command === "allow-user-remove" ? "user" : "group";
    const removed = await accessStore.disablePrincipal({
      profileName: profile.name,
      type,
      principalId,
      disabledBy: actorUserId
    });
    return { ok: true, replyText: removed ? `已停用 ${type} ${principalId}` : "找不到項目。" };
  }

  if (command === "invite-code-create") {
    if (!inviteCodeSecret) {
      return { ok: false, replyText: messages.requestFailed };
    }
    const rawCode = args[0];
    if (!rawCode) {
      return { ok: true, replyText: "Usage: /invite-code-create <code> [maxUses] [expiresDays]" };
    }
    const maxUses = parsePositiveInt(args[1]);
    const expiresDays = parsePositiveInt(args[2]);
    const inviteCode = await accessStore.createInviteCode({
      profileName: profile.name,
      codeHash: hashInviteCode(rawCode, inviteCodeSecret),
      maxUses,
      expiresAt: expiresDays
        ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined,
      createdBy: actorUserId
    });
    return {
      ok: true,
      replyText: [
        "Invite code created",
        `id: ${inviteCode.id}`,
        `maxUses: ${inviteCode.maxUses ?? "(unlimited)"}`,
        `expiresAt: ${inviteCode.expiresAt ?? "(none)"}`,
        "Store the plain code securely; only its hash is saved."
      ].join("\n")
    };
  }

  if (command === "invite-code-list") {
    const inviteCodes = await accessStore.listInviteCodes(profile.name);
    if (inviteCodes.length === 0) {
      return { ok: true, replyText: "Invite codes\n(none)" };
    }
    return {
      ok: true,
      replyText: [
        "Invite codes",
        ...inviteCodes.map(
          (code) =>
            `id: ${code.id} | used: ${code.usedCount}/${code.maxUses ?? "unlimited"} | expiresAt: ${
              code.expiresAt ?? "(none)"
            }`
        )
      ].join("\n")
    };
  }

  if (command === "invite-code-disable") {
    const inviteCodeId = args[0];
    if (!inviteCodeId) {
      return { ok: true, replyText: "Usage: /invite-code-disable <id>" };
    }
    const disabled = await accessStore.disableInviteCode({
      profileName: profile.name,
      inviteCodeId,
      disabledBy: actorUserId
    });
    return {
      ok: true,
      replyText: disabled ? `Invite code disabled: ${inviteCodeId}` : "找不到邀請碼。"
    };
  }

  if (command === "admin-add" || command === "admin-remove") {
    if (!isBootstrapSuperAdmin(profile, actorUserId)) {
      return { ok: true, replyText: "只有 superadmin 可以管理 admin。" };
    }
    const targetUserId = args[0];
    if (!targetUserId) {
      return { ok: true, replyText: `Usage: /${command} <userId>` };
    }
    if (command === "admin-add") {
      await accessStore.addPrincipal({
        profileName: profile.name,
        type: "admin",
        principalId: targetUserId,
        createdBy: actorUserId
      });
      return { ok: true, replyText: `已加入 admin ${targetUserId}` };
    }
    if (isBootstrapSuperAdmin(profile, targetUserId)) {
      return { ok: true, replyText: "不能移除 bootstrap superadmin。" };
    }
    const removed = await accessStore.disablePrincipal({
      profileName: profile.name,
      type: "admin",
      principalId: targetUserId,
      disabledBy: actorUserId
    });
    return { ok: true, replyText: removed ? `已停用 admin ${targetUserId}` : "找不到 admin。" };
  }

  return undefined;
}

async function withPendingAccessNotice(
  profile: BotProfileConfig,
  event: LineEvent,
  accessStore: AccessStore,
  result: FunctionExecutionResult
): Promise<FunctionExecutionResult> {
  if (!result.ok || !profile.registration?.enabled) {
    return result;
  }
  if (!(await isAdminUser(profile, event.source.userId, accessStore))) {
    return result;
  }
  const pendingCount = await accessStore.countPendingRequests(profile.name);
  if (pendingCount === 0 || result.replyText.includes("/access-requests")) {
    return result;
  }
  return {
    ...result,
    replyText: `${result.replyText}\n\n待審核申請：${pendingCount}\n/access-requests`
  };
}

function formatAdminCommandHelp(adminHandlers: AdminHandlerRegistry): string {
  const registeredCommands = Object.keys(adminHandlers)
    .map((command) => `/${command}`)
    .filter((usage) => !builtInAdminCommands.some((entry) => entry.usage === usage))
    .sort();

  return [
    "Admin commands",
    "",
    "Built-in",
    ...builtInAdminCommands.map((entry) => `${entry.usage} - ${entry.description}`),
    ...(registeredCommands.length
      ? ["", "Registered", ...registeredCommands.map((usage) => `${usage} - registered handler`)]
      : [])
  ].join("\n");
}

async function handleRouteTestCommand(
  args: string[],
  profile: BotProfileConfig,
  event: LineEvent,
  router: FunctionRouterPort
): Promise<FunctionExecutionResult> {
  const text = args.join(" ").trim();
  if (!text) {
    return { ok: true, replyText: "Route test\n請提供要測試的文字。" };
  }

  const route = await router.route({
    profileName: profile.name,
    text,
    enabledFunctions: profile.enabledFunctions,
    source: event.source
  });

  if (route.type === "deny") {
    return {
      ok: true,
      replyText: [
        "Route test",
        "type: deny",
        `provider: ${route.provider}`,
        `reason: ${route.reason}`,
        ...formatFallbackDiagnostics(route)
      ].join("\n")
    };
  }

  return {
    ok: true,
    replyText: [
      "Route test",
      "type: execute",
      `provider: ${route.provider}`,
      `action: ${route.action}`,
      `arguments: ${JSON.stringify(route.arguments)}`,
      ...formatFallbackDiagnostics(route)
    ].join("\n")
  };
}

function formatFallbackDiagnostics(route: {
  fallbackProvider?: string;
  fallbackReason?: string;
}): string[] {
  if (!route.fallbackProvider && !route.fallbackReason) {
    return [];
  }
  return [
    `fallbackProvider: ${route.fallbackProvider ?? "(unknown)"}`,
    `fallbackReason: ${route.fallbackReason ?? "(unknown)"}`
  ];
}

function summarizeRouteArguments(args: JsonRecord): Pick<LastRouteRecord, "query" | "fileType"> {
  const queryValue = args.query;
  const fileTypeValue = args.fileType;
  return {
    query: typeof queryValue === "string" ? (queryValue.trim() ? "present" : "empty") : "missing",
    fileType: typeof fileTypeValue === "string" ? fileTypeValue : undefined
  };
}

function parseAdminCommand(text: string | undefined): ParsedAdminCommand | undefined {
  const normalized = text?.trim().replace(/^小哈[，,\s]*/i, "") ?? "";
  const match = normalized.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+(.*))?$/i);
  if (!match) {
    return undefined;
  }
  return {
    command: match[1].toLowerCase(),
    args: (match[2] ?? "").split(/\s+/).filter(Boolean)
  };
}

async function adminAllowed(
  profile: BotProfileConfig,
  event: LineEvent,
  accessStore: AccessStore,
  command?: string
): Promise<boolean> {
  if (!(await isAdminUser(profile, event.source.userId, accessStore))) {
    return false;
  }
  if (command === "register-this-group") {
    return event.source.type === "group";
  }
  if (profile.adminDirectOnly !== false && event.source.type !== "user") {
    return false;
  }
  return true;
}

async function isAdminUser(
  profile: BotProfileConfig,
  userId: string | undefined,
  accessStore: AccessStore
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  return (
    isBootstrapSuperAdmin(profile, userId) ||
    (await accessStore.hasActivePrincipal(profile.name, "admin", userId))
  );
}

function isBootstrapSuperAdmin(profile: BotProfileConfig, userId: string | undefined): boolean {
  if (!userId) {
    return false;
  }
  return profile.adminUserId === userId || (profile.adminUserIds ?? []).includes(userId);
}

async function isDirectUserAllowed(
  profile: BotProfileConfig,
  userId: string | undefined,
  accessStore: AccessStore
): Promise<boolean> {
  if (!userId) {
    return false;
  }
  return (
    directAccessPolicy(profile) === "public" ||
    isAllowedId(profile.allowedUserIds, userId) ||
    isBootstrapSuperAdmin(profile, userId) ||
    (await accessStore.hasActivePrincipal(profile.name, "admin", userId)) ||
    (await accessStore.hasActivePrincipal(profile.name, "user", userId))
  );
}

async function isGroupAllowed(
  profile: BotProfileConfig,
  groupId: string | undefined,
  accessStore: AccessStore
): Promise<boolean> {
  if (!groupId) {
    return false;
  }
  return (
    isAllowedId(profile.allowedGroupIds, groupId) ||
    (await accessStore.hasActivePrincipal(profile.name, "group", groupId))
  );
}

function directAccessPolicy(profile: BotProfileConfig) {
  return profile.directAccessPolicy ?? (profile.allowDirectUser ? "managed" : "blocked");
}

function groupAccessPolicy(profile: BotProfileConfig) {
  return profile.groupAccessPolicy ?? (profile.allowedGroupIds.length > 0 ? "managed" : "blocked");
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function messageTypeAllowed(profile: BotProfileConfig, event: LineEvent): boolean {
  const messageType = event.message?.type?.trim().toLowerCase();
  if (!messageType) {
    return false;
  }
  return profile.allowedMessageTypes.map((type) => type.toLowerCase()).includes(messageType);
}

async function matchingTextMessageHandler(
  event: LineEvent,
  profile: BotProfileConfig,
  textMessageHandlers: TextMessageHandlerRegistry
) {
  const text = event.message?.text;
  if (event.type !== "message" || event.message?.type !== "text" || !text) {
    return undefined;
  }
  for (const [name, handler] of Object.entries(textMessageHandlers)) {
    if (await handler.matches({ text }, { profile, event })) {
      return { name, handler };
    }
  }
  return undefined;
}

async function emitRouteEvent(
  observer: RouteObserver | undefined,
  event: RouteObserverEvent
): Promise<void> {
  if (!observer) {
    return;
  }
  try {
    await observer(event);
  } catch {
    // Observability must not change LINE webhook behavior.
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function matchesWakeRule(profile: BotProfileConfig, message?: LineMessage): boolean {
  const text = typeof message?.text === "string" ? message.text : "";
  if (profile.wakeKeywords.some((keyword) => keyword && text.includes(keyword))) {
    return true;
  }
  return Boolean(
    profile.acceptMention && message?.mention?.mentionees?.some((mentionee) => mentionee.isSelf)
  );
}

function isAllowedId(allowedIds: string[], actual?: string): boolean {
  if (!actual) {
    return false;
  }
  return allowedIds.includes("*") || allowedIds.includes(actual);
}

function formatIgnoredSummary(counts: Map<string, number>): string {
  if (counts.size === 0) {
    return "";
  }
  if (counts.size === 1) {
    return counts.keys().next().value ?? "";
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => `${reason}=${count}`)
    .join(",");
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
