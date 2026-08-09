/**
 * Story discovery across four free sources.
 *
 * Design rules:
 *  - A dead adapter is skipped, never fatal. Three of four still makes a wire.
 *  - Each adapter has its own fetch budget, so one slow host cannot eat the tick.
 *  - Queries rotate by clock slot, so consecutive ticks cover different ground.
 *    Without this the agent re-reads the same handful of queries forever and the
 *    feed narrows to one corner of its own beat.
 *
 * Two things here were decided by probing the real APIs, not by assumption:
 *
 * 1. Freshness is per-source. A blanket 48-hour window silently deleted arXiv
 *    from the wire entirely — for a niche query the newest matching preprint is
 *    routinely four or five days old. That is not staleness, it is how preprints
 *    move, so arXiv gets a much wider window.
 *
 *    News sits at 72 hours, raised from 48 after the wire went a full day
 *    without filing. The cause was not a fault: these queries return a median
 *    article age of 721 hours, so the filter was correctly discarding almost
 *    everything, and the little that survived the agents had already spiked.
 *    Measured against a two-day-old agent at that moment: 48h left 7 unseen
 *    candidates, 72h left 32, 96h left 50. 72 was taken because a wire filing
 *    three analytical takes a day can legitimately comment on something from
 *    the last three days; four felt like stretching the word "news".
 *
 * 2. Bing News exists here because Google News RSS emits opaque
 *    news.google.com/rss/articles/CBMi… links that only resolve via in-page
 *    JavaScript. They work for a human, but they are poor things to publish in a
 *    dispatch's `sources`. Bing wraps the real publisher URL in a query
 *    parameter we can simply unwrap, so it yields clean, direct links. Google
 *    News is kept for coverage; Bing is kept for link quality.
 */

export type SourceKey = "hackernews" | "arxiv" | "googlenews" | "bingnews";

export type Candidate = {
  title: string;
  url: string;
  source: SourceKey;
  /** Human label — publisher name for news, "Hacker News" / "arXiv" otherwise. */
  sourceLabel: string;
  publishedAt: string;
  snippet: string;
  /** Corroborating signal, e.g. "412 points · 233 comments". Newsroom UI only. */
  signal: string | null;
  /** Which query surfaced this. Useful when explaining a decision. */
  keyword: string;
  /** How many outlets carried this same story, including this one. */
  corroboration: number;
  /** The other outlets that carried it. */
  alsoReported: string[];
};

export type AdapterStatus = {
  source: SourceKey;
  ok: boolean;
  found: number;
  ms: number;
  error: string | null;
};

export type DiscoveryReport = {
  candidates: Candidate[];
  adapters: AdapterStatus[];
};

/**
 * Per-adapter fetch budgets.
 *
 * arXiv gets nearly double. Measured cold it answered in 15.8s while the news
 * adapters return in well under two — so a shared 10s budget was not
 * "protecting the tick", it was quietly deleting research from the wire on
 * arXiv's slower days and logging it as a timeout. It is the only adapter that
 * runs a single query, so the extra headroom costs at most one slow request.
 */
const FETCH_TIMEOUT_MS: Record<SourceKey, number> = {
  hackernews: 10_000,
  googlenews: 10_000,
  bingnews: 10_000,
  arxiv: 18_000,
};

/** See the note above: preprints and news age at completely different rates. */
const MAX_AGE_HOURS: Record<SourceKey, number> = {
  hackernews: 72,
  googlenews: 72,
  bingnews: 72,
  arxiv: 14 * 24,
};

/** Lower wins a duplicate. Ordered by how good the link it yields is. */
const DEDUPE_PRECEDENCE: Record<SourceKey, number> = {
  hackernews: 0, // direct publisher link plus a discussion signal
  arxiv: 1, // canonical abstract page
  bingnews: 2, // unwrapped publisher link
  googlenews: 3, // opaque redirect; kept only for coverage
};

/**
 * Hosts that republish someone else's reporting.
 *
 * Used only to choose which member of an already-merged cluster represents it.
 * A reader clicking a source should land on the outlet that did the work, not
 * on a syndication shell — the first Indus dispatch cited msn.com for a story
 * the publisher had run themselves.
 */
const AGGREGATOR_HOSTS = [
  "msn.com",
  "news.google.com",
  "news.yahoo.com",
  "flipboard.com",
  "smartnews.com",
];

function isAggregator(url: string): boolean {
  try {
    const host = new URL(url).host.replace(/^www\./, "");
    return AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const UA = "TAAR/1.0 (autonomous wire service; https://github.com/Het161/Team-DriftLock)";

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function discover(
  queries: string[],
  options: { offset?: number } = {},
): Promise<DiscoveryReport> {
  const plan = [...new Set(queries.map((k) => k.trim()).filter(Boolean))];
  if (!plan.length) return { candidates: [], adapters: [] };

  // Rotate which slice of the pool each adapter uses. `offset` lets the caller
  // ask for a different slice — used to widen the search when a beat comes back
  // near-empty.
  //
  // 15-minute granularity, matching the fastest scheduler. At 30 minutes two
  // consecutive pinger cycles landed in the same slot and re-ran identical
  // queries, so the rotation did nothing for half of all cycles.
  const slot = Math.floor(Date.now() / (15 * 60_000)) + (options.offset ?? 0);
  const pick = (count: number, offset: number) =>
    Array.from(
      { length: Math.min(count, plan.length) },
      (_, i) => plan[(slot + offset + i) % plan.length],
    );

  // The two news adapters deliberately run the SAME queries. Splitting the plan
  // between them would halve each one's coverage and, worse, mean they never
  // surface the same story — which is exactly when the dedupe precedence below
  // does its job of keeping Bing's clean publisher link over Google's redirect.
  const newsKeywords = pick(3, 2);

  const settled = await Promise.all([
    run("hackernews", () => fromHackerNews(pick(4, 0))),
    // One query only. arXiv's rate limit makes it the slowest adapter by far,
    // and a second keyword costs a mandatory 3s pause plus another full timeout
    // window — which pushed whole ticks past 50s. Research is a garnish on this
    // wire, not the main course; one query per pass is the right trade.
    run("arxiv", () => fromArxiv(pick(1, 1))),
    run("googlenews", () => fromGoogleNews(newsKeywords)),
    run("bingnews", () => fromBingNews(newsKeywords)),
  ]);

  const now = Date.now();
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const candidates: Candidate[] = [];

  // Dedupe precedence, not fetch order. The same story routinely appears on
  // both news adapters, and whichever is seen first keeps its URL — so Bing
  // must win over Google News or its clean publisher links are always the ones
  // discarded, which would make adding it pointless.
  const byPreference = [...settled].sort(
    (a, b) => DEDUPE_PRECEDENCE[a.status.source] - DEDUPE_PRECEDENCE[b.status.source],
  );

  for (const { candidates: batch } of byPreference) {
    for (const c of batch) {
      if (!c.url || !c.title) continue;

      const age = now - new Date(c.publishedAt).getTime();
      if (!Number.isFinite(age) || age > MAX_AGE_HOURS[c.source] * 3_600_000) continue;

      const urlKey = normaliseUrl(c.url);
      const titleKey = normaliseTitle(c.title);
      if (seenUrl.has(urlKey) || seenTitle.has(titleKey)) continue;

      seenUrl.add(urlKey);
      seenTitle.add(titleKey);
      candidates.push(c);
    }
  }

  // Collapse the same event reported under different headlines, then show the
  // freshest first — the editorial gate reads only the top slice.
  const clustered = cluster(candidates);
  clustered.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return { candidates: clustered, adapters: settled.map((s) => s.status) };
}

/**
 * Merges near-duplicate stories.
 *
 * Exact URL and title matching is not enough. A single announcement reaches the
 * wire as "AMD announces agreement with AI chip startup Taalas", "AMD acquires
 * Taalas AI inference chip startup", and four other rewrites — on the first
 * live run that filled five of the eight desk slots with one event, so the
 * editor spent most of its judgement writing six variations of "this is a press
 * release".
 *
 * Titles are compared by word overlap, and the first member of a cluster wins
 * because candidates arrive in link-quality order. The count is kept rather
 * than discarded: how many outlets carried something is genuine editorial
 * signal, cutting both ways — wide pickup means the story matters, or that it
 * is a commodity announcement everyone reprinted. The editor gets the number
 * and decides which.
 */
function cluster(candidates: Candidate[]): Candidate[] {
  const kept: Array<{ candidate: Candidate; tokens: Set<string> }> = [];

  for (const c of candidates) {
    const tokens = titleTokens(c.title);
    const match = kept.find((k) => jaccard(k.tokens, tokens) >= 0.45);

    if (match) {
      match.candidate.corroboration++;
      if (!match.candidate.alsoReported.includes(c.sourceLabel)) {
        match.candidate.alsoReported.push(c.sourceLabel);
      }

      // Promote a canonical publisher over a syndication shell. Only the
      // representative link changes — the cluster, its count and its ordering
      // are untouched, so this cannot alter what the editor is offered or how
      // it ranks anything. It only changes where a reader lands.
      if (isAggregator(match.candidate.url) && !isAggregator(c.url)) {
        match.candidate.url = c.url;
        match.candidate.sourceLabel = c.sourceLabel;
        match.candidate.snippet = c.snippet || match.candidate.snippet;
      }
      continue;
    }

    kept.push({
      candidate: { ...c, corroboration: 1, alsoReported: [c.sourceLabel] },
      tokens,
    });
  }

  return kept.map((k) => k.candidate);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "at", "by", "from", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "will", "can", "could", "would",
  "has", "have", "had", "how", "why", "what", "new", "says", "said",
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    normaliseTitle(title)
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

async function run(
  source: SourceKey,
  fn: () => Promise<Candidate[]>,
): Promise<{ status: AdapterStatus; candidates: Candidate[] }> {
  const started = Date.now();
  try {
    const candidates = await fn();
    return {
      candidates,
      status: { source, ok: true, found: candidates.length, ms: Date.now() - started, error: null },
    };
  } catch (err) {
    return {
      candidates: [],
      status: {
        source,
        ok: false,
        found: 0,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function get(url: string, source: SourceKey): Promise<Response> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS[source]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return res;
}

/* -------------------------------------------------------------------------- */
/* Hacker News (Algolia)                                                       */
/* -------------------------------------------------------------------------- */

type HnHit = {
  objectID: string;
  title: string | null;
  url: string | null;
  story_text: string | null;
  created_at: string;
  points: number | null;
  num_comments: number | null;
};

async function fromHackerNews(keywords: string[]): Promise<Candidate[]> {
  const since = Math.floor((Date.now() - MAX_AGE_HOURS.hackernews * 3_600_000) / 1000);

  const batches = await Promise.all(
    keywords.map(async (keyword) => {
      const url =
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(keyword)}` +
        `&tags=story&hitsPerPage=20&numericFilters=created_at_i>${since}`;
      const body = (await get(url, "hackernews").then((r) => r.json())) as { hits?: HnHit[] };

      return (body.hits ?? [])
        .filter((h) => h.title)
        .map<Candidate>((h) => ({
          title: clean(h.title!),
          // Ask HN and similar carry no external link; the discussion is the story.
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          source: "hackernews",
          sourceLabel: "Hacker News",
          publishedAt: new Date(h.created_at).toISOString(),
          snippet: clean(h.story_text ?? "").slice(0, 400),
          signal:
            h.points != null ? `${h.points} points · ${h.num_comments ?? 0} comments` : null,
          keyword,
          corroboration: 1,
          alsoReported: [],
        }));
    }),
  );

  return batches.flat();
}

/* -------------------------------------------------------------------------- */
/* arXiv (Atom)                                                                */
/* -------------------------------------------------------------------------- */

/**
 * arXiv asks API clients for roughly one request every three seconds, and
 * enforces it: firing this adapter's keywords in parallel like the others
 * reliably drew HTTP 429 and silently removed research from the wire. So this
 * one adapter runs its queries sequentially with the requested spacing. It is
 * the slowest of the four by design, and still well inside a tick.
 */
async function fromArxiv(keywords: string[]): Promise<Candidate[]> {
  const batches: Candidate[][] = [];

  for (const [i, keyword] of keywords.entries()) {
    if (i > 0) await sleep(3_000);
    batches.push(await arxivQuery(keyword));
  }

  return batches.flat();
}

async function arxivQuery(keyword: string): Promise<Candidate[]> {
  const url =
    `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(`"${keyword}"`)}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=15`;
  const xml = await get(url, "arxiv").then((r) => r.text());

  return blocks(xml, "entry").map<Candidate>((entry) => {
    // A revised preprint is news on its revision date, not its original one.
    const published = tag(entry, "published") ?? "";
    const updated = tag(entry, "updated") ?? "";
    const newest = [published, updated]
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a)[0];

    return {
      title: clean(tag(entry, "title") ?? ""),
      url: clean(tag(entry, "id") ?? "").replace(/^http:/, "https:"),
      source: "arxiv",
      sourceLabel: "arXiv",
      publishedAt: new Date(newest ?? 0).toISOString(),
      snippet: clean(tag(entry, "summary") ?? "").slice(0, 400),
      signal: "preprint",
      keyword,
      corroboration: 1,
      alsoReported: [],
    };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Google News (RSS)                                                           */
/* -------------------------------------------------------------------------- */

async function fromGoogleNews(keywords: string[]): Promise<Candidate[]> {
  const batches = await Promise.all(
    keywords.map(async (keyword) => {
      const url =
        `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}` +
        `&hl=en-US&gl=US&ceid=US:en`;
      const xml = await get(url, "googlenews").then((r) => r.text());

      return blocks(xml, "item")
        .slice(0, 12)
        .map<Candidate>((item) => {
          const pubDate = tag(item, "pubDate") ?? "";
          // <source> carries the actual publisher, which matters far more to a
          // reader than "Google News" does.
          const publisher = clean(tag(item, "source") ?? "Google News");
          return {
            title: stripPublisherSuffix(clean(tag(item, "title") ?? ""), publisher),
            url: clean(tag(item, "link") ?? ""),
            source: "googlenews",
            sourceLabel: publisher,
            publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date(0).toISOString(),
            snippet: textOf(tag(item, "description") ?? "").slice(0, 400),
            signal: null,
            keyword,
            corroboration: 1,
            alsoReported: [],
          };
        });
    }),
  );

  return batches.flat();
}

/* -------------------------------------------------------------------------- */
/* Bing News (RSS)                                                             */
/* -------------------------------------------------------------------------- */

async function fromBingNews(keywords: string[]): Promise<Candidate[]> {
  const batches = await Promise.all(
    keywords.map(async (keyword) => {
      const url = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}&format=RSS`;
      const xml = await get(url, "bingnews").then((r) => r.text());

      return blocks(xml, "item")
        .slice(0, 12)
        .map<Candidate>((item) => {
          const pubDate = tag(item, "pubDate") ?? "";
          const link = unwrapBingLink(clean(tag(item, "link") ?? ""));
          return {
            title: clean(tag(item, "title") ?? ""),
            url: link,
            source: "bingnews",
            sourceLabel: publisherFromUrl(link) ?? "Bing News",
            publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date(0).toISOString(),
            snippet: textOf(tag(item, "description") ?? "").slice(0, 400),
            signal: null,
            keyword,
            corroboration: 1,
            alsoReported: [],
          };
        });
    }),
  );

  return batches.flat();
}

/**
 * Bing links look like
 *   bing.com/news/apiclick.aspx?…&url=https%3a%2f%2fpublisher.com%2fstory&…
 * The real destination is sitting in the `url` parameter, so the clean link is
 * a decode away rather than a redirect chase.
 */
function unwrapBingLink(link: string): string {
  try {
    const inner = new URL(link).searchParams.get("url");
    if (inner && /^https?:\/\//i.test(inner)) return inner;
  } catch {
    /* fall through to the original */
  }
  return link;
}

function publisherFromUrl(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Parsing helpers                                                             */
/* -------------------------------------------------------------------------- */

/** All inner contents of <name …>…</name>. */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** First inner content of <name …>…</name> within a block. */
function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  return re.exec(block)?.[1] ?? null;
}

function clean(s: string): string {
  return decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plain text from an RSS description.
 *
 * Order matters and was originally wrong here: RSS descriptions arrive with
 * their markup entity-encoded (`&lt;a href=…&gt;`), so stripping tags before
 * decoding finds no tags at all and the raw anchor markup ends up in the
 * snippet. Decode first, then strip.
 */
function textOf(s: string): string {
  return clean(stripTags(clean(s)));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

/** Google News appends " - Publisher" to every headline. */
function stripPublisherSuffix(title: string, publisher: string): string {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    // Ampersand last, or it re-decodes the entities produced above.
    .replace(/&amp;/g, "&");
}

export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Campaign parameters make the same story look like several stories.
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_|^ref$|^source$|^oc$/i.test(key)) u.searchParams.delete(key);
    }
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}
