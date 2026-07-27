/**
 * textures.js — every texture in the scene is drawn procedurally on a 2D canvas
 * so the project has zero binary assets and runs offline.
 *
 * All factories are memoised: calling `floorEpoxy()` twice returns the very same
 * THREE.Texture. Pass `{repeat:[u,v]}` where offered rather than mutating a
 * shared texture's `.repeat` — mutating it would affect every user.
 */
import * as THREE from 'three';
import { PAL } from './config.js';
import { makeRng } from './utils.js';

const _cache = new Map();
function memo(key, make) {
  let t = _cache.get(key);
  if (!t) {
    t = make();
    _cache.set(key, t);
  }
  return t;
}

/** Global anisotropy, set once by main.js after the renderer exists. */
export const TexOpts = { anisotropy: 8 };

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, x: c.getContext('2d') };
}

function toTex(c, { repeat = [1, 1], srgb = true, wrap = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = TexOpts.anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Tint a hex colour by a multiplicative factor, returning a css string. */
function shade(n, f, a = 1) {
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

// ────────────────────────────────────────────────────────────────────────────
// Noise helpers
// ────────────────────────────────────────────────────────────────────────────

/** Soft blotchy value-noise painted with radial gradients. Seamless-ish. */
function blotches(ctx, w, h, rng, { count = 90, rMin = 20, rMax = 90, colors, alpha = 0.09 }) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = rMin + rng() * (rMax - rMin);
    const col = colors[Math.floor(rng() * colors.length)];
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, col.replace(/[\d.]+\)$/, `${alpha})`));
      g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Fine grain speckle. */
function grain(ctx, w, h, rng, amount = 10, alpha = 0.05) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount * 2;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  if (alpha > 0) {
    ctx.globalAlpha = 1;
  }
}

/** Branching crack network — the epoxy floor in the photo is finely crazed. */
function cracks(ctx, w, h, rng, { count = 26, len = 260, width = 1.1, color = 'rgba(70,90,74,0.35)' }) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rng() * w;
    let y = rng() * h;
    let a = rng() * Math.PI * 2;
    const branches = [[x, y, a, len * (0.5 + rng())]];
    while (branches.length) {
      const [bx, by, ba, blen] = branches.pop();
      x = bx; y = by; a = ba;
      ctx.lineWidth = width * (0.5 + rng() * 0.8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      let travelled = 0;
      while (travelled < blen) {
        const step = 6 + rng() * 14;
        a += (rng() - 0.5) * 0.5;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        ctx.lineTo(x, y);
        travelled += step;
        if (rng() < 0.05 && branches.length < 40) {
          branches.push([x, y, a + (rng() - 0.5) * 1.6, blen * 0.4]);
        }
      }
      ctx.stroke();
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Floor
// ────────────────────────────────────────────────────────────────────────────

/** Green epoxy deck: mottled colour + crack crazing. 4 m tile. */
export const floorEpoxy = (tint = PAL.floorGreen) =>
  memo('floorEpoxy' + tint, () => {
    const S = 1024;
    const { c, x } = canvas(S);
    x.fillStyle = hex(tint);
    x.fillRect(0, 0, S, S);
    const rng = makeRng(7);
    blotches(x, S, S, rng, {
      count: 140, rMin: 40, rMax: 210, alpha: 0.075,
      colors: ['rgba(255,255,255,1)', 'rgba(60,90,66,1)', 'rgba(150,190,158,1)', 'rgba(90,120,96,1)'],
    });
    // squeegee streaks left by the roller application
    x.globalAlpha = 0.05;
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = rng() > 0.5 ? '#ffffff' : '#41604a';
      x.lineWidth = 3 + rng() * 22;
      x.beginPath();
      const y0 = rng() * S;
      x.moveTo(-20, y0);
      x.bezierCurveTo(S * 0.3, y0 + (rng() - 0.5) * 90, S * 0.7, y0 + (rng() - 0.5) * 90, S + 20, y0 + (rng() - 0.5) * 60);
      x.stroke();
    }
    x.globalAlpha = 1;
    cracks(x, S, S, rng, { count: 22, len: 300, width: 1.0, color: 'rgba(58,82,62,0.30)' });
    cracks(x, S, S, rng, { count: 10, len: 160, width: 0.7, color: 'rgba(210,225,212,0.20)' });
    grain(x, S, S, rng, 7);
    return toTex(c, { repeat: [1, 1] });
  });

/** Roughness companion for the epoxy floor — mostly glossy with dull patches. */
export const floorEpoxyRough = () =>
  memo('floorEpoxyRough', () => {
    const S = 512;
    const { c, x } = canvas(S);
    x.fillStyle = '#3a3a3a'; // base gloss ≈ 0.23
    x.fillRect(0, 0, S, S);
    const rng = makeRng(11);
    blotches(x, S, S, rng, {
      count: 110, rMin: 30, rMax: 170, alpha: 0.35,
      colors: ['rgba(150,150,150,1)', 'rgba(20,20,20,1)', 'rgba(110,110,110,1)'],
    });
    // traffic lanes are scuffed = rougher
    x.globalAlpha = 0.25;
    for (let i = 0; i < 40; i++) {
      x.strokeStyle = '#b0b0b0';
      x.lineWidth = 8 + rng() * 40;
      x.beginPath();
      const y0 = rng() * S;
      x.moveTo(-20, y0);
      x.lineTo(S + 20, y0 + (rng() - 0.5) * 70);
      x.stroke();
    }
    x.globalAlpha = 1;
    grain(x, S, S, rng, 12);
    return toTex(c, { srgb: false });
  });

/** Bare concrete — wall aprons, the strip under the shutters, outside the paint. */
export const concrete = () =>
  memo('concrete', () => {
    const S = 512;
    const { c, x } = canvas(S);
    x.fillStyle = hex(PAL.concreteApron);
    x.fillRect(0, 0, S, S);
    const rng = makeRng(23);
    blotches(x, S, S, rng, {
      count: 120, rMin: 20, rMax: 130, alpha: 0.10,
      colors: ['rgba(255,255,255,1)', 'rgba(120,116,105,1)', 'rgba(90,86,78,1)'],
    });
    cracks(x, S, S, rng, { count: 8, len: 200, width: 1.2, color: 'rgba(105,100,90,0.4)' });
    // aggregate pinholes
    for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(${90 + rng() * 60 | 0},${88 + rng() * 60 | 0},${80 + rng() * 60 | 0},${0.1 + rng() * 0.3})`;
      x.beginPath();
      x.arc(rng() * S, rng() * S, 0.6 + rng() * 2.2, 0, Math.PI * 2);
      x.fill();
    }
    grain(x, S, S, rng, 10);
    return toTex(c);
  });

// ────────────────────────────────────────────────────────────────────────────
// Building surfaces
// ────────────────────────────────────────────────────────────────────────────

/**
 * Painted wall panel with the faint horizontal joint lines of ribbed steel
 * siding, plus grime accumulating toward the bottom.
 * One tile = 3.6 m wide × 1.2 m tall.
 */
export const wallPanel = (tint = PAL.wallWhite) =>
  memo('wallPanel' + tint, () => {
    const W = 512, H = 256;
    const { c, x } = canvas(W, H);
    x.fillStyle = hex(tint);
    x.fillRect(0, 0, W, H);
    const rng = makeRng(31);
    blotches(x, W, H, rng, {
      count: 60, rMin: 25, rMax: 120, alpha: 0.05,
      colors: ['rgba(255,255,255,1)', 'rgba(180,172,156,1)', 'rgba(205,198,182,1)'],
    });
    // horizontal panel joints every 1/4 tile
    for (let i = 1; i < 4; i++) {
      const y = (H * i) / 4;
      x.strokeStyle = shade(tint, 0.90);
      x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
      x.strokeStyle = shade(tint, 1.06);
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, y + 2); x.lineTo(W, y + 2); x.stroke();
    }
    grain(x, W, H, rng, 5);
    return toTex(c);
  });

/** Ceiling deck soffit: broad flat panels with faint seams. */
export const ceilingDeck = () =>
  memo('ceilingDeck', () => {
    const W = 512, H = 512;
    const { c, x } = canvas(W, H);
    x.fillStyle = hex(PAL.ceilingWhite);
    x.fillRect(0, 0, W, H);
    const rng = makeRng(41);
    blotches(x, W, H, rng, {
      count: 45, rMin: 60, rMax: 220, alpha: 0.045,
      colors: ['rgba(255,255,255,1)', 'rgba(185,178,162,1)'],
    });
    x.strokeStyle = shade(PAL.ceilingWhite, 0.93);
    x.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) {
      const y = (H * i) / 4;
      x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
    }
    grain(x, W, H, rng, 4);
    return toTex(c);
  });

/** Roll-up shutter: tightly spaced horizontal slats. Tile = 1 m tall. */
export const shutterSlats = () =>
  memo('shutterSlats', () => {
    const W = 64, H = 256;
    const { c, x } = canvas(W, H);
    const n = 18;
    for (let i = 0; i < n; i++) {
      const y = (H * i) / n;
      const g = x.createLinearGradient(0, y, 0, y + H / n);
      g.addColorStop(0.0, shade(PAL.shutterGrey, 0.82));
      g.addColorStop(0.18, shade(PAL.shutterGrey, 1.06));
      g.addColorStop(0.62, shade(PAL.shutterGrey, 0.99));
      g.addColorStop(1.0, shade(PAL.shutterGrey, 0.80));
      x.fillStyle = g;
      x.fillRect(0, y, W, H / n + 1);
    }
    return toTex(c);
  });

/** Vertically corrugated / trapezoidal metal siding. Tile = 1 m wide. */
export const corrugated = (tint = PAL.wallWhite, ribs = 12) =>
  memo(`corr${tint}${ribs}`, () => {
    const W = 256, H = 8;
    const { c, x } = canvas(W, H);
    for (let i = 0; i < W; i++) {
      const p = (i / W) * ribs * Math.PI * 2;
      const f = 0.86 + 0.2 * (0.5 + 0.5 * Math.cos(p));
      x.fillStyle = shade(tint, f);
      x.fillRect(i, 0, 1, H);
    }
    return toTex(c);
  });

// ────────────────────────────────────────────────────────────────────────────
// Metals
// ────────────────────────────────────────────────────────────────────────────

/** Brushed / rolled steel sheet, streaked along U. */
export const brushedSteel = (tint = PAL.steelBrushed) =>
  memo('brushed' + tint, () => {
    const W = 512, H = 512;
    const { c, x } = canvas(W, H);
    x.fillStyle = hex(tint);
    x.fillRect(0, 0, W, H);
    const rng = makeRng(53);
    x.globalAlpha = 0.10;
    for (let i = 0; i < 1400; i++) {
      x.strokeStyle = rng() > 0.5 ? '#ffffff' : '#4c5054';
      x.lineWidth = 0.6 + rng() * 1.6;
      const y = rng() * H;
      x.beginPath();
      x.moveTo(rng() * W * 0.4 - 40, y);
      x.lineTo(rng() * W * 0.6 + W * 0.5, y + (rng() - 0.5) * 2);
      x.stroke();
    }
    x.globalAlpha = 1;
    grain(x, W, H, rng, 5);
    return toTex(c);
  });

/** Roughness map giving polished aluminium rollers their anisotropic streaks. */
export const alumRough = () =>
  memo('alumRough', () => {
    const W = 256, H = 64;
    const { c, x } = canvas(W, H);
    x.fillStyle = '#3c3c3c';
    x.fillRect(0, 0, W, H);
    const rng = makeRng(59);
    x.globalAlpha = 0.35;
    for (let i = 0; i < 500; i++) {
      x.strokeStyle = rng() > 0.5 ? '#8a8a8a' : '#181818';
      x.lineWidth = 0.5 + rng() * 2;
      const y = rng() * H;
      x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
    }
    x.globalAlpha = 1;
    return toTex(c, { srgb: false });
  });

/** Aluminium T-slot extrusion profile seen from the side (the silver framing). */
export const extrusionFace = () =>
  memo('extrusionFace', () => {
    const W = 128, H = 128;
    const { c, x } = canvas(W, H);
    x.fillStyle = hex(PAL.aluExtrusion);
    x.fillRect(0, 0, W, H);
    // central T-slot groove
    const g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0.0, shade(PAL.aluExtrusion, 1.05));
    g.addColorStop(0.34, shade(PAL.aluExtrusion, 1.10));
    g.addColorStop(0.40, shade(PAL.aluExtrusion, 0.62));
    g.addColorStop(0.50, shade(PAL.aluExtrusion, 0.50));
    g.addColorStop(0.60, shade(PAL.aluExtrusion, 0.62));
    g.addColorStop(0.66, shade(PAL.aluExtrusion, 1.10));
    g.addColorStop(1.0, shade(PAL.aluExtrusion, 1.05));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    const rng = makeRng(61);
    grain(x, W, H, rng, 6);
    return toTex(c);
  });

/** Diamond / checker plate for step treads and platforms. */
export const checkerPlate = () =>
  memo('checkerPlate', () => {
    const S = 256;
    const { c, x } = canvas(S);
    x.fillStyle = shade(PAL.galv, 0.88);
    x.fillRect(0, 0, S, S);
    x.fillStyle = shade(PAL.galv, 1.12);
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 6; i++) {
        const cx = (S / 6) * i + (r % 2 ? S / 12 : 0) + S / 12;
        const cy = (S / 6) * r + S / 12;
        x.save();
        x.translate(cx, cy);
        x.rotate(r % 2 ? 0.5 : -0.5);
        x.fillRect(-16, -4, 32, 8);
        x.restore();
      }
    }
    return toTex(c);
  });

/** Perforated punched-steel sheet (alpha map). */
export const perforatedAlpha = () =>
  memo('perfAlpha', () => {
    const S = 128;
    const { c, x } = canvas(S);
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, S, S);
    x.fillStyle = '#000000';
    for (let r = 0; r < 8; r++) {
      for (let i = 0; i < 8; i++) {
        x.beginPath();
        x.arc((S / 8) * i + (r % 2 ? S / 16 : 0) + S / 16, (S / 8) * r + S / 16, 4.2, 0, Math.PI * 2);
        x.fill();
      }
    }
    return toTex(c, { srgb: false });
  });

/** Wire-mesh alpha map for the green roll cages and safety fencing. */
export const meshAlpha = (cell = 10, wire = 2) =>
  memo(`meshAlpha${cell}${wire}`, () => {
    const S = 128;
    const { c, x } = canvas(S);
    x.fillStyle = '#000000';
    x.fillRect(0, 0, S, S);
    x.strokeStyle = '#ffffff';
    x.lineWidth = wire;
    for (let i = 0; i <= S; i += cell) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke();
    }
    return toTex(c, { srgb: false });
  });

// ────────────────────────────────────────────────────────────────────────────
// Materials of things
// ────────────────────────────────────────────────────────────────────────────

/** Corrugated cardboard — box flaps, kraft brown with flute lines. */
export const cardboard = () =>
  memo('cardboard', () => {
    const S = 256;
    const { c, x } = canvas(S);
    x.fillStyle = hex(PAL.cardboard);
    x.fillRect(0, 0, S, S);
    const rng = makeRng(67);
    blotches(x, S, S, rng, {
      count: 50, rMin: 15, rMax: 90, alpha: 0.07,
      colors: ['rgba(255,255,255,1)', 'rgba(130,105,70,1)'],
    });
    x.globalAlpha = 0.10;
    x.strokeStyle = '#7a5f3c';
    x.lineWidth = 1;
    for (let i = 0; i < S; i += 5) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
    }
    x.globalAlpha = 1;
    // tape seam
    x.fillStyle = 'rgba(215,200,175,0.55)';
    x.fillRect(S * 0.46, 0, S * 0.08, S);
    grain(x, S, S, rng, 8);
    return toTex(c);
  });

/** Pale pine pallet / crate timber, grain running along U. */
export const timber = (tint = PAL.wood) =>
  memo('timber' + tint, () => {
    const W = 512, H = 128;
    const { c, x } = canvas(W, H);
    x.fillStyle = hex(tint);
    x.fillRect(0, 0, W, H);
    const rng = makeRng(71);
    for (let i = 0; i < 90; i++) {
      x.strokeStyle = `rgba(${120 + rng() * 60 | 0},${95 + rng() * 55 | 0},${60 + rng() * 45 | 0},${0.05 + rng() * 0.13})`;
      x.lineWidth = 0.8 + rng() * 4;
      const y = rng() * H;
      x.beginPath();
      x.moveTo(0, y);
      x.bezierCurveTo(W * 0.3, y + (rng() - 0.5) * 14, W * 0.7, y + (rng() - 0.5) * 14, W, y + (rng() - 0.5) * 8);
      x.stroke();
    }
    // knots
    for (let i = 0; i < 4; i++) {
      const kx = rng() * W, ky = rng() * H;
      for (let r = 9; r > 0; r--) {
        x.strokeStyle = `rgba(110,82,50,${0.05 + r * 0.012})`;
        x.lineWidth = 1.2;
        x.beginPath();
        x.ellipse(kx, ky, r * 2.2, r * 1.1, rng() * 0.4, 0, Math.PI * 2);
        x.stroke();
      }
    }
    grain(x, W, H, rng, 7);
    return toTex(c);
  });

/** Cast-iron / painted machine finish: subtle orange-peel over flat paint. */
export const paintedMetal = (tint = PAL.machineIvory) =>
  memo('paint' + tint, () => {
    const S = 256;
    const { c, x } = canvas(S);
    x.fillStyle = hex(tint);
    x.fillRect(0, 0, S, S);
    const rng = makeRng(tint & 0xffff);
    blotches(x, S, S, rng, {
      count: 70, rMin: 10, rMax: 60, alpha: 0.045,
      colors: ['rgba(255,255,255,1)', 'rgba(0,0,0,1)'],
    });
    grain(x, S, S, rng, 5);
    return toTex(c);
  });

/** Weathered painted steel — the crane girder and jibs are chalky and scuffed. */
export const weatheredPaint = (tint = PAL.craneOrange) =>
  memo('weather' + tint, () => {
    const S = 512;
    const { c, x } = canvas(S);
    x.fillStyle = hex(tint);
    x.fillRect(0, 0, S, S);
    const rng = makeRng((tint & 0xffff) + 3);
    blotches(x, S, S, rng, {
      count: 110, rMin: 20, rMax: 130, alpha: 0.09,
      colors: ['rgba(255,255,255,1)', 'rgba(0,0,0,1)', 'rgba(140,90,40,1)'],
    });
    // runs and drips
    x.globalAlpha = 0.06;
    for (let i = 0; i < 40; i++) {
      x.strokeStyle = rng() > 0.5 ? '#ffffff' : '#402a10';
      x.lineWidth = 1 + rng() * 7;
      const cx = rng() * S;
      x.beginPath();
      x.moveTo(cx, rng() * S);
      x.lineTo(cx + (rng() - 0.5) * 8, rng() * S);
      x.stroke();
    }
    x.globalAlpha = 1;
    grain(x, S, S, rng, 8);
    return toTex(c);
  });

// ────────────────────────────────────────────────────────────────────────────
// Signage & printed matter
// ────────────────────────────────────────────────────────────────────────────

const CJK = '"Noto Sans CJK JP","Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",' +
  '"MS PGothic","Source Han Sans JP","Droid Sans Fallback",sans-serif';

/** Fill text centred in a box, shrinking to fit. */
function fitText(x, text, cx, cy, maxW, size, font = CJK, color = '#000') {
  x.fillStyle = color;
  let s = size;
  do {
    x.font = `700 ${s}px ${font}`;
    if (x.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 6);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, cx, cy);
}

/** 消火器 — red fire-extinguisher location sign with a white down-arrow. */
export const signExtinguisher = () =>
  memo('signExt', () => {
    const W = 256, H = 320;
    const { c, x } = canvas(W, H);
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);
    x.fillStyle = hex(PAL.signRed);
    x.fillRect(6, 6, W - 12, H - 12);
    fitText(x, '消火器', W / 2, 52, W - 30, 54, CJK, '#ffffff');
    // down arrow
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.moveTo(W * 0.36, 100); x.lineTo(W * 0.64, 100);
    x.lineTo(W * 0.64, 218); x.lineTo(W * 0.82, 218);
    x.lineTo(W * 0.50, 292); x.lineTo(W * 0.18, 218);
    x.lineTo(W * 0.36, 218); x.closePath();
    x.fill();
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** 非常口 — green running-man emergency exit sign (glows). */
export const signExit = () =>
  memo('signExit', () => {
    const W = 320, H = 160;
    const { c, x } = canvas(W, H);
    x.fillStyle = hex(PAL.signGreen);
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffffff';
    // door frame
    x.fillRect(200, 26, 12, 108);
    x.fillRect(212, 26, 56, 12);
    x.fillRect(212, 122, 56, 12);
    x.fillRect(256, 26, 12, 108);
    // running figure
    x.save();
    x.translate(96, 80);
    x.beginPath(); x.arc(6, -40, 13, 0, Math.PI * 2); x.fill();      // head
    x.lineWidth = 15; x.strokeStyle = '#ffffff'; x.lineCap = 'round';
    x.beginPath(); x.moveTo(2, -24); x.lineTo(-6, 6); x.stroke();     // torso
    x.lineWidth = 12;
    x.beginPath(); x.moveTo(-6, 4); x.lineTo(-30, 30); x.stroke();    // back leg
    x.beginPath(); x.moveTo(-6, 4); x.lineTo(24, 22); x.lineTo(30, 46); x.stroke(); // front leg
    x.beginPath(); x.moveTo(0, -18); x.lineTo(-28, -8); x.stroke();   // back arm
    x.beginPath(); x.moveTo(0, -18); x.lineTo(24, -30); x.stroke();   // front arm
    x.restore();
    // arrow
    x.beginPath();
    x.moveTo(150, 60); x.lineTo(178, 80); x.lineTo(150, 100); x.closePath();
    x.fill();
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/**
 * 安全第一 crane-girder panels. `which` ∈ '安' | '全' | '第' | '一' | 'cross'.
 * White square plate with a black glyph, or the green safety cross.
 */
export const signGirderPanel = (which) =>
  memo('girderPanel' + which, () => {
    const S = 128;
    const { c, x } = canvas(S);
    x.fillStyle = '#f4f2ec';
    x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(0,0,0,0.25)';
    x.lineWidth = 3;
    x.strokeRect(2, 2, S - 4, S - 4);
    if (which === 'cross') {
      x.fillStyle = hex(PAL.signGreen);
      x.fillRect(S * 0.40, S * 0.14, S * 0.20, S * 0.72);
      x.fillRect(S * 0.14, S * 0.40, S * 0.72, S * 0.20);
    } else {
      fitText(x, which, S / 2, S / 2 + 3, S - 22, 92, CJK, '#141414');
    }
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** Yellow/black hazard triangle decal for robot bodies. */
export const decalWarning = () =>
  memo('decalWarn', () => {
    const S = 128;
    const { c, x } = canvas(S);
    x.clearRect(0, 0, S, S);
    x.fillStyle = '#111111';
    x.beginPath();
    x.moveTo(S / 2, 10); x.lineTo(S - 10, S - 14); x.lineTo(10, S - 14); x.closePath();
    x.fill();
    x.fillStyle = '#f0c800';
    x.beginPath();
    x.moveTo(S / 2, 26); x.lineTo(S - 24, S - 24); x.lineTo(24, S - 24); x.closePath();
    x.fill();
    x.fillStyle = '#111111';
    x.fillRect(S / 2 - 5, 48, 10, 40);
    x.beginPath(); x.arc(S / 2, 100, 6, 0, Math.PI * 2); x.fill();
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** Analogue wall clock face. */
export const clockFace = () =>
  memo('clockFace', () => {
    const S = 256;
    const { c, x } = canvas(S);
    x.fillStyle = '#fbfaf6';
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#c9c5bb'; x.lineWidth = 7;
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#22242a';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? S * 0.34 : S * 0.38;
      x.lineWidth = i % 3 === 0 ? 7 : 3;
      x.beginPath();
      x.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
      x.lineTo(S / 2 + Math.cos(a) * S * 0.43, S / 2 + Math.sin(a) * S * 0.43);
      x.stroke();
    }
    x.lineCap = 'round';
    x.lineWidth = 9; // hour hand → ~10:10
    x.beginPath(); x.moveTo(S / 2, S / 2);
    x.lineTo(S / 2 + Math.cos(-2.62) * S * 0.24, S / 2 + Math.sin(-2.62) * S * 0.24); x.stroke();
    x.lineWidth = 6; // minute hand
    x.beginPath(); x.moveTo(S / 2, S / 2);
    x.lineTo(S / 2 + Math.cos(-0.52) * S * 0.36, S / 2 + Math.sin(-0.52) * S * 0.36); x.stroke();
    x.strokeStyle = '#c0392b'; x.lineWidth = 2.5;
    x.beginPath(); x.moveTo(S / 2, S / 2);
    x.lineTo(S / 2 + Math.cos(1.9) * S * 0.4, S / 2 + Math.sin(1.9) * S * 0.4); x.stroke();
    x.fillStyle = '#22242a';
    x.beginPath(); x.arc(S / 2, S / 2, 7, 0, Math.PI * 2); x.fill();
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** Whiteboard covered in scribbles, magnets and pinned A4 sheets. */
export const whiteboard = () =>
  memo('whiteboard', () => {
    const W = 512, H = 384;
    const { c, x } = canvas(W, H);
    x.fillStyle = '#f7f6f2';
    x.fillRect(0, 0, W, H);
    const rng = makeRng(83);
    // faint grid
    x.strokeStyle = 'rgba(0,0,0,0.05)'; x.lineWidth = 1;
    for (let i = 0; i < W; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
    for (let i = 0; i < H; i += 32) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke(); }
    // marker scribbles
    const inks = ['#1a4fa0', '#c0392b', '#1d7a3e', '#222'];
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = inks[Math.floor(rng() * inks.length)];
      x.lineWidth = 1.5 + rng() * 2;
      x.beginPath();
      let px = rng() * W, py = rng() * H;
      x.moveTo(px, py);
      for (let k = 0; k < 3 + rng() * 5; k++) {
        px += (rng() - 0.5) * 90; py += (rng() - 0.5) * 30;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    // magnets
    for (let i = 0; i < 12; i++) {
      x.fillStyle = ['#e04a2a', '#2c66c9', '#f0c020', '#28a05a'][Math.floor(rng() * 4)];
      x.beginPath(); x.arc(rng() * W, rng() * H, 5 + rng() * 4, 0, Math.PI * 2); x.fill();
    }
    // pinned sheets
    for (let i = 0; i < 4; i++) {
      const sx = rng() * (W - 90), sy = rng() * (H - 120);
      x.fillStyle = '#ffffff';
      x.fillRect(sx, sy, 78, 108);
      x.strokeStyle = 'rgba(0,0,0,0.15)'; x.lineWidth = 1;
      x.strokeRect(sx, sy, 78, 108);
      x.fillStyle = 'rgba(60,60,60,0.5)';
      for (let l = 0; l < 9; l++) x.fillRect(sx + 8, sy + 12 + l * 10, 40 + rng() * 24, 2);
    }
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** A4 paper with body copy — pinned notes, job sheets, box labels. */
export const paperSheet = (seed = 1) =>
  memo('paper' + seed, () => {
    const W = 256, H = 362;
    const { c, x } = canvas(W, H);
    x.fillStyle = '#fdfcf8';
    x.fillRect(0, 0, W, H);
    const rng = makeRng(90 + seed);
    x.fillStyle = 'rgba(50,50,55,0.55)';
    for (let l = 0; l < 24; l++) {
      if (rng() < 0.12) continue;
      x.fillRect(24, 30 + l * 13, 40 + rng() * (W - 90), 3);
    }
    if (rng() > 0.5) {
      x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1.5;
      x.strokeRect(24, 200, W - 48, 100);
      for (let r = 1; r < 4; r++) {
        x.beginPath(); x.moveTo(24, 200 + r * 25); x.lineTo(W - 24, 200 + r * 25); x.stroke();
      }
    }
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** Yellow/black diagonal hazard striping (floor tape, cone bars, bollards). */
export const hazardStripe = (angle = 45) =>
  memo('hazard' + angle, () => {
    const S = 128;
    const { c, x } = canvas(S);
    x.fillStyle = hex(PAL.coneBand);
    x.fillRect(0, 0, S, S);
    x.fillStyle = hex(PAL.floorTapeBlack);
    x.save();
    x.translate(S / 2, S / 2);
    x.rotate((angle * Math.PI) / 180);
    for (let i = -S; i < S; i += S / 4) x.fillRect(i, -S, S / 8, S * 2);
    x.restore();
    return toTex(c);
  });

/** Generic multi-line factory notice / equipment nameplate. */
export const noticePlate = (title = '注意', lines = 3, bg = '#f2efe6') =>
  memo(`notice${title}${lines}${bg}`, () => {
    const W = 256, H = 180;
    const { c, x } = canvas(W, H);
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 3;
    x.strokeRect(3, 3, W - 6, H - 6);
    fitText(x, title, W / 2, 34, W - 24, 34, CJK, '#b02318');
    x.fillStyle = 'rgba(40,40,45,0.6)';
    for (let l = 0; l < lines; l++) x.fillRect(22, 62 + l * 22, W - 60 - l * 18, 5);
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** Andon / stack-light lens colours as an emissive strip (unused UV = solid). */
export const gradientSky = () =>
  memo('gradSky', () => {
    const W = 4, H = 256;
    const { c, x } = canvas(W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.0, '#ffffff');
    g.addColorStop(0.45, '#f4f7fb');
    g.addColorStop(0.55, '#e9eef4');
    g.addColorStop(1.0, '#cfd6dd');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/**
 * Bright window "sky" — what you see through the glazing. The photo's windows
 * are fully blown out, so this is near-white with a faint gradient.
 */
export const windowSky = () =>
  memo('windowSky', () => {
    const W = 64, H = 128;
    const { c, x } = canvas(W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.0, '#ffffff');
    g.addColorStop(0.7, '#fdfefe');
    g.addColorStop(1.0, '#eef2f4');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    return toTex(c, { wrap: THREE.ClampToEdgeWrapping });
  });

/** Insect screen / louvre mesh over one of the right-hand windows. */
export const screenMesh = () =>
  memo('screenMesh', () => {
    const S = 64;
    const { c, x } = canvas(S);
    x.fillStyle = 'rgba(0,0,0,0)';
    x.clearRect(0, 0, S, S);
    x.strokeStyle = 'rgba(40,42,45,0.85)';
    x.lineWidth = 1.6;
    for (let i = 0; i <= S; i += 6) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke();
    }
    return toTex(c);
  });

/** Dispose everything (hot-reload safety). */
export function disposeTextures() {
  _cache.forEach((t) => t.dispose());
  _cache.clear();
}
