import { promises as dns } from "node:dns";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export interface ExternalBinaryDownloadResult {
  data: Uint8Array;
  finalUrl: string;
  fileName?: string;
  contentType?: string;
}

export interface ExternalBinaryClient {
  download(input: {
    url: string;
    maxBytes: number;
    timeoutMs: number;
    maxRedirects: number;
  }): Promise<ExternalBinaryDownloadResult>;
}

type DnsAnswer = { address: string; family: number };
type Resolver = (hostname: string) => Promise<DnsAnswer[]>;

export async function validateExternalBinaryUrl(
  rawUrl: string,
  resolve: Resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true })
): Promise<{ url: URL; hostname: string; address: string; family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("external_binary_invalid_url");
  }
  if (url.protocol !== "https:") {
    throw new Error("external_binary_https_required");
  }
  if (url.username || url.password) {
    throw new Error("external_binary_credentials_forbidden");
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const literalFamily = isIP(hostname);
  const answers = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolve(hostname);
  if (answers.length === 0 || answers.some((answer) => isUnsafeAddress(answer.address))) {
    throw new Error("external_binary_unsafe_address");
  }
  const selected = answers[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new Error("external_binary_invalid_address");
  }
  return { url, hostname, address: selected.address, family: selected.family };
}

export function createExternalBinaryClient(): ExternalBinaryClient {
  return {
    async download(input) {
      return downloadUrl(input.url, input, 0);
    }
  };
}

async function downloadUrl(
  rawUrl: string,
  limits: { maxBytes: number; timeoutMs: number; maxRedirects: number },
  redirects: number
): Promise<ExternalBinaryDownloadResult> {
  const validated = await validateExternalBinaryUrl(rawUrl);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = https.request(
      validated.url,
      {
        method: "GET",
        headers: { accept: "application/pdf,image/jpeg,image/png" },
        servername: validated.hostname,
        lookup: (_hostname, _options, callback) =>
          callback(null, validated.address, validated.family)
      },
      resolve
    );
    request.setTimeout(limits.timeoutMs, () =>
      request.destroy(new Error("external_binary_timeout"))
    );
    request.once("error", reject);
    request.end();
  });

  if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
    response.resume();
    if (redirects >= limits.maxRedirects) {
      throw new Error("external_binary_too_many_redirects");
    }
    const location = response.headers.location;
    if (!location) {
      throw new Error("external_binary_invalid_redirect");
    }
    return downloadUrl(new URL(location, validated.url).toString(), limits, redirects + 1);
  }
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`external_binary_http_${response.statusCode ?? "unknown"}`);
  }

  const contentType = String(response.headers["content-type"] ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType === "text/html" || (contentType && !isAllowedContentType(contentType))) {
    response.resume();
    throw new Error("external_binary_not_direct_file");
  }
  const declaredLength = Number(response.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > limits.maxBytes) {
    response.destroy();
    throw new Error("external_binary_too_large");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limits.maxBytes) {
      response.destroy();
      throw new Error("external_binary_too_large");
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    throw new Error("external_binary_empty");
  }
  return {
    data: new Uint8Array(Buffer.concat(chunks, size)),
    finalUrl: validated.url.toString(),
    fileName:
      fileNameFromHeaders(response.headers["content-disposition"]) ??
      decodeURIComponent(validated.url.pathname.split("/").at(-1) ?? ""),
    contentType
  };
}

function isAllowedContentType(value: string): boolean {
  return (
    value === "application/pdf" ||
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "application/octet-stream"
  );
}

function fileNameFromHeaders(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/iu)?.[1];
}

function isUnsafeAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
    const octets = ipv4.split(".").map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
      return true;
    }
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    /^(?:fc|fd|fe[89ab]|ff)/u.test(normalized) ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("2001:2:")
  );
}
