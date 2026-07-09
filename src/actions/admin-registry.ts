import type { AccessStore } from "../access/types.js";
import type { RegistrationInviteCodeStore } from "../access/registration-invite-code-store.js";
import type { WebAllowlistEntry, WebAllowlistStore } from "../web/allowlist.js";
import { InMemoryConfirmationStore, type ConfirmationStore } from "./confirmation-store.js";
import {
  FUNCTION_NAMES,
  isFunctionName,
  type AdminActionName,
  type BotProfileConfig,
  type FunctionExecutionResult,
  type FunctionName,
  type JsonRecord,
  type LineEvent
} from "../types.js";
import { evaluateActionPolicy } from "./policy.js";

export interface AdminActionRegistryOptions {
  accessStore: AccessStore;
  registrationInviteCodeStore: RegistrationInviteCodeStore;
  registrationInviteCodeTtlMinutes: number;
  confirmationStore?: ConfirmationStore;
  confirmationTtlMinutes?: number;
  webAllowlistStore?: WebAllowlistStore;
}

export interface AdminActionExecutionInput {
  action: AdminActionName;
  profile: BotProfileConfig;
  event: LineEvent;
  arguments?: JsonRecord;
  confirmed?: boolean;
}

export interface AdminActionRegistry {
  execute(input: AdminActionExecutionInput): Promise<FunctionExecutionResult>;
  confirm(input: {
    code: string;
    profile: BotProfileConfig;
    event: LineEvent;
  }): Promise<FunctionExecutionResult>;
}

export function createAdminActionRegistry(
  options: AdminActionRegistryOptions
): AdminActionRegistry {
  return new DefaultAdminActionRegistry(options);
}

class DefaultAdminActionRegistry implements AdminActionRegistry {
  private readonly confirmationStore: ConfirmationStore;
  private readonly confirmationTtlMinutes: number;

  constructor(private readonly options: AdminActionRegistryOptions) {
    this.confirmationStore = options.confirmationStore ?? new InMemoryConfirmationStore();
    this.confirmationTtlMinutes = options.confirmationTtlMinutes ?? 5;
  }

  async execute(input: AdminActionExecutionInput): Promise<FunctionExecutionResult> {
    const policy = await evaluateActionPolicy({
      action: input.action,
      profile: input.profile,
      source: input.event.source,
      accessStore: this.options.accessStore,
      confirmed: input.confirmed
    });
    if (!policy.allowed) {
      if (policy.requiresConfirmation) {
        return this.createConfirmation(input);
      }
      return {
        ok: true,
        replyText:
          policy.reason === "source_direct_required"
            ? "請在 1 對 1 對話中使用這個 admin 操作。"
            : "你沒有權限使用 admin 指令。"
      };
    }

    switch (input.action) {
      case "invite_code_create":
        return this.createInviteCode(input.profile, input.event.source.userId);
      case "web_allowlist_list":
        return this.listWebAllowlist(input.profile);
      case "web_allowlist_add":
        return this.addWebAllowlist(input);
      case "function_scope_grant":
        return this.grantFunctionScope(input);
      case "function_scope_revoke":
        return this.revokeFunctionScope(input);
      case "function_scope_list":
        return this.listFunctionScope(input);
    }
  }

  async confirm(input: {
    code: string;
    profile: BotProfileConfig;
    event: LineEvent;
  }): Promise<FunctionExecutionResult> {
    const actorUserId = input.event.source.userId;
    if (!actorUserId) {
      return { ok: true, replyText: "你沒有權限使用 admin 指令。" };
    }
    const request = await this.confirmationStore.consume(
      input.code,
      actorUserId,
      input.profile.name
    );
    if (!request) {
      return { ok: true, replyText: "確認碼不存在、已使用或已過期。" };
    }
    return this.execute({
      action: request.action,
      profile: input.profile,
      event: input.event,
      confirmed: true
    });
  }

  private async createConfirmation(
    input: AdminActionExecutionInput
  ): Promise<FunctionExecutionResult> {
    const actorUserId = input.event.source.userId;
    if (!actorUserId) {
      return { ok: true, replyText: "你沒有權限使用 admin 指令。" };
    }
    const request = await this.confirmationStore.create({
      profileName: input.profile.name,
      actorUserId,
      action: input.action,
      ttlMinutes: this.confirmationTtlMinutes
    });
    return {
      ok: true,
      replyText: [
        "這個操作需要再次確認。",
        `請在 ${this.confirmationTtlMinutes} 分鐘內回覆：`,
        `/confirm ${request.id}`
      ].join("\n")
    };
  }

  private async createInviteCode(
    profile: BotProfileConfig,
    actorUserId: string | undefined
  ): Promise<FunctionExecutionResult> {
    if (!actorUserId) {
      return { ok: true, replyText: "你沒有權限使用 admin 指令。" };
    }
    if (!profile.registration?.enabled) {
      return { ok: true, replyText: "這個 profile 沒有啟用註冊邀請碼。" };
    }
    const invite = await this.options.registrationInviteCodeStore.create({
      profileName: profile.name,
      createdBy: actorUserId,
      ttlMinutes: this.options.registrationInviteCodeTtlMinutes
    });
    await this.options.accessStore.recordAudit({
      profileName: profile.name,
      actorUserId,
      action: "invite_code.create",
      metadata: { ttlMinutes: this.options.registrationInviteCodeTtlMinutes }
    });
    return {
      ok: true,
      replyText: [
        "已建立一次性註冊邀請碼。",
        `有效時間：${this.options.registrationInviteCodeTtlMinutes} 分鐘`,
        `到期時間：${invite.expiresAt}`,
        "",
        "請複製下面這一行給要開通的使用者或群組：",
        `/registry ${invite.code}`
      ].join("\n")
    };
  }

  private async listWebAllowlist(profile: BotProfileConfig): Promise<FunctionExecutionResult> {
    const store = this.options.webAllowlistStore;
    if (!store) {
      return { ok: true, replyText: "Web allowlist store is not configured." };
    }
    const entries = await store.list(profile.name);
    return {
      ok: true,
      replyText:
        entries.length === 0
          ? "Web allowlist\n(none)"
          : ["Web allowlist", ...entries.map(formatWebAllowlistEntry)].join("\n")
    };
  }

  private async addWebAllowlist(
    input: AdminActionExecutionInput
  ): Promise<FunctionExecutionResult> {
    const store = this.options.webAllowlistStore;
    if (!store) {
      return { ok: true, replyText: "Web allowlist store is not configured." };
    }
    const actorUserId = input.event.source.userId;
    if (!actorUserId) {
      return { ok: true, replyText: "你沒有權限使用 admin 指令。" };
    }
    const target = parseWebAllowlistTarget(input.arguments);
    if (!target.ok) {
      return { ok: true, replyText: target.replyText };
    }
    const entry = await store.add({
      profileName: input.profile.name,
      domain: target.domain,
      pathPrefix: target.pathPrefix,
      label: target.label,
      createdBy: actorUserId
    });
    await this.options.accessStore.recordAudit({
      profileName: input.profile.name,
      actorUserId,
      action: "web_allowlist.add",
      targetType: "web_allowlist",
      targetId: entry.id,
      metadata: { domain: entry.domain, pathPrefix: entry.pathPrefix }
    });
    return {
      ok: true,
      replyText: [
        "Added web allowlist",
        `id: ${entry.id}`,
        `domain: ${entry.domain}`,
        entry.pathPrefix ? `path: ${entry.pathPrefix}` : undefined
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    };
  }

  private async grantFunctionScope(
    input: AdminActionExecutionInput
  ): Promise<FunctionExecutionResult> {
    const parsed = parseFunctionScopeArgs(input);
    if (!parsed.ok) {
      return { ok: true, replyText: parsed.replyText };
    }
    await this.options.accessStore.addGroupFunctionGrant({
      profileName: input.profile.name,
      groupId: parsed.groupId,
      functionName: parsed.functionName,
      createdBy: parsed.actorUserId
    });
    await this.options.accessStore.recordAudit({
      profileName: input.profile.name,
      actorUserId: parsed.actorUserId,
      action: "access.function.grant",
      targetType: "group",
      targetId: parsed.groupId,
      metadata: { functionName: parsed.functionName }
    });
    return {
      ok: true,
      replyText: [
        "Function scope granted",
        `profile: ${input.profile.name}`,
        `group: ${parsed.groupId}`,
        `function: ${parsed.functionName}`
      ].join("\n")
    };
  }

  private async revokeFunctionScope(
    input: AdminActionExecutionInput
  ): Promise<FunctionExecutionResult> {
    const parsed = parseFunctionScopeArgs(input);
    if (!parsed.ok) {
      return { ok: true, replyText: parsed.replyText };
    }
    const revoked = await this.options.accessStore.disableGroupFunctionGrant({
      profileName: input.profile.name,
      groupId: parsed.groupId,
      functionName: parsed.functionName,
      disabledBy: parsed.actorUserId
    });
    if (revoked) {
      await this.options.accessStore.recordAudit({
        profileName: input.profile.name,
        actorUserId: parsed.actorUserId,
        action: "access.function.revoke",
        targetType: "group",
        targetId: parsed.groupId,
        metadata: { functionName: parsed.functionName }
      });
    }
    return {
      ok: true,
      replyText: revoked
        ? [
            "Function scope revoked",
            `profile: ${input.profile.name}`,
            `group: ${parsed.groupId}`,
            `function: ${parsed.functionName}`
          ].join("\n")
        : "Function scope grant not found."
    };
  }

  private async listFunctionScope(
    input: AdminActionExecutionInput
  ): Promise<FunctionExecutionResult> {
    const actorUserId = input.event.source.userId;
    if (!actorUserId) {
      return { ok: true, replyText: "你沒有權限使用 admin 指令。" };
    }
    const groupId = readTargetGroupId(input.arguments, input.event);
    if (!groupId) {
      return { ok: true, replyText: "請提供 groupId，或在要設定的群組裡使用。" };
    }
    const groupGrants = await this.options.accessStore.listGroupFunctionGrants(
      input.profile.name,
      groupId
    );
    const effectiveFunctions = mergeFunctionNames(input.profile.enabledFunctions, groupGrants);
    return {
      ok: true,
      replyText: [
        "Function scopes",
        `profile: ${input.profile.name}`,
        `group: ${groupId}`,
        `profile-global: ${input.profile.enabledFunctions.join(", ") || "(none)"}`,
        `group-grants: ${groupGrants.join(", ") || "(none)"}`,
        `effective: ${effectiveFunctions.join(", ") || "(none)"}`
      ].join("\n")
    };
  }
}

function formatWebAllowlistEntry(entry: WebAllowlistEntry): string {
  return [
    `- ${entry.id}`,
    entry.enabled ? "enabled" : "disabled",
    entry.domain,
    entry.pathPrefix ? `path=${entry.pathPrefix}` : undefined,
    entry.label ? `label=${entry.label}` : undefined
  ]
    .filter(Boolean)
    .join(" ");
}

function parseWebAllowlistTarget(
  args: JsonRecord | undefined
):
  | { ok: true; domain: string; pathPrefix?: string; label?: string }
  | { ok: false; replyText: string } {
  const rawTarget = readStringArg(args, ["url", "domain", "website", "target"]);
  if (!rawTarget) {
    return {
      ok: false,
      replyText: "請提供要加入白名單的 HTTPS 網址或 domain，例如：https://example.org"
    };
  }
  const explicitPathPrefix = readStringArg(args, ["pathPrefix", "path", "path_prefix"]);
  const label = readStringArg(args, ["label", "name"]);

  if (/^http:\/\//iu.test(rawTarget)) {
    return { ok: false, replyText: "只支援 HTTPS 網址。" };
  }
  if (/^https:\/\//iu.test(rawTarget)) {
    try {
      const url = new URL(rawTarget);
      return {
        ok: true,
        domain: url.hostname,
        pathPrefix:
          explicitPathPrefix ?? (url.pathname && url.pathname !== "/" ? url.pathname : undefined),
        label
      };
    } catch {
      return { ok: false, replyText: "網址格式不正確，請提供 HTTPS 網址。" };
    }
  }

  return {
    ok: true,
    domain: rawTarget,
    pathPrefix: explicitPathPrefix,
    label
  };
}

function parseFunctionScopeArgs(
  input: AdminActionExecutionInput
):
  | { ok: true; actorUserId: string; groupId: string; functionName: FunctionName }
  | { ok: false; replyText: string } {
  const actorUserId = input.event.source.userId;
  if (!actorUserId) {
    return { ok: false, replyText: "你沒有權限使用 admin 指令。" };
  }
  const functionName = readFunctionName(input.arguments);
  if (!functionName) {
    return {
      ok: false,
      replyText: `請提供 functionName，可用功能：${FUNCTION_NAMES.join(", ")}`
    };
  }
  const groupId = readTargetGroupId(input.arguments, input.event);
  if (!groupId) {
    return { ok: false, replyText: "請提供 groupId，或在要設定的群組裡使用。" };
  }
  return { ok: true, actorUserId, groupId, functionName };
}

function readFunctionName(args: JsonRecord | undefined): FunctionName | undefined {
  const value = readStringArg(args, ["functionName", "function", "function_name", "name"]);
  return value && isFunctionName(value) ? value : undefined;
}

function readTargetGroupId(args: JsonRecord | undefined, event: LineEvent): string | undefined {
  return (
    readStringArg(args, ["groupId", "group", "targetGroupId", "target_group_id"]) ??
    (event.source.type === "group" ? event.source.groupId : undefined)
  );
}

function readStringArg(args: JsonRecord | undefined, keys: string[]): string | undefined {
  if (!args) {
    return undefined;
  }
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function mergeFunctionNames(left: FunctionName[], right: FunctionName[]): FunctionName[] {
  return Array.from(new Set([...left, ...right]));
}
