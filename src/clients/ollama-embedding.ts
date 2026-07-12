export interface EmbeddingClient {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(input: string[]): Promise<number[][]>;
}

export interface OllamaEmbeddingOptions {
  baseUrl: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
  keepAlive?: string | number;
}

export function createOllamaEmbeddingClient(options: OllamaEmbeddingOptions): EmbeddingClient {
  const baseUrl = options.baseUrl.replace(/\/+$/u, "");
  return {
    provider: "ollama",
    model: options.model,
    dimensions: options.dimensions,
    async embed(input: string[]): Promise<number[][]> {
      if (input.length === 0) {
        return [];
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const body: Record<string, unknown> = { model: options.model, input };
        if (options.keepAlive !== undefined) {
          body.keep_alive = options.keepAlive;
        }
        const response = await fetch(`${baseUrl}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          throw new Error(`embedding_http_${response.status}`);
        }
        const payload = (await response.json()) as { embeddings?: unknown };
        if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== input.length) {
          throw new Error("embedding_response_invalid");
        }
        return payload.embeddings.map((vector) => {
          if (
            !Array.isArray(vector) ||
            vector.length !== options.dimensions ||
            vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
          ) {
            throw new Error("embedding_dimension_mismatch");
          }
          return vector as number[];
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("embedding_timeout");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
