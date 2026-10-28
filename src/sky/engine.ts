// ASCII ink-wash landscape: layered mountains fading into mist, with flocks of birds crossing the sky.
// Click anywhere in the sky to steer the nearest flock there; it banks toward the point, then cruises on.

type Palette = {
  bg: string;
  muted: string;
  faint: string;
  wash: string;
  night: boolean; // dark theme: a moonlit sky with stars, and the birds have gone to roost
  tones: string[]; // bird tones, 0 = most prominent … 4 = least
  chars: string[]; // glyph colour drawn on top of each bird tone
  layers: string[]; // landscape colours, far → near, then trees
};

type Flock = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  cx: number; // where the flock would be cruising; during the entrance it is flown toward
  entry: number; // entrance progress: < 0 waiting off-screen, 0 → 1 climbing in, 1 cruising
  entryDur: number;
  ex0: number; // entrance start, below the bottom-left corner
  ey0: number;
  target: { x: number; y: number } | null; // a point in the sky the flock was sent toward
  steerTime: number;
  baseY: number;
  dir: 1 | -1;
  speed: number;
  seed: number;
  near: boolean;
  birds: Bird[];
};

type Bird = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ox: number; // slot in the formation
  oy: number;
  s: number; // body length in px
  alpha: number;
  toneShift: number;
  samples: number;
  fine: boolean;
  phase: number;
  freq: number;
  amp: number;
  e0: number; // resting wing elevation (dihedral while gliding)
  gliding: boolean;
  alt: number; // height gained or lost against the slot by the flap–glide cycle (px, + is lower)
  altRange: number;
  surge: number; // forward offset gained while gliding, spent while flapping
  face: 1 | -1;
  pitch: number;
  state: "flock" | "return";
  seed: number;
  startled: number;
};

/** A character grid that birds are rasterised into. Distant birds use a finer one. */
class Grid {
  cols: number;
  rows: number;
  cov: Float32Array;
  tone: Uint8Array;
  kind: Uint8Array; // 0 empty, 1 bird tile, 2 line glyph
  glyph: Uint8Array;
  alpha: Float32Array;
  constructor(
    public cell: number,
    w: number,
    h: number,
  ) {
    this.cols = Math.ceil(w / cell);
    this.rows = Math.ceil(h / cell);
    const n = this.cols * this.rows;
    this.cov = new Float32Array(n);
    this.tone = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.glyph = new Uint8Array(n);
    this.alpha = new Float32Array(n);
  }
  clear() {
    this.cov.fill(0);
    this.kind.fill(0);
  }
}

type Burst = { x: number; y: number; age: number; dur: number; r: number };
/** A piece of a bird silhouette in screen space: a polygon, or (when `poly` is null) a tapered capsule a→b. */
type Prim = { poly: number[] | null; ax: number; ay: number; bx: number; by: number; r0: number; r1: number; tone: number };

function inside(q: Prim, px: number, py: number) {
  if (q.poly) {
    // even–odd ray cast
    const p = q.poly;
    let hit = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      if (p[i + 1] > py !== p[j + 1] > py && px < ((p[j] - p[i]) * (py - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) hit = !hit;
    }
    return hit;
  }
  const dx = q.bx - q.ax;
  const dy = q.by - q.ay;
  const t = clamp(((px - q.ax) * dx + (py - q.ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  const ex = q.ax + dx * t - px;
  const ey = q.ay + dy * t - py;
  const rad = q.r0 + (q.r1 - q.r0) * t;
  return ex * ex + ey * ey <= rad * rad;
}

type Box = { left: number; top: number; right: number; bottom: number };
type Put = (c: number, r: number, ch: string, col: number, a: number) => void;

const SOLID = "SX%8";
const RAMP = " .,:;-~=+*x#%@";
const LINES = ["-", "\\", "|", "/"];
const TAU = Math.PI * 2;
const INTERACTIVE = "a, button, input, textarea, select, label, [data-no-seed]";
// Page content carries this attribute; birds fade as they pass beneath it.
const AVOID = "[data-sky-avoid]";
const DIM_UNDER_CONTENT = 0.22;
const STARTLE_SPEED = 1100; // px/s of pointer movement that spooks a nearby bird

// ---------------------------------------------------------------- noise & helpers

function hash2(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number) {
  return (
    vnoise(x, y) * 0.57 +
    vnoise(x * 2.03 + 17, y * 2.03 + 5) * 0.29 +
    vnoise(x * 4.1 + 31, y * 4.1 + 11) * 0.14
  );
}

/** Ridged 1D fractal noise: sharp crests, the jagged skyline of the far ranges. */
function ridged(x: number, seed: number) {
  let sum = 0;
  let amp = 0.55;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(vnoise(x * f, seed + i * 7.3) * 2 - 1);
    sum += n * n * amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / 1.03;
}

/** Ridged noise stretched to full contrast, so ranges rise to distinct summits. */
const peaks = (x: number, seed: number) => smoothstep(0.18, 0.78, ridged(x, seed));

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bump = (a: number, b: number, v: number) =>
  smoothstep(a, a + (b - a) * 0.3, v) * (1 - smoothstep(b - (b - a) * 0.3, b, v));

function lineChar(dx: number, dy: number) {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return 0;
  if (deg < 67.5) return 1;
  if (deg < 112.5) return 2;
  return 3;
}

/** Wingbeat: +1 wings up, -1 wings down. The downstroke is quicker than the recovery. */
function stroke(p: number) {
  p -= Math.floor(p);
  return p < 0.42 ? Math.cos((Math.PI * p) / 0.42) : -Math.cos((Math.PI * (p - 0.42)) / 0.58);
}

// ---------------------------------------------------------------- colour

function parseHex(hex: string) {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
}

function luminance(hex: string) {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim() || "#888888";
  const tones = [0, 1, 2, 3, 4].map((i) => v(`--t${i}`));
  const bg = v("--bg");
  const mtn = v("--mtn");
  return {
    bg,
    muted: v("--muted"),
    faint: v("--faint"),
    wash: v("--wash"),
    night: luminance(bg) < 0.35,
    tones,
    chars: tones.map((t) => mix(t, luminance(t) < 0.5 ? "#ffffff" : "#0b1226", 0.38)),
    // landscape far → near, trees, then the sun or moon
    layers: [...[0.4, 0.6, 0.78, 0.92, 1].map((k) => mix(bg, mtn, k)), v("--sun")],
  };
}

// ---------------------------------------------------------------- landscape

type Layer = { ridge: (x: number) => number; fade: number; color: number; mistFoot?: boolean };

/**
 * A range that starts low at the bottom-left and climbs toward the top-right, leaving the lower-left
 * open for the text. `rise` is the extra height reached at the right edge, `curve` how late the climb
 * begins; the result is the ridge height as a fraction of the viewport.
 */
function slope(x: number, rise: number, curve: number, seed: number, jag: number) {
  const n = 0.6 + 0.4 * peaks(x * jag + seed, seed);
  return 1.03 - (0.04 + rise * Math.pow(clamp(x, 0, 1), curve)) * n;
}

// Listed near → far.
const LAYERS: Layer[] = [
  { ridge: (x) => slope(x, 0.42, 2.2, 21, 5), fade: 0.5, color: 3, mistFoot: true },
  { ridge: (x) => slope(x, 0.56, 2, 11, 3.6), fade: 0.36, color: 2 },
  { ridge: (x) => slope(x, 0.7, 1.8, 3, 2.6), fade: 0.3, color: 1 },
  { ridge: (x) => slope(x, 0.78, 1.6, 7, 3), fade: 0.16, color: 0 },
];

// ---------------------------------------------------------------- engine

export class SkyEngine {
  private ctx: CanvasRenderingContext2D;
  private backdrop = document.createElement("canvas");
  private mist = document.createElement("canvas");
  private pal: Palette = readPalette();
  private font = "monospace";

  private w = 0;
  private h = 0;
  private dpr = 1;
  private cell = 12;
  private cols = 0;
  private rows = 0;

  private grid = new Grid(12, 0, 0);
  private fineGrid = new Grid(6, 0, 0);
  // landscape density per cell, so drifting mist only shows over open air
  private ground = new Float32Array(0);

  private flocks: Flock[] = [];
  private bursts: Burst[] = [];
  private avoid: Box[] = [];
  private stars: { c: number; r: number; phase: number; speed: number; bright: number }[] = [];
  private pointer = { x: 0, y: 0, speed: 0, active: false, time: 0 };

  private t = 0;
  private frameNo = 0;
  private last = 0;
  private raf = 0;
  private timeScale = 1;
  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.font = getComputedStyle(document.body).fontFamily || "monospace";
    this.timeScale = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.3 : 1;

    this.resize();
    this.spawnFlocks();

    const onResize = () => this.resize();
    // Clicks on empty sky steer the birds; controls and text selection are left alone.
    // composedPath() rather than target.closest(): a control that re-renders on click can leave the target detached.
    const onClick = (e: MouseEvent) => {
      if (e.composedPath().some((n) => n instanceof Element && n.matches(INTERACTIVE))) return;
      if (window.getSelection()?.toString()) return;
      this.steer(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      const p = this.pointer;
      const elapsed = Math.max(1, e.timeStamp - p.time) / 1000;
      const speed = Math.hypot(e.clientX - p.x, e.clientY - p.y) / elapsed;
      p.speed += (Math.min(speed, 5000) - p.speed) * 0.5;
      p.time = e.timeStamp;
      p.x = e.clientX;
      p.y = e.clientY;
      p.active = e.pointerType !== "touch";
    };
    const onLeave = () => {
      this.pointer.active = false;
      this.pointer.speed = 0;
    };
    const onTheme = () => {
      this.pal = readPalette();
      this.drawBackdrop();
    };
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const observer = new MutationObserver(onTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    window.addEventListener("resize", onResize);
    window.addEventListener("click", onClick);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    scheme.addEventListener("change", onTheme);
    document.fonts?.ready.then(() => this.drawBackdrop());

    this.cleanup.push(
      () => window.removeEventListener("resize", onResize),
      () => window.removeEventListener("click", onClick),
      () => window.removeEventListener("pointermove", onMove),
      () => document.documentElement.removeEventListener("pointerleave", onLeave),
      () => window.removeEventListener("blur", onLeave),
      () => scheme.removeEventListener("change", onTheme),
      () => observer.disconnect(),
    );
  }

  start() {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((fn) => fn());
  }

  // ------------------------------------------------------------ setup

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const prevW = this.w;
    this.w = w;
    this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cell = w < 640 ? 9 : w < 1200 ? 10 : 12;
    this.cols = Math.ceil(w / this.cell);
    this.rows = Math.ceil(h / this.cell);

    for (const c of [this.canvas, this.backdrop, this.mist]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }

    // birds are drawn on a grid finer than the text, so their silhouettes keep their shape
    this.grid = new Grid(this.cell / 2, w, h);
    this.fineGrid = new Grid(this.cell / 2, w, h);
    this.ground = new Float32Array(this.cols * this.rows);

    if (prevW && Math.abs(prevW - w) > 200) this.spawnFlocks();
    this.drawBackdrop();
    this.drawMist();
    this.measureContent();
    this.stars = Array.from({ length: Math.round(this.cols * this.rows * 0.006) }, () => ({
      c: Math.floor(Math.random() * this.cols),
      r: Math.floor(Math.pow(Math.random(), 1.4) * this.rows * 0.75),
      phase: rand(0, TAU),
      speed: rand(0.6, 2.2),
      bright: Math.random(),
    }));
  }

  private measureContent() {
    this.avoid = Array.from(document.querySelectorAll(AVOID), (el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b) => ({ left: b.left - 8, top: b.top - 4, right: b.right + 8, bottom: b.bottom + 4 }));
  }

  private prepare(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = `500 ${Math.round(this.cell * 0.78)}px ${this.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  private spawnFlocks() {
    const k = this.cell / 12;
    const small = this.w < 640;
    const make = (near: boolean, x: number): Flock => {
      const f: Flock = {
        x,
        y: 0,
        vx: 0,
        vy: 0,
        cx: 0,
        entry: 1,
        entryDur: 1,
        ex0: 0,
        ey0: 0,
        target: null,
        steerTime: 0,
        baseY: 0,
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 0,
        seed: rand(0, 100),
        near,
        birds: [],
      };
      const count = near ? (small ? 4 : 6) : small ? 6 : 10;
      for (let i = 0; i < count; i++) {
        f.birds.push({
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          ox: 0,
          oy: 0,
          s: (near ? rand(44, 52) : rand(26, 31)) * k,
          alpha: near ? 1 : 0.7,
          toneShift: near ? 0 : 1,
          samples: 2,
          fine: !near,
          phase: rand(0, 1),
          freq: (near ? 1.45 : 1.85) * rand(0.9, 1.1),
          amp: 1,
          e0: 0.12,
          gliding: Math.random() < 0.4,
          alt: 0,
          altRange: 0,
          surge: 0,
          face: 1,
          pitch: 0,
          state: "flock",
          seed: rand(0, 1000),
          startled: 0,
        });
      }
      this.formFlock(f, x);
      return f;
    };
    // the far flock is drawn first so the near one passes in front of it
    this.flocks = [make(false, this.w * 0.24), make(true, this.w * 0.42)];
    // on load both flocks rise in from below the bottom-left corner, the near one first
    this.flocks.forEach((f, i) => this.enterFromCorner(f, f.near ? 0.3 : 1.8, f.near ? 7 : 9 + i));
  }

  /** Park the flock below the bottom-left corner and fly it up into its cruising position. */
  private enterFromCorner(f: Flock, delay: number, dur: number) {
    const extentX = Math.max(...f.birds.map((b) => Math.abs(b.ox))) + f.birds[0].s * 2;
    const extentY = Math.max(...f.birds.map((b) => Math.abs(b.oy))) + f.birds[0].s * 2;
    f.dir = 1;
    f.entryDur = dur;
    f.entry = -delay / dur;
    f.ex0 = -extentX * 0.6;
    f.ey0 = this.h + extentY;
    f.x = f.ex0;
    f.y = f.ey0;
    for (const b of f.birds) {
      b.x = f.x + b.ox;
      b.y = f.y + b.oy;
      b.vx = f.speed;
      b.vy = -f.speed;
      b.face = 1;
      b.gliding = false;
    }
  }

  /** Lay the flock out in a loose, staggered cluster and park it at `x`. */
  private formFlock(f: Flock, x: number) {
    const n = f.birds.length;
    const s = f.birds[0].s;
    const rx = Math.sqrt(n) * s * (f.near ? 1.8 : 2.2);
    const ry = rx * 0.38;
    const slant = rand(-0.25, 0.25);
    const placed: [number, number][] = [];
    for (const b of f.birds) {
      let px = 0;
      let py = 0;
      for (let tries = 0; tries < 40; tries++) {
        px = rand(-rx, rx);
        py = rand(-ry, ry) + px * slant;
        if (placed.every(([qx, qy]) => Math.hypot(px - qx, py - qy) > s * 2.6)) break;
      }
      placed.push([px, py]);
      b.ox = px;
      b.oy = py;
    }

    f.speed = rand(82, 96) * (f.near ? 1 : 0.6) * (this.w < 640 ? 0.75 : 1);
    f.baseY = this.h * (f.near ? rand(0.12, 0.4) : rand(0.08, 0.3));
    f.x = x;
    f.cx = x;
    f.y = f.baseY;
    f.entry = 1;
    for (const b of f.birds) {
      b.x = f.x + b.ox;
      b.y = f.y + b.oy;
      b.vx = f.dir * f.speed;
      b.vy = 0;
      b.face = f.dir;
      b.pitch = 0;
      b.state = "flock";
      b.alt = rand(-0.4, 0.4) * b.s;
      b.altRange = rand(0.35, 0.6) * b.s;
      b.surge = 0;
    }
  }

  // ------------------------------------------------------------ landscape

  /** Static layer: mountains fading into mist, foreground trees, a pale sun. */
  private drawBackdrop() {
    const ctx = this.backdrop.getContext("2d")!;
    const { w, h, cell, cols, rows, pal } = this;
    this.prepare(ctx);
    ctx.clearRect(0, 0, w, h);

    const n = cols * rows;
    const chars: string[] = new Array(n).fill("");
    const color = new Uint8Array(n);
    const alpha = new Float32Array(n);
    const wash = new Float32Array(n); // soft tile behind the glyph
    this.ground.fill(0);
    const put: Put = (c, r, ch, col, a) => {
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      const i = r * cols + c;
      chars[i] = ch;
      color[i] = col;
      alpha[i] = a;
      wash[i] = 0;
      this.ground[i] = 1;
    };

    // ridge lines sampled once per column, in px
    const ridges = LAYERS.map((L) => Array.from({ length: cols + 2 }, (_, i) => L.ridge((i - 0.5) / cols) * h));

    for (let r = 0; r < rows; r++) {
      const y = r * cell + cell / 2;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        // the nearest layer whose ridge is above this cell owns it; its misty foot hides the ranges behind
        let li = -1;
        for (let l = 0; l < LAYERS.length; l++) {
          if (y >= ridges[l][c + 1]) {
            li = l;
            break;
          }
        }

        if (li < 0) continue;

        const L = LAYERS[li];
        const R = ridges[li];
        const ridgeY = R[c + 1];
        const slope = (R[c + 2] - R[c]) / (2 * cell); // screen dy/dx; < 0 on faces climbing to the right
        const ridgeRow = Math.floor(ridgeY / cell);
        // the crest itself, connected across steep columns
        const edgeTop = Math.floor(Math.min(ridgeY, (ridgeY + R[c]) / 2, (ridgeY + R[c + 2]) / 2) / cell);
        // (no crest where the hills sink into the bottom mist)
        if (r >= edgeTop && r <= ridgeRow && ridgeY < h * 0.9) {
          const peak = R[c] > ridgeY && R[c + 2] > ridgeY;
          chars[i] = peak ? "^" : Math.abs(slope) < 0.35 ? "_" : slope < 0 ? "/" : "\\";
          color[i] = L.color;
          alpha[i] = 0.95;
          wash[i] = 0.3;
          this.ground[i] = 1;
          continue;
        }

        const depth = (y - ridgeY) / (L.fade * h);
        // ink pools under the crest and thins into mist; light falls from the left
        // faces climbing to the right catch the light; the far side falls into shadow
        const shadow = clamp(0.5 + slope * 0.9, 0, 1);
        const strata = fbm(c * 0.2 + r * 0.05, r * 0.5 + li * 13);
        let v = Math.pow(1 - smoothstep(0, 1, depth), 1.1) * (0.55 + 0.45 * shadow) * (0.7 + 0.5 * strata);
        if (L.mistFoot) v *= 1 - 0.45 * smoothstep(h * 0.9, h, y);
        v = clamp(v, 0, 1);
        this.ground[i] = Math.max(v, depth < 1 ? 0.2 : 0);
        if (v < 0.04) continue;
        // a wash of ink under dense strokes, thinning into the mist below
        color[i] = L.color;
        wash[i] = v * 0.6;
        const n = hash2(c * 13 + li, r * 29);
        if (n > 0.3 + v * 1.1) continue;
        // rock striations follow the slope; elsewhere the glyph darkens with the ink
        chars[i] = v > 0.3 && hash2(c * 5, r * 3 + li) < 0.2 ? (slope < 0 ? "/" : "\\") : RAMP[clamp(Math.round(v * (RAMP.length - 1)), 1, RAMP.length - 1)];
        alpha[i] = 0.4 + 0.6 * v;
      }
    }

    // trees standing on the foreground hills
    const fg = ridges[0];
    const groundAt = (x: number) => fg[clamp(Math.floor(x / cell) + 1, 0, cols + 1)];
    const trees: [number, "pine" | "bare", number][] = [
      [0.7, "bare", 0.11],
      [0.83, "pine", 0.18],
      [0.88, "pine", 0.14],
      [0.95, "bare", 0.15],
    ]
    trees.forEach(([fx, kind, size], ti) => {
      const x = fx * w;
      const H = size * h;
      const base = groundAt(x) + cell;
      const rnd = mulberry(ti * 977 + 13);
      if (kind === "pine") this.drawPine(put, x, base, H, rnd);
      else this.drawBare(put, x, base, -Math.PI / 2 + (rnd() - 0.5) * 0.2, H * 0.36, 6, rnd);
    });

    for (let i = 0; i < n; i++) {
      const x = (i % cols) * cell;
      const y = ((i / cols) | 0) * cell;
      ctx.fillStyle = pal.layers[color[i]];
      if (wash[i] > 0) {
        ctx.globalAlpha = wash[i];
        ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
      if (!chars[i]) continue;
      ctx.globalAlpha = alpha[i];
      ctx.fillText(chars[i], x + cell / 2, y + cell / 2);
    }
    ctx.globalAlpha = 1;
  }

  private line(put: Put, x0: number, y0: number, x1: number, y1: number, a: number) {
    const { cell } = this;
    const g = LINES[lineChar(x1 - x0, y1 - y0)];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      put(Math.floor((x0 + ((x1 - x0) * s) / steps) / cell), Math.floor((y0 + ((y1 - y0) * s) / steps) / cell), g, 4, a);
    }
  }

  /** A pine: a leaning trunk carrying flat, layered tufts of needles. */
  private drawPine(put: Put, x: number, base: number, H: number, rnd: () => number) {
    const { cell } = this;
    const topX = x + (rnd() - 0.5) * 0.25 * H;
    this.line(put, x, base, topX, base - H, 0.9);
    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
      const k = t / (tiers - 1);
      const ty = base - H * (0.42 + 0.58 * k);
      const tx = x + (topX - x) * (0.42 + 0.58 * k) + (rnd() - 0.5) * H * 0.12;
      const rx = H * (0.26 - 0.15 * k) + cell;
      const ry = cell * (1.3 + rnd() * 0.6);
      for (let yy = ty - ry; yy <= ty + ry * 0.6; yy += cell) {
        for (let xx = tx - rx; xx <= tx + rx; xx += cell) {
          const d = ((xx - tx) / rx) ** 2 + ((yy - ty) / ry) ** 2;
          const c = Math.floor(xx / cell);
          const r = Math.floor(yy / cell);
          if (d > 1 || hash2(c * 3 + t, r * 5) > 0.85 - d * 0.4) continue;
          put(c, r, d < 0.35 ? "#" : d < 0.7 ? "*" : "^", 4, 0.85 - d * 0.3);
        }
      }
    }
  }

  /** A bare tree: recursive forking branches drawn as ink strokes. */
  private drawBare(put: Put, x: number, y: number, ang: number, len: number, depth: number, rnd: () => number) {
    const x1 = x + Math.cos(ang) * len;
    const y1 = y + Math.sin(ang) * len;
    this.line(put, x, y, x1, y1, 0.5 + depth * 0.08);
    if (depth === 0) {
      put(Math.floor(x1 / this.cell), Math.floor(y1 / this.cell), rnd() < 0.5 ? "." : ",", 4, 0.6);
      return;
    }
    const forks = rnd() < 0.3 ? 3 : 2;
    for (let i = 0; i < forks; i++) {
      const spread = (i / (forks - 1) - 0.5) * (0.9 + rnd() * 0.5);
      this.drawBare(put, x1, y1, ang + spread + (rnd() - 0.5) * 0.3, len * (0.66 + rnd() * 0.12), depth - 1, rnd);
    }
  }

  /** Thin streaks of cloud across the sky and mist pooling in the valley, refreshed a few times a second. */
  private drawMist() {
    const ctx = this.mist.getContext("2d")!;
    const { w, h, cell, cols, rows, pal, t } = this;
    // sampling noise further along x slides the pattern left; at night run it backwards so the clouds drift right
    const drift = pal.night ? -t : t;
    this.prepare(ctx);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = pal.wash;
    for (let r = 0; r < rows; r++) {
      const yf = (r * cell) / h;
      const sky = bump(0.02, 0.5, yf);
      const valley = bump(0.55, 1.02, yf);
      if (sky <= 0 && valley <= 0) continue;
      for (let c = 0; c < cols; c++) {
        if (this.ground[r * cols + c] > 0.3) continue;
        const x = c * cell + cell / 2;
        const y = r * cell + cell / 2;
        if (sky > 0) {
          // long, thin bands: stretched noise, kept only near its midline, broken up by a coverage field
          // the midline wanders, so each streak drifts up and down along its length
          const n = fbm(c * 0.014 + drift * 0.012, r * 0.3 + 3 + vnoise(c * 0.02, r * 0.1) * 0.6);
          const thin = 1 - Math.abs(n * 2 - 1) * 4.5;
          const cover = smoothstep(0.45, 0.68, fbm(c * 0.018 + drift * 0.008 + 40, r * 0.08));
          const k = clamp(thin, 0, 1) * cover * sky;
          if (k > 0.12 && hash2(c * 7, r * 11) < 0.35 + k) {
            ctx.globalAlpha = 0.2 + k * 0.4;
            ctx.fillText(k > 0.75 ? "~" : k > 0.45 ? "-" : ".", x, y);
            continue;
          }
        }
        if (valley > 0) {
          const n = fbm(c * 0.03 + drift * 0.03, r * 0.16 + 7);
          if (n < 0.56) continue;
          const k = clamp((n - 0.56) / 0.22, 0, 1) * valley;
          if (k < 0.08) continue;
          ctx.globalAlpha = k * 0.3;
          ctx.fillText(k > 0.6 ? "~" : k > 0.3 ? "-" : ".", x, y);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ interaction

  private steer(x: number, y: number) {
    if (this.pal.night) return; // the birds have gone to roost
    // the nearest flock answers
    let best = this.flocks[0];
    for (const f of this.flocks) {
      if (Math.hypot(f.x - x, f.y - y) < Math.hypot(best.x - x, best.y - y)) best = f;
    }
    best.entry = 1;
    best.target = { x, y };
    best.steerTime = 12;
    this.bursts.push({ x, y, age: 0, dur: 0.9, r: 40 });
  }

  // ------------------------------------------------------------ simulation

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000) * this.timeScale;
    this.last = now;
    this.t += dt;
    this.frameNo++;
    if (this.frameNo % 30 === 0) this.measureContent();
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const { w, h, pointer, t } = this;
    pointer.speed *= Math.exp(-dt * 8);

    for (const b of this.bursts) b.age += dt;
    this.bursts = this.bursts.filter((b) => b.age < b.dur);

    for (const f of this.flocks) {
      // the flock glides on at a steady speed, with a slow swell in altitude
      const swell = Math.sin(t * 0.13 + f.seed) * h * 0.03;
      const cruiseY = f.baseY + swell;
      if (f.entry < 1) {
        const px = f.x;
        const py = f.y;
        f.entry += dt / f.entryDur;
        if (f.entry > 0) {
          // climbing in: sweep across quickly at first, levelling off as it reaches cruising height
          f.cx += f.dir * f.speed * dt;
          const e = Math.min(1, f.entry);
          f.x = f.ex0 + (f.cx - f.ex0) * smoothstep(0, 1, Math.pow(e, 0.75));
          f.y = f.ey0 + (cruiseY - f.ey0) * smoothstep(0, 1, e);
        }
        if (dt > 0) {
          f.vx = (f.x - px) / dt;
          f.vy = (f.y - py) / dt;
        }
      } else {
        // the flock carries momentum: its velocity eases toward where it wants to go, so turns are wide arcs
        let wantX = f.dir * f.speed;
        let wantY = clamp((cruiseY - f.y) * 0.6, -f.speed * 0.4, f.speed * 0.4);
        if (f.target) {
          const dx = f.target.x - f.x;
          const dy = f.target.y - f.y;
          const d = Math.hypot(dx, dy) || 1;
          wantX = (dx / d) * f.speed * 1.35;
          wantY = (dy / d) * f.speed * 1.35;
          f.steerTime -= dt;
          // arrived (or gave up): carry on cruising at this height, in whichever direction it is now flying
          if (d < f.speed * 0.9 || f.steerTime <= 0) {
            f.baseY = clamp(f.y - swell, h * 0.06, h * 0.55);
            f.target = null;
          }
        }
        const k = Math.min(1, dt * 1.1);
        f.vx += (wantX - f.vx) * k;
        f.vy += (wantY - f.vy) * k;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (Math.abs(f.vx) > 15) f.dir = f.vx > 0 ? 1 : -1;
      }

      for (const b of f.birds) this.updateBird(b, f, dt);

      // once it has crossed, it re-enters from a random side at a new height
      const busy = !!f.target || f.birds.some((b) => b.state !== "flock");
      const gone = f.birds.every((b) => (f.dir > 0 ? b.x - b.s * 2 > w : b.x + b.s * 2 < 0));
      if (gone && !busy) {
        f.dir = Math.random() < 0.5 ? 1 : -1;
        const extent = Math.max(...f.birds.map((b) => Math.abs(b.ox))) + f.birds[0].s * 2;
        const delay = rand(0, 6) * f.speed;
        this.formFlock(f, f.dir > 0 ? -extent - delay : w + extent + delay);
      }
    }
  }

  private updateBird(b: Bird, f: Flock, dt: number) {
    const { pointer, t } = this;
    const fvx = f.vx;
    // climbing in, or flying to a clicked point: steady wingbeats, no gliding
    const entering = f.entry < 1 || !!f.target;

    // Flap–glide flight, as large birds actually fly: a run of wingbeats climbs and spends a little speed,
    // then a glide on held wings trades that height back for speed, and the cycle repeats.
    let altRate = 0;
    let surgeRate = 0;
    if (entering) b.gliding = false; // a steady climb on beating wings
    if (b.state === "flock" && !entering) {
      if (b.gliding) {
        altRate = b.s * 0.28;
        surgeRate = f.speed * 0.06;
        if (b.alt > b.altRange) {
          b.gliding = false;
          b.phase = 0.88; // pick the beat up from the top of the stroke
          b.altRange = rand(0.35, 0.6) * b.s;
        }
      } else {
        altRate = -b.s * 0.42 * b.amp;
        surgeRate = -f.speed * 0.04;
        if (b.alt < -b.altRange) b.gliding = true;
      }
      b.alt += altRate * dt;
      b.surge = clamp(b.surge + surgeRate * dt, -b.s, b.s);
    }

    // each bird holds its slot, with a slow drift so the formation breathes; every downstroke shoves it forward
    const thrust = b.s * 0.05 * b.amp * Math.sin(TAU * b.phase);
    const tx = f.x + b.ox + f.dir * (b.surge + thrust) + (vnoise(t * 0.08 + b.seed, 1) - 0.5) * b.s * 0.6;
    const ty = f.y + b.oy + b.alt + (vnoise(t * 0.07 + b.seed, 7) - 0.5) * b.s * 0.4;

    // stiff, critically damped tracking of the slot and its velocity, so the bird carries the
    // flight cycle's momentum instead of drifting after its target
    const k = b.state === "return" ? 1.2 : 6;
    const c = 2 * Math.sqrt(k);
    const ax = k * (tx - b.x) + c * (fvx + f.dir * surgeRate - b.vx);
    const ay = k * (ty - b.y) + c * (f.vy + altRate - b.vy);
    if (b.state === "return" && Math.hypot(tx - b.x, ty - b.y) < b.s) {
      b.state = "flock";
      b.alt = b.y - (f.y + b.oy);
      b.surge = 0;
    }

    // a quick swipe of the cursor close by startles a bird out of line for a moment
    b.startled = Math.max(0, b.startled - dt);
    const pd = Math.hypot(pointer.x - b.x, pointer.y - b.y);
    if (pointer.active && !b.startled && pointer.speed > STARTLE_SPEED && pd < b.s * 3) {
      b.vx += ((b.x - pointer.x) / (pd || 1)) * 160;
      b.vy += ((b.y - pointer.y) / (pd || 1)) * 160;
      b.startled = 1.2;
      b.state = "return";
    }

    b.vx += ax * dt;
    b.vy += ay * dt;
    const max = f.speed * 3 + 160;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > max) {
      b.vx *= max / sp;
      b.vy *= max / sp;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.vx > 25) b.face = 1;
    else if (b.vx < -25) b.face = -1;
    // nose up while climbing on wingbeats, a touch down through the glide
    const pitch = clamp(Math.atan2(-b.vy, Math.abs(b.vx)) * 1.3, -0.7, 0.7);
    b.pitch += (pitch - b.pitch) * Math.min(1, dt * 3);

    // wingbeat: held out flat with a slight dihedral when gliding; hard beats to catch back up after a scare
    let ampTarget = 1;
    let e0 = 0.08;
    let freq = b.freq;
    if (b.state === "flock") {
      if (b.gliding) {
        ampTarget = 0;
        e0 = 0.16;
      } else if (entering) freq *= 1.15;
    } else {
      freq *= 1.3;
    }
    b.amp += (ampTarget - b.amp) * Math.min(1, dt * 4);
    b.e0 += (e0 - b.e0) * Math.min(1, dt * 3);
    if (b.amp > 0.03) b.phase += freq * dt;
  }

  // ------------------------------------------------------------ rendering

  private render() {
    const { ctx, w, h, cell, cols, rows, pal } = this;
    this.prepare(ctx);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.backdrop, 0, 0, w, h);
    if (this.frameNo % 5 === 0) this.drawMist();
    this.drawCelestial();
    ctx.drawImage(this.mist, 0, 0, w, h);
    this.prepare(ctx);

    // distant birds on the fine grid first, so the near flock passes in front
    this.fineGrid.clear();
    this.grid.clear();
    if (pal.night) this.drawStars();
    else for (const f of this.flocks) for (const b of f.birds) this.rasterBird(b, b.fine ? this.fineGrid : this.grid);
    this.drawGrid(this.fineGrid, false);
    this.drawGrid(this.grid, false);

    // bursts: an expanding ring of dots where the sky was clicked
    ctx.fillStyle = pal.tones[2];
    for (const b of this.bursts) {
      const p = b.age / b.dur;
      const rad = b.r * (1 - Math.pow(1 - p, 3));
      ctx.globalAlpha = (1 - p) * 0.8;
      const n = Math.max(6, Math.ceil((TAU * rad) / (cell * 0.9)));
      const seen = new Set<number>();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const c = Math.floor((b.x + Math.cos(a) * rad) / cell);
        const r = Math.floor((b.y + Math.sin(a) * rad) / cell);
        if (c < 0 || r < 0 || c >= cols || r >= rows || seen.has(r * cols + c)) continue;
        seen.add(r * cols + c);
        ctx.fillText("·", c * cell + cell / 2, r * cell + cell / 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private get celestial() {
    return { x: this.w * 0.28, y: this.h * 0.17, R: clamp(Math.min(this.w, this.h) * 0.07, 34, 80) };
  }

  /**
   * By day, a sun: a pale disc with a crisp rim, inner rings and a bright core.
   * By night, a crescent moon: the lit sliver left outside an offset shadow disc, mottled with craters.
   */
  private drawCelestial() {
    const { ctx, cell, cols, rows, pal, t } = this;
    const { x: cx, y: cy, R } = this.celestial;
    const reach = R * 1.5;
    const c0 = Math.max(0, Math.floor((cx - reach) / cell));
    const c1 = Math.min(cols - 1, Math.floor((cx + reach) / cell));
    const r0 = Math.max(0, Math.floor((cy - reach) / cell));
    const r1 = Math.min(rows - 1, Math.floor((cy + reach) / cell));
    const rim = (cell * 0.55) / R;
    const tile = (x: number, y: number, color: string, a: number) => {
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    };
    const glyph = (ch: string, x: number, y: number, color: string, a: number) => {
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.fillText(ch, x + cell / 2, y + cell / 2);
    };

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * cell;
        const y = r * cell;
        const dx = x + cell / 2 - cx;
        const dy = y + cell / 2 - cy;
        const d = Math.hypot(dx, dy) / R;

        if (pal.night) {
          // shadow disc offset toward the upper right leaves a crescent facing lower left
          const sx = dx / R - 0.42;
          const sy = dy / R + 0.2;
          const inShadow = Math.hypot(sx, sy) < 0.9;
          if (d < 1 && !inShadow) {
            const edge = Math.min(1 - d, Math.hypot(sx, sy) - 0.9);
            const crater = smoothstep(0.5, 0.68, fbm(c * 0.45 + 5, r * 0.45 + 9));
            const v = clamp(0.55 + edge * 3 - crater * 0.45, 0.2, 1);
            tile(x, y, pal.layers[5], 0.25 + 0.45 * v);
            const ch = Math.abs(d - 1) < rim ? LINES[lineChar(-dy, dx)] : crater > 0.5 ? "o" : v > 0.8 ? "@" : v > 0.6 ? "%" : "*";
            glyph(ch, x, y, pal.bg, 0.55 + 0.35 * v);
          } else if (d >= 1 && d < 1.5 && Math.hypot(sx, sy) > 1) {
            const glow = 1 - (d - 1) / 0.5;
            if (hash2(c * 7, r * 13) < glow * 0.5) glyph(glow > 0.6 ? ":" : ".", x, y, pal.layers[5], 0.15 + 0.35 * glow);
          }
          continue;
        }

        if (d < 1 + rim) {
          tile(x, y, pal.layers[5], 0.1 + 0.16 * (1 - d * d));
          if (Math.abs(d - 1) < rim) glyph(LINES[lineChar(-dy, dx)], x, y, pal.tones[1], 0.9);
          else if (d < 0.2) glyph(d < 0.1 ? "@" : "#", x, y, pal.tones[1], 0.85);
          else if (Math.abs(d - 0.72) < rim * 0.8) glyph(hash2(c, r) < 0.7 ? "o" : ".", x, y, pal.tones[2], 0.7);
          else if (Math.abs(d - 0.45) < rim * 0.8) glyph(":", x, y, pal.tones[2], 0.6);
          else {
            // granulation that shimmers slowly across the face
            const n = vnoise(c * 0.8 + t * 0.4, r * 0.8 - t * 0.3);
            if (n > 0.55) glyph(n > 0.75 ? "*" : ".", x, y, pal.tones[2], 0.35 + 0.4 * (n - 0.55));
          }
          continue;
        }

        // a soft halo just outside the rim
        if (d < 1.12 && hash2(c * 7, r * 13) < 0.5) {
          glyph(".", x, y, pal.tones[2], 0.35);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Stars over open sky, each twinkling at its own pace. */
  private drawStars() {
    const { ctx, cell, cols, pal, t } = this;
    ctx.fillStyle = pal.layers[5];
    for (const s of this.stars) {
      if (this.ground[s.r * cols + s.c] > 0.1) continue;
      const m = this.celestial;
      if (Math.hypot(s.c * cell - m.x, s.r * cell - m.y) < m.R * 1.6) continue;
      const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      ctx.globalAlpha = (0.2 + 0.6 * s.bright) * (0.35 + 0.65 * tw);
      ctx.fillText(s.bright > 0.9 ? "*" : s.bright > 0.65 ? "+" : ".", s.c * cell + cell / 2, s.r * cell + cell / 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawGrid(g: Grid, glyphs: boolean) {
    const { ctx, pal } = this;
    const { cell, cols, rows } = g;

    // birds fade as they pass beneath text
    for (const box of this.avoid) {
      const c0 = Math.max(0, Math.floor(box.left / cell));
      const c1 = Math.min(cols - 1, Math.floor(box.right / cell));
      const r0 = Math.max(0, Math.floor(box.top / cell));
      const r1 = Math.min(rows - 1, Math.floor(box.bottom / cell));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) g.alpha[r * cols + c] *= DIM_UNDER_CONTENT;
      }
    }

    const tick = Math.floor(this.t * 2);
    const gap = glyphs ? (cell > 10 ? 1.5 : 1) : 0.75;
    for (let i = 0; i < g.kind.length; i++) {
      const k = g.kind[i];
      if (!k) continue;
      const c = i % cols;
      const r = (i / cols) | 0;
      const x = c * cell;
      const y = r * cell;
      ctx.globalAlpha = g.alpha[i];
      if (k === 1) {
        const v = g.cov[i];
        if (v >= 0.45) {
          const t = g.tone[i];
          ctx.fillStyle = pal.tones[t];
          ctx.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
          if (!glyphs) continue;
          ctx.fillStyle = pal.chars[t];
          ctx.fillText(SOLID[Math.floor(hash2(c + tick * 7, r) * 4)], x + cell / 2, y + cell / 2 + 0.5);
        } else if (glyphs) {
          ctx.fillStyle = pal.faint;
          ctx.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
          ctx.fillStyle = pal.muted;
          ctx.fillText(v < 0.3 ? "." : ":", x + cell / 2, y + cell / 2);
        } else {
          ctx.globalAlpha *= 0.4;
          ctx.fillStyle = pal.tones[g.tone[i]];
          ctx.fillRect(x + gap / 2, y + gap / 2, cell - gap, cell - gap);
        }
      } else {
        ctx.fillStyle = pal.tones[1];
        ctx.fillText(LINES[g.glyph[i]], x + cell / 2, y + cell / 2);
      }
    }
  }

  /**
   * Build a bird in profile, as a dove-like silhouette: a rounded body, small head and beak, a fanned
   * tail, and broad wings that taper to a pointed, swept-back tip. Wings are modelled in 3D (forward X,
   * toward viewer Y, up Z) with the hand lagging the arm and folding in on the upstroke, then projected
   * with a slight three-quarter turn so both wings read through the beat. Shapes are listed back to front.
   */
  private buildBird(b: Bird): Prim[] {
    const s = b.s;
    const fx = b.face * Math.cos(b.pitch);
    const fy = -Math.sin(b.pitch);
    const nx = -b.face * Math.sin(b.pitch);
    const ny = -Math.cos(b.pitch);
    // the body lifts on the downstroke
    const bob = -0.07 * s * b.amp * stroke(b.phase);
    const ox = b.x + nx * bob;
    const oy = b.y + ny * bob;
    const sx = (u: number, w: number) => ox + (u * fx + w * nx) * s;
    const sy = (u: number, w: number) => oy + (u * fy + w * ny) * s;
    const prims: Prim[] = [];
    const cap = (u0: number, w0: number, u1: number, w1: number, r0: number, r1: number, tone: number) =>
      prims.push({ poly: null, ax: sx(u0, w0), ay: sy(u0, w0), bx: sx(u1, w1), by: sy(u1, w1), r0: r0 * s, r1: r1 * s, tone });
    const poly = (pts: number[], tone: number) => {
      const out: number[] = [];
      for (let i = 0; i < pts.length; i += 2) out.push(sx(pts[i], pts[i + 1]), sy(pts[i], pts[i + 1]));
      prims.push({ poly: out, ax: 0, ay: 0, bx: 0, by: 0, r0: 0, r1: 0, tone });
    };

    const p = b.phase - Math.floor(b.phase);
    const e = b.e0 + 0.95 * b.amp * stroke(p);
    const eh = b.e0 + 1.1 * b.amp * stroke(p - 0.1);
    // on the upstroke the hand folds in toward the body, then flings out for the next downstroke
    const fold = 1 - 0.3 * b.amp * (p > 0.42 ? Math.sin((Math.PI * (p - 0.42)) / 0.58) : 0);
    const project = (X: number, Y: number) => X + Y * 0.3;
    const wing = (side: number, scale: number, tone: number) => {
      const La = 0.5 * scale;
      const Lh = 0.72 * scale * fold;
      const su = 0.06;
      const sw = 0.07;
      const eu = su + project(-0.12, side * Math.cos(e)) * La;
      const ew = sw + Math.sin(e) * La;
      const hu = project(-0.38, side * Math.cos(eh)) * Lh;
      const hw = Math.sin(eh) * Lh;
      const tu = eu + hu;
      const tw = ew + hw;
      // leading edge shoulder → wrist → tip, then the trailing edge back along the chord to the root
      poly([su, sw, eu, ew, tu, tw, eu - 0.36 * scale, ew - (ew - sw) * 0.15, -0.22, 0.05], tone);
    };

    wing(-1, 0.85, 1); // far wing, behind the body
    poly([-0.22, 0.05, -0.62, 0.09, -0.66, -0.04, -0.22, -0.05], 0); // fanned tail
    cap(-0.28, 0.01, 0.16, 0.03, 0.07, 0.14, 0); // body, round at the breast
    cap(0.16, 0.03, 0.32, 0.08, 0.12, 0.085, 0); // neck
    cap(0.32, 0.08, 0.35, 0.085, 0.095, 0.095, 0); // head
    cap(0.43, 0.08, 0.51, 0.065, 0.03, 0.01, 0); // beak
    wing(1, 1, 0); // near wing
    return prims;
  }

  private rasterBird(b: Bird, g: Grid) {
    const { cell, cols, rows } = g;
    const prims = this.buildBird(b);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const q of prims) {
      if (q.poly) {
        for (let i = 0; i < q.poly.length; i += 2) {
          minX = Math.min(minX, q.poly[i]);
          maxX = Math.max(maxX, q.poly[i]);
          minY = Math.min(minY, q.poly[i + 1]);
          maxY = Math.max(maxY, q.poly[i + 1]);
        }
      } else {
        const r = Math.max(q.r0, q.r1);
        minX = Math.min(minX, q.ax - r, q.bx - r);
        maxX = Math.max(maxX, q.ax + r, q.bx + r);
        minY = Math.min(minY, q.ay - r, q.by - r);
        maxY = Math.max(maxY, q.ay + r, q.by + r);
      }
    }
    const c0 = Math.max(0, Math.floor(minX / cell));
    const c1 = Math.min(cols - 1, Math.floor(maxX / cell));
    const r0 = Math.max(0, Math.floor(minY / cell));
    const r1 = Math.min(rows - 1, Math.floor(maxY / cell));
    const k = b.samples;
    const total = k * k;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        let hits = 0;
        let toneSum = 0;
        for (let sy = 0; sy < k; sy++) {
          for (let sx = 0; sx < k; sx++) {
            const px = (c + (sx + 0.5) / k) * cell;
            const py = (r + (sy + 0.5) / k) * cell;
            // frontmost shape wins
            for (let i = prims.length - 1; i >= 0; i--) {
              if (inside(prims[i], px, py)) {
                hits++;
                toneSum += prims[i].tone;
                break;
              }
            }
          }
        }
        const cov = hits / total;
        if (cov < 0.2) continue;
        const i = r * cols + c;
        if (cov >= 0.45 || g.cov[i] < 0.45) {
          g.cov[i] = cov;
          g.kind[i] = 1;
          g.tone[i] = Math.min(4, Math.round(toneSum / hits) + b.toneShift);
          g.alpha[i] = b.alpha;
        }
      }
    }
  }
}
