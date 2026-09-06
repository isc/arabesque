#!/bin/bash
# $1: crop jpg → $2: binary pgm, ink black, staff lines horizontal.
# Adaptive threshold: the paper is not lit evenly across a photographed double
# page. The tilt is measured and the photo rotated straight in up to three
# passes: the first takes out the bulk, the others what a coarse search left.
set -e
here=$(dirname "$0")
tobin() { convert "$1" -colorspace Gray -lat 30x30-8% -depth 8 -compress none pgm:- | python3 -c "
import sys
t=sys.stdin.read().split()
w,h=int(t[1]),int(t[2]); vals=t[4:]
sys.stdout.buffer.write(b'P5\n%d %d\n255\n'%(w,h)+bytes(255 if int(v)>0 else 0 for v in vals))"; }
straight="${2%.pgm}-straight.jpg"
cp "$1" "$straight"
tobin "$straight" > "$2"
for pass in 1 2 3; do
  # Pass 1 finds the bulk of the tilt by projection; the later passes read
  # the residual off the staff lines, which is exact but needs them nearly
  # straight already.
  if [ $pass = 1 ]; then a=$(python3 "$here/tilt_coarse.py" "$2"); else a=$(python3 "$here/tilt_fine.py" "$2"); fi
  echo "$1 pass $pass tilt ${a}°"
  if [ "$(python3 -c "print(abs(float('$a')) < 0.05)")" = "True" ]; then break; fi
  convert "$straight" -background white -rotate "$(python3 -c "print(-float('$a'))")" +repage "$straight.tmp.jpg"
  mv "$straight.tmp.jpg" "$straight"
  tobin "$straight" > "$2"
done
