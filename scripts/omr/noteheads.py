#!/usr/bin/env python3
"""Notehead finder for one photographed song (any number of staves).

    noteheads.py song.pgm [clefs] [overlay.grid]

Reads a binary PGM (P5, 0 = ink) as prepare.sh writes it, finds the staff
lines in a narrow band on each side (so a residual tilt is modelled rather
than fought), erases them where nothing crosses them, closes the hollow heads,
labels the connected ink, and prints every blob with notehead-wide rows: its
staff, x, the pitch its centre lands on, filled or hollow, and which way its
stem points. `clefs` names each staff top to bottom, T or B (default: treble
and bass alternating). With a third argument, ImageMagick draw commands for
an overlay of the detected lines are written there — see README.md.
"""
import sys
from collections import deque

path = sys.argv[1]
with open(path, 'rb') as f:
    assert f.readline().strip() == b'P5'
    line = f.readline()
    while line.startswith(b'#'):
        line = f.readline()
    w, h = map(int, line.split())
    f.readline()  # maxval
    data = f.read()

ink = [[data[y * w + x] < 128 for x in range(w)] for y in range(h)]

# --- staff lines, measured in a band at each side so a tilted photo still
# reads: each line is then the straight line through its two measurements.
def line_centers(xa, xb):
    dark = [y for y in range(h) if sum(ink[y][xa:xb]) > 0.5 * (xb - xa)]
    groups = []
    for y in dark:
        if groups and y - groups[-1][-1] <= 2:
            groups[-1].append(y)
        else:
            groups.append([y])
    # A title or a slur running along a line is a band far thicker than a line.
    return [g for g in groups if len(g) <= 5]


def spacing_of(group):
    return (group[-1] - group[0]) / 4


def staves_of(groups):
    centers = [sum(g) / len(g) for g in groups]
    found, i = [], 0
    while i + 5 <= len(centers):
        group = centers[i:i + 5]
        gaps = [b - a for a, b in zip(group, group[1:])]
        if max(gaps) < 1.6 * min(gaps):
            found.append((group, groups[i:i + 5]))
            i += 5
        else:
            i += 1
    # The little reminder staves drawn above a system are staves too, at half
    # the size: keep the full-size ones.
    if found:
        full = max(spacing_of(f[0]) for f in found)
        found = [f for f in found if spacing_of(f[0]) > 0.7 * full]
    return found


# Narrow bands: a tilt of a few degrees spreads a line over several rows across
# a wide band, and it stops reading as a line.
band = 60


def staves_near(fractions):
    # Several bands, merged: any one band can land on a clef or a chord that
    # hides a line, but rarely all of them.
    found = []
    for fr in fractions:
        xa = int(w * fr)
        for st in staves_of(line_centers(xa, xa + band)):
            if not any(abs(f[0][2] - st[0][2]) < spacing_of(st[0]) * 2 for f in found):
                found.append(st)
    found.sort(key=lambda st: st[0][2])
    return found


LEFT_BANDS, RIGHT_BANDS = (0.20, 0.28, 0.36), (0.65, 0.75, 0.85)
# Lines are interpolated between the middle band of each side.
xl, xr = w * LEFT_BANDS[1] + band / 2, w * RIGHT_BANDS[1] + band / 2
lefts = staves_near(LEFT_BANDS)
rights = staves_near(RIGHT_BANDS)
# Pair each left staff with the right staff whose middle line is nearest.
pairs = []
for ls in lefts:
    best = min(rights, key=lambda rs: abs(rs[0][2] - ls[0][2]), default=None)
    if best and abs(best[0][2] - ls[0][2]) < 2 * (ls[0][4] - ls[0][0]):
        pairs.append((ls, best))
# Which clef each staff carries, top to bottom: treble and bass alternating
# unless said otherwise (a right-hand-only piece is all treble: "TTT").
clefs = (sys.argv[2] if len(sys.argv) > 2 else '') or ('TB' * len(pairs))[:len(pairs)]
if not pairs or len(clefs) != len(pairs):
    print('left', [[round(c) for c in s[0]] for s in lefts], 'right', [[round(c) for c in s[0]] for s in rights], file=sys.stderr)
    sys.exit(f'{len(pairs)} staves paired, clefs given for {len(clefs)}')
left = [p[0] for p in pairs]
right = [p[1] for p in pairs]
nstaves = len(pairs)


def line_y(si, li, x):
    yl, yr = left[si][0][li], right[si][0][li]
    return yl + (yr - yl) * (x - xl) / (xr - xl)


spacing = sum((left[s][0][4] - left[s][0][0] + right[s][0][4] - right[s][0][0]) / 8 for s in range(nstaves)) / nstaves

# --- overlay: the five lines of each staff and the middle-C ledger line,
# drawn across the whole width, for reading pitches by eye on a photo that
# is never perfectly straight.
if len(sys.argv) > 3:
    with open(sys.argv[3], 'w') as g:
        for si in range(nstaves):
            for li in range(5):
                g.write(f"-stroke '#e00000' -strokewidth 1 -draw \"line 0,{line_y(si, li, 0):.1f} {w},{line_y(si, li, w):.1f}\" ")
            # middle C: one ledger line below a treble staff, one above a bass staff
            step = -2 if clefs[si] == 'T' else 10
            ya, yb = line_y(si, 4, 0) - step * spacing / 2, line_y(si, 4, w) - step * spacing / 2
            g.write(f"-stroke '#00a000' -strokewidth 1 -draw \"line 0,{ya:.1f} {w},{yb:.1f}\" ")

# --- erase staff lines where nothing crosses them. The model line says
# roughly where each is; the ink itself says exactly, column by column, so a
# page that curves near its binding is followed rather than missed.
bottom_at = [[None] * w for _ in range(nstaves)]  # the bottom line as traced, per column
for si in range(nstaves):
    for li in range(5):
        for x in range(w):
            yc = int(round(line_y(si, li, x)))
            best = None
            for dy in (0, -1, 1, -2, 2, -3, 3, -4, 4):
                y = yc + dy
                if 0 <= y < h and ink[y][x]:
                    best = y
                    break
            if best is None:
                continue
            top = bot = best
            while top - 1 >= 0 and ink[top - 1][x] and best - top < 4:
                top -= 1
            while bot + 1 < h and ink[bot + 1][x] and bot - best < 4:
                bot += 1
            if bot - top > 5:
                continue  # part of something tall, not a line
            if li == 4:
                bottom_at[si][x] = (top + bot) / 2
            if top - 1 >= 0 and bot + 1 < h and not (ink[top - 1][x] and ink[bot + 1][x]):
                for y in range(top, bot + 1):
                    ink[y][x] = False

# --- close the ink: grow it by two pixels, fill what is now enclosed, then
# shrink it back. A hollow head whose thin oval the threshold broke closes
# again and comes out solid; a slur or a stem comes out as it went in.
def grow(img, r):
    out = [row[:] for row in img]
    for y in range(h):
        for x in range(w):
            if img[y][x]:
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w:
                            out[ny][nx] = True
    return out


def shrink(img, r):
    out = [row[:] for row in img]
    for y in range(h):
        for x in range(w):
            if img[y][x]:
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        ny, nx = y + dy, x + dx
                        if not (0 <= ny < h and 0 <= nx < w) or not img[ny][nx]:
                            out[y][x] = False
                            break
                    else:
                        continue
                    break
    return out


GROW = 2
orig = [row[:] for row in ink]


# --- hollow heads by their hole: the white inside a half or whole note is an
# oval of a known size, enclosed once the ink has grown a pixel. Digits and
# the treble clef leave holes too, but not of that shape.
def holes_of(img, lo_area, hi_area):
    found = []
    seen = [[False] * w for _ in range(h)]
    for sy in range(h):
        for sx in range(w):
            if img[sy][sx] or seen[sy][sx]:
                continue
            q = deque([(sy, sx)])
            seen[sy][sx] = True
            region, border, too_big = [], False, False
            while q:
                y, x = q.popleft()
                if y == 0 or x == 0 or y == h - 1 or x == w - 1:
                    border = True
                if not too_big:
                    region.append((y, x))
                    if len(region) > hi_area:
                        region, too_big = [], True  # the walk goes on, only to mark it seen
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not img[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((ny, nx))
            if region and not border and lo_area <= len(region) <= hi_area:
                ys_ = [p[0] for p in region]
                xs_ = [p[1] for p in region]
                bw_, bh_ = max(xs_) - min(xs_) + 1, max(ys_) - min(ys_) + 1
                # An oval fills less of its box than a rectangle, and is
                # narrower at its top and bottom rows than in the middle.
                rows_ = {}
                for y, x in region:
                    rows_[y] = rows_.get(y, 0) + 1
                mid = rows_.get((min(ys_) + max(ys_)) // 2, 0)
                ends = max(rows_[min(ys_)], rows_[max(ys_)])
                elliptical = len(region) < 0.88 * bw_ * bh_ and ends < 0.75 * mid
                found.append(((min(xs_) + max(xs_)) / 2, (min(ys_) + max(ys_)) / 2, bw_, bh_, elliptical))
    return found


hole_heads = []
grown_once = grow(ink, 1)
for hx, hy, hw, hh, elliptical in holes_of(grown_once, 0.08 * spacing * spacing, 1.2 * spacing * spacing):
    if 0.45 * spacing <= hw <= 1.6 * spacing and 0.2 * spacing <= hh <= 0.9 * spacing and hw > hh and elliptical:
        hole_heads.append((hx, hy))

ink = grow(grown_once, GROW - 1)
# A hole is a small white region enclosed by ink. Small: a shadow along the
# page edge can close a loop around the whole image, and that is not a hole.
max_hole = 4 * spacing * spacing
seen_white = [[False] * w for _ in range(h)]
for sy in range(h):
    for sx in range(w):
        if ink[sy][sx] or seen_white[sy][sx]:
            continue
        q = deque([(sy, sx)])
        seen_white[sy][sx] = True
        region = []
        touches_border = False
        while q:
            y, x = q.popleft()
            region.append((y, x))
            if y == 0 or x == 0 or y == h - 1 or x == w - 1:
                touches_border = True
            if len(region) > max_hole and touches_border:
                region = None
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and not ink[ny][nx] and not seen_white[ny][nx]:
                    seen_white[ny][nx] = True
                    q.append((ny, nx))
            if region is None:
                region = []
        if region and len(region) <= max_hole and not touches_border:
            for y, x in region:
                ink[y][x] = True

ink = shrink(ink, GROW)

# --- connected components
seen = [[False] * w for _ in range(h)]
blobs = []
for sy in range(h):
    for sx in range(w):
        if not ink[sy][sx] or seen[sy][sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy][sx] = True
        pts = []
        while q:
            y, x = q.popleft()
            pts.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and ink[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((ny, nx))
        blobs.append(pts)

NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']


def traced_bottom(staff_idx, x):
    # the bottom line as the ink has it near this column, else the model
    xi = int(x)
    for dx in range(0, 30):
        for xx in (xi - dx, xi + dx):
            if 0 <= xx < w and bottom_at[staff_idx][xx] is not None:
                return bottom_at[staff_idx][xx]
    return line_y(staff_idx, 4, x)


def pitch(staff_idx, x, y):
    bottom = traced_bottom(staff_idx, x)
    steps = round((bottom - y) / (spacing / 2))
    # treble bottom line E4 = step 0; bass bottom line G2
    base = 2 + 4 * 7 if clefs[staff_idx] == 'T' else 4 + 2 * 7  # diatonic index from C0
    idx = base + steps
    return f'{NAMES[idx % 7]}{idx // 7}'


# Which staff a head belongs to: the nearest, unless the head sits in the gap
# between two staves, where the stem decides — this book points stems away
# from the note's own staff, so a stem going up hangs the note under the
# treble staff and a stem going down floats it above the bass.
def staff_and_stem(hx, hy, top, bot):
    si = min(range(nstaves), key=lambda i: abs(line_y(i, 2, hx) - hy))
    cx = int(hx)
    cols = range(max(0, cx - 12), min(w, cx + 12))
    above = sum(1 for y in range(max(0, top - int(2 * spacing)), top) if any(orig[y][x] for x in cols))
    below = sum(1 for y in range(bot + 1, min(h, bot + int(2 * spacing))) if any(orig[y][x] for x in cols))
    stem = ''
    if above > 1.5 * spacing and below < spacing:
        stem = 'up'
    elif below > 1.5 * spacing and above < spacing:
        stem = 'down'
    for i in range(nstaves - 1):
        if line_y(i, 4, hx) < hy < line_y(i + 1, 0, hx) and clefs[i] == 'T' and clefs[i + 1] == 'B':
            if stem == 'up':
                si = i
            elif stem == 'down':
                si = i + 1
    return si, stem

# --- heads: within a blob, rows whose ink runs are about a head wide, clustered
# by adjacency. Stems are too thin, slurs and beams too wide or too slanted.
out = []
for pts in blobs:
    if len(pts) < spacing * spacing * 0.15:
        continue
    rows = {}
    for y, x in pts:
        rows.setdefault(y, []).append(x)
    runs = []  # (y, x_start, x_end)
    for y, xs in rows.items():
        xs.sort()
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is None or x != prev + 1:
                width = prev - start + 1
                if 0.7 * spacing <= width <= 2.1 * spacing:
                    runs.append((y, start, prev))
                if x is not None:
                    start = x
            if x is not None:
                prev = x
    runs.sort()
    heads = []
    for r in runs:
        for hd in heads:
            last = hd[-1]
            if r[0] - last[0] == 1 and r[1] <= last[2] and r[2] >= last[1]:
                hd.append(r)
                break
        else:
            heads.append([r])
    for hd in heads:
        top, bot = hd[0][0], hd[-1][0]
        height = bot - top + 1
        if not 0.45 * spacing <= height <= 1.5 * spacing:
            continue
        lft, rgt = min(r[1] for r in hd), max(r[2] for r in hd)
        if rgt - lft + 1 > 2.2 * spacing:
            continue  # a slanted slur
        area = sum(r[2] - r[1] + 1 for r in hd)
        if area < 0.6 * height * (rgt - lft + 1):
            continue
        hy = (top + bot) / 2
        hx = (lft + rgt) / 2
        core = [(y, x) for y in range(top + 2, bot - 1) for x in range(lft + 3, rgt - 2)]
        filled = core and sum(orig[y][x] for y, x in core) / len(core) > 0.7
        si, stem = staff_and_stem(hx, hy, top, bot)
        out.append((si, hx, hy, filled, rgt - lft + 1, height, stem))

for hx, hy in hole_heads:
    if any(abs(o[1] - hx) < 0.6 * spacing and abs(o[2] - hy) < 0.6 * spacing for o in out):
        continue
    si, stem = staff_and_stem(hx, hy, int(hy - 0.5 * spacing), int(hy + 0.5 * spacing))
    out.append((si, hx, hy, False, 0, 0, stem + ' (hole)'))

print(f'spacing {spacing:.1f}px, {nstaves} staves')
for si in range(nstaves):
    print(f'--- staff {si + 1} ' + ('TREBLE' if clefs[si] == 'T' else 'BASS'))
    for _, hx, hy, filled, bw, bh, stem in sorted((o for o in out if o[0] == si), key=lambda o: o[1]):
        print(f'  x={hx:6.0f} y={hy:5.0f} {pitch(si, hx, hy):4} {"filled" if filled else "hollow"} {bw}x{bh} {stem}')
