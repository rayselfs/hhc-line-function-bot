import type { JsonRecord } from "../types.js";

export class ProviderResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderResponseError";
  }
}

export function coerceFunctionArguments(args: unknown): JsonRecord {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as JsonRecord) : {};
}
