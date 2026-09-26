#!/usr/bin/env python3
"""Tilt of the staff lines in a binary PGM, in degrees.

Tries every angle in a range and keeps the one at which the ink, projected
onto rows, is the most concentrated: straight staff lines pile up into five
sharp peaks, tilted ones smear.
"""
import sys, math
with open(sys.argv[1], 'rb') as f:
    f.readline(); w, h = map(int, f.readline().split()); f.readline(); d = f.read()

pts = [(y, x) for y in range(h) for x in range(int(w * 0.15), int(w * 0.95), 3) if d[y * w + x] < 128]
def score(a):
    t = math.tan(math.radians(a))
    hist = [0] * (2 * h + 2 * w)
    for y, x in pts:
        hist[int(y - x * t) + w] += 1
    return sum(v * v for v in hist)

# A coarse sweep of the whole range, then a fine one around its best angle.
coarse = max((a / 2 for a in range(-20, 21)), key=score)
fine = max((coarse + a / 20 for a in range(-10, 11)), key=score)
print(f'{fine:.2f}')
