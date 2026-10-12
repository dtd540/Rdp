'use strict';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { createCanvas, loadImage } from 'canvas';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOGO_PATH = process.env.VMB_LOGO || path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Desktop',
  '72b779b7-c415-4ef4-b7fe-c041eec7b3c5.png',
);

// ── PNG encoder ──────────────────────────────────────────────────────────────
const PNG_SIG = Buffer.from([137, 80, 78, 71, 82, 84, 13, 10, 26, 10]);

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let b = 0; b < 8; b++) c = (c >>> 1) ^ (-((c & 1) & 1) & 0xedb88320);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(pixels, w, h, bitDepth, colorType, deflateFn) {
  const stride = colorType === 6 ? 4 : colorType === 3 ? 1 : 3;
  const raw = Buffer.alloc(h * (1 + w * stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * stride)] = 0; // filter none
    const row = raw.subarray(y * (1 + w * stride) + 1, (y + 1) * (1 + w * stride));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3] ?? 255;
      if (colorType === 3) {
        // palette — we only ever use RGBA for real output, so this path stays unused
        row[x] = r;
      } else if (colorType === 2) {
        row[x * 3] = r; row[x * 3 + 1] = g; row[x * 3 + 2] = b;
      } else if (colorType === 6) {
        row[x * 4] = r; row[x * 4 + 1] = g; row[x * 4 + 2] = b; row[x * 4 + 3] = a;
      }
    }
  }
  const compressed = deflateFn(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth; ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const png = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

function deflateRaw(raw) {
  // raw deflate: 7 zlib header + deflate block + adler32
  const deflated = deflateBlock(raw);
  const header = Buffer.alloc(2);
  header[0] = 0x78; header[1] = 0x01; // CMF+FLG: deflate, no preset, check bits
  const adler = adler32(raw);
  const a = Buffer.alloc(4); a.writeUInt32BE(adler >>> 0, 0);
  return Buffer.concat([header, deflated, a]);
}

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

function deflateBlock(input) {
  const chunks = [];
  let i = 0;
  while (i < input.length) {
    const end = Math.min(i + 65535, input.length);
    const len = end - i;
    // dynamic Huffman — simplest reliable path: store uncompressed block with BFINAL when done
    const isFinal = end >= input.length;
    const head = Buffer.alloc(5 + len * 2); // BFINAL+BHLIT+B extra bits + 3 header nibbles + len-limited len+symbols
    head[0] = (isFinal ? 1 : 0);
    head[0] |= 0x1 << 1;  // BTYPE = fixed? no — use stored for simplicity
    // Actually use stored block for reliability
    head[0] = (isFinal ? 1 : 0);       // BFINAL
    head[0] |= 0 << 1;                  // BTYPE = 0 (stored)
    head[0] |= 0 << 2;                  // unused
    // pad to byte boundary (already aligned since we emit from byte boundary)
    let bitPos = 0;
    const LEN = len;
    const NLEN = ~LEN & 0xffff;
    const stored = Buffer.alloc(4 + len);
    stored.writeUInt16LE(LEN, 0);
    stored.writeUInt16LE(NLEN, 2);
    stored.set(input.subarray(i, end), 4);
    // flush to byte boundary already
    chunks.push(stored);
    i = end;
  }
  return Buffer.concat(chunks);
}

// ── ICO writer ───────────────────────────────────────────────────────────────
function writeIco(entries, outPath) {
  // entries: [{ w, h, bpp, imgData:PNGorBMP }]
  const resolved = [];
  for (const e of entries) {
    if (e.w === 256) e.w = 0;
    if (e.h === 256) e.h = 0;
    resolved.push(e);
  }
  const hdr = Buffer.alloc(6 + resolved.length * 16);
  hdr[0] = 0; hdr[1] = 0; // reserved
  hdr[2] = 1; hdr[3] = 0; // type = ICO
  hdr.writeUInt16LE(resolved.length, 4);
  let off = 6 + resolved.length * 16;
  for (let i = 0; i < resolved.length; i++) {
    const e = resolved[i];
    const b = hdr.subarray(6 + i * 16, 6 + i * 16 + 16);
    b[0] = e.w; b[1] = e.h;
    b[2] = e.palette ? 0 : (e.pixelsPerByte ? 0 : 0); // color count (0 for >=256)
    b[3] = 0; // reserved
    b.writeUInt16LE(e.planes || 1, 4);
    b.writeUInt16LE(e.bpp || 32, 6);
    b.writeUInt32LE(e.imgData.length, 8);
    b.writeUInt32LE(off, 12);
    off += e.imgData.length;
  }
  const body = Buffer.concat(resolved.map(e => e.imgData));
  writeFileSync(outPath, Buffer.concat([hdr, body]));
}

// BMP + DIB for ICO small sizes + AND mask
function bmpForIcon(px, w, h, bpp) {
  // px: RGBA buffer, w*h pixels, bottom-up BMP
  const stride = Math.ceil(w * bpp / 8);
  const rowSize = Math.max(4, stride);
  const rowsizePad = rowSize;
  const dataSize = rowSize * h;
  const infoHdrSize = 40;
  const fileHdrSize = 14;
  const reserved = 0;
  const offBits = fileHdrSize + 4 + infoHdrSize;
  const imgSize = dataSize;
  const size = offBits + imgSize;
  const buf = Buffer.alloc(size);
  // BMP file header
  buf[0] = 66; buf[1] = 77;
  buf.writeUInt32LE(size, 2);
  buf.writeUInt16LE(reserved, 6);
  buf.writeUInt16LE(0, 8); // app type
  buf.writeUInt32LE(offBits, 10);
  // DIB header BITMAPINFOHEADER
  buf.writeUInt32LE(infoHdrSize, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h * 2, 22); // doubled for AND mask
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(bpp, 28);
  buf.writeUInt32LE(0, 30); // compression = BI_RGB
  buf.writeUInt32LE(imgSize, 34);
  buf.writeInt32LE(0, 38); // x ppm
  buf.writeInt32LE(0, 42); // y ppm
  buf.writeUInt32LE(0, 46); // colors used
  buf.writeUInt32LE(0, 50); // important colors
  // pixel data — bottom up, BGRA
  let di = offBits;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[di++] = px[i + 2];     // B
      buf[di++] = px[i + 1];     // G
      buf[di++] = px[i];         // R
      buf[di++] = px[i + 3];     // A
    }
    // pad row to 4-byte boundary
    let pad = di - offBits - (y * rowSize);
    while (pad < rowSize) buf[di++] = 0x00, pad++;
  }
  return buf;
}

function andMaskForIcon(w, h) {
  // 1bpp bottom-up AND mask, one bit per pixel, rows padded to 4 bytes
  const rowBytes = Math.ceil(w / 8);
  const paddedRow = Math.ceil(rowBytes / 4) * 4;
  const buf = Buffer.alloc(paddedRow * h);
  // all zeros = fully opaque where alpha=255 already
  return buf;
}

// ── Area-average resampler (exact, no off-by-one) ────────────────────────────
function resampleTo(srcW, srcH, src, dstW, dstH) {
  const dst = new Float32Array(dstW * dstH * 4);
  const sx = srcW / dstW, sy = srcH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const y0f = dy * sy, y1f = (dy + 1) * sy;
    const y0 = Math.floor(y0f), y1 = Math.ceil(y1f);
    const yReal0 = Math.max(0, y0), yReal1 = Math.min(srcH, y1);
    const yCount = yReal1 - yReal0;
    if (yCount <= 0) continue;
    for (let dx = 0; dx < dstW; dx++) {
      const x0f = dx * sx, x1f = (dx + 1) * sx;
      const x0 = Math.floor(x0f), x1 = Math.ceil(x1f);
      const xReal0 = Math.max(0, x0), xReal1 = Math.min(srcW, x1);
      const xCount = xReal1 - xReal0;
      if (xCount <= 0) continue;
      const area = xCount * yCount;
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = yReal0; y < yReal1; y++) {
        for (let x = xReal0; x < xReal1; x++) {
          const i = (y * srcW + x) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
        }
      }
      const di = (dy * dstW + dx) * 4;
      dst[di] = r / area; dst[di + 1] = g / area;
      dst[di + 2] = b / area; dst[di + 3] = a / area;
    }
  }
  return new Uint8ClampedArray(dst);
}

// ── Canvas helpers ────────────────────────────────────────────────────────────
function drawFromCanvas(srcCanvas, dstW, dstH) {
  const srcCtx = srcCanvas.getContext('2d');
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const srcPix = srcCtx.getImageData(0, 0, sw, sh).data;
  const dst = resampleTo(sw, sh, srcPix, dstW, dstH);
  return dst;
}

function rgbaBufToCanvas(buf, w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(w, h);
  imgData.data.set(buf);
  ctx.putImageData(imgData, 0, 0);
  return c;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const exists = statSync(LOGO_PATH, { throwIfMissing: false });
  if (!exists) {
    console.error('Logo source not found at:', LOGO_PATH);
    console.error('Set VMB_LOGO=<path> or place the PNG on the Desktop.');
    process.exit(1);
  }
  const src = createCanvas(1024, 1024);
  const ctx = src.getContext('2d');
  const logoImg = await loadImage(LOGO_PATH);
  ctx.drawImage(logoImg, 0, 0, 1024, 1024);

  // ── Build the icon set ─────────────────────────────────────────────────────
  const SIZES = [16, 24, 32, 48, 64, 128, 256];
  const pngs = {}; // size -> buffer
  const iconEntries = [];

  for (const size of SIZES) {
    const rgba = drawFromCanvas(src, size, size);
    const canvas = rgbaBufToCanvas(rgba, size, size);
    const finalCtx = canvas.getContext('2d');
    const finalPix = finalCtx.getImageData(0, 0, size, size).data;
    const pngBuf = encodePng(
      finalPix, size, size, 8, 6,
      (raw) => { const c = zlib.deflateSync(raw, { level: 9 }); return c; }
    );
    pngs[size] = pngBuf;

    if (size < 256) {
      // BMP + AND mask entry for ICO
      const bmp = bmpForIcon(finalPix, size, size, 32);
      const and = andMaskForIcon(size, size);
      const imgData = Buffer.concat([bmp, and]);
      iconEntries.push({ w: size, h: size, bpp: 32, imgData });
    } else {
      // PNG entry
      iconEntries.push({ w: size, h: size, bpp: 32, imgData: pngBuf, palette: false, pixelsPerByte: false });
    }
  }

  // ── Write outputs ──────────────────────────────────────────────────────────
  const buildDir = path.join(ROOT, 'build');
  mkdirSync(buildDir, { recursive: true });

  const icoPath = path.join(buildDir, 'icon.ico');
  writeIco(iconEntries, icoPath);
  console.log('wrote', icoPath);

  const png256Path = path.join(buildDir, 'icon.png');
  writeFileSync(png256Path, pngs[256]);
  console.log('wrote', png256Path);

  const trayPath = path.join(buildDir, 'tray.png');
  writeFileSync(trayPath, pngs[32]);
  console.log('wrote', trayPath);

  const faviconPath = path.join(buildDir, 'favicon.png');
  writeFileSync(faviconPath, pngs[32]);
  console.log('wrote', faviconPath);

  // ── Tray base64 for tray.ts ────────────────────────────────────────────────
  const trayBase64 = pngs[32].toString('base64');
  console.log('\n// New tray icon base64 (32px) for app/main/tray.ts:');
  console.log(`export const TRAY_ICON_BASE64 = \`data:image/png;base64,${trayBase64}\`;\n`);

  // ── Review sheet ───────────────────────────────────────────────────────────
  const tmpDir = path.join(require('node:os').tmpdir(), 'vmb-icon-review');
  mkdirSync(tmpDir, { recursive: true });

  const reviewSizes = [16, 24, 32, 48];
  const reviewCanvases = {};
  for (const s of reviewSizes) {
    const rgba = drawFromCanvas(src, s, s);
    reviewCanvases[s] = rgbaBufToCanvas(rgba, s, s);
  }

  const reviewRows = reviewSizes.map(s => {
    const c = reviewCanvases[s];
    const dataUri = c.toDataURL();
    return `<div class="cell">
      <div class="label">${s}×${s}</div>
      <div class="swatch light" style="background:url('${dataUri}') center/cover"></div>
      <div class="swatch dark" style="background:url('${dataUri}') center/cover"></div>
      <div class="zoom"><img src="${dataUri}" style="image-rendering:auto;width:${s*4}px;height:${s*4}px"></div>
    </div>`;
  }).join('\n');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>VMB Icon Review</title>
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#0b0b0f; color:#d8d8e0; }
  h1 { font-size:14px; letter-spacing:.12em; text-transform:uppercase; opacity:.7; margin:18px 20px 8px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:14px; padding:0 20px 30px; }
  .cell { background:#14141c; border:1px solid #262631; border-radius:10px; padding:12px; }
  .label { font-size:11px; opacity:.6; margin-bottom:8px; text-transform:uppercase; letter-spacing:.1em; }
  .swatch { width:100%; aspect-ratio:1/1; border-radius:6px; border:1px solid #2a2a36; }
  .zoom { margin-top:8px; background:#0a0a0e; border-radius:6px; overflow:hidden; }
  .zoom img { display:block; image-rendering:auto; }
</style></head><body>
<h1>VMB Icon — auto review (source: ${path.basename(LOGO_PATH)})</h1>
<div class="grid">${reviewRows}</div>
</body></html>`;
  const reviewPath = path.join(tmpDir, 'index.html');
  writeFileSync(reviewPath, html);
  console.log('review sheet:', reviewPath);
}

main().catch(e => { console.error(e); process.exit(1); });
