/**
 * Generates docs/architecture.svg — an isometric view of TAAR's four planes.
 *
 *   node scripts/gen-architecture.mjs
 *
 * Generated rather than hand-drawn so the geometry stays honest and it can be
 * rebuilt when the architecture changes. Every colour is a design token from
 * app/globals.css. Depth comes from shading the three visible faces, which is
 * how a solid actually looks — the design system bans drop shadows.
 *
 * Two numbers govern the whole layout, and both were learned by getting them
 * wrong:
 *
 *   1. A plane's projected height is (W + D) / 2. The vertical gap between
 *      planes must exceed it or the slabs intersect. First attempt used 220
 *      against a plane height of 380.
 *
 *   2. A box's projected height is (w + h) / 2 — its WIDTH contributes. So two
 *      218-wide boxes stacked 62 apart in plane-space are separated by only
 *      31px on screen while each occupies 126px, and they overlap almost
 *      completely. Boxes therefore tile along x in a single diagonal row, where
 *      the x-step buys real vertical clearance.
 *
 * Plane labels sit in screen space beside each slab rather than on it, because
 * on-plane text shears and collided with the first row of boxes no matter how
 * the rows were spaced.
 */

import { writeFileSync, mkdirSync } from "node:fs";

/* Design tokens ----------------------------------------------------------- */
const PAPER = "#F6F5F1";
const RAISED = "#FBFAF7";
const INK = "#1A1915";
const BLUE = "#2743C7";
const STAMP = "#C63B21";
const GRAPHITE = "#8A887F";
const RULE = "#E3E0D6";
const FACE_R = "#EAE7DD";
const FACE_L = "#D7D3C6";

/* Geometry ---------------------------------------------------------------- */
const W = 520;
const D = 240;
const T = 14;
const GAP = 430; // > (W + D) / 2 = 380

const CW = 132; // box width
const CH = 34; // box height
const STEP = 176; // x-step: 176/2 = 88 clearance > (132+34)/2 = 83
const ROW_Y = 74; // single row, leaving the front band free for arrows
const ARROW_Y = 196;

const COS30 = Math.cos(Math.PI / 6);
const P = (x, y, z) => [(x - y) * COS30, (x + y) * 0.5 - z];
const pt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
const onPlane = (x, y, z) => {
  const [tx, ty] = P(x, y, z);
  return `matrix(${COS30},0.5,${-COS30},0.5,${tx.toFixed(2)},${ty.toFixed(2)})`;
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function slab(z) {
  const top = [P(0, 0, z), P(W, 0, z), P(W, D, z), P(0, D, z)];
  const right = [P(W, 0, z), P(W, D, z), P(W, D, z - T), P(W, 0, z - T)];
  const left = [P(0, D, z), P(W, D, z), P(W, D, z - T), P(0, D, z - T)];
  return `
  <polygon points="${left.map(pt).join(" ")}" fill="${FACE_L}"/>
  <polygon points="${right.map(pt).join(" ")}" fill="${FACE_R}"/>
  <polygon points="${top.map(pt).join(" ")}" fill="${RAISED}" stroke="${RULE}" stroke-width="1.5"/>`;
}

/** Plane label, in screen space to the left of the slab. */
function label(z, num, name, sub) {
  const [, y] = P(0, D, z);
  return `
  <text x="-306" y="${(y - 26).toFixed(1)}" font-family="ui-monospace,monospace" font-size="13" letter-spacing="1.6" fill="${BLUE}">${esc(num)} ${esc(name)}</text>
  <text x="-306" y="${(y - 8).toFixed(1)}" font-family="ui-sans-serif,system-ui" font-size="11.5" fill="${GRAPHITE}">${esc(sub)}</text>
  <line x1="-306" y1="${(y - 2).toFixed(1)}" x2="${(P(0, D, z)[0] - 14).toFixed(1)}" y2="${(y - 2).toFixed(1)}" stroke="${RULE}" stroke-width="1.5"/>`;
}

/** A box laid flat on a plane, at slot n of the diagonal row. */
function box(n, z, title, meta, accent = INK) {
  return `
  <g transform="${onPlane(26 + n * STEP, ROW_Y, z)}">
    <rect width="${CW}" height="${CH}" fill="${PAPER}" stroke="${accent}" stroke-width="1.3" rx="2"/>
    <text x="9" y="14" font-family="ui-sans-serif,system-ui" font-size="10.5" fill="${INK}">${esc(title)}</text>
    <text x="9" y="26" font-family="ui-monospace,monospace" font-size="8.5" fill="${GRAPHITE}">${esc(meta)}</text>
  </g>`;
}

/** Vertical drop between planes — a pure z change is vertical on screen. */
function drop(x, zFrom, zTo, text, colour = BLUE, at = 0.5) {
  const a = P(x, ARROW_Y, zFrom - T);
  const b = P(x, ARROW_Y, zTo);
  return `
  <line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${(b[1] - 7).toFixed(1)}"
        stroke="${colour}" stroke-width="1.8" marker-end="url(#head${colour === BLUE ? "" : "g"})"/>
  <text x="${(a[0] + 9).toFixed(1)}" y="${(a[1] + (b[1] - a[1]) * at).toFixed(1)}"
        font-family="ui-monospace,monospace" font-size="9.5" letter-spacing="0.4" fill="${colour}">${esc(text)}</text>`;
}

const Z = { trigger: GAP * 3, exec: GAP * 2, state: GAP, serve: 0 };

/* Bounds: title above plane ①, footer below plane ④'s front edge at (W+D)/2. */
const TOP = -Z.trigger - 120;
const BOTTOM = (W + D) / 2 + 110;
const H = BOTTOM - TOP;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-330 ${TOP} 1090 ${H}" width="1090" height="${H}" font-family="ui-sans-serif,system-ui">
  <defs>
    <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${BLUE}"/>
    </marker>
    <marker id="headg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${GRAPHITE}"/>
    </marker>
    <marker id="headr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${STAMP}"/>
    </marker>
  </defs>
  <rect x="-330" y="${TOP}" width="1090" height="${H}" fill="${PAPER}"/>

  <text x="-306" y="${TOP + 56}" font-family="ui-serif,Georgia,serif" font-size="30" fill="${INK}">TAAR — the four planes</text>
  <text x="-306" y="${TOP + 80}" font-family="ui-monospace,monospace" font-size="10.5" letter-spacing="1.3" fill="${GRAPHITE}">THE DEPLOYMENT SERVES THE FEED. IT IS NOT WHAT FILLS IT.</text>

  ${slab(Z.trigger)}
  ${label(Z.trigger, "①", "TRIGGER", "two schedulers, both always on")}
  ${box(0, Z.trigger, "GitHub Actions", "cron 9,39")}
  ${box(1, Z.trigger, "cron-job.org", "every 30 min")}
  ${box(2, Z.trigger, "either may stall", "other covers ~20 min", GRAPHITE)}

  ${drop(120, Z.trigger, Z.exec, "runs tick.ts on GitHub's own runner")}
  ${drop(410, Z.trigger, Z.serve + 116, "POST + bearer", GRAPHITE, 0.17)}

  ${slab(Z.exec)}
  ${label(Z.exec, "②", "EXECUTION", "lib/tick.ts — one cycle, from either trigger")}
  ${box(0, Z.exec, "discover → judge → file", "13 steps · 8 calls max", BLUE)}
  ${box(1, Z.exec, "Mongo lease, 8 min", "2nd arrival exits")}
  ${box(2, Z.exec, "roster by lastRunAt", "3 agents, rotating")}

  ${drop(96, Z.exec, Z.state, "read + write")}
  ${drop(300, Z.exec, Z.state, "recall / remember", GRAPHITE)}
  ${drop(470, Z.exec, Z.state, "fetch", GRAPHITE)}

  ${slab(Z.state)}
  ${label(Z.state, "③", "STATE · MEMORY · SOURCES", "what a cycle reads from and writes to")}
  ${box(0, Z.state, "MongoDB Atlas M0", "5 collections")}
  ${box(1, Z.state, "Breeth graph", "scoped per agent")}
  ${box(2, Z.state, "Groq 8b + 70b", "Gemini in reserve")}

  ${drop(120, Z.state, Z.serve, "read-only projection")}

  ${slab(Z.serve)}
  ${label(Z.serve, "④", "SERVING", "Vercel Hobby — serves, never drives")}
  ${box(0, Z.serve, "POST /api/agent/init", "persona → agentId")}
  ${box(1, Z.serve, "GET /api/agent/feed", "five fields, forever", BLUE)}
  ${box(2, Z.serve, "wire · newsroom", "server components")}

  <g transform="${onPlane(-190, 150, Z.serve)}">
    <rect width="140" height="34" fill="${PAPER}" stroke="${STAMP}" stroke-width="1.5" rx="2"/>
    <text x="9" y="14" font-family="ui-sans-serif,system-ui" font-size="10.5" fill="${INK}">Evaluator</text>
    <text x="9" y="26" font-family="ui-monospace,monospace" font-size="8.5" fill="${GRAPHITE}">init once, then polls</text>
  </g>
  <line x1="${P(-44, 162, Z.serve)[0].toFixed(1)}" y1="${P(-44, 162, Z.serve)[1].toFixed(1)}"
        x2="${P(18, 116, Z.serve)[0].toFixed(1)}" y2="${P(18, 116, Z.serve)[1].toFixed(1)}"
        stroke="${STAMP}" stroke-width="1.8" marker-end="url(#headr)"/>

  <text x="-306" y="${BOTTOM - 62}" font-family="ui-monospace,monospace" font-size="10.5" letter-spacing="0.8" fill="${GRAPHITE}">PLANE ① REACHES PLANE ③ BY TWO INDEPENDENT ROUTES — ONE THROUGH VERCEL, ONE AROUND IT.</text>
  <text x="-306" y="${BOTTOM - 44}" font-family="ui-monospace,monospace" font-size="10.5" letter-spacing="0.8" fill="${GRAPHITE}">EITHER PROVIDER CAN BE DOWN AND THE WIRE KEEPS FILING.</text>
</svg>
`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/architecture.svg", svg);
console.log(`docs/architecture.svg — ${(svg.length / 1024).toFixed(1)} KB · ${1090}×${H}`);
