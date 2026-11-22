// Decoding of the exporter's binary files (layout documented in sim/vhsim/viewer/formats.py and meta.json).

/** Return the decompressed bytes if `buf` is gzip (magic 1f 8b), else `buf` unchanged. */
export async function maybeGunzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 2 || u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

/** Bytes from a base64 text body (``*.b64.txt``: how binary files are published where .gz is not served). */
export function fromBase64Text(text) {
  const bin = atob(text.replace(/\s+/g, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

const ARRAY = { uint8: Uint8Array, uint16: Uint16Array };

/**
 * Lane planes (interval-major [T][N]). Returns { raw: {name: TypedArray}, value(name, t, i) -> number|null,
 * planes: {name: plane meta}, T, N }.
 */
export function decodeLanes(buf, layout, T, N) {
  const raw = {}, planes = {};
  for (const p of layout.planes) {
    const A = ARRAY[p.dtype];
    if (!A) throw new Error(`unsupported dtype ${p.dtype}`);
    if (p.offset % A.BYTES_PER_ELEMENT) throw new Error(`plane ${p.name} misaligned`);
    raw[p.name] = new A(buf, p.offset, T * N);
    planes[p.name] = p;
  }
  return {
    raw, planes, T, N,
    value(name, t, i) {
      const p = planes[name];
      const q = raw[name][t * N + i];
      if (p.missing !== null && p.missing !== undefined && q === p.missing) return null;
      return q * p.scale;
    },
  };
}

export function laneSeries(lanes, name, i) {
  const out = [];
  for (let t = 0; t < lanes.T; t++) out.push(lanes.value(name, t, i));
  return out;
}

/** Edge travel times -> Float32Array [T][E] seconds, Infinity = impassable. */
export function decodeEdgeTimes(buf, layout, T, E) {
  const p = layout.planes[0];
  const q = new Uint16Array(buf, p.offset, T * E);
  const out = new Float32Array(T * E);
  for (let k = 0; k < q.length; k++) out[k] = q[k] === p.missing ? Infinity : q[k] * p.scale;
  return out;
}
