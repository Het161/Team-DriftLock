/**
 * Generates docs/build-timeline.svg — an isometric column chart of the build.
 *
 *   node scripts/gen-timeline.mjs
 *
 * Column height is the number of things that broke in that session, counted
 * from PROMPTS.md itself rather than typed in by hand — so the chart cannot
 * drift away from the log it illustrates. Re-run it after editing an entry.
 *
 * The geometry lesson from gen-architecture.mjs applies here too: a box's
 * projected height is (w + d) / 2, so columns 54 wide standing 90 apart clear
 * each other by 45px against a 54px footprint. They overlap slightly, which is
 * correct — they are solids in a row, and drawing them in increasing x order
 * makes the near ones occlude the far ones exactly as they should.
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";

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
const BLUE_R = "#3A55CF";
const BLUE_L = "#1E35A4";
const STAMP_R = "#D24E36";
const STAMP_L = "#A32E18";

/* Read the real numbers out of the log ------------------------------------ */
/** Ground labels shear into each other, so they have to stay short. */
const SHORT = {
  "001": "Brief",
  "002": "Live",
  "003": "The tick",
  "004": "Pages",
  "005": "Schedulers",
  "006": "The silence",
  "007": "Providers",
  "008": "Lockdown",
};

function readSessions() {
  const t = readFileSync("PROMPTS.md", "utf8");
  const parts = t.split(/^## (00\d) · (.+)$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 3) {
    const broke = parts[i + 2].split(/^### What broke$/m)[1] ?? "";
    out.push({
      id: parts[i],
      title: SHORT[parts[i]] ?? parts[i + 1],
      broke: (broke.match(/^\*\*/gm) ?? []).length,
    });
  }
  return out;
}

/* Geometry ---------------------------------------------------------------- */
const COS30 = Math.cos(Math.PI / 6);
const P = (x, y, z) => [(x - y) * COS30, (x + y) * 0.5 - z];
const pt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
const onPlane = (x, y, z) => {
  const [tx, ty] = P(x, y, z);
  return `matrix(${COS30},0.5,${-COS30},0.5,${tx.toFixed(2)},${ty.toFixed(2)})`;
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CW = 54; // column footprint
const STEP = 92; // x spacing — 46 clearance, columns deliberately touch a little
const UNIT = 25; // pixels of height per correction
const PAD = 40; // margin inside the ground plane
const CY = 34; // column y offset on the plane

const sessions = readSessions();
const GW = PAD * 2 + (sessions.length - 1) * STEP + CW;
const GD = 150;

function ground() {
  const top = [P(0, 0, 0), P(GW, 0, 0), P(GW, GD, 0), P(0, GD, 0)];
  const right = [P(GW, 0, 0), P(GW, GD, 0), P(GW, GD, -12), P(GW, 0, -12)];
  const left = [P(0, GD, 0), P(GW, GD, 0), P(GW, GD, -12), P(0, GD, -12)];
  return `
  <polygon points="${left.map(pt).join(" ")}" fill="${FACE_L}"/>
  <polygon points="${right.map(pt).join(" ")}" fill="${FACE_R}"/>
  <polygon points="${top.map(pt).join(" ")}" fill="${RAISED}" stroke="${RULE}" stroke-width="1.5"/>`;
}

function column(i, s) {
  const x = PAD + i * STEP;
  const y = CY;
  const h = s.broke * UNIT;
  // 006 is the outage where every check stayed green. stamp-red is reserved for
  // spikes and genuine urgency; a nine-hour silent failure qualifies.
  const hot = s.id === "006";
  const [fT, fR, fL] = hot
    ? [STAMP, STAMP_R, STAMP_L]
    : s.broke >= 8
      ? [BLUE, BLUE_R, BLUE_L]
      : [RAISED, FACE_R, FACE_L];
  const onDark = hot || s.broke >= 8;

  const top = [P(x, y, h), P(x + CW, y, h), P(x + CW, y + CW, h), P(x, y + CW, h)];
  const right = [P(x + CW, y, h), P(x + CW, y + CW, h), P(x + CW, y + CW, 0), P(x + CW, y, 0)];
  const left = [P(x, y + CW, h), P(x + CW, y + CW, h), P(x + CW, y + CW, 0), P(x, y + CW, 0)];

  return `
  <polygon points="${left.map(pt).join(" ")}" fill="${fL}"/>
  <polygon points="${right.map(pt).join(" ")}" fill="${fR}"/>
  <polygon points="${top.map(pt).join(" ")}" fill="${fT}" stroke="${onDark ? fT : RULE}" stroke-width="1.2"/>
  <g transform="${onPlane(x + 13, y + 34, h)}">
    <text font-family="ui-monospace,monospace" font-size="22" fill="${onDark ? PAPER : INK}">${s.broke}</text>
  </g>
  <g transform="${onPlane(x - 2, y + CW + (i % 2 ? 46 : 18), 0)}">
    <text font-family="ui-monospace,monospace" font-size="14" letter-spacing="1" fill="${BLUE}">${esc(s.id)}</text>
    <text y="18" font-family="ui-sans-serif,system-ui" font-size="13.5" fill="${GRAPHITE}">${esc(s.title)}</text>
  </g>`;
}

/* Bounds ------------------------------------------------------------------ */
// The tallest column is not the highest on screen: position pushes columns
// down as x grows, so measure every top face and take the real minimum.
const topY = sessions.map((s, i) => (PAD + i * STEP + CY) * 0.5 - s.broke * UNIT);
const X0 = -GD * COS30 - 60;
const X1 = GW * COS30 + 150;
const Y0 = Math.min(...topY) - 130;
const Y1 = (GW + GD) / 2 + 60;
const VW = X1 - X0;
const VH = Y1 - Y0;
const total = sessions.reduce((a, s) => a + s.broke, 0);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X0.toFixed(0)} ${Y0.toFixed(0)} ${VW.toFixed(0)} ${VH.toFixed(0)}" width="${VW.toFixed(0)}" height="${VH.toFixed(0)}" font-family="ui-sans-serif,system-ui">
  <rect x="${X0.toFixed(0)}" y="${Y0.toFixed(0)}" width="${VW.toFixed(0)}" height="${VH.toFixed(0)}" fill="${PAPER}"/>

  <text x="${(X0 + 30).toFixed(0)}" y="${(Y0 + 52).toFixed(0)}" font-family="ui-serif,Georgia,serif" font-size="34" fill="${INK}">What broke, per session</text>
  <text x="${(X0 + 30).toFixed(0)}" y="${(Y0 + 76).toFixed(0)}" font-family="ui-monospace,monospace" font-size="13" letter-spacing="1.4" fill="${GRAPHITE}">${total} CORRECTIONS ACROSS ${sessions.length} SESSIONS · COUNTED FROM THIS FILE, NOT ESTIMATED</text>

  ${ground()}
  ${sessions.map((s, i) => column(i, s)).join("\n")}

  <g transform="translate(${(X0 + 30).toFixed(0)}, ${(Y1 - 44).toFixed(0)})">
    <rect width="13" height="13" fill="${STAMP}"/>
    <text x="20" y="11" font-family="ui-sans-serif,system-ui" font-size="14" fill="${INK}">006 — the outage where every check stayed green</text>
    <rect y="20" width="13" height="13" fill="${BLUE}"/>
    <text x="20" y="31" font-family="ui-sans-serif,system-ui" font-size="14" fill="${INK}">sessions where eight or more things broke at once</text>
  </g>
</svg>
`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/build-timeline.svg", svg);
console.log(
  `docs/build-timeline.svg — ${(svg.length / 1024).toFixed(1)} KB · ${VW.toFixed(0)}×${VH.toFixed(0)} · ${total} corrections`,
);
