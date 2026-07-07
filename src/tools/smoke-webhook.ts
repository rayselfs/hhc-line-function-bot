import { pathToFileURL } from "node:url";

import { signLineBody } from "../line-signature.js";

export interface SmokeWebhookPayloadOptions {
  text: string;
  userId?: string;
}

export interface SmokeWebhookRequestOptions extends SmokeWebhookPayloadOptions {
  secret: string;
}

export interface SmokeWebhookCliOptions {
  fetchImpl?: typeof fetch;
  writeLine?: (line: string) => void;
}

export function buildSmokeWebhookPayload(options: SmokeWebhookPayloadOptions): string {
  return JSON.stringify({
    destination: "smoke-bot",
    events: [
      {
        type: "message",
        replyToken: "smoke-reply-token",
        source: {
          type: "user",
          userId: options.userId ?? "Usmoke"
        },
        message: {
          type: "text",
          id: "smoke-message",
          text: options.text
        },
        timestamp: 0
      }
    ]
  });
}

export function createSmokeWebhookRequest(options: SmokeWebhookRequestOptions): {
  body: string;
  headers: Record<string, string>;
} {
  const body = buildSmokeWebhookPayload(options);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-line-signature": signLineBody(Buffer.from(body), options.secret)
    }
  };
}

export async function runSmokeWebhookCli(
  argv: string[],
  options: SmokeWebhookCliOptions = {}
): Promise<void> {
  const parsed = parseArgs(argv);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const writeLine = options.writeLine ?? ((line: string) => console.log(line));
  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }
  const request = createSmokeWebhookRequest({
    text: parsed.text,
    secret: parsed.secret,
    userId: parsed.userId
  });
  const response = await fetchImpl(parsed.url, {
    method: "POST",
    headers: request.headers,
    body: request.body
  });
  const body = await response.text();
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-ms-request-id");
  writeLine(`status=${response.status}`);
  if (requestId) {
    writeLine(`requestId=${requestId}`);
  }
  writeLine(`body=${body}`);
}

function parseArgs(argv: string[]): {
  url: string;
  secret: string;
  text: string;
  userId?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      continue;
    }
    values.set(key.slice(2), value);
  }
  const url = values.get("url");
  const secret = values.get("secret");
  const text = values.get("text");
  if (!url || !secret || !text) {
    throw new Error("Usage: pnpm smoke:webhook -- --url <url> --secret <secret> --text <text>");
  }
  return {
    url,
    secret,
    text,
    userId: values.get("user-id")
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSmokeWebhookCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
