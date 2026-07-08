import { createOllamaProvider } from "./clients/ollama.js";
import {
  createOpenAICodexOAuthProvider,
  refreshOpenAICodexOAuthToken
} from "./clients/openai-codex-oauth.js";
import { createAdminActionRouter } from "./admin-action-router.js";
import { RedisConfirmationStore } from "./actions/confirmation-store.js";
import { createAccessStore } from "./access/create-access-store.js";
import { RedisRegistrationInviteCodeStore } from "./access/registration-invite-code-store.js";
import { createAgentMemoryStore } from "./agent/create-agent-memory-store.js";
import { createAgentRuntime } from "./agent/agent-runtime.js";
import { RedisAgentJobStore } from "./agent/jobs.js";
import { RedisConversationWindowStore } from "./agent/context-manager.js";
import { createCacheStore } from "./cache/create-cache-store.js";
import { createGraphDriveClient } from "./clients/graph.js";
import { createNotionDatabaseClient } from "./clients/notion.js";
import { loadConfigFromEnv } from "./config.js";
import { createDependencyDiagnostics } from "./diagnostics/dependencies.js";
import { createPostgresRuntime } from "./db/postgres.js";
import { createFunctionRegistries } from "./functions/registry.js";
import { createInFlightStore } from "./in-flight/create-in-flight-store.js";
import { createKeywordFallbackRouter } from "./keyword-router.js";
import { createLastErrorStore } from "./observability/create-last-error-store.js";
import { createConsoleRouteObserver } from "./observability/route-observer.js";
import { createRateLimiter } from "./rate-limit.js";
import { createRedisRuntime } from "./redis.js";
import { createFunctionRouter } from "./router.js";
import { createApp } from "./server.js";
import { createSessionStore } from "./state/create-session-store.js";
import { PostgresWebAllowlistStore, runWebAllowlistMigrations } from "./web/allowlist.js";
import {
  createLlmTokenCipher,
  InMemoryLlmAuthStore,
  OpenAICodexAuthManager,
  PostgresLlmAuthStore,
  runLlmAuthMigrations
} from "./llm/auth.js";
import { RedisLlmOAuthStateStore } from "./llm/oauth-state-store.js";
import type { LlmAuthStore } from "./llm/auth.js";
import type { ChatProvider, TextGenerationProvider } from "./types.js";

const config = loadConfigFromEnv(process.env);

const redis = await createRedisRuntime(config.redis);
const postgres = await createPostgresRuntime(config.database);
const llmAuthStore = await createSharedLlmAuthStore();

const ollama = createOllamaProvider({
  baseUrl: config.llm.ollamaBaseUrl,
  model: config.llm.ollamaModel,
  timeoutMs: config.llm.timeoutMs,
  keepAlive: config.llm.ollamaKeepAlive
});
const primary = await createPrimaryProvider();
const router = createFunctionRouter({
  primary,
  modelFallback: primary.providerName === "openai_codex_oauth" ? ollama : undefined,
  keywordFallback: createKeywordFallbackRouter(),
  keywordFallbackEnabled: config.llm.keywordFallbackEnabled
});
const adminActionRouter = createAdminActionRouter({
  primary,
  modelFallback: primary.providerName === "openai_codex_oauth" ? ollama : undefined
});
const accessStore = await createAccessStore({ db: postgres?.pool });
const memoryStore = await createAgentMemoryStore({ db: postgres?.pool });
const webAllowlistStore = postgres?.pool ? await createPostgresWebAllowlistStore() : undefined;
const graph = config.graph ? createGraphDriveClient(config.graph) : undefined;
const notion = config.notion ? createNotionDatabaseClient(config.notion) : undefined;
const registrationInviteCodeStore = redis
  ? new RedisRegistrationInviteCodeStore({ client: redis.client, keyPrefix: redis.keyPrefix })
  : undefined;
const confirmationStore = redis
  ? new RedisConfirmationStore({ client: redis.client, keyPrefix: redis.keyPrefix })
  : undefined;
const sessionStore = createSessionStore({ redis });
const cache = createCacheStore({ redis });
const inFlightStore = createInFlightStore({ redis });
const agentJobStore = redis
  ? new RedisAgentJobStore({ client: redis.client, keyPrefix: redis.keyPrefix })
  : undefined;
const conversationWindowStore = redis
  ? new RedisConversationWindowStore({ client: redis.client, keyPrefix: redis.keyPrefix })
  : undefined;
const lastErrorStore = createLastErrorStore({
  redis,
  maxEntries: config.lastErrors?.maxEntries ?? 20
});
const rateLimiter = createRateLimiter({
  redis,
  config: config.rateLimit ?? { enabled: true, windowMs: 60_000, maxRequests: 20 }
});
const registries = createFunctionRegistries(config, {
  graph,
  notion,
  sessionStore,
  cache,
  memoryStore,
  llmAuthStore
});
const llmOAuthStateStore = redis
  ? new RedisLlmOAuthStateStore({ client: redis.client, keyPrefix: redis.keyPrefix })
  : undefined;
const app = createApp(config, {
  router,
  adminActionRouter,
  functionRegistry: registries.functions,
  postbackHandlers: registries.postbacks,
  textMessageHandlers: registries.textMessages,
  adminHandlers: registries.adminHandlers,
  lastErrorStore,
  rateLimiter,
  accessStore,
  registrationInviteCodeStore,
  confirmationStore,
  inFlightStore,
  sessionStore,
  agentJobStore,
  conversationWindowStore,
  webAllowlistStore,
  llmAuthStore,
  llmOAuthStateStore,
  textGenerator: primary,
  agentRuntime: createAgentRuntime({ memoryStore, graph }),
  diagnostics: createDependencyDiagnostics({
    config,
    postgres: postgres?.pool,
    redis: redis?.client
  }),
  routeObserver: createConsoleRouteObserver()
});

await app.listen({ host: config.host, port: config.port });

async function createPrimaryProvider(): Promise<ChatProvider & TextGenerationProvider> {
  if (config.llm.provider !== "openai_codex_oauth") {
    return ollama;
  }
  if (!config.llm.authEncryptionKey) {
    console.warn("LLM_PROVIDER=openai_codex_oauth requires LLM_AUTH_ENCRYPTION_KEY; using Ollama");
    return ollama;
  }
  const authStore = llmAuthStore ?? new InMemoryLlmAuthStore();
  const auth = new OpenAICodexAuthManager({
    store: authStore,
    refresh: (refreshToken) =>
      refreshOpenAICodexOAuthToken(refreshToken, {
        tokenUrl: config.llm.openaiCodexOAuthTokenUrl,
        clientId: config.llm.openaiCodexOAuthClientId
      })
  });
  return createOpenAICodexOAuthProvider({
    auth,
    authProfile: config.llm.openaiCodexAuthProfile ?? "helper",
    baseUrl: config.llm.openaiCodexBaseUrl ?? "https://chatgpt.com/backend-api/codex",
    model: config.llm.openaiCodexModel ?? "gpt-5.1-codex",
    timeoutMs: config.llm.timeoutMs,
    routeMaxOutputTokens: config.llm.routeMaxOutputTokens,
    generalMaxOutputTokens: config.llm.generalMaxOutputTokens
  });
}

async function createSharedLlmAuthStore(): Promise<LlmAuthStore | undefined> {
  if (!postgres?.pool || !config.llm.authEncryptionKey) {
    return undefined;
  }
  return createPostgresLlmAuthStore();
}

async function createPostgresLlmAuthStore(): Promise<PostgresLlmAuthStore> {
  if (!postgres?.pool || !config.llm.authEncryptionKey) {
    throw new Error("postgres_and_llm_auth_key_required");
  }
  await runLlmAuthMigrations(postgres.pool);
  return new PostgresLlmAuthStore(
    postgres.pool,
    createLlmTokenCipher(config.llm.authEncryptionKey)
  );
}

async function createPostgresWebAllowlistStore(): Promise<PostgresWebAllowlistStore> {
  if (!postgres?.pool) {
    throw new Error("postgres_required");
  }
  await runWebAllowlistMigrations(postgres.pool);
  return new PostgresWebAllowlistStore(postgres.pool);
}
