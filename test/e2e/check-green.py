"""
Check if a PNG screenshot contains a meaningful amount of green pixels.
Samples the center region of the image (avoiding OS chrome like dock/taskbar).

Usage: python3 check-green.py <image.png> [crop_percent]
  crop_percent: percentage to crop from each edge (default: 15)

Exit code 0 = enough green found, 1 = not enough green.
Prints the green pixel percentage to stdout.
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


def check_green(filepath, crop_pct=15):
    width, height, bpp, rows = read_png(filepath)

    # Crop to center region to avoid OS chrome (dock, taskbar, etc.)
    x_margin = int(width * crop_pct / 100)
    y_margin = int(height * crop_pct / 100)
    x_start = x_margin
    x_end = width - x_margin
    y_start = y_margin
    y_end = height - y_margin

    total = 0
    green_count = 0

    for y in range(y_start, y_end):
        row = rows[y]
        for x in range(x_start, x_end):
            offset = x * bpp
            r, g, b = row[offset], row[offset + 1], row[offset + 2]
            total += 1
            # A pixel is "green" if green channel dominates
            if g > 80 and g > r * 1.5 and g > b * 1.5:
                green_count += 1

    pct = (green_count / total * 100) if total > 0 else 0
    return pct


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 check-green.py <image.png> [crop_percent]', file=sys.stderr)
        sys.exit(2)

    filepath = sys.argv[1]
    crop_pct = int(sys.argv[2]) if len(sys.argv) > 2 else 15

    try:
        pct = check_green(filepath, crop_pct)
        print(f'{pct:.1f}')
        # 5% threshold — if more than 5% of the cropped center is green,
        # vibrancy is likely applied
        sys.exit(0 if pct >= 5.0 else 1)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(2)
