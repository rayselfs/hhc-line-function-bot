export type WikipediaLanguage = "zh" | "en";

export interface WikipediaSearchResult {
  language: WikipediaLanguage;
  title: string;
  snippet: string;
  articleUrl: string;
}

export interface WikipediaArticle extends Omit<WikipediaSearchResult, "snippet"> {
  extract: string;
}

export interface WikipediaClient {
  search(
    language: WikipediaLanguage,
    query: string,
    limit: number
  ): Promise<WikipediaSearchResult[]>;
  getIntro(language: WikipediaLanguage, title: string): Promise<WikipediaArticle | undefined>;
}

export interface CreateWikipediaClientOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class WikipediaRateLimitError extends Error {
  constructor(readonly retryAfterSeconds?: number) {
    super("wikipedia_rate_limited");
    this.name = "WikipediaRateLimitError";
  }
}

export function createWikipediaClient(options: CreateWikipediaClientOptions): WikipediaClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  return {
    async search(language, query, limit) {
      const url = buildApiUrl(language, {
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: String(Math.min(Math.max(limit, 1), 3)),
        format: "json",
        formatversion: "2",
        utf8: "1"
      });
      const payload = await requestJson(fetchImpl, url, options.userAgent, timeoutMs);
      const results = asRecord(payload).query;
      const searchResults = asRecord(results).search;
      const search: unknown[] = Array.isArray(searchResults) ? searchResults : [];
      return search.flatMap((candidate) => {
        const record = asRecord(candidate);
        const title = stringValue(record.title);
        if (!title) {
          return [];
        }
        return [
          {
            language,
            title,
            snippet: stripHtml(stringValue(record.snippet) ?? ""),
            articleUrl: articleUrl(language, title)
          }
        ];
      });
    },

    async getIntro(language, title) {
      const url = buildApiUrl(language, {
        action: "query",
        prop: "extracts",
        exintro: "1",
        explaintext: "1",
        exchars: "1200",
        titles: title,
        format: "json",
        formatversion: "2"
      });
      const payload = await requestJson(fetchImpl, url, options.userAgent, timeoutMs);
      const pages = asRecord(asRecord(payload).query).pages;
      const page = Array.isArray(pages) ? asRecord(pages[0]) : {};
      const pageTitle = stringValue(page.title);
      const extract = stringValue(page.extract);
      if (!pageTitle || !extract || page.missing === true) {
        return undefined;
      }
      return { language, title: pageTitle, extract, articleUrl: articleUrl(language, pageTitle) };
    }
  };
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  userAgent: string,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "accept-encoding": "gzip", "user-agent": userAgent },
      signal: controller.signal
    });
    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      throw new WikipediaRateLimitError(Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    if (!response.ok) {
      throw new Error(`wikipedia_http_${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildApiUrl(language: WikipediaLanguage, parameters: Record<string, string>): string {
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function articleUrl(language: WikipediaLanguage, title: string): string {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/gu, "_"))}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/gu, "")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&");
}
