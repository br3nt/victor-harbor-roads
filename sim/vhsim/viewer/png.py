"""Minimal 8-bit RGB PNG codec (numpy + zlib), for terrain tiles. No Pillow in the project venv.

``decode_png`` reads 8-bit greyscale-free truecolour PNGs (colour type 2 RGB or 6 RGBA, not interlaced), checks
every chunk CRC and undoes all five row filters (None, Sub, Up, Average, Paeth). Alpha is dropped.
``encode_png`` writes an 8-bit RGB PNG (no alpha) with zlib level 9, choosing each row's filter by the usual
"minimum sum of absolute differences" heuristic (or one forced filter). Output is deterministic.
"""
from __future__ import annotations

import struct
import zlib

import numpy as np

SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _chunks(data: bytes):
    if data[:8] != SIGNATURE:
        raise ValueError("not a PNG file")
    pos = 8
    while pos < len(data):
        if pos + 12 > len(data):
            raise ValueError("truncated PNG")
        (n,) = struct.unpack(">I", data[pos:pos + 4])
        if pos + 12 + n > len(data):
            raise ValueError("truncated PNG")
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + n]
        (crc,) = struct.unpack(">I", data[pos + 8 + n:pos + 12 + n])
        if zlib.crc32(kind + body) & 0xFFFFFFFF != crc:
            raise ValueError(f"bad CRC in {kind!r} chunk")
        yield kind, body
        pos += 12 + n
        if kind == b"IEND":
            return
    raise ValueError("truncated PNG (no IEND)")


def _paeth_row(f: np.ndarray, prev: np.ndarray, bpp: int) -> np.ndarray:
    out = [0] * len(f)
    fl, pl = f.tolist(), prev.tolist()
    for i in range(len(fl)):
        a = out[i - bpp] if i >= bpp else 0
        b = pl[i]
        c = pl[i - bpp] if i >= bpp else 0
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
        out[i] = (fl[i] + pred) & 0xFF
    return np.array(out, dtype=np.uint8)


def _average_row(f: np.ndarray, prev: np.ndarray, bpp: int) -> np.ndarray:
    out = [0] * len(f)
    fl, pl = f.tolist(), prev.tolist()
    for i in range(len(fl)):
        a = out[i - bpp] if i >= bpp else 0
        out[i] = (fl[i] + ((a + pl[i]) >> 1)) & 0xFF
    return np.array(out, dtype=np.uint8)


def decode_png(data: bytes) -> np.ndarray:
    """PNG bytes -> uint8 array (height, width, 3)."""
    ihdr, idat = None, []
    for kind, body in _chunks(data):
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
    if ihdr is None:
        raise ValueError("PNG has no IHDR")
    w, h, depth, ctype, _comp, _filt, interlace = ihdr
    if depth != 8 or ctype not in (2, 6) or interlace:
        raise ValueError(f"unsupported PNG (bit depth {depth}, colour type {ctype}, interlace {interlace})")
    bpp = 3 if ctype == 2 else 4
    stride = w * bpp
    raw = np.frombuffer(zlib.decompress(b"".join(idat)), dtype=np.uint8)
    if raw.size != h * (stride + 1):
        raise ValueError("PNG image data has the wrong length")
    raw = raw.reshape(h, stride + 1)
    out = np.zeros((h, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.uint8)
    for r in range(h):
        ft, f = raw[r, 0], raw[r, 1:]
        if ft == 0:
            row = f.copy()
        elif ft == 1:
            row = (np.cumsum(f.reshape(w, bpp).astype(np.int64), axis=0) & 0xFF).astype(np.uint8).reshape(-1)
        elif ft == 2:
            row = f + prev  # uint8 wraps modulo 256
        elif ft == 3:
            row = _average_row(f, prev, bpp)
        elif ft == 4:
            row = _paeth_row(f, prev, bpp)
        else:
            raise ValueError(f"bad PNG filter type {ft}")
        out[r] = row
        prev = row
    return out.reshape(h, w, bpp)[..., :3].copy()


def _filtered(img: np.ndarray) -> np.ndarray:
    """All five filters of every row: array (5, h, w*3) uint8."""
    h, w, bpp = img.shape
    x = img.reshape(h, w * bpp).astype(np.int16)
    a = np.zeros_like(x)
    a[:, bpp:] = x[:, :-bpp]
    b = np.zeros_like(x)
    b[1:] = x[:-1]
    c = np.zeros_like(x)
    c[1:, bpp:] = x[:-1, :-bpp]
    p = a + b - c
    pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - c)
    paeth = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, c))
    out = np.stack([x, x - a, x - b, x - ((a + b) >> 1), x - paeth])
    return (out & 0xFF).astype(np.uint8)


def encode_png(img: np.ndarray, force_filter: int | None = None, level: int = 9) -> bytes:
    """uint8 array (height, width, 3) -> 8-bit RGB PNG bytes."""
    img = np.ascontiguousarray(img, dtype=np.uint8)
    if img.ndim != 3 or img.shape[2] != 3:
        raise ValueError("encode_png wants an (h, w, 3) uint8 array")
    h, w, _ = img.shape
    allf = _filtered(img)
    if force_filter is None:
        cost = np.abs(allf.astype(np.int8).astype(np.int32)).sum(axis=2)  # (5, h)
        choice = cost.argmin(axis=0)
    else:
        choice = np.full(h, force_filter)
    rows = allf[choice, np.arange(h)]
    raw = np.concatenate([choice.astype(np.uint8)[:, None], rows], axis=1).tobytes()

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, level)) + chunk(b"IEND", b"")
