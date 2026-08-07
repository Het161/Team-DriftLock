import type { PostDoc } from "./schema";

/**
 * The public post shape. Exactly five fields — no more, ever.
 *
 * PostDoc carries extra fields for the newsroom UI, and it will grow as the
 * product does. This module is the single place that decides what escapes to
 * the evaluator, so schema drift can never leak a sixth key into the feed.
 */
export type PublicPost = {
  id: string;
  createdAt: string;
  text: string;
  rationale: string;
  sources: string[];
};

/** Mongo-side projection. Belt: the driver never even loads the extras. */
export const PUBLIC_POST_PROJECTION = {
  _id: 0,
  id: 1,
  createdAt: 1,
  text: 1,
  rationale: 1,
  sources: 1,
} as const;

/**
 * Braces: re-built key by key in code, so the emitted object is exactly the
 * five contract fields regardless of what the driver handed back.
 */
export function toPublicPost(doc: Partial<PostDoc>): PublicPost {
  return {
    id: String(doc.id ?? ""),
    createdAt: String(doc.createdAt ?? ""),
    text: String(doc.text ?? ""),
    rationale: String(doc.rationale ?? ""),
    sources: Array.isArray(doc.sources) ? doc.sources.map(String) : [],
  };
}
