import type { FunctionName, JsonRecord, RouteResult } from "../types.js";

export function guardSystemRouteWithFunctionIntent(
  route: RouteResult,
  text: string,
  enabledFunctions: FunctionName[]
): RouteResult {
  if (route.type !== "respond") {
    return route;
  }

  const scheduleIntent = detectServiceScheduleIntent(text, enabledFunctions);
  if (!scheduleIntent) {
    return route;
  }

  return {
    type: "execute",
    action: scheduleIntent.action,
    arguments: scheduleIntent.arguments,
    provider: "keyword",
    fallbackProvider: route.provider === "keyword" ? undefined : route.provider,
    fallbackReason: `system_route_${route.action}`
  };
}

function detectServiceScheduleIntent(
  text: string,
  enabledFunctions: FunctionName[]
): { action: FunctionName; arguments: JsonRecord } | undefined {
  const action = enabledFunctions.includes("query_schedule")
    ? "query_schedule"
    : enabledFunctions.includes("query_service_schedule")
      ? "query_service_schedule"
      : undefined;
  if (!action) {
    return undefined;
  }

  const normalized = text.normalize("NFKC").replace(/\s+/g, "");
  const hasScheduleWord = /服事|聚會/u.test(normalized);
  if (!hasScheduleWord) {
    return undefined;
  }

  const args: JsonRecord = { query: text.trim() };
  if (/(下一場|下場|最近一場|下一次|下次)/u.test(normalized)) {
    args.dateIntent = "next_meeting";
    return { action, arguments: args };
  }
  if (/(這週|這周|本週|本周|这周|这週)/u.test(normalized)) {
    args.dateIntent = "this_week";
    return { action, arguments: args };
  }
  if (/今天/u.test(normalized)) {
    args.dateIntent = "today";
    return { action, arguments: args };
  }
  if (/明天/u.test(normalized)) {
    args.dateIntent = "tomorrow";
    return { action, arguments: args };
  }
  if (/後天|后天/u.test(normalized)) {
    args.dateIntent = "day_after_tomorrow";
    return { action, arguments: args };
  }
  if (/主日|晨更|門訓|國度禱告|福音餐會|仙履奇緣/u.test(normalized)) {
    return { action, arguments: args };
  }
  if (/服事表|聚會服事/u.test(normalized)) {
    return { action, arguments: args };
  }
  return undefined;
}
