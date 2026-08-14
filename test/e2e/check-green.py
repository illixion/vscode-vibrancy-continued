"""
Measure what percentage of a PNG screenshot region matches a target color.

Used by the E2E test to verify *true* vibrancy: the desktop wallpaper is set to
solid green and the vibrancy type to "transparent", so green pixels inside the
VSCode window can only come from the desktop showing through. A solid magenta
frame painted by the custom-imports CSS proves CSS injection independently of
transparency.

Usage: python3 check-green.py <image.png> [crop_or_region] [color]
  crop_or_region: either a crop percentage (e.g. "10" = crop 10% from each
                  edge, the default is 15), or a region as four comma-separated
                  fractions "x0,y0,x1,y1" of the image size (e.g.
                  "0.06,0.25,0.14,0.75" for the sidebar strip)
  color:          "green" (default) or "magenta"

Prints the matching pixel percentage (0-100) to stdout. Exit code 0 on
success, 2 on error — thresholds are applied by the caller (run-e2e.js).
"""

import sys
import struct
import zlib

# Samples per pixel for each PNG color type.
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def _row_to_rgb(cur, width, bit_depth, color_type, channels, palette):
    """Normalize one unfiltered scanline to packed 8-bit RGB."""
    # Fast paths for the formats screenshot tools actually emit.
    if bit_depth == 8 and color_type == 2:
        return bytes(cur[:width * 3])
    if bit_depth == 8 and color_type == 6:
        out = bytearray(width * 3)
        out[0::3] = cur[0:width * 4:4]
        out[1::3] = cur[1:width * 4:4]
        out[2::3] = cur[2:width * 4:4]
        return bytes(out)

    out = bytearray(width * 3)
    if bit_depth in (8, 16):
        step = channels * (bit_depth // 8)
        for x in range(width):
            o = x * step
            if color_type in (2, 6):
                r, g, b = cur[o], cur[o + (bit_depth // 8)], cur[o + 2 * (bit_depth // 8)]
            elif color_type in (0, 4):
                r = g = b = cur[o]
            else:  # 3 — palette, always 8-bit indices here
                i = cur[o] * 3
                r, g, b = palette[i], palette[i + 1], palette[i + 2]
            out[x * 3], out[x * 3 + 1], out[x * 3 + 2] = r, g, b
        return bytes(out)

    # Sub-byte depths (1/2/4) only occur for grayscale and palette images.
    # ImageMagick writes a solid-color desktop as exactly this: a 1-bit
    # palette PNG. Rejecting it made a perfectly good baseline capture read as
    # "check failed".
    mask = (1 << bit_depth) - 1
    per_byte = 8 // bit_depth
    for x in range(width):
        byte = cur[x // per_byte]
        shift = 8 - bit_depth * ((x % per_byte) + 1)
        v = (byte >> shift) & mask
        if color_type == 3:
            i = v * 3
            r, g, b = palette[i], palette[i + 1], palette[i + 2]
        else:
            r = g = b = v * 255 // mask
        out[x * 3], out[x * 3 + 1], out[x * 3 + 2] = r, g, b
    return bytes(out)


def read_png(filepath):
    """Minimal PNG reader. Returns (width, height, rows) with rows as packed RGB bytes."""
    with open(filepath, 'rb') as f:
        sig = f.read(8)
        if sig != b'\x89PNG\r\n\x1a\n':
            raise ValueError('Not a PNG file')

        width = height = bit_depth = color_type = interlace = 0
        palette = b''
        idat_chunks = []

        while True:
            header = f.read(8)
            if len(header) < 8:
                break
            length, chunk_type = struct.unpack('>I4s', header)
            data = f.read(length)
            f.read(4)  # CRC

            if chunk_type == b'IHDR':
                (width, height, bit_depth, color_type,
                 _compression, _filter, interlace) = struct.unpack('>IIBBBBB', data[:13])
            elif chunk_type == b'PLTE':
                palette = data
            elif chunk_type == b'IDAT':
                idat_chunks.append(data)
            elif chunk_type == b'IEND':
                break

    if not idat_chunks:
        raise ValueError('No IDAT chunks')
    if interlace:
        raise ValueError('Interlaced PNGs are not supported')
    channels = CHANNELS.get(color_type)
    if channels is None:
        raise ValueError(f'Unsupported color type {color_type}')
    if bit_depth not in (1, 2, 4, 8, 16):
        raise ValueError(f'Unsupported bit depth {bit_depth}')
    if color_type == 3 and len(palette) < 3:
        raise ValueError('Palette image with no PLTE chunk')

    raw = zlib.decompress(b''.join(idat_chunks))

    bits_per_pixel = channels * bit_depth
    # Filters operate on whole bytes; the offset is the pixel size rounded down
    # to a byte, never less than 1.
    fbpp = max(1, bits_per_pixel // 8)
    stride = (width * bits_per_pixel + 7) // 8

    rows = []
    prev_row = bytearray(stride)
    pos = 0
    for _y in range(height):
        filter_byte = raw[pos]
        pos += 1
        row_data = bytearray(raw[pos:pos + stride])
        pos += stride

        if filter_byte == 0:  # None
            pass
        elif filter_byte == 1:  # Sub
            for i in range(fbpp, stride):
                row_data[i] = (row_data[i] + row_data[i - fbpp]) & 0xFF
        elif filter_byte == 2:  # Up
            for i in range(stride):
                row_data[i] = (row_data[i] + prev_row[i]) & 0xFF
        elif filter_byte == 3:  # Average
            for i in range(stride):
                a = row_data[i - fbpp] if i >= fbpp else 0
                row_data[i] = (row_data[i] + ((a + prev_row[i]) >> 1)) & 0xFF
        elif filter_byte == 4:  # Paeth
            for i in range(stride):
                a = row_data[i - fbpp] if i >= fbpp else 0
                b = prev_row[i]
                c = prev_row[i - fbpp] if i >= fbpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    pr = a
                elif pb <= pc:
                    pr = b
                else:
                    pr = c
                row_data[i] = (row_data[i] + pr) & 0xFF
        else:
            raise ValueError(f'Unknown filter type {filter_byte}')

        rows.append(_row_to_rgb(row_data, width, bit_depth, color_type, channels, palette))
        prev_row = row_data

    return width, height, rows


# Color predicates. The green threshold accounts for the theme's translucent
# layers dimming the wallpaper: Default Dark at opacity 0.15 plus the sidebar's
# rgba(37,37,38,0.3) leaves the green channel around 160-220 over a solid green
# desktop, while an opaque dark UI sits near 30 on all channels. Channel
# dominance (1.5x) rejects grays and whites regardless of brightness.
def is_green(r, g, b):
    return g > 60 and g > r * 1.5 and g > b * 1.5


# Deliberately strict — near-pure #ff00ff only. The beacon is a solid magenta
# frame, so it matches easily, while colorful OS chrome that happens to be in
# the capture (macOS dock icons, Windows taskbar) does not: a loose "pink-ish"
# predicate put those close to the post-uninstall "beacon is gone" threshold.
def is_magenta(r, g, b):
    return r > 200 and b > 200 and g < 80


PREDICATES = {'green': is_green, 'magenta': is_magenta}


def check_pixels(filepath, spec='15', color='green'):
    width, height, rows = read_png(filepath)
    predicate = PREDICATES[color]

    if ',' in spec:
        # Explicit region as fractions of the image: "x0,y0,x1,y1"
        fx0, fy0, fx1, fy1 = (float(v) for v in spec.split(','))
        x_start, x_end = int(width * fx0), int(width * fx1)
        y_start, y_end = int(height * fy0), int(height * fy1)
    else:
        # Crop N% from each edge to avoid OS chrome (menu bar, dock, taskbar)
        crop_pct = float(spec)
        x_margin = int(width * crop_pct / 100)
        y_margin = int(height * crop_pct / 100)
        x_start, x_end = x_margin, width - x_margin
        y_start, y_end = y_margin, height - y_margin

    total = 0
    match_count = 0

    for y in range(y_start, y_end):
        row = rows[y]
        for x in range(x_start, x_end):
            offset = x * 3
            total += 1
            if predicate(row[offset], row[offset + 1], row[offset + 2]):
                match_count += 1

    return (match_count / total * 100) if total > 0 else 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 check-green.py <image.png> [crop_pct|x0,y0,x1,y1] [green|magenta]', file=sys.stderr)
        sys.exit(2)

    filepath = sys.argv[1]
    spec = sys.argv[2] if len(sys.argv) > 2 else '15'
    color = sys.argv[3] if len(sys.argv) > 3 else 'green'

    try:
        pct = check_pixels(filepath, spec, color)
        print(f'{pct:.1f}')
        sys.exit(0)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(2)
