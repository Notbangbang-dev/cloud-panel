/* Cloud Panel — tiny dependency-free QR code generator (byte mode, ECC level M,
   versions 1–10 — plenty for otpauth:// 2FA URIs). Renders to an inline SVG.
   Returns null on any failure so callers can fall back to manual key entry. */
(function () {
  'use strict';
  const CP = (window.CP = window.CP || {});

  // ---- GF(256) tables ----
  const EXP = new Array(512), LOG = new Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsGen(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); }
      g = ng;
    }
    return g; // length deg+1, leading coeff 1
  }
  function rsEncode(data, ecLen) {
    const gen = rsGen(ecLen);
    const res = new Array(ecLen).fill(0);
    for (const d of data) {
      const factor = d ^ res[0];
      res.shift(); res.push(0);
      for (let i = 0; i < ecLen; i++) res[i] ^= gmul(gen[i + 1], factor);
    }
    return res;
  }

  // ---- Version data (ECC level M): ec per block + block groups ----
  const V = {
    1: { ec: 10, g1: 1, d1: 16 }, 2: { ec: 16, g1: 1, d1: 28 }, 3: { ec: 26, g1: 1, d1: 44 },
    4: { ec: 18, g1: 2, d1: 32 }, 5: { ec: 24, g1: 2, d1: 43 }, 6: { ec: 16, g1: 4, d1: 27 },
    7: { ec: 18, g1: 4, d1: 31 }, 8: { ec: 22, g1: 2, d1: 38, g2: 2, d2: 39 },
    9: { ec: 22, g1: 3, d1: 36, g2: 2, d2: 37 }, 10: { ec: 26, g1: 4, d1: 43, g2: 1, d2: 44 },
  };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const VERSION_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };

  const dataCount = (v) => V[v].g1 * V[v].d1 + (V[v].g2 || 0) * (V[v].d2 || 0);
  const countBits = (v) => (v < 10 ? 8 : 16);

  function chooseVersion(len) {
    for (let v = 1; v <= 10; v++) {
      const cap = dataCount(v) * 8 - 4 - countBits(v);
      if (len * 8 <= cap) return v;
    }
    return null;
  }

  function buildCodewords(text, v) {
    const bytes = []; for (const ch of unescape(encodeURIComponent(text))) bytes.push(ch.charCodeAt(0));
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);              // byte mode
    push(bytes.length, countBits(v));
    for (const b of bytes) push(b, 8);
    const total = dataCount(v) * 8;
    for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0); // terminator
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    const pads = [0xEC, 0x11]; let pi = 0;
    while (cw.length < dataCount(v)) cw.push(pads[pi++ % 2]);

    // split into blocks
    const blocks = [];
    const def = V[v];
    for (let i = 0; i < def.g1; i++) blocks.push(cw.splice(0, def.d1));
    for (let i = 0; i < (def.g2 || 0); i++) blocks.push(cw.splice(0, def.d2));
    const ecBlocks = blocks.map((b) => rsEncode(b, def.ec));

    // interleave
    const out = [];
    const maxD = Math.max(...blocks.map((b) => b.length));
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < def.ec; i++) for (const e of ecBlocks) out.push(e[i]);
    return out;
  }

  function buildMatrix(v, codewords) {
    const size = 17 + v * 4;
    const m = Array.from({ length: size }, () => new Array(size).fill(null)); // null = free
    const set = (r, c, val) => { if (r >= 0 && c >= 0 && r < size && c < size) m[r][c] = val; };
    const finder = (r, c) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(rr, cc, inRing || inCore ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    // timing
    for (let i = 8; i < size - 8; i++) { if (m[6][i] === null) m[6][i] = i % 2 === 0 ? 1 : 0; if (m[i][6] === null) m[i][6] = i % 2 === 0 ? 1 : 0; }
    // alignment
    const ap = ALIGN[v];
    for (const r of ap) for (const c of ap) {
      if ((r <= 7 && c <= 7) || (r <= 7 && c >= size - 8) || (r >= size - 8 && c <= 7)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
    }
    set(size - 8, 8, 1); // dark module
    // reserve format areas (mark as 2 = reserved/placeholder)
    for (let i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = 2; if (m[i][8] === null) m[i][8] = 2; }
    for (let i = 0; i < 8; i++) { if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 2; if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 2; }
    // reserve version info (v>=7)
    if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { m[i][size - 11 + j] = 2; m[size - 11 + j][i] = 2; }

    // place data
    const bits = []; for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
    let bi = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < size; i++) {
        const row = up ? size - 1 - i : i;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (m[row][cc] === null) { m[row][cc] = bi < bits.length ? bits[bi++] : 0; }
        }
      }
      up = !up;
    }
    return { m, size };
  }

  const maskFn = [
    (r, c) => (r + c) % 2 === 0, (r, c) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
    (r, c) => (((r * c) % 2 + (r * c) % 3) % 2) === 0, (r, c) => (((r + c) % 2 + (r * c) % 3) % 2) === 0,
  ];

  function isData(m, r, c) { return m[r][c] === 0 || m[r][c] === 1; } // reserved=2 stays untouched

  function applyMask(base, size, mask) {
    const m = base.map((row) => row.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (isData(base, r, c) && maskFn[mask](r, c)) m[r][c] = base[r][c] ^ 1;
    return m;
  }

  function placeFormat(m, size, mask) {
    // level M = 0b00, mask 3 bits
    let bits = (0b00 << 3) | mask;
    let rem = bits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) & 1 ? 0x537 : 0);
    const fmt = ((bits << 10) | rem) ^ 0x5412;
    const arr = []; for (let i = 14; i >= 0; i--) arr.push((fmt >> i) & 1);
    // around top-left
    const coords1 = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
    coords1.forEach(([r, c], i) => { m[r][c] = arr[i]; });
    // split across top-right + bottom-left
    const coords2 = [[8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4], [8, size - 5], [8, size - 6], [8, size - 7], [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8], [size - 3, 8], [size - 2, 8], [size - 1, 8]];
    coords2.forEach(([r, c], i) => { m[r][c] = arr[i]; });
  }

  function placeVersion(m, size, v) {
    if (v < 7) return;
    const info = VERSION_INFO[v];
    const arr = []; for (let i = 0; i < 18; i++) arr.push((info >> i) & 1);
    let k = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { m[i][size - 11 + j] = arr[k]; m[size - 11 + j][i] = arr[k]; k++; }
  }

  function penalty(m, size) {
    let p = 0;
    // rule 1: runs of 5+
    for (let r = 0; r < size; r++) { let run = 1; for (let c = 1; c < size; c++) { if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (let c = 0; c < size; c++) { let run = 1; for (let r = 1; r < size; r++) { if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    // rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) { const x = m[r][c]; if (x === m[r][c + 1] && x === m[r + 1][c] && x === m[r + 1][c + 1]) p += 3; }
    // rule 4: dark ratio
    let dark = 0; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    const ratio = (dark * 100) / (size * size);
    p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return p;
  }

  function generate(text) {
    const bytes = unescape(encodeURIComponent(text)).length;
    const v = chooseVersion(bytes);
    if (!v) throw new Error('Too long for QR v1-10');
    const codewords = buildCodewords(text, v);
    const { m: base, size } = buildMatrix(v, codewords);
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = applyMask(base, size, mask);
      placeFormat(m, size, mask);
      placeVersion(m, size, v);
      const score = penalty(m, size);
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best.map((row) => row.map((x) => (x === 1 ? 1 : 0)));
  }

  /** Build an inline SVG string for the given text (e.g. an otpauth URI). */
  CP.qrSvg = function (text, px = 220) {
    try {
      const m = generate(text);
      const n = m.length, quiet = 4, total = n + quiet * 2;
      let rects = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) rects += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      return `<svg width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="2FA QR code"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${rects}" fill="#000000"/></svg>`;
    } catch (e) {
      return null;
    }
  };
})();
