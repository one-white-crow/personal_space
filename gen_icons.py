import zlib, struct, math, os

OUT = r"D:\WorkBuddy\玄幻小说创作\icons"
os.makedirs(OUT, exist_ok=True)

# Brand colors (RGB)
AMBER = (201, 120, 62)    # time
TEAL  = (58, 107, 123)    # work/study
SAGE  = (107, 142, 90)    # health

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def grad(x, y, W, H):
    u = x / (W - 1)
    v = y / (H - 1)
    t = (u + v) / 2.0
    if t < 0.5:
        return lerp(AMBER, TEAL, t / 0.5)
    else:
        return lerp(TEAL, SAGE, (t - 0.5) / 0.5)

def rounded_alpha(x, y, W, H, r):
    qx = abs(x - W / 2) - (W / 2 - r)
    qy = abs(y - H / 2) - (H / 2 - r)
    outside = math.sqrt(max(qx, 0) ** 2 + max(qy, 0) ** 2) + min(max(qx, qy), 0) - r
    return max(0.0, min(1.0, 0.5 - outside))

def make_icon(size, maskable):
    W = H = size
    r = int(size * 0.22)  # corner radius for standard icon
    # three dots
    dot_r = size * 0.085
    if maskable:
        # safe zone: keep glyph within center 80%
        gap = size * 0.13
    else:
        gap = size * 0.17
    cx = W / 2
    cy = H / 2
    dot_xs = [cx - gap, cx, cx + gap]

    raw = bytearray()
    for y in range(H):
        raw.append(0)  # filter byte
        for x in range(W):
            base = grad(x, y, W, H)
            if maskable:
                a = 255
            else:
                a = int(rounded_alpha(x + 0.5, y + 0.5, W, H, r) * 255)
            # draw white dots
            for dx in dot_xs:
                if (x - dx) ** 2 + (y - cy) ** 2 <= dot_r ** 2:
                    base = (255, 255, 255)
                    a = 255
                    break
            raw.extend(bytes((base[0], base[1], base[2], a)))
    return bytes(raw)

def write_png(path, size, rgba):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(rgba, 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))

for size in (192, 512):
    write_png(os.path.join(OUT, f"icon-{size}.png"), size, make_icon(size, False))
    write_png(os.path.join(OUT, f"maskable-{size}.png"), size, make_icon(size, True))
    print(f"generated {size}")

print("done:", os.listdir(OUT))
