import { describe, expect, it, vi } from "vitest";

import { createOpenAiEmbeddingClient } from "../clients/openai-embedding.js";

const vector = (value: number) => Array.from({ length: 1536 }, () => value);

describe("OpenAI embedding client", () => {
  it("uses the embeddings API and restores vectors by response index", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: vector(0.2) },
            { index: 0, embedding: vector(0.1) }
          ]
        }),
        { status: 200 }
      )
    );
    const client = createOpenAiEmbeddingClient({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1/",
      model: "text-embedding-3-small",
      dimensions: 1536,
      timeoutMs: 1000,
      fetchImpl
    });

    await expect(client.embed(["first", "second"])).resolves.toEqual([vector(0.1), vector(0.2)]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: ["first", "second"],
          encoding_format: "float"
        })
      })
    );
  });

  it("rejects a response with an unexpected vector dimension", async () => {
    const client = createOpenAiEmbeddingClient({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      dimensions: 1536,
      timeoutMs: 1000,
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1] }] }), { status: 200 })
        )
    });

    await expect(client.embed(["first"])).rejects.toThrow("embedding_dimension_mismatch");
  });
});
