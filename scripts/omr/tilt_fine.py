#!/usr/bin/env python3
"""Residual tilt, in degrees, from the staff lines themselves: each line's
height is measured in a narrow band on the left and on the right, staves are
matched by order, and the median slope is the answer. Prints nothing useful
(0) when the two sides don't see the same staves."""
import sys, math
with open(sys.argv[1], 'rb') as f:
    f.readline(); w, h = map(int, f.readline().split()); f.readline(); d = f.read()

def lines_at(xa, width=14):
    xb = xa + width
    dark = [y for y in range(h) if sum(1 for x in range(xa, xb) if d[y * w + x] < 128) >= width * 0.7]
    groups = []
    for y in dark:
        if groups and y - groups[-1][-1] <= 2: groups[-1].append(y)
        else: groups.append([y])
    return [sum(g) / len(g) for g in groups if len(g) <= 5]

def staves(centers):
    found, i = [], 0
    while i + 5 <= len(centers):
        g = centers[i:i + 5]
        gaps = [b - a for a, b in zip(g, g[1:])]
        if max(gaps) < 1.5 * min(gaps) and 8 <= sum(gaps) / 4 <= 30:
            found.append(g); i += 5
        else:
            i += 1
    return found

best = None
for fl, fr in ((0.3, 0.7), (0.25, 0.75), (0.35, 0.65), (0.2, 0.8)):
    xa, xb = int(w * fl), int(w * fr)
    sl, sr = staves(lines_at(xa)), staves(lines_at(xb))
    if sl and len(sl) == len(sr):
        slopes = sorted((r[j] - l[j]) / (xb - xa) for l, r in zip(sl, sr) for j in range(5))
        med = slopes[len(slopes) // 2]
        best = math.degrees(math.atan(med))
        break
print(f'{best:.2f}' if best is not None else '0')
