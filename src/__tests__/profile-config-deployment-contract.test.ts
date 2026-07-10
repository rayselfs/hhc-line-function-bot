import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("production profile configuration deployment contract", () => {
  it("ships file-backed profiles and does not deploy an ACA profile secret", () => {
    const dockerfile = readProjectFile("Dockerfile");
    const manifest = readProjectFile("aca.containerapp.yaml");
    const pipeline = readProjectFile("azure-pipelines.yml");

    expect(dockerfile).toContain("COPY config ./config");
    expect(manifest).toContain("name: PROFILE_CONFIG_PATH");
    expect(manifest).toContain("value: /app/config/profiles.json");
    expect(manifest).not.toContain("BOT_PROFILES_BASE64_JSON");
    expect(manifest).not.toContain("bot-profiles-base64-json");
    expect(pipeline).toContain("- config/**");
    expect(pipeline).toContain("pnpm config:validate");
    expect(pipeline).toContain("PROFILE_CONFIG_PATH=/app/config/profiles.json");
    expect(pipeline).toContain("--remove-env-vars");
    expect(pipeline).toContain("--secret-names bot-profiles-base64-json");
    expect(pipeline).not.toContain("--secret-name bot-profiles-base64-json");
    expect(readProjectFile("README.md")).toContain("sole complete");
    expect(readProjectFile("README.md")).not.toContain("Example shape:");
    expect(readProjectFile("README.md")).not.toContain('"personaPrompt"');
    expect(readProjectFile(".env.example")).not.toContain("BOT_PROFILES_JSON=");
    expect(readProjectFile(".env.example")).not.toContain("BOT_PROFILES_BASE64_JSON=");
  });
});
