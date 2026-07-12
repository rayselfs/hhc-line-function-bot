import type { JsonRecord } from "../types.js";

export interface QueryRefinement<TArguments extends JsonRecord = JsonRecord> {
  originalQuery: string;
  structuredArguments: TArguments;
  consumedTerms: string[];
  residualQuery: string;
}

export function buildResidualQuery(input: {
  query: string;
  consumedTerms: string[];
  genericTerms?: string[];
}): string {
  const terms = [...input.consumedTerms, ...(input.genericTerms ?? [])]
    .map((term) => term.normalize("NFKC").trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  let residual = input.query.normalize("NFKC");
  for (const term of terms) {
    residual = residual.replace(new RegExp(escapeRegExp(term), "giu"), " ");
  }

  return residual
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^的+|的+$/gu, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
