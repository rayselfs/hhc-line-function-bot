import { createServer, type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createClamAvScanner } from "../clients/clamav.js";
import { createHttpVirusScanner } from "../clients/virus-scan.js";

describe("HTTP virus scanner client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts file metadata and base64 content to the scanner endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "clean", detail: "ok" })
    });
    vi.stubGlobal("fetch", fetchMock);
    const scanner = createHttpVirusScanner({
      endpoint: "https://scanner.internal/scan",
      apiKey: "secret",
      timeoutMs: 5000
    });

    await expect(
      scanner.scan({
        data: new Uint8Array([1, 2, 3]),
        fileName: "週報.pdf",
        contentType: "application/pdf",
        sha256: "sha"
      })
    ).resolves.toEqual({ status: "clean", detail: "ok" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://scanner.internal/scan",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer secret"
        }),
        body: JSON.stringify({
          fileName: "週報.pdf",
          contentType: "application/pdf",
          sha256: "sha",
          dataBase64: "AQID"
        })
      })
    );
  });

  it("fails closed when the scanner endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const scanner = createHttpVirusScanner({
      endpoint: "https://scanner.internal/scan",
      timeoutMs: 5000
    });

    await expect(
      scanner.scan({
        data: new Uint8Array([1]),
        fileName: "file.pdf",
        contentType: "application/pdf",
        sha256: "sha"
      })
    ).resolves.toEqual({ status: "unavailable", detail: "http_503" });
  });
});

describe("ClamAV scanner client", () => {
  it.each([
    ["stream: OK\0", { status: "clean" }],
    ["stream: Eicar-Signature FOUND\0", { status: "infected", detail: "Eicar-Signature" }]
  ] as const)("maps clamd response %s", async (response, expected) => {
    const server = createServer((socket) => {
      let received = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        received = Buffer.concat([received, chunk]);
        if (received.subarray(-4).equals(Buffer.alloc(4))) {
          socket.end(response);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test_server_address_missing");
    const scanner = createClamAvScanner({
      host: "127.0.0.1",
      port: address.port,
      timeoutMs: 1000
    });

    await expect(
      scanner.scan({
        data: new Uint8Array([1, 2, 3]),
        fileName: "file.pdf",
        contentType: "application/pdf",
        sha256: "sha"
      })
    ).resolves.toEqual(expected);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("fails closed on a malformed clamd response", async () => {
    let peer: Socket | undefined;
    const server = createServer((socket) => {
      peer = socket;
      socket.end("unexpected response\0");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test_server_address_missing");
    const scanner = createClamAvScanner({ host: "127.0.0.1", port: address.port, timeoutMs: 1000 });

    await expect(
      scanner.scan({
        data: new Uint8Array([1]),
        fileName: "file.pdf",
        contentType: "application/pdf",
        sha256: "sha"
      })
    ).resolves.toEqual({ status: "unavailable", detail: "unexpected response" });
    peer?.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("fails closed when clamd times out", async () => {
    let peer: Socket | undefined;
    const server = createServer((socket) => {
      peer = socket;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test_server_address_missing");
    const scanner = createClamAvScanner({ host: "127.0.0.1", port: address.port, timeoutMs: 20 });

    await expect(
      scanner.scan({
        data: new Uint8Array([1]),
        fileName: "file.pdf",
        contentType: "application/pdf",
        sha256: "sha"
      })
    ).resolves.toEqual({ status: "unavailable", detail: "clamav_timeout" });
    peer?.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });
});
