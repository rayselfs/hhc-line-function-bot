# R3.1 Azure Embedding Correction Design

## Status

Approach approved on 2026-07-24. This correction supersedes only the embedding
provider and secret-provisioning decisions in
`2026-07-24-remote-provider-local-runtime-retirement-design.md`. The remaining
R3.1 decisions are unchanged.

## Goal

Complete R3.1 by using the existing Azure-hosted embedding deployment originally
created for the Bible workload. The bot must not require a direct OpenAI
platform account or an `api.openai.com` API key.

## Existing Azure Resource

The production subscription already contains the following healthy resource:

- Resource group: `alive`
- Azure AI Services account: `bible-text-embedding-resource`
- Region: Japan East
- SKU: S0
- Deployment: `text-embedding-3-small`
- Deployment format: OpenAI
- Deployment SKU: GlobalStandard
- Native output dimensions: 1536

R3.1 reuses this account and deployment. It does not create a duplicate model
resource or change the Bible workload's endpoint.

## Provider Contract

The embedding provider is named `azure_openai`. Its configuration declares the
Azure AI Services endpoint, deployment name, API version, API-key environment
reference, 1536 dimensions, timeout, batch size, and snapshot identity.

The adapter calls the Azure deployment-specific embeddings route and
authenticates with the Azure `api-key` header:

`POST {endpoint}/openai/deployments/{deployment}/embeddings?api-version=2024-10-21`

The production configuration uses these names:

| Setting | Production value or source |
| --- | --- |
| `EMBEDDING_PROVIDER` | `azure_openai` |
| `AZURE_OPENAI_EMBEDDING_ENDPOINT` | Azure account endpoint |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | `text-embedding-3-small` |
| `AZURE_OPENAI_EMBEDDING_API_VERSION` | `2024-10-21` |
| `AZURE_OPENAI_EMBEDDING_API_KEY` | `secretref:azure-openai-embedding-key` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` |

It never sends the Azure key to `api.openai.com`, and it rejects an endpoint
outside the configured Azure AI Services account.

Document and query embeddings use the same deployment and snapshot identity.
The existing R3.1 migration from BGE-M3's 1024-dimensional vectors to
1536-dimensional vectors remains valid and does not run a second dimension
migration.

## Secret Handling

The Azure AI Services account has two active account keys. Deployment copies
one existing key directly into a dedicated `hhc-line-function-bot` Container
App secret without printing it, writing it to disk, placing it in command
output, or committing it.

The deployment must not rotate either shared account key because the Bible
workload may use it. Container App secrets are workload-scoped, so the bot gets
its own secret reference even though the underlying Azure account is shared.
The deployment preflight verifies the resource and model deployment before
reading or installing the key.

The bot's managed identity remains the preferred future authentication
improvement, but switching authentication mechanisms is outside R3.1 because it
would expand the code, RBAC, and deployment scope during production completion.

## Deployment Flow

The release script:

1. Resolves `bible-text-embedding-resource` in resource group `alive`.
2. Verifies the `text-embedding-3-small` deployment is provisioned successfully.
3. Reads an account key without emitting its value.
4. Installs or updates the bot's workload-scoped Container App secret.
5. Configures the Azure endpoint, deployment, API version, model identity,
   dimensions, timeout, and secret reference on the bot revision.
6. Removes the direct-OpenAI embedding secret and environment contract.

If the resource, deployment, endpoint, or account key cannot be resolved, the
release fails before shifting production traffic. The currently healthy
revision remains active.

## Failure Behavior

Azure embedding timeout, rate limiting, authentication failure, malformed
response, or dimension mismatch produces the existing controlled unavailable
outcome. The bot does not fall back to Ollama, direct OpenAI, another Azure
deployment, or lexical publication against a mismatched snapshot.

Failed source synchronization preserves the prior last-known-good snapshot
where the existing R3.1 lifecycle contract permits it. A source cannot publish
a partial snapshot or mix vectors from different provider identities.

## Verification

- Unit tests verify the Azure embeddings URL, `api-key` authentication,
  deployment name, batching, response validation, timeout, and 1536 dimensions.
- Configuration tests reject direct OpenAI endpoints, missing Azure deployment
  settings, unsupported dimensions, and unknown embedding providers.
- Deployment-contract tests require Azure resource/deployment preflight and
  secret-reference wiring while prohibiting direct OpenAI secret requirements.
- The full repository format, typecheck, lint, test, build, agent evaluation,
  and Kernel evaluation gates pass.
- Pull-request CI passes before merge.
- After merge, the production release succeeds, the new revision becomes
  healthy, public readiness succeeds, and an unsigned request through the API
  Gateway webhook returns the bot-owned
  `400 {"ok":false,"error":"missing_line_signature"}` response.
- Production diagnostics confirm the Azure embedding provider identity without
  exposing its endpoint key.
