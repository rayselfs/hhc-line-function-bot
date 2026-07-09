import type { ModelProviderName, ProviderCapabilities } from "../types.js";

export const providerCapabilities: Record<ModelProviderName, ProviderCapabilities> = {
  ollama: {
    structuredOutput: true,
    smartTalk: true,
    largeContext: false,
    requiresExternalAuth: false,
    subscriptionBased: false
  },
  codex_app_server: {
    structuredOutput: true,
    smartTalk: true,
    largeContext: true,
    requiresExternalAuth: true,
    subscriptionBased: true
  }
};
