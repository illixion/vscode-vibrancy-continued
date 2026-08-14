"""
Measure what percentage of a PNG screenshot region matches a target color.

Used by the E2E test to verify *true* vibrancy: the desktop wallpaper is set to
solid green and the vibrancy type to "transparent", so green pixels inside the
VSCode window can only come from the desktop showing through the window. A
solid magenta beacon painted by the custom-imports CSS proves CSS injection
independently of transparency.

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

def read_png(filepath):
    """Minimal PNG reader — returns (width, height, rows) where rows is list of bytes per row."""
    with open(filepath, 'rb') as f:
        sig = f.read(8)
        if sig != b'\x89PNG\r\n\x1a\n':
            raise ValueError('Not a PNG file')

        width = height = bit_depth = color_type = 0
        idat_chunks = []

        while True:
            header = f.read(8)
            if len(header) < 8:
                break
            length, chunk_type = struct.unpack('>I4s', header)
            data = f.read(length)
            f.read(4)  # CRC

            if chunk_type == b'IHDR':
                width, height, bit_depth, color_type = struct.unpack('>IIBB', data[:10])
            elif chunk_type == b'IDAT':
                idat_chunks.append(data)
            elif chunk_type == b'IEND':
                break

    if not idat_chunks:
        raise ValueError('No IDAT chunks')

    raw = zlib.decompress(b''.join(idat_chunks))

    # Determine bytes per pixel
    if color_type == 2:    # RGB
        bpp = 3
    elif color_type == 6:  # RGBA
        bpp = 4
    else:
        raise ValueError(f'Unsupported color type {color_type}')

    stride = 1 + width * bpp  # 1 filter byte + pixel data per row

    rows = []
    prev_row = bytes(width * bpp)
    for y in range(height):
        offset = y * stride
        filter_byte = raw[offset]
        row_data = bytearray(raw[offset + 1:offset + stride])

        # Undo PNG filters
        if filter_byte == 0:  # None
            pass
        elif filter_byte == 1:  # Sub
            for i in range(bpp, len(row_data)):
                row_data[i] = (row_data[i] + row_data[i - bpp]) & 0xFF
        elif filter_byte == 2:  # Up
            for i in range(len(row_data)):
                row_data[i] = (row_data[i] + prev_row[i]) & 0xFF
        elif filter_byte == 3:  # Average
            for i in range(len(row_data)):
                a = row_data[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                row_data[i] = (row_data[i] + (a + b) // 2) & 0xFF
        elif filter_byte == 4:  # Paeth
            for i in range(len(row_data)):
                a = row_data[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                c = prev_row[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    pr = a
                elif pb <= pc:
                    pr = b
                else:
                    pr = c
                row_data[i] = (row_data[i] + pr) & 0xFF

        rows.append(bytes(row_data))
        prev_row = row_data

    return width, height, bpp, rows


# Color predicates. The green threshold accounts for the theme's translucent
# layers dimming the wallpaper: Default Dark at opacity 0.15 plus the sidebar's
# rgba(37,37,38,0.3) leaves the green channel around 160-220 over a solid green
# desktop, while an opaque dark UI sits near 30 on all channels. Channel
# dominance (1.5x) rejects grays and whites regardless of brightness.
def is_green(r, g, b):
    return g > 60 and g > r * 1.5 and g > b * 1.5

def is_magenta(r, g, b):
    return r > 80 and b > 80 and r > g * 1.5 and b > g * 1.5

PREDICATES = {'green': is_green, 'magenta': is_magenta}


def check_pixels(filepath, spec='15', color='green'):
    width, height, bpp, rows = read_png(filepath)
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
            offset = x * bpp
            r, g, b = row[offset], row[offset + 1], row[offset + 2]
            total += 1
            if predicate(r, g, b):
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
