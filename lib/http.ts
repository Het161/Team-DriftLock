/**
 * JSON response helpers.
 *
 * Every error this API returns is JSON with a machine-readable `error` code and
 * a human `message` — including the 400/404 cases the evaluator probes, which
 * must never fall through to Next's default HTML error page.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // The evaluator may poll from anywhere, including a browser page.
  "access-control-allow-origin": "*",
  // The feed is a live wire; nothing between us and the evaluator may cache it.
  "cache-control": "no-store, max-age=0, must-revalidate",
};

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function fail(status: number, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: JSON_HEADERS,
  });
}
