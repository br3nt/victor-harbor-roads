import struct
import zlib

import numpy as np
import pytest

from vhsim.viewer.png import decode_png, encode_png


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _png(w: int, h: int, color_type: int, raw: bytes) -> bytes:
    ihdr = struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b"")


def test_decode_hand_filtered_rows_of_every_filter_type():
    # 2 x 5 RGB image; row r uses filter type r. Expected pixels computed by hand from the PNG spec.
    want = np.array([
        [[10, 20, 30], [40, 50, 60]],
        [[15, 25, 35], [45, 55, 65]],
        [[20, 30, 40], [50, 60, 70]],
        [[100, 0, 255], [0, 200, 1]],
        [[101, 2, 250], [3, 202, 4]],
    ], dtype=np.uint8)
    rows = [
        bytes([0, 10, 20, 30, 40, 50, 60]),                        # None
        bytes([1, 15, 25, 35, 30, 30, 30]),                        # Sub: 45-15, 55-25, 65-35
        bytes([2, 5, 5, 5, 5, 5, 5]),                              # Up
        # Average: first pixel predictor = up//2 ; second = (left + up)//2
        bytes([3, (100 - 10) % 256, (0 - 15) % 256, (255 - 20) % 256,
               (0 - (100 + 50) // 2) % 256, (200 - (0 + 60) // 2) % 256, (1 - (255 + 70) // 2) % 256]),
        # Paeth: first pixel predictor = up (a = c = 0); second computed below
        None,
    ]
    prev, cur = want[3].astype(int), want[4].astype(int)
    out = [4] + [(cur[0][k] - prev[0][k]) % 256 for k in range(3)]
    for k in range(3):
        a, b, c = cur[0][k], prev[1][k], prev[0][k]
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
        out.append((cur[1][k] - pred) % 256)
    rows[4] = bytes(out)
    img = decode_png(_png(2, 5, 2, b"".join(rows)))
    assert img.shape == (5, 2, 3) and img.dtype == np.uint8
    assert (img == want).all()


def test_decode_rgba_drops_alpha():
    raw = bytes([0, 1, 2, 3, 255, 4, 5, 6, 128])
    img = decode_png(_png(2, 1, 6, raw))
    assert img.shape == (1, 2, 3)
    assert img.tolist() == [[[1, 2, 3], [4, 5, 6]]]


def test_decode_rejects_bad_crc():
    data = bytearray(_png(1, 1, 2, bytes([0, 1, 2, 3])))
    data[-20] ^= 0xFF  # inside the IDAT chunk
    with pytest.raises(ValueError):
        decode_png(bytes(data))


@pytest.mark.parametrize("filt", [None, 0, 1, 2, 3, 4])
def test_encode_decode_round_trip(filt):
    rng = np.random.default_rng(7)
    img = rng.integers(0, 256, size=(33, 17, 3), dtype=np.uint8)
    img[5:9] = 12  # flat rows
    data = encode_png(img, force_filter=filt)
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert (decode_png(data) == img).all()


def test_encoder_writes_8bit_rgb_without_alpha_and_is_deterministic():
    img = np.zeros((4, 4, 3), dtype=np.uint8)
    img[..., 0] = np.arange(4)
    a, b = encode_png(img), encode_png(img)
    assert a == b
    w, h, depth, ctype = struct.unpack(">IIBB", a[16:26])
    assert (w, h, depth, ctype) == (4, 4, 8, 2)


def test_encoder_picks_a_cheap_filter_for_a_smooth_ramp():
    # A smooth surface (like a hillside in a terrarium tile) is smaller with per-row filters than with None.
    y, x = np.mgrid[0:128, 0:256]
    img = np.zeros((128, 256, 3), dtype=np.uint8)
    img[..., 0] = 128
    img[..., 1] = np.round(120 + 100 * np.sin(x / 23.0) * np.cos(y / 17.0)).astype(np.uint8)
    assert len(encode_png(img)) < len(encode_png(img, force_filter=0))
