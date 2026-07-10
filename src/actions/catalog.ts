import { getFunctionDefinitions } from "../functions/definitions.js";
import {
  FUNCTION_NAMES,
  SYSTEM_ACTION_NAMES,
  type ActionName,
  type AdminActionName,
  type FunctionName,
  type SystemActionName
} from "../types.js";

export type ActionKind = "user_function" | "admin_action" | "system_action";
export type ActionAuth = "public" | "registered" | "admin" | "superadmin";
export type ActionSourcePolicy = "direct" | "group" | "direct_or_group";
export type ActionSideEffect = "read_only" | "state_change" | "security_change" | "destructive";

export interface ActionDefinition<Name extends ActionName = ActionName> {
  name: Name;
  kind: ActionKind;
  auth: ActionAuth;
  sourcePolicy: ActionSourcePolicy;
  sideEffect: ActionSideEffect;
  naturalLanguage: boolean;
  auditAction?: string;
  description: string;
  naturalLanguageHints?: string[];
  groupNaturalLanguage?: boolean;
}

const userFunctionActions: ActionDefinition<FunctionName>[] = getFunctionDefinitions([
  ...FUNCTION_NAMES
]).map((definition) => ({
  name: definition.name,
  kind: "user_function",
  auth: "registered",
  sourcePolicy: "direct_or_group",
  sideEffect: actionSideEffectForFunction(definition.sideEffectLevel),
  naturalLanguage: true,
  description: definition.description
}));

function actionSideEffectForFunction(sideEffectLevel: string): ActionSideEffect {
  switch (sideEffectLevel) {
    case "read":
      return "read_only";
    case "destructive":
      return "destructive";
    case "write":
    case "admin":
    default:
      return "state_change";
  }
}

const systemActions: ActionDefinition<SystemActionName>[] = [...SYSTEM_ACTION_NAMES].map(
  (name) => ({
    name,
    kind: "system_action",
    auth: "public",
    sourcePolicy: "direct_or_group",
    sideEffect: "read_only",
    naturalLanguage: true,
    description: "Controlled system response."
  })
);

const adminActions: ActionDefinition<AdminActionName>[] = [
  {
    name: "invite_code_create",
    kind: "admin_action",
    auth: "admin",
    sourcePolicy: "direct",
    sideEffect: "security_change",
    naturalLanguage: true,
    auditAction: "invite_code.create",
    description:
      "Create a one-time registration invite code for opening a direct user or current group.",
    naturalLanguageHints: [
      "invite code",
      "registration code",
      "registry code",
      "create code",
      "產生邀請碼",
      "建立邀請碼",
      "註冊碼",
      "邀請碼"
    ]
  },
  {
    name: "function_scope_grant",
    kind: "admin_action",
    auth: "admin",
    sourcePolicy: "direct_or_group",
    sideEffect: "security_change",
    naturalLanguage: true,
    groupNaturalLanguage: true,
    auditAction: "access.function.grant",
    description:
      "Grant a function to a group or user. Arguments: functionName; optional targetType ('group' or 'user'), groupId, userId. In a group, missing groupId means the current group.",
    naturalLanguageHints: [
      "enable function",
      "grant function",
      "allow function",
      "開啟功能",
      "開放功能",
      "允許功能",
      "群組開啟",
      "這個群組開啟"
    ]
  },
  {
    name: "function_scope_revoke",
    kind: "admin_action",
    auth: "admin",
    sourcePolicy: "direct_or_group",
    sideEffect: "state_change",
    naturalLanguage: true,
    groupNaturalLanguage: true,
    auditAction: "access.function.revoke",
    description:
      "Revoke a group- or user-specific function grant. Arguments: functionName; optional targetType ('group' or 'user'), groupId, userId. In a group, missing groupId means the current group.",
    naturalLanguageHints: [
      "disable function",
      "revoke function",
      "remove function",
      "關閉功能",
      "停用功能",
      "取消功能",
      "群組關閉",
      "這個群組關閉"
    ]
  },
  {
    name: "function_scope_list",
    kind: "admin_action",
    auth: "admin",
    sourcePolicy: "direct_or_group",
    sideEffect: "read_only",
    naturalLanguage: true,
    groupNaturalLanguage: true,
    description:
      "Show profile-global, group-granted/user-granted, and effective functions for a group or user. Arguments: optional targetType ('group' or 'user'), groupId, userId. In a group, missing groupId means the current group.",
    naturalLanguageHints: [
      "function scopes",
      "enabled functions",
      "group functions",
      "群組功能",
      "有哪些功能",
      "能用哪些功能"
    ]
  }
];

export const ACTION_DEFINITIONS: ActionDefinition[] = [
  ...userFunctionActions,
  ...systemActions,
  ...adminActions
];

export function getActionDefinition(name: ActionName): ActionDefinition | undefined {
  return ACTION_DEFINITIONS.find((definition) => definition.name === name);
}

export function getNaturalLanguageAdminActions(): ActionDefinition<AdminActionName>[] {
  return adminActions.filter((definition) => definition.naturalLanguage);
}

export function enabledNaturalLanguageAdminActionNames(): AdminActionName[] {
  return getNaturalLanguageAdminActions().map((definition) => definition.name);
}

export function matchesNaturalLanguageAdminActionHint(text: string): boolean {
  return Boolean(matchNaturalLanguageAdminActionHint(text));
}

export function matchesGroupScopedNaturalLanguageAdminActionHint(text: string): boolean {
  const matched = matchNaturalLanguageAdminActionHint(text);
  return Boolean(
    matched &&
    getNaturalLanguageAdminActions().find((definition) => definition.name === matched)
      ?.groupNaturalLanguage
  );
}

export function matchNaturalLanguageAdminActionHint(text: string): AdminActionName | undefined {
  const normalized = text.normalize("NFKC").toLowerCase();
  let best: { name: AdminActionName; length: number } | undefined;
  for (const definition of getNaturalLanguageAdminActions()) {
    for (const hint of definition.naturalLanguageHints ?? []) {
      const normalizedHint = hint.toLowerCase();
      if (normalized.includes(normalizedHint) && normalizedHint.length > (best?.length ?? 0)) {
        best = { name: definition.name, length: normalizedHint.length };
      }
    }
  }
  return best?.name;
}
