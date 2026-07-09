import { matchNaturalLanguageAdminActionHint } from "./catalog.js";
import type { AdminActionName } from "../types.js";

export type AdminActionEvalExpected = AdminActionName | "deny";

export interface AdminActionEvalCase {
  text: string;
  action: AdminActionEvalExpected;
}

const ADMIN_ACTION_EVAL_CASES: AdminActionEvalCase[] = [
  { text: "幫我產生邀請碼", action: "invite_code_create" },
  { text: "建立一組註冊碼", action: "invite_code_create" },
  { text: "create an invite code", action: "invite_code_create" },
  { text: "allow website https://example.org/news", action: "web_allowlist_add" },
  { text: "把維基百科加入網站白名單", action: "web_allowlist_add" },
  { text: "目前有哪些白名單網站", action: "web_allowlist_list" },
  { text: "enable function find_ppt_slides for this group", action: "function_scope_grant" },
  { text: "disable function find_ppt_slides for this group", action: "function_scope_revoke" },
  { text: "這個群組能用哪些功能", action: "function_scope_list" },
  { text: "請刪掉所有使用者", action: "deny" },
  { text: "把系統全部重設", action: "deny" }
];

export function getAdminActionEvalCases(): AdminActionEvalCase[] {
  return [...ADMIN_ACTION_EVAL_CASES];
}

export function evaluateAdminActionTextForEval(text: string): AdminActionEvalExpected {
  return matchNaturalLanguageAdminActionHint(text) ?? "deny";
}
