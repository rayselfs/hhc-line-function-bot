import { afterEach, describe, expect, it, vi } from "vitest";

import { createOllamaEmbeddingClient } from "../clients/ollama-embedding.js";

describe("Ollama embedding client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the dedicated embedding model and short keep-alive", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), { status: 200 })
      );
    const client = createOllamaEmbeddingClient({
      baseUrl: "http://ollama.local/",
      model: "bge-m3",
      dimensions: 3,
      timeoutMs: 1_000,
      keepAlive: "1m"
    });

    await expect(client.embed(["聚會 SOP"])).resolves.toEqual([[0.1, 0.2, 0.3]]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ollama.local/api/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "bge-m3", input: ["聚會 SOP"], keep_alive: "1m" })
      })
    );
  });

  it("rejects vectors with an unexpected dimension", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 })
    );
    const client = createOllamaEmbeddingClient({
      baseUrl: "http://ollama.local",
      model: "bge-m3",
      dimensions: 3,
      timeoutMs: 1_000
    });

    await expect(client.embed(["text"])).rejects.toThrow("embedding_dimension_mismatch");
  });
});
