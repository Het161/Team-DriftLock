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
 * Three numbers govern the layout, all learned by getting them wrong:
 *
 *   1. A plane's projected height is (W + D) / 2. The vertical gap between
 *      planes must exceed it or the slabs intersect.
 *
 *   2. A box's projected height is (w + h) / 2 — its WIDTH contributes. Boxes
 *      therefore tile along one diagonal row, where the x-step buys real
 *      vertical clearance, rather than stacking in rows.
 *
 *   3. Type is sized for the DISPLAYED width, not the SVG's own. A README
 *      column is about 900px, so an 1100px drawing renders at ~0.8 scale and
 *      10px type arrives as 8px — unreadable. Boxes are sized around 15px
 *      type here, not the other way round.
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
const W = 680; // narrower drawing = less downscaling in a README column
const D = 150; // shallow on purpose: a strip the boxes actually fill
const T = 16; // slab thickness
const GAP = 430; // > (W + D) / 2 = 415

const CW = 170; // box width, sized for 16px type
const CH = 50;
const STEP = 226; // 113 clearance > (170 + 50) / 2 = 110
const ROW_Y = 40;
const ARROW_Y = 118;
const GUTTER = 240; // left column for plane labels — every pixel here
// costs legibility, because it widens the drawing and so shrinks it on screen

const COS30 = Math.cos(Math.PI / 6);
const P = (x, y, z) => [(x - y) * COS30, (x + y) * 0.5 - z];
const pt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
const onPlane = (x, y, z) => {
  const [tx, ty] = P(x, y, z);
  return `matrix(${COS30},0.5,${-COS30},0.5,${tx.toFixed(2)},${ty.toFixed(2)})`;
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const Z = { trigger: GAP * 3, exec: GAP * 2, state: GAP, serve: 0 };

const TOP = -Z.trigger - 165;
const BOTTOM = (W + D) / 2 + 140;
const H = Math.round(BOTTOM - TOP);
const X0 = Math.round(-D * COS30 - GUTTER);
const VW = Math.round(W * COS30 - X0 + 70);
const LX = X0 + 26; // left text margin, shared by labels and captions

function slab(z) {
  const top = [P(0, 0, z), P(W, 0, z), P(W, D, z), P(0, D, z)];
  const right = [P(W, 0, z), P(W, D, z), P(W, D, z - T), P(W, 0, z - T)];
  const left = [P(0, D, z), P(W, D, z), P(W, D, z - T), P(0, D, z - T)];
  return `
  <polygon points="${left.map(pt).join(" ")}" fill="${FACE_L}"/>
  <polygon points="${right.map(pt).join(" ")}" fill="${FACE_R}"/>
  <polygon points="${top.map(pt).join(" ")}" fill="${RAISED}" stroke="${RULE}" stroke-width="1.6"/>`;
}

/**
 * Plane label, in screen space, aligned to the slab's vertical MIDDLE — so it
 * reads as belonging to the whole plane rather than to its nearest corner.
 */
function label(z, num, name, sub) {
  const mid = (P(0, 0, z)[1] + P(W, D, z)[1]) / 2;
  const edge = P(0, D / 2, z)[0];
  return `
  <text x="${LX}" y="${(mid - 12).toFixed(1)}" font-family="ui-monospace,monospace" font-size="19" letter-spacing="2" fill="${BLUE}">${esc(num)} ${esc(name)}</text>
  <text x="${LX}" y="${(mid + 12).toFixed(1)}" font-family="ui-sans-serif,system-ui" font-size="14.5" fill="${GRAPHITE}">${esc(sub)}</text>
  <line x1="${LX}" y1="${(mid + 26).toFixed(1)}" x2="${(edge - 18).toFixed(1)}" y2="${(mid + 26).toFixed(1)}" stroke="${RULE}" stroke-width="1.6"/>`;
}

function box(n, z, title, meta, accent = INK) {
  return `
  <g transform="${onPlane(28 + n * STEP, ROW_Y, z)}">
    <rect width="${CW}" height="${CH}" fill="${PAPER}" stroke="${accent}" stroke-width="1.6" rx="2"/>
    <text x="14" y="21" font-family="ui-sans-serif,system-ui" font-size="16" fill="${INK}">${esc(title)}</text>
    <text x="14" y="39" font-family="ui-monospace,monospace" font-size="13" fill="${GRAPHITE}">${esc(meta)}</text>
  </g>`;
}

function drop(x, zFrom, zTo, text, colour = BLUE, at = 0.5) {
  const a = P(x, ARROW_Y, zFrom - T);
  const b = P(x, ARROW_Y, zTo);
  return `
  <line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${(b[1] - 8).toFixed(1)}"
        stroke="${colour}" stroke-width="2" marker-end="url(#head${colour === BLUE ? "" : "g"})"/>
  <text x="${(a[0] + 12).toFixed(1)}" y="${(a[1] + (b[1] - a[1]) * at).toFixed(1)}"
        font-family="ui-monospace,monospace" font-size="13" letter-spacing="0.5" fill="${colour}">${esc(text)}</text>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X0} ${TOP} ${VW} ${H}" width="${VW}" height="${H}" font-family="ui-sans-serif,system-ui">
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
  <rect x="${X0}" y="${TOP}" width="${VW}" height="${H}" fill="${PAPER}"/>

  <text x="${LX}" y="${TOP + 66}" font-family="ui-serif,Georgia,serif" font-size="38" fill="${INK}">TAAR — the four planes</text>
  <text x="${LX}" y="${TOP + 96}" font-family="ui-monospace,monospace" font-size="13.5" letter-spacing="1.5" fill="${GRAPHITE}">THE DEPLOYMENT SERVES THE FEED. IT IS NOT WHAT FILLS IT.</text>

  ${slab(Z.trigger)}
  ${label(Z.trigger, "①", "TRIGGER", "two schedulers, both always on")}
  ${box(0, Z.trigger, "GitHub Actions", "cron 9,39 hourly")}
  ${box(1, Z.trigger, "cron-job.org", "every 30 minutes")}
  ${box(2, Z.trigger, "either may stall", "other covers, ~20 min", GRAPHITE)}

  ${drop(130, Z.trigger, Z.exec, "runs tick.ts on GitHub's runner")}
  ${drop(540, Z.trigger, Z.serve, "POST + bearer", GRAPHITE, 0.12)}

  ${slab(Z.exec)}
  ${label(Z.exec, "②", "EXECUTION", "lib/tick.ts — one cycle, from either trigger")}
  ${box(0, Z.exec, "discover → judge", "then file, or not", BLUE)}
  ${box(1, Z.exec, "Mongo lease, 8 min", "second arrival exits")}
  ${box(2, Z.exec, "roster by lastRunAt", "3 agents, rotating")}

  ${drop(104, Z.exec, Z.state, "read + write")}
  ${drop(330, Z.exec, Z.state, "recall / remember", GRAPHITE)}
  ${drop(600, Z.exec, Z.state, "fetch", GRAPHITE)}

  ${slab(Z.state)}
  ${label(Z.state, "③", "STATE", "Mongo, memory, models and the four sources")}
  ${box(0, Z.state, "MongoDB Atlas M0", "five collections")}
  ${box(1, Z.state, "Breeth graph", "scoped per agent")}
  ${box(2, Z.state, "Groq 8b + 70b", "Gemini in reserve")}

  ${drop(130, Z.state, Z.serve, "read-only projection")}

  ${slab(Z.serve)}
  ${label(Z.serve, "④", "SERVING", "Vercel Hobby — serves, never drives")}
  ${box(0, Z.serve, "POST /api/agent/init", "persona → agentId")}
  ${box(1, Z.serve, "GET /api/agent/feed", "five fields, forever", BLUE)}
  ${box(2, Z.serve, "wire · newsroom", "server components")}

  <g transform="${onPlane(-232, 104, Z.serve)}">
    <rect width="180" height="50" fill="${PAPER}" stroke="${STAMP}" stroke-width="1.8" rx="2"/>
    <text x="14" y="21" font-family="ui-sans-serif,system-ui" font-size="16" fill="${INK}">Evaluator</text>
    <text x="14" y="39" font-family="ui-monospace,monospace" font-size="13" fill="${GRAPHITE}">init once, then polls</text>
  </g>
  <line x1="${P(-42, 112, Z.serve)[0].toFixed(1)}" y1="${P(-42, 112, Z.serve)[1].toFixed(1)}"
        x2="${P(18, 72, Z.serve)[0].toFixed(1)}" y2="${P(18, 72, Z.serve)[1].toFixed(1)}"
        stroke="${STAMP}" stroke-width="2" marker-end="url(#headr)"/>

  <text x="${LX}" y="${BOTTOM - 74}" font-family="ui-monospace,monospace" font-size="13" letter-spacing="1" fill="${GRAPHITE}">PLANE ① REACHES PLANE ③ BY TWO INDEPENDENT ROUTES — ONE THROUGH VERCEL, ONE AROUND IT.</text>
  <text x="${LX}" y="${BOTTOM - 50}" font-family="ui-monospace,monospace" font-size="13" letter-spacing="1" fill="${GRAPHITE}">EITHER PROVIDER CAN BE DOWN AND THE WIRE KEEPS FILING.</text>
</svg>
`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/architecture.svg", svg);
console.log(`docs/architecture.svg — ${(svg.length / 1024).toFixed(1)} KB · ${VW}×${H}`);
