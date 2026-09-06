# Reading a photographed score

What made the transcription of the Allerme songs (`scripts/chansons/`)
possible: a photo of a page, taken at an angle under a lamp, is not something
to read pitches off by eye. These scripts straighten it and tell where every
notehead sits relative to the staff lines. Rhythms, rests, slurs and fingerings
are still read by eye; only the pitches are measured.

```bash
# 1. Crop one song (both systems) out of the photo, e.g. with ImageMagick:
convert page.jpg -crop 1500x700+500+980 +repage song.jpg

# 2. Threshold and straighten it (two passes: coarse by projection, then
#    exact from the staff lines). Writes song.pgm and song-straight.jpg.
scripts/omr/prepare.sh song.jpg song.pgm

# 3. List the noteheads: staff, x, pitch, filled or hollow, stem direction.
#    The clefs argument names each staff top to bottom ("" = treble/bass
#    alternating; "TTT" for three treble staves). The last argument, if
#    given, receives ImageMagick draw commands that overlay the detected
#    staff lines and middle-C ledger line on the straightened photo:
scripts/omr/noteheads.py song.pgm "" song.grid
eval convert song-straight.jpg $(cat song.grid) song-overlay.jpg
```

The overlay is the most useful output: zoomed in, every head is plainly on a
red line or between two, and reading the pitch by eye becomes reliable. The
listed pitches are right for filled heads well inside a staff; hollow heads
and heads touching a slur are found less reliably, so treat the list as a
cross-check, not as the transcription.

Pure Python 3 and ImageMagick, nothing else: the machine this was written on
had neither NumPy nor Pillow.
