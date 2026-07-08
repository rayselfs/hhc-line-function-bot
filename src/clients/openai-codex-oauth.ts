import { ProviderResponseError } from "../router.js";
import {
  TerminalLlmAuthError,
  type OpenAICodexAuthManager,
  type RefreshedCodexToken
} from "../llm/auth.js";
import type {
  ChatProvider,
  ChatProviderRequest,
  TextGenerationProvider,
  TextGenerationRequest
} from "../types.js";

export const DEFAULT_CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const DEFAULT_CODEX_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const DEFAULT_CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";

export interface OpenAICodexOAuthProviderOptions {
  auth: OpenAICodexAuthManager;
  authProfile: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  routeMaxOutputTokens?: number;
  generalMaxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenAICodexOAuthTokenOptions {
  tokenUrl?: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
}

export function buildOpenAICodexOAuthAuthorizeUrl(input: {
  authorizeUrl?: string;
  clientId?: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(input.authorizeUrl ?? DEFAULT_CODEX_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId ?? DEFAULT_CODEX_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", "openid profile email offline_access");
  return url.toString();
}

export function createOpenAICodexOAuthProvider(
  options: OpenAICodexOAuthProviderOptions
): ChatProvider & TextGenerationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = normalizeCodexResponsesUrl(options.baseUrl);
  return {
    providerName: "openai_codex_oauth",

    async completeJson(request: ChatProviderRequest): Promise<string> {
      return completeCodexResponse(fetchImpl, options, endpoint, {
        instructions: request.prompt,
        text: request.text,
        maxOutputTokens: options.routeMaxOutputTokens ?? 256,
        forceJson: true
      });
    },

    async completeText(request: TextGenerationRequest): Promise<string> {
      return completeCodexResponse(fetchImpl, options, endpoint, {
        instructions: request.prompt,
        text: request.text,
        maxOutputTokens: options.generalMaxOutputTokens ?? Math.max(128, request.maxChars * 2),
        forceJson: false
      });
    }
  };
}

export async function refreshOpenAICodexOAuthToken(
  refreshToken: string,
  optionsOrFetch: OpenAICodexOAuthTokenOptions | typeof fetch = {}
): Promise<RefreshedCodexToken> {
  const options = normalizeTokenOptions(optionsOrFetch);
  const response = await options.fetchImpl(options.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: options.clientId
    })
  });
  return parseTokenResponse(response, "codex_refresh");
}

export async function exchangeOpenAICodexOAuthCode(input: {
  code: string;
  redirectUri: string;
  tokenUrl?: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
}): Promise<RefreshedCodexToken> {
  const response = await (input.fetchImpl ?? fetch)(
    input.tokenUrl ?? DEFAULT_CODEX_OAUTH_TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.clientId ?? DEFAULT_CODEX_OAUTH_CLIENT_ID
      })
    }
  );
  return parseTokenResponse(response, "codex_oauth_code");
}

async function completeCodexResponse(
  fetchImpl: typeof fetch,
  options: OpenAICodexOAuthProviderOptions,
  endpoint: string,
  input: {
    instructions: string;
    text: string;
    maxOutputTokens: number;
    forceJson: boolean;
  }
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const token = await options.auth.getAccessToken(options.authProfile);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        instructions: input.forceJson
          ? `${input.instructions}\nReturn only valid JSON.`
          : input.instructions,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: input.text }]
          }
        ],
        store: false,
        max_output_tokens: input.maxOutputTokens
      })
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ProviderResponseError("codex_unauthorized");
      }
      throw new ProviderResponseError(`codex_http_${response.status}`);
    }
    const payload = await response.json();
    const text = extractResponseText(payload);
    if (!text) {
      throw new ProviderResponseError("codex_empty_response");
    }
    return text;
  } catch (error) {
    if (error instanceof ProviderResponseError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderResponseError("timeout");
    }
    throw new ProviderResponseError(error instanceof Error ? error.message : "codex_unreachable");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCodexResponsesUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, "");
  if (normalized.endsWith("/responses")) {
    return normalized;
  }
  if (normalized.endsWith("/codex")) {
    return `${normalized}/responses`;
  }
  return `${normalized}/codex/responses`;
}

function extractResponseText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  const output = record.output;
  if (!Array.isArray(output)) {
    return undefined;
  }
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (part && typeof part === "object") {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string") {
          chunks.push(text);
        }
      }
    }
  }
  return chunks.join("").trim() || undefined;
}

function extractJwtClaim(token: string, claim: string): string | undefined {
  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const value = json[claim];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTokenOptions(
  optionsOrFetch: OpenAICodexOAuthTokenOptions | typeof fetch
): Required<OpenAICodexOAuthTokenOptions> {
  if (typeof optionsOrFetch === "function") {
    return {
      tokenUrl: DEFAULT_CODEX_OAUTH_TOKEN_URL,
      clientId: DEFAULT_CODEX_OAUTH_CLIENT_ID,
      fetchImpl: optionsOrFetch
    };
  }
  return {
    tokenUrl: optionsOrFetch.tokenUrl ?? DEFAULT_CODEX_OAUTH_TOKEN_URL,
    clientId: optionsOrFetch.clientId ?? DEFAULT_CODEX_OAUTH_CLIENT_ID,
    fetchImpl: optionsOrFetch.fetchImpl ?? fetch
  };
}

async function parseTokenResponse(
  response: Response,
  errorPrefix: string
): Promise<RefreshedCodexToken> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status >= 400 && response.status < 500) {
      throw new TerminalLlmAuthError(
        body.includes("invalid_grant") ? "invalid_grant" : `${errorPrefix}_http_${response.status}`
      );
    }
    throw new ProviderResponseError(`${errorPrefix}_http_${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token || !payload.refresh_token || !Number.isFinite(payload.expires_in)) {
    throw new ProviderResponseError(`${errorPrefix}_invalid_response`);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString(),
    accountId: extractJwtClaim(payload.access_token, "https://api.openai.com/profile_id")
  };
}
