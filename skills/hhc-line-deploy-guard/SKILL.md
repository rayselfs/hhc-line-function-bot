---
name: hhc-line-deploy-guard
description: Guard hhc-line-function-bot Azure DevOps to Azure Container Apps deployments after the migration to file-backed production profiles. Use when pushing main, checking pipeline deploy status, or validating ACA profile configuration inventory.
---

# HHC LINE Deploy Guard

Use this skill for the deployment path: Azure DevOps pipeline -> ACR image -> Azure Container Apps revision.

Production profile behavior lives in `config/profiles.json` inside the application image. The file must be a JSON array and must not contain credentials. ACA keeps only the referenced credential values as separate secrets.

## Rules

- Do not set, decode, base64 encode, or repair `BOT_PROFILES_JSON` or `BOT_PROFILES_BASE64_JSON` in production.
- Do not recreate `bot-profiles-base64-json`.
- `PROFILE_CONFIG_PATH` must be `/app/config/profiles.json`.
- Production profile files use `channelSecretEnv`, `channelAccessTokenEnv`, and `adminUserIdEnv`; they never contain direct credential values.
- Run `corepack pnpm config:validate` before building an image.
- Treat `git push origin main` as a production deployment action when trigger paths are changed.

## Read-Only Checks

Validate the checked-in profile configuration:

```powershell
corepack pnpm config:validate
```

Show the live ACA profile-config inventory without secret values:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\hhc-line-deploy-guard\scripts\profile-config.ps1 -Action summary
```

Require the post-migration ACA state:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\hhc-line-deploy-guard\scripts\profile-config.ps1 -Action check
```

## Deploy Diagnosis

1. Check the Azure DevOps run status and timeline.
2. Confirm the Validate stage ran `pnpm config:validate`.
3. Check the ACA image, `latestRevision`, and `latestReadyRevision`.
4. If the revision is not ready, inspect logs for that exact revision.
5. After readiness, run the inventory check. It must report no legacy profile env vars and no `bot-profiles-base64-json` secret.

## Expected Constants

- Azure DevOps organization: `https://dev.azure.com/HalleluyaHomeChurch`
- Azure DevOps project: `OPS`
- Pipeline: `hhc-line-function-bot ci`
- Resource group: `alive`
- Container app: `hhc-line-function-bot`
- Profile config path: `/app/config/profiles.json`
- Image pattern: `alive.azurecr.io/alive/hhc-line-function-bot:main-<BuildId>`
