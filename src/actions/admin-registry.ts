import type { AccessStore } from "../access/types.js";
import type { RegistrationInviteCodeStore } from "../access/registration-invite-code-store.js";
import { InMemoryConfirmationStore, type ConfirmationStore } from "./confirmation-store.js";
import {
  getFunctionDefinition,
  isGrantableFunctionName,
  userFacingFunctionNames
} from "../functions/definitions.js";
import {
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

  private async grantFunctionScope(
    input: AdminActionExecutionInput
  ): Promise<FunctionExecutionResult> {
    const parsed = parseFunctionScopeArgs(input);
    if (!parsed.ok) {
      return { ok: true, replyText: parsed.replyText };
    }
    if (parsed.target.type === "user") {
      await this.options.accessStore.addUserFunctionGrant({
        profileName: input.profile.name,
        userId: parsed.target.userId,
        functionName: parsed.functionName,
        createdBy: parsed.actorUserId
      });
      await this.options.accessStore.recordAudit({
        profileName: input.profile.name,
        actorUserId: parsed.actorUserId,
        action: "access.function.user.grant",
        targetType: "user",
        targetId: parsed.target.userId,
        metadata: { functionName: parsed.functionName }
      });
      return {
        ok: true,
        replyText: [
          "Function scope granted",
          `profile: ${input.profile.name}`,
          `user: ${parsed.target.userId}`,
          `function: ${parsed.functionName}`
        ].join("\n")
      };
    }
    await this.options.accessStore.addGroupFunctionGrant({
      profileName: input.profile.name,
      groupId: parsed.target.groupId,
      functionName: parsed.functionName,
      createdBy: parsed.actorUserId
    });
    await this.options.accessStore.recordAudit({
      profileName: input.profile.name,
      actorUserId: parsed.actorUserId,
      action: "access.function.grant",
      targetType: "group",
      targetId: parsed.target.groupId,
      metadata: { functionName: parsed.functionName }
    });
    return {
      ok: true,
      replyText: [
        "Function scope granted",
        `profile: ${input.profile.name}`,
        `group: ${parsed.target.groupId}`,
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
    if (parsed.target.type === "user") {
      const revoked = await this.options.accessStore.disableUserFunctionGrant({
        profileName: input.profile.name,
        userId: parsed.target.userId,
        functionName: parsed.functionName,
        disabledBy: parsed.actorUserId
      });
      if (revoked) {
        await this.options.accessStore.recordAudit({
          profileName: input.profile.name,
          actorUserId: parsed.actorUserId,
          action: "access.function.user.revoke",
          targetType: "user",
          targetId: parsed.target.userId,
          metadata: { functionName: parsed.functionName }
        });
      }
      return {
        ok: true,
        replyText: revoked
          ? [
              "Function scope revoked",
              `profile: ${input.profile.name}`,
              `user: ${parsed.target.userId}`,
              `function: ${parsed.functionName}`
            ].join("\n")
          : "Function scope grant not found."
      };
    }
    const revoked = await this.options.accessStore.disableGroupFunctionGrant({
      profileName: input.profile.name,
      groupId: parsed.target.groupId,
      functionName: parsed.functionName,
      disabledBy: parsed.actorUserId
    });
    if (revoked) {
      await this.options.accessStore.recordAudit({
        profileName: input.profile.name,
        actorUserId: parsed.actorUserId,
        action: "access.function.revoke",
        targetType: "group",
        targetId: parsed.target.groupId,
        metadata: { functionName: parsed.functionName }
      });
    }
    return {
      ok: true,
      replyText: revoked
        ? [
            "Function scope revoked",
            `profile: ${input.profile.name}`,
            `group: ${parsed.target.groupId}`,
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
    const target = readFunctionScopeTarget(input.arguments, input.event);
    if (!target) {
      return { ok: true, replyText: "請提供 groupId 或 userId。" };
    }
    if (target.type === "user") {
      const userGrants = await this.options.accessStore.listUserFunctionGrants(
        input.profile.name,
        target.userId
      );
      const profileDefaults = input.profile.enabledFunctions.filter(isDefaultUserFunctionAvailable);
      const effectiveFunctions = mergeFunctionNames(profileDefaults, userGrants);
      return {
        ok: true,
        replyText: [
          "Function scopes",
          `profile: ${input.profile.name}`,
          `user: ${target.userId}`,
          `profile-default: ${profileDefaults.join(", ") || "(none)"}`,
          `user-grants: ${userGrants.join(", ") || "(none)"}`,
          `effective: ${effectiveFunctions.join(", ") || "(none)"}`
        ].join("\n")
      };
    }
    const groupGrants = await this.options.accessStore.listGroupFunctionGrants(
      input.profile.name,
      target.groupId
    );
    const profileDefaults = input.profile.enabledFunctions.filter(isDefaultUserFunctionAvailable);
    const effectiveFunctions = mergeFunctionNames(profileDefaults, groupGrants);
    return {
      ok: true,
      replyText: [
        "Function scopes",
        `profile: ${input.profile.name}`,
        `group: ${target.groupId}`,
        `profile-global: ${input.profile.enabledFunctions.join(", ") || "(none)"}`,
        `profile-default: ${profileDefaults.join(", ") || "(none)"}`,
        `group-grants: ${groupGrants.join(", ") || "(none)"}`,
        `effective: ${effectiveFunctions.join(", ") || "(none)"}`
      ].join("\n")
    };
  }
}

function parseFunctionScopeArgs(input: AdminActionExecutionInput):
  | {
      ok: true;
      actorUserId: string;
      target: FunctionScopeTarget;
      functionName: FunctionName;
    }
  | { ok: false; replyText: string } {
  const actorUserId = input.event.source.userId;
  if (!actorUserId) {
    return { ok: false, replyText: "你沒有權限使用 admin 指令。" };
  }
  const functionName = readFunctionName(input.arguments);
  if (!functionName) {
    return {
      ok: false,
      replyText: `請提供 functionName，可用功能：${userFacingFunctionNames().join(", ")}`
    };
  }
  const target = readFunctionScopeTarget(input.arguments, input.event);
  if (!target) {
    return { ok: false, replyText: "請提供 groupId 或 userId。" };
  }
  return { ok: true, actorUserId, target, functionName };
}

type FunctionScopeTarget = { type: "group"; groupId: string } | { type: "user"; userId: string };

function readFunctionName(args: JsonRecord | undefined): FunctionName | undefined {
  const value = readStringArg(args, ["functionName", "function", "function_name", "name"]);
  return value && isFunctionName(value) && isGrantableFunctionName(value) ? value : undefined;
}

function readTargetGroupId(args: JsonRecord | undefined, event: LineEvent): string | undefined {
  return (
    readStringArg(args, ["groupId", "group", "targetGroupId", "target_group_id"]) ??
    (event.source.type === "group" ? event.source.groupId : undefined)
  );
}

function readTargetUserId(args: JsonRecord | undefined): string | undefined {
  return readStringArg(args, ["userId", "user", "targetUserId", "target_user_id"]);
}

function readFunctionScopeTarget(
  args: JsonRecord | undefined,
  event: LineEvent
): FunctionScopeTarget | undefined {
  const targetType = readStringArg(args, ["targetType", "target_type", "type"])?.toLowerCase();
  const userId = readTargetUserId(args);
  if (targetType === "user" || userId) {
    return userId ? { type: "user", userId } : undefined;
  }
  const groupId = readTargetGroupId(args, event);
  return groupId ? { type: "group", groupId } : undefined;
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

function isDefaultUserFunctionAvailable(functionName: FunctionName): boolean {
  return getFunctionDefinition(functionName)?.sideEffectLevel === "read";
}
