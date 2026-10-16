#!/usr/bin/env python3
"""Build the library's Hanon scales and arpeggios from one transcription.

    hanon_scales.py source.mxl [--dry-run] [--catalog]

Le Pianiste virtuose, nos 39 to 43 — the scales in every key, the chromatic
scales, the arpeggios on every triad, and the arpeggios on the diminished and
dominant sevenths — come from one MuseScore upload (PDMX 4868686, CC0): the
pieces back to back, each starting again at bar 1. This cuts it into one .mxl
per scale or exercise in public/scores/, the parts of one collection in
public/data/scores.json (`--catalog` prints that entry), and on the way does
three things the upload does not:

- It checks every note against what the exercise has to be. A scale or an
  arpeggio is spelled out entirely by its key, so each hand is compared with
  it note by note, spelling included; a chromatic run moves by semitones; a
  seventh-chord arpeggio walks its chord from one tone to the next. The hands
  sound an octave apart (a fixed interval, or in mirror, in the chromatic
  scales). What the upload has wrong is put right in PATCHES and OCTAVES,
  each line checked against what it replaces, and nothing is written while
  anything is still out of place.

- It puts each hand on its own staff. The upload writes the hands as voices,
  each wandering across both staves — a scale's right hand starts on the bass
  staff and its left climbs onto the treble — while the score page tells the
  hands apart by staff (handOfNote, public/js/noteExtraction.js). Voice 1 goes
  on the upper staff and voice 5 on the lower, and the clefs and ottava lines
  move instead, beat by beat, to keep the notes within a few ledger lines of
  the staff (STATES). The accidentals are then worked out again, staff by
  staff.

- It fingers every note of the runs. The scales follow a chart of where the
  fourth finger falls in each key and mode (FOURTH_FINGER), which settles the
  rest of a scale's fingering; the arpeggios the same chart's root-position
  fingerings (ARPEGGIOS). The chromatic scales and the seventh chords follow
  the usual rules, written where they are applied. The cadence closing each
  scale keeps the few fingerings the upload has. Each fingering is checked
  for a hand that can play it: the thumb passes under or a finger crosses
  over it, never two fingers past each other, and a scale's thumb never falls
  on a black key.

Standard library only. Re-run `node scripts/generate-fingerprints.mjs`
afterwards; a part added or renamed also goes through
`node scripts/bar-counts.mjs`.
"""
import argparse
import copy
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import namedtuple
from pathlib import Path

from compare import STEPS as SEMITONES, Score

OUTPUT_DIR = Path(__file__).resolve().parents[2] / 'public' / 'scores'
SOURCE_URL = 'https://musescore.com/score/4868686'
COMPOSER = 'Charles-Louis Hanon'
FILE_PREFIX = 'Hanon_Le_Pianiste_Virtuose_'
COLLECTION = 'Le Pianiste virtuose (gammes et arpèges)'

STEPS = 'CDEFGAB'
SIGNS = {'bb': -2, 'b': -1, '': 0, '#': 1, 'x': 2}
SIGN_TEXT = {v: k for k, v in SIGNS.items()}
BLACK = {1, 3, 6, 8, 10}
RH, LH = '1', '5'  # the voice the upload gives each hand


class Pitch(namedtuple('Pitch', 'step alter octave')):
    @property
    def midi(self):
        return 12 * (self.octave + 1) + SEMITONES[self.step] + self.alter

    @property
    def diatonic(self):
        return 7 * self.octave + STEPS.index(self.step)

    @property
    def pc(self):
        return self.step, self.alter

    @property
    def black(self):
        return self.midi % 12 in BLACK

    def __str__(self):
        return pc_name(self.pc) + str(self.octave)


def parse_pitch(text):
    return Pitch(*parse_pc(text[:-1]), int(text[-1]))


def pc_name(pc):
    step, alter = pc
    return step + SIGN_TEXT[alter]


def parse_pc(text):
    m = re.fullmatch(r'([A-G])(bb|b|#|x|)', text)
    return m[1], SIGNS[m[2]]


def pitch_of(note):
    p = note.find('pitch')
    return p is not None and Pitch(p.findtext('step'), int(p.findtext('alter') or 0), int(p.findtext('octave')))


def set_pitch(note, pitch):
    p = note.find('pitch')
    p.find('step').text = pitch.step
    p.find('octave').text = str(pitch.octave)
    alter = p.find('alter')
    if pitch.alter and alter is None:
        alter = ET.Element('alter')
        p.insert(1, alter)
    if pitch.alter:
        alter.text = str(pitch.alter)
    elif alter is not None:
        p.remove(alter)


# ---------------------------------------------------------------------------
# Scales, spelled

INTERVALS = {
    'major': (2, 2, 1, 2, 2, 2, 1),
    'harmonic': (2, 1, 2, 2, 1, 3, 1),
    'melodic': (2, 1, 2, 2, 2, 2, 1),  # going up
    'natural': (2, 1, 2, 2, 1, 2, 2),  # the melodic minor coming down
}


def spell(tonic, mode):
    """The seven degrees of a scale, as (step, alter), from its tonic up."""
    step, alter = tonic
    index, semitones, degrees = STEPS.index(step), SEMITONES[step] + alter, []
    for interval in INTERVALS[mode]:
        s = STEPS[index % 7]
        degrees.append((s, (semitones - SEMITONES[s] + 6) % 12 - 6))
        index, semitones = index + 1, semitones + interval
    return degrees


def at(diatonic, degrees):
    """The pitch on a line or space, with the alteration the scale gives its step."""
    step = STEPS[diatonic % 7]
    return Pitch(step, dict(degrees)[step], diatonic // 7)


# ---------------------------------------------------------------------------
# What the upload holds, in the order it holds it

# No 39 goes round the circle of fifths by the flats, each major scale followed
# by its relative minor, harmonic then melodic; no 41 the same keys, a major
# arpeggio and its relative minor.
MAJOR_KEYS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'B', 'E', 'A', 'D', 'G']

FRENCH = dict(zip(STEPS, ('do', 'ré', 'mi', 'fa', 'sol', 'la', 'si')))


def key_name(tonic, minor):
    step, alter = tonic
    sign = {-1: ' bémol', 0: '', 1: ' dièse'}[alter]
    return f"{FRENCH[step]}{sign} {'mineur' if minor else 'majeur'}"


def key_file(tonic):
    step, alter = tonic
    return step + {-1: '-flat', 0: '', 1: '-sharp'}[alter]


def relative_minor(major):
    return spell(major, 'major')[5]


Piece = namedtuple('Piece', 'kind title file tonic mode section measures')


def plan():
    """The pieces the upload holds, in its order, with the source section
    (and measures within it) each comes from."""
    pieces, section = [], 0
    for key in MAJOR_KEYS:
        major = parse_pc(key)
        minor = relative_minor(major)
        for tonic, mode, label, suffix in ((major, 'major', '', 'major'),
                                           (minor, 'harmonic', ' harmonique', 'harmonic_minor'),
                                           (minor, 'melodic', ' mélodique', 'melodic_minor')):
            title = f"Gamme de {key_name(tonic, mode != 'major')}{label}"
            pieces.append(Piece('scale', title, f'39_{key_file(tonic)}_{suffix}', tonic, mode, section, None))
            section += 1
    # No 40 in six sections, the last two holding two exercises each: which
    # section after the scales, and which of its bars.
    chromatic = [
        ("à l'octave", 'octaves', 0, None),
        ('à la tierce mineure', 'minor_thirds', 1, None),
        ('à la sixte majeure', 'major_sixths', 2, None),
        ('à la sixte mineure', 'minor_sixths', 3, None),
        ("en mouvement contraire, depuis l'octave", 'contrary_octave', 4, (1, 5)),
        ('en mouvement contraire, depuis la tierce mineure', 'contrary_minor_third', 4, (6, 10)),
        ('en mouvement contraire, depuis la tierce majeure', 'contrary_major_third', 5, (1, 5)),
        ("à l'octave, au milieu du clavier", 'octaves_middle', 5, (6, 10)),
    ]
    for label, suffix, offset, measures in chromatic:
        pieces.append(Piece('chromatic', f'Gamme chromatique {label}', f'40_chromatic_{suffix}',
                            None, None, section + offset, measures))
    section += 6
    for key in MAJOR_KEYS:
        major = parse_pc(key)
        for tonic, mode in ((major, 'major'), (relative_minor(major), 'harmonic')):
            title = f"Arpège de {key_name(tonic, mode != 'major')}"
            name = f"41_{key_file(tonic)}_{'major' if mode == 'major' else 'minor'}"
            pieces.append(Piece('arpeggio', title, name, tonic, mode, section, None))
            section += 1
    pieces.append(Piece('seventh', 'Arpèges sur la septième diminuée', '42_diminished_sevenths',
                        None, 'diminished', section, None))
    pieces.append(Piece('seventh', 'Arpèges sur la septième de dominante', '43_dominant_sevenths',
                        None, 'dominant', section + 1, None))
    return pieces



# ---------------------------------------------------------------------------
# Corrections. A note: (source section, bar, hand, nth note of that hand in
# the bar counting from 1, what the upload has, what it should be).
PATCHES = [
    # B and E harmonic minor: the hands swapped on the scale's last note.
    (31, 8, RH, 1, 'B1', 'B2'), (31, 8, LH, 1, 'B2', 'B1'),
    (34, 8, RH, 1, 'E2', 'E3'), (34, 8, LH, 1, 'E3', 'E2'),
    # Chromatic in minor thirds: E sharp then F sharp, not F.
    (37, 4, LH, 7, 'F5', 'F#5'),
    # Chromatic in contrary motion from the minor third: G sharp twice.
    (40, 9, LH, 6, 'G#2', 'G2'),
]

# Notes in the wrong octave: (source section, bar, hand, from its nth note to
# its mth in the bar, the first as the upload has it, octaves up).
OCTAVES = [
    # Bar 4 of seven melodic minor scales, under the ottava line in both
    # hands, sounds as written: G, C, F, B flat, E flat, B, E.
    (8, 4, RH, 1, 8, 'C6', 1), (8, 4, LH, 1, 8, 'C5', 1),
    (11, 4, RH, 1, 8, 'F5', 1), (11, 4, LH, 1, 8, 'F4', 1),
    (14, 4, RH, 1, 8, 'Bb4', 1), (14, 4, LH, 1, 8, 'Bb3', 1),
    (17, 4, RH, 1, 8, 'Eb5', 1), (17, 4, LH, 1, 8, 'Eb4', 1),
    (20, 4, RH, 1, 8, 'Ab5', 1), (20, 4, LH, 1, 8, 'Ab4', 1),
    (32, 4, RH, 1, 8, 'E5', 1), (32, 4, LH, 1, 8, 'E4', 1),
    (35, 4, RH, 1, 8, 'A5', 1), (35, 4, LH, 1, 8, 'A4', 1),
    # Chromatic in major sixths: the top of the run, bar 4 to the second-last
    # note of bar 5, an octave low in the right hand and two in the left.
    (38, 4, RH, 1, 12, 'C5', 1), (38, 5, RH, 1, 11, 'C6', 1),
    (38, 4, LH, 1, 12, 'Eb3', 2), (38, 5, LH, 1, 11, 'Eb4', 2), (38, 5, LH, 12, 12, 'E4', 1),
    # Chromatic in minor sixths: the left hand an octave low in bars 4 and 5.
    (39, 4, LH, 1, 12, 'E4', 1), (39, 5, LH, 1, 12, 'E5', 1),
]

# A backward repeat whose forward repeat the upload left out: without it the
# B7 bar of no 43 would send the player back to bar 22.
FORWARD_REPEATS = [(67, 25)]

# ---------------------------------------------------------------------------
# Reading a section


def split_sections(root):
    """The source's measures, cut where the numbering starts again."""
    sections = []
    for measure in root.find('part').findall('measure'):
        if measure.get('number') == '1':
            sections.append([])
        sections[-1].append(measure)
    return sections


def onsets(measures, voice):
    """A hand's notes as [(bar number, [notes sounding together])], rests left out."""
    found = []
    for measure in measures:
        for note in measure.findall('note'):
            if note.findtext('voice') != voice or note.find('rest') is not None:
                continue
            if note.find('chord') is not None:
                found[-1][1].append(note)
            else:
                found.append((measure.get('number'), [note]))
    return found


def lone_notes(measures, voice):
    """A hand's notes that sound alone: its runs, without the chords."""
    return [notes[0] for _, notes in onsets(measures, voice) if len(notes) == 1]


def find_bar(sections, section, bar):
    return next(m for m in sections[section] if m.get('number') == str(bar))


def apply_patches(sections):
    def bar_notes(section, bar, hand):
        return [notes[0] for _, notes in onsets([find_bar(sections, section, bar)], hand)]

    for section, bar, hand, nth, was, should in PATCHES:
        note = bar_notes(section, bar, hand)[nth - 1]
        assert str(pitch_of(note)) == was, f'patch {section}/{bar}/{hand}/{nth}: found {pitch_of(note)}, not {was}'
        set_pitch(note, parse_pitch(should))
    for section, bar, hand, first, last, was, octaves in OCTAVES:
        notes = bar_notes(section, bar, hand)[first - 1:last]
        assert str(pitch_of(notes[0])) == was, f'octave {section}/{bar}/{hand}: found {pitch_of(notes[0])}, not {was}'
        for note in notes:
            pitch = pitch_of(note)
            set_pitch(note, pitch._replace(octave=pitch.octave + octaves))
    for section, bar in FORWARD_REPEATS:
        measure = find_bar(sections, section, bar)
        assert not any(b.get('location') == 'left' for b in measure.findall('barline'))
        barline = ET.Element('barline', location='left')
        ET.SubElement(barline, 'bar-style').text = 'heavy-light'
        ET.SubElement(barline, 'repeat', direction='forward')
        measure.insert(0, barline)


# ---------------------------------------------------------------------------
# Checking the notes. Each check returns the problems it finds, as text.

RUN_OCTAVES = 4  # how far every scale and arpeggio climbs before coming back
SCALE_NOTES = 2 * 7 * RUN_OCTAVES + 1


def scale_spellings(tonic, mode):
    """A scale's degrees going up, then coming down."""
    return spell(tonic, mode), spell(tonic, 'natural' if mode == 'melodic' else mode)


def compare(label, found, expected):
    problems = []
    for i, ((bar, notes), want) in enumerate(zip(found, expected)):
        have = pitch_of(notes[0])
        if len(notes) > 1 or have != want:
            problems.append(f'{label} bar {bar}, note {i + 1}: {have} instead of {want}')
    if len(found) != len(expected):
        problems.append(f'{label}: {len(found)} notes instead of {len(expected)}')
    return problems


def check_hands(piece, rh, lh, run_from):
    """Both hands against the run that starts on the right hand's first note,
    the left an octave below."""
    start = pitch_of(rh[0][1][0])
    if start.pc != piece.tonic:
        return [f'right hand starts on {start}, not the tonic']
    expected = run_from(start)
    return (compare('right hand', rh, expected)
            + compare('left hand', lh, [p._replace(octave=p.octave - 1) for p in expected]))


def scale_run(start, up, down):
    """A scale up from start and back, spelled by `up` and `down`."""
    d0, top = start.diatonic, SCALE_NOTES // 2
    return [at(d0 + k, up) for k in range(top + 1)] + [at(d0 + k, down) for k in range(top - 1, -1, -1)]


def arpeggio_run(start, degrees):
    chord = [degrees[0], degrees[2], degrees[4]]
    offsets = [7 * (k // 3) + (0, 2, 4)[k % 3] for k in range(3 * RUN_OCTAVES + 1)]
    up = [at(start.diatonic + o, chord) for o in offsets]
    return up + up[-2::-1]


def check_scale(piece, measures):
    rh, lh = onsets(measures, RH), onsets(measures, LH)
    spellings = scale_spellings(piece.tonic, piece.mode)
    return (check_hands(piece, rh[:SCALE_NOTES], lh[:SCALE_NOTES], lambda start: scale_run(start, *spellings))
            + check_cadence(piece, rh[SCALE_NOTES:], lh[SCALE_NOTES:]))


# The cadence after each scale: II 6/5, I 6/4, V7, I — scale degrees (from 1)
# heard together, and the one in the bass. The minor keys take the harmonic
# minor's, the melodic minor included.
CADENCE = [({1, 2, 4, 6}, 4), ({1, 3, 5}, 5), ({2, 4, 5, 7}, 5), ({1, 3, 5}, 1)]


def check_cadence(piece, rh, lh):
    degrees = spell(piece.tonic, 'major' if piece.mode == 'major' else 'harmonic')
    degree = {pc: i + 1 for i, pc in enumerate(degrees)}
    if len(rh) != len(CADENCE) or len(lh) != len(CADENCE):
        return [f'cadence: {len(rh)} and {len(lh)} chords instead of {len(CADENCE)}']
    problems = []
    for (bar, upper), (_, lower), (want, bass) in zip(rh, lh, CADENCE):
        notes = [pitch_of(n) for n in upper + lower]
        heard = {degree.get(p.pc) for p in notes}
        lowest = min(notes, key=lambda p: p.midi)
        if heard != want or degree.get(lowest.pc) != bass:
            problems.append(f'cadence bar {bar}: {" ".join(map(str, notes))}')
    return problems


def check_arpeggio(piece, measures):
    degrees = spell(piece.tonic, piece.mode)
    return check_hands(piece, onsets(measures, RH), onsets(measures, LH), lambda start: arpeggio_run(start, degrees))


def check_chromatic(piece, measures):
    rh, lh = ([pitch_of(n) for n in lone_notes(measures, hand)] for hand in (RH, LH))
    problems = []
    for label, run in (('right hand', rh), ('left hand', lh)):
        for i in range(1, len(run)):
            if abs(run[i].midi - run[i - 1].midi) != 1:
                problems.append(f'{label} note {i + 1}: {run[i - 1]} then {run[i]}')
    if len(rh) != len(lh):
        return problems + [f'{len(rh)} notes in the right hand, {len(lh)} in the left']
    # Both hands move together: at a fixed distance, or in mirror.
    together = {r.midi - l.midi for r, l in zip(rh, lh)}
    mirror = {r.midi + l.midi for r, l in zip(rh, lh)}
    if len(together) > 1 and len(mirror) > 1:
        problems.append('the hands move neither together nor in mirror')
    return problems


# Seventh chords by their intervals, from the root up.
SEVENTHS = {'diminished': (3, 3, 3, 3), 'dominant': (4, 3, 3, 2), 'major': (4, 3, 4, 1)}


def segments(measures):
    """Runs of measures between repeat signs: what the player plays in one go."""
    runs, current = [], []
    for measure in measures:
        bars = {b.get('location'): b.find('repeat') for b in measure.findall('barline')}
        if current and bars.get('left') is not None:
            runs.append(current)
            current = []
        current.append(measure)
        if bars.get('right') is not None:
            runs.append(current)
            current = []
    return runs + ([current] if current else [])


def arpeggio_notes(pitches):
    """A run without the note it closes on outside its chord: the last run of
    no 42 ends on C after the chord on B."""
    if len({p.midi % 12 for p in pitches}) == 5:
        return pitches[:-1]
    return pitches


def chord_steps(pitches):
    """The semitones of the chord a run walks, from its first note, the root."""
    root = pitches[0].midi % 12
    return root, sorted({(p.midi - root) % 12 for p in pitches})


def check_seventh(piece, measures):
    problems, runs = [], segments(measures)
    for run in runs:
        bar = run[0].get('number')
        rh_notes, lh_notes = ([pitch_of(n) for n in lone_notes(run, hand)] for hand in (RH, LH))
        # The last run closes the exercise: no 42 on C, no 43 on C's major seventh.
        coda = run is runs[-1]
        if coda:
            rh_notes, lh_notes = arpeggio_notes(rh_notes), arpeggio_notes(lh_notes)
        root, steps = chord_steps(rh_notes)
        intervals = tuple(b - a for a, b in zip(steps, steps[1:] + [12]))
        if intervals not in (SEVENTHS[piece.mode], SEVENTHS['major'] if coda and piece.mode == 'dominant' else None):
            problems.append(f'bar {bar}: not a {piece.mode} seventh: {" ".join(map(str, rh_notes))}')
            continue
        chord = {(root + step) % 12 for step in steps}
        tones = sorted(m for m in range(21, 109) if m % 12 in chord)
        for label, notes in (('right hand', rh_notes), ('left hand', lh_notes)):
            for a, b in zip(notes, notes[1:]):
                if b.midi % 12 not in chord or abs(tones.index(b.midi) - tones.index(a.midi)) != 1:
                    problems.append(f'bar {bar} {label}: {a} then {b}')
        if [p.midi for p in lh_notes] != [p.midi - 12 for p in rh_notes]:
            problems.append(f'bar {bar}: the hands are not an octave apart')
    return problems + check_repeats(measures)


def check_repeats(measures):
    problems, open_at = [], measures[0].get('number')
    for measure in measures:
        for barline in measure.findall('barline'):
            repeat = barline.find('repeat')
            if repeat is None:
                continue
            if repeat.get('direction') == 'forward':
                if open_at is not None and open_at != measures[0].get('number'):
                    problems.append(f'bar {measure.get("number")}: a forward repeat inside another')
                open_at = measure.get('number')
            else:
                if open_at is None:
                    problems.append(f'bar {measure.get("number")}: a backward repeat with no forward one')
                open_at = None
    return problems


CHECKS = {'scale': check_scale, 'arpeggio': check_arpeggio, 'chromatic': check_chromatic, 'seventh': check_seventh}

# ---------------------------------------------------------------------------
# Fingering

# Where the fourth finger falls, left hand then right, after the chart Prof.
# Escandon gave her piano students at the University of Miami, as Burt
# transcribed it (https://www.cs.miami.edu/home/burt/music/finger-charts.html):
# in C, D, E, G and A, every mode, the left hand's on the second degree and
# the right hand's on the seventh; in F, on the second and the fourth (B flat);
# the other keys as listed. A pair of pitches is the melodic minor going up,
# then coming down. The rest follows from the fourth finger, the thumb
# passing under the third: the right hand plays 4 1 2 3 1 2 3 up from it, the
# left hand 4 3 2 1 3 2 1.
FOURTH_FINGER = {
    ('B', 'major'): ('F#', 'A#'), ('B', 'harmonic'): ('F#', 'A#'), ('B', 'melodic'): ('F#', ('A#', 'A')),
    ('Db', 'major'): ('Gb', 'Bb'),
    ('C#', 'harmonic'): ('F#', 'D#'), ('C#', 'melodic'): ('F#', ('A#', 'D#')),
    ('Eb', 'major'): ('Ab', 'Bb'), ('Eb', 'harmonic'): ('Gb', 'Bb'), ('Eb', 'melodic'): ('Gb', 'Bb'),
    ('Gb', 'major'): ('Gb', 'Bb'),
    ('F#', 'harmonic'): ('F#', 'G#'), ('F#', 'melodic'): ('F#', ('D#', 'G#')),
    ('Ab', 'major'): ('Db', 'Bb'),
    ('G#', 'harmonic'): ('C#', 'A#'), ('G#', 'melodic'): (('C#', 'F#'), 'A#'),
    ('Bb', 'major'): ('Eb', 'Bb'), ('Bb', 'harmonic'): ('Gb', 'Bb'), ('Bb', 'melodic'): (('G', 'Gb'), 'Bb'),
}
CYCLE = {RH: (4, 1, 2, 3, 1, 2, 3), LH: (4, 3, 2, 1, 3, 2, 1)}


def scale_fingers(tonic, mode):
    """{(hand, 'up' or 'down'): {pitch class: finger}} for a scale."""
    up, down = scale_spellings(tonic, mode)
    name = pc_name(tonic)
    if (name, mode) in FOURTH_FINGER:
        fourths = FOURTH_FINGER[name, mode]
    elif name == 'F':
        fourths = (pc_name(up[1]), pc_name(up[3]))
    else:
        fourths = (pc_name(up[1]), (pc_name(up[6]), pc_name(down[6])))
    maps = {}
    for hand, fourth in zip((LH, RH), fourths):
        for direction, degrees, which in (('up', up, 0), ('down', down, 1)):
            pc = parse_pc(fourth if isinstance(fourth, str) else fourth[which])
            i = degrees.index(pc)
            maps[hand, direction] = {degrees[(i + k) % 7]: f for k, f in enumerate(CYCLE[hand])}
    return maps


def finger_scale(piece, hand, run):
    """The fingers of a scale up and down again."""
    maps = scale_fingers(piece.tonic, piece.mode)
    up, down = maps[hand, 'up'], maps[hand, 'down']
    top, last = SCALE_NOTES // 2, SCALE_NOTES - 1
    fingers = [up[p.pc] for p in run[:top]] + [None] + [down[p.pc] for p in run[top + 1:]]
    if hand == RH:
        # The top: the hand ends on its fifth finger, or the one past the
        # last, unless the tonic falls to another finger coming down.
        fingers[top] = down[piece.tonic] if down[piece.tonic] != 1 else fingers[top - 1] + 1
    else:
        fingers[top] = up[piece.tonic]
        # The bottom: the left hand starts and ends past the thumb.
        if fingers[0] == 1:
            fingers[0] = fingers[1] + 1
        if fingers[last] == 1:
            fingers[last] = fingers[last - 1] + 1
    return fingers


# The arpeggios' root-position fingerings from the same chart, over two
# octaves up from the root: right hand, then left. A four-octave arpeggio
# starts and ends on the first finger, takes the last at the top, and the
# third, fifth and root in between as the second, third and fourth.
ARPEGGIOS = {
    ('C', 'F', 'G', 'A minor', 'D minor', 'E minor', 'Gb', 'Eb minor'): ('1231235', '5421421'),
    ('D', 'A', 'E'): ('1231235', '5321321'),
    ('C minor', 'F minor', 'G minor'): ('1231235', '5421421'),
    ('Ab', 'Db', 'Eb', 'C# minor', 'F# minor', 'G# minor'): ('3124124', '2142142'),
    ('B',): ('1231235', '5321321'),
    ('B minor',): ('1231235', '5421421'),
    ('Bb',): ('2124124', '3213213'),
    ('Bb minor',): ('2312312', '3213213'),
}


def finger_arpeggio(piece, hand, run):
    name = pc_name(piece.tonic) + ('' if piece.mode == 'major' else ' minor')
    digits = next(v for k, v in ARPEGGIOS.items() if name in k)[0 if hand == RH else 1]
    fingers = [int(d) for d in digits]
    assert fingers[1:3] == fingers[4:6], digits
    degrees = spell(piece.tonic, piece.mode)
    member = {degrees[0]: fingers[3], degrees[2]: fingers[1], degrees[4]: fingers[2]}
    out = [member[p.pc] for p in run]
    out[0] = out[-1] = fingers[0]
    out[len(run) // 2] = fingers[6]
    return out


# The chromatic scale: the third finger on the black keys, the thumb on the
# white ones, except where two white keys follow each other — the right
# hand's second finger on F and C (after E and B), the left hand's on E and B.
SECOND_FINGER = {RH: {5: 4, 0: 11}, LH: {4: 5, 11: 0}}


def finger_chromatic(piece, hand, run):
    fingers = []
    for i, p in enumerate(run):
        pc = p.midi % 12
        near = {q.midi % 12 for q in run[max(i - 1, 0):i + 2]}
        if pc in BLACK:
            fingers.append(3)
        elif SECOND_FINGER[hand].get(pc) in near:
            fingers.append(2)
        else:
            fingers.append(1)
    return fingers


# The seventh chords: their roots are all white keys, and the thumb takes the
# root — the right hand 1 2 3 4 up the chord and its fifth finger on a top
# root, the left hand 4 3 2 1 up to the root and its fifth finger on a bottom
# one. The C each closes on is played by the thumb, or the left hand's fifth.
def finger_seventh(piece, hand, run):
    root, steps = chord_steps(arpeggio_notes(run))
    order = steps if hand == RH else [steps[0]] + steps[:0:-1]
    finger_of = {(root + step) % 12: f for f, step in enumerate(order, 1)}
    fingers = []
    for i, p in enumerate(run):
        f = finger_of.get(p.midi % 12, 1 if hand == RH else 5)  # or the closing C
        around = [run[j].midi for j in (i - 1, i + 1) if 0 <= j < len(run)]
        if f == 1 and hand == RH and i and all(m < p.midi for m in around):
            f = 5
        if f == 1 and hand == LH and all(m > p.midi for m in around):
            f = 5
        fingers.append(f)
    return fingers


FINGERINGS = {'scale': finger_scale, 'arpeggio': finger_arpeggio, 'chromatic': finger_chromatic,
              'seventh': finger_seventh}


def playable(hand, run, fingers, thumb_on_black_ok):
    """Where a hand cannot play a fingering: two fingers passing each other,
    or, in a scale, the thumb on a black key."""
    problems = []
    for i, (p, f) in enumerate(zip(run, fingers)):
        if f == 1 and p.black and not thumb_on_black_ok:
            problems.append(f'thumb on {p}')
        if i == 0:
            continue
        q, g = run[i - 1], fingers[i - 1]
        if p.midi == q.midi:
            continue
        rising = (p.midi > q.midi) == (hand == RH)  # towards the little finger's side for the left hand
        if rising:
            ok = f > g or (f == 1 and g in (2, 3, 4))
        else:
            ok = f < g or (g == 1 and f in (2, 3, 4))
        if not ok:
            problems.append(f'{q} with {g} then {p} with {f}')
    return problems


def fingering_runs(piece, measures):
    """For each hand and run, its notes, their pitches, and the fingers that
    play them. A seventh-chord exercise is a run between each repeat sign; a
    scale's run stops before its cadence."""
    runs = segments(measures) if piece.kind == 'seventh' else [measures]
    for hand in (RH, LH):
        for run in runs:
            notes = lone_notes(run, hand)[:SCALE_NOTES if piece.kind == 'scale' else None]
            pitches = [pitch_of(n) for n in notes]
            yield hand, notes, pitches, FINGERINGS[piece.kind](piece, hand, pitches)


# The order of a note's children, as MusicXML requires them.
NOTE_ORDER = ['grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'instrument', 'voice',
              'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff',
              'beam', 'notations', 'lyric', 'play']
ATTRIBUTE_ORDER = ['footnote', 'level', 'divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments',
                   'clef', 'staff-details', 'transpose', 'directive', 'measure-style']


def insert_in_order(parent, el, order):
    """Put el after the children that come before it, or with it, in order."""
    rank = order.index(el.tag)
    before = [i for i, child in enumerate(parent) if child.tag in order and order.index(child.tag) <= rank]
    parent.insert(before[-1] + 1 if before else 0, el)


def add_fingering(note, finger, hand):
    """Writes a finger on a note, or returns the one it already has."""
    technical = note.find('notations/technical')
    if technical is None:
        notations = note.find('notations')
        if notations is None:
            notations = ET.Element('notations')
            insert_in_order(note, notations, NOTE_ORDER)
        technical = ET.SubElement(notations, 'technical')
    if technical.find('fingering') is not None:
        return technical.find('fingering').text.strip()
    ET.SubElement(technical, 'fingering', placement='above' if hand == RH else 'below').text = str(finger)
    return None


# ---------------------------------------------------------------------------
# Engraving: one hand per staff, clefs, accidentals

# The lines bounding each staff, as diatonic positions (octave * 7 + step).
STAFF_LINES = {'G': (30, 38), 'F': (18, 26)}  # E4–F5, G2–A3
CLEF_SIGN = {'G': ('G', '2'), 'F': ('F', '4')}
DEFAULT_CLEF = {'1': 'G', '2': 'F'}


def ledger_lines(clef, diatonic):
    low, high = STAFF_LINES[clef]
    return max((low - diatonic) // 2, (diatonic - high) // 2, 0)


def walk(measure):
    """Each note and direction of a measure, with the stream it is written in
    (0 before the <backup>, 1 after: the right hand's, then the left's) and
    its onset in divisions."""
    position, stream = 0, 0
    for el in measure:
        if el.tag == 'backup':
            position -= int(el.findtext('duration'))
            stream += 1
        elif el.tag == 'forward':
            position += int(el.findtext('duration'))
        elif el.tag == 'note':
            if el.find('chord') is None:
                start = position
                position += int(el.findtext('duration') or 0)
            yield el, stream, start
        elif el.tag == 'direction':
            yield el, stream, position


def restaff(measures):
    """Each hand's notes, and the directions written among them, onto its own staff."""
    for measure in measures:
        for el, stream, _ in walk(measure):
            if el.tag == 'note':
                voice = el.findtext('voice')
                assert voice == (RH, LH)[stream], f'bar {measure.get("number")}: voice {voice} in stream {stream}'
                for stem in el.findall('stem'):
                    el.remove(stem)
            elif el.find('staff') is None:
                ET.SubElement(el, 'staff')
            el.find('staff').text = str(stream + 1)


DIVISIONS = 4  # per quarter note, all through the upload; build() holds it to that

# The ways a staff can show a beat: its clef, and the octaves an ottava line
# writes the notes below their sound (1: 8va, 2: 15ma, -1: 8vb). Each costs
# something, a ledger line more than two costs more, and a change costs too,
# the more in the middle of a bar; each staff takes the cheapest sequence.
STATES = [('G', 0), ('G', 1), ('G', 2), ('F', 0), ('F', -1)]
SHIFT_COST = {0: 0, 1: 0.5, 2: 6, -1: 3}
OTHER_CLEF_COST = 0.3
LEDGER_COST = {0: 0, 1: 0, 2: 0, 3: 1, 4: 4}


def beat_cost(staff, state, positions):
    clef, shift = state
    lines = max(ledger_lines(clef, d - 7 * shift) for d in positions)
    return (LEDGER_COST.get(lines, 10 * (lines - 3)) + SHIFT_COST[shift]
            + (OTHER_CLEF_COST if clef != DEFAULT_CLEF[staff] else 0))


def change_cost(before, after, beat):
    cost = 0
    if before[0] != after[0]:
        cost += 1.5 + (0.5 if beat else 0)
    if before[1] != after[1]:
        cost += 1
    return cost


def cheapest_states(staff, beats):
    """The state each beat takes: [(bar index, beat, notes)] -> [state]."""
    best = [{s: (beat_cost(staff, s, beats[0][2]), None) for s in STATES}]
    for _, beat, positions in beats[1:]:
        row = {}
        for s in STATES:
            via = lambda p: best[-1][p][0] + change_cost(p, s, beat)
            prev = min(STATES, key=via)
            row[s] = (via(prev) + beat_cost(staff, s, positions), prev)
        best.append(row)
    state = min(STATES, key=lambda s: best[-1][s][0])
    chosen = [state]
    for row in reversed(best[1:]):
        state = row[state][1]
        chosen.append(state)
    return chosen[::-1]


def insert_before(parent, ref, el):
    parent.insert(list(parent).index(ref), el)


def insert_after(parent, ref, el):
    parent.insert(list(parent).index(ref) + 1, el)


def engrave(measures):
    """Clefs and ottava lines for each staff, beat by beat."""
    for measure in measures:
        for el in measure.findall('attributes'):
            for clef in el.findall('clef'):
                el.remove(clef)
            if not len(el):
                measure.remove(el)
        for el in measure.findall('direction'):
            if el.find('direction-type/octave-shift') is not None:
                measure.remove(el)
    beats = {'1': {}, '2': {}}
    for index, measure in enumerate(measures):
        for el, stream, onset in walk(measure):
            if el.tag == 'note' and el.find('pitch') is not None:
                beats[str(stream + 1)].setdefault((index, onset // DIVISIONS), []).append(el)
    for staff, groups in beats.items():
        keys = sorted(groups)
        chosen = cheapest_states(staff, [(i, b, [pitch_of(n).diatonic for n in groups[i, b]]) for i, b in keys])

        def stop_after(key, shift):
            insert_after(measures[key[0]], groups[key][-1], octave_shift('stop', shift, staff))

        before = (None, 0)
        for i, (key, state) in enumerate(zip(keys, chosen)):
            measure, first = measures[key[0]], groups[key][0]
            if before[1] != state[1] and before[1]:
                stop_after(keys[i - 1], before[1])
            if before[0] != state[0]:
                place_clef(measure, key[1], staff, state[0], first)
            if before[1] != state[1] and state[1]:
                insert_before(measure, first, octave_shift('start', state[1], staff))
            before = state
        if before[1]:
            stop_after(keys[-1], before[1])


def octave_shift(kind, shift, staff):
    direction = ET.Element('direction', placement='above' if shift > 0 else 'below')
    ET.SubElement(ET.SubElement(direction, 'direction-type'), 'octave-shift', {
        'type': 'stop' if kind == 'stop' else ('down' if shift > 0 else 'up'),
        'size': str(7 * abs(shift) + 1), 'number': staff})
    ET.SubElement(direction, 'staff').text = staff
    return direction


def clef_element(staff, clef):
    el = ET.Element('clef', number=staff)
    sign, line = CLEF_SIGN[clef]
    ET.SubElement(el, 'sign').text = sign
    ET.SubElement(el, 'line').text = line
    return el


def place_clef(measure, beat, staff, clef, note):
    """A clef change at the start of a bar goes into its attributes, one in
    the middle of a bar just before the note it applies to."""
    if beat:
        attributes = ET.Element('attributes')
        attributes.append(clef_element(staff, clef))
        insert_before(measure, note, attributes)
        return
    attributes = measure.find('attributes')
    if attributes is None or list(measure).index(attributes) > list(measure).index(measure.find('note')):
        attributes = ET.Element('attributes')
        measure.insert(sum(1 for el in measure if el.tag == 'barline' and el.get('location') == 'left'), attributes)
    insert_in_order(attributes, clef_element(staff, clef), ATTRIBUTE_ORDER)


ACCIDENTAL = {-2: 'flat-flat', -1: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'}


def mark_accidentals(measures, key_fifths):
    """Each note's accidental, from the key signature and what the staff has
    already shown in the measure."""
    order = 'FCGDAEB'
    in_key = {step: 0 for step in STEPS}
    for step in (order[:key_fifths] if key_fifths > 0 else order[::-1][:-key_fifths]):
        in_key[step] = 1 if key_fifths > 0 else -1
    for measure in measures:
        shown = {}
        for el, stream, _ in walk(measure):
            if el.tag != 'note':
                continue
            for old in el.findall('accidental'):
                el.remove(old)
            pitch = pitch_of(el)
            if not pitch:
                continue
            where = (stream, pitch.step, pitch.octave)
            if shown.get(where, in_key[pitch.step]) != pitch.alter:
                accidental = ET.Element('accidental')
                accidental.text = ACCIDENTAL[pitch.alter]
                insert_in_order(el, accidental, NOTE_ORDER)
            shown[where] = pitch.alter


# ---------------------------------------------------------------------------
# Building each piece's file

TRACKED = ['divisions', 'key', 'time', 'staves']


def build(piece, measures, state, tempo):
    measures = [copy.deepcopy(m) for m in measures]
    first = measures[0]
    # The running attributes, complete, at the head of the piece.
    attributes = ET.Element('attributes')
    own = first.find('attributes')
    for name in TRACKED:
        found = own.find(name) if own is not None else None
        attributes.append(copy.deepcopy(found if found is not None else state[name]))
    if own is not None:
        first.remove(own)
    first.insert(0, attributes)
    assert attributes.findtext('divisions') == str(DIVISIONS)
    key = attributes.find('key')
    if piece.mode in ('major', 'harmonic', 'melodic'):
        mode = key.find('mode')
        if mode is None:
            mode = ET.SubElement(key, 'mode')
        mode.text = 'major' if piece.mode == 'major' else 'minor'
    for number, measure in enumerate(measures, 1):
        measure.set('number', str(number))
        measure.attrib.pop('width', None)
        for el in measure.findall('print'):
            measure.remove(el)
        # The tempo: the metronome mark alone, as the first part has it.
        for direction in measure.findall('direction'):
            if direction.find('direction-type/metronome') is not None or direction.find('sound[@tempo]') is not None:
                measure.remove(direction)
    first.insert(1, copy.deepcopy(tempo))
    restaff(measures)
    engrave(measures)
    mark_accidentals(measures, int(key.findtext('fifths')))
    return measures


def tempo_mark(direction):
    """A copy of a tempo direction with the metronome alone."""
    mark = copy.deepcopy(direction)
    for kind in mark.findall('direction-type'):
        if kind.find('metronome') is None:
            mark.remove(kind)
    for metronome in mark.iter('metronome'):
        for attr in [a for a in metronome.attrib if a != 'parentheses']:
            del metronome.attrib[attr]
    if mark.find('sound') is None:
        per_minute = mark.findtext('direction-type/metronome/per-minute')
        sound = ET.Element('sound', tempo=per_minute)
        mark.insert(list(mark).index(mark.find('staff')) if mark.find('staff') is not None else len(mark), sound)
    return mark


def score_document(root, piece, measures):
    score = ET.Element('score-partwise', version='3.1')
    ET.SubElement(ET.SubElement(score, 'work'), 'work-title').text = piece.title
    identification = ET.SubElement(score, 'identification')
    ET.SubElement(identification, 'creator', type='composer').text = COMPOSER
    ET.SubElement(identification, 'rights').text = 'Public Domain'
    ET.SubElement(identification, 'source').text = SOURCE_URL
    for name in ('defaults', 'part-list'):
        if root.find(name) is not None:
            score.append(copy.deepcopy(root.find(name)))
    part = ET.SubElement(score, 'part', id=root.find('part').get('id'))
    part.extend(measures)
    ET.indent(score, space='  ')
    return ET.tostring(score, encoding='unicode')


CONTAINER = ('<?xml version="1.0" encoding="UTF-8"?>\n<container>\n  <rootfiles>\n'
             '    <rootfile full-path="score.xml"/>\n  </rootfiles>\n</container>\n')


def mxl_bytes(xml):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in (('META-INF/container.xml', CONTAINER),
                           ('score.xml', '<?xml version="1.0" encoding="UTF-8"?>\n' + xml + '\n')):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return buffer.getvalue()


# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('source', help='the upload, PDMX 4868686 (.mxl)')
    parser.add_argument('--dry-run', action='store_true', help='check and report, write nothing')
    parser.add_argument('--catalog', action='store_true', help='print the scores.json entry')
    args = parser.parse_args()

    root = Score.read_xml(args.source)
    sections = split_sections(root)
    pieces = plan()
    assert len(sections) == pieces[-1].section + 1, f'{len(sections)} sections, expected {pieces[-1].section + 1}'
    apply_patches(sections)

    # The attributes in force at each section's start, and its group's tempo.
    states, state, tempos, tempo = [], {}, [], None
    for section in sections:
        states.append(dict(state))
        for measure in section:
            for attributes in measure.findall('attributes'):
                for name in TRACKED:
                    if attributes.find(name) is not None:
                        state[name] = attributes.find(name)
            for direction in measure.findall('direction'):
                if direction.find('direction-type/metronome') is not None:
                    tempo = tempo_mark(direction)
        tempos.append(tempo)

    failures, written_files, unchanged = 0, 0, 0
    for piece in pieces:
        measures = sections[piece.section]
        if piece.measures:
            measures = [m for m in measures if piece.measures[0] <= int(m.get('number')) <= piece.measures[1]]
        problems = CHECKS[piece.kind](piece, measures)

        built = build(piece, measures, states[piece.section], tempos[piece.section])
        disagreements = []
        for hand, notes, pitches, fingers in fingering_runs(piece, built):
            problems += [f'fingering, {"right" if hand == RH else "left"} hand: {p}'
                         for p in playable(hand, pitches, fingers, piece.kind != 'scale')]
            for note, finger in zip(notes, fingers):
                kept = add_fingering(note, finger, hand)
                if kept is not None and kept != str(finger):
                    disagreements.append(f'{pitch_of(note)}: the upload has {kept}, the chart {finger}')

        label = f'{piece.title} ({piece.file})'
        if problems:
            failures += 1
            print(f'✗ {label}')
            for problem in problems:
                print(f'    {problem}')
        for d in disagreements:
            print(f'  {label}: fingering kept from the upload — {d}')
        if problems or args.dry_run:
            continue
        data = mxl_bytes(score_document(root, piece, built))
        path = OUTPUT_DIR / f'{FILE_PREFIX}{piece.file}.mxl'
        if path.exists() and path.read_bytes() == data:
            unchanged += 1
            continue
        path.write_bytes(data)
        written_files += 1

    if args.catalog:
        # As public/data/scores.json writes a collection: a part a line.
        dump = lambda value: json.dumps(value, ensure_ascii=False)
        parts = ',\n'.join(f'      {{ "title": {dump(p.title)}, "file": {dump(FILE_PREFIX + p.file + ".mxl")} }}'
                            for p in pieces)
        print(f'    {{ "title": {dump(COLLECTION)}, "composer": "Hanon", "parts": [\n{parts}\n    ] }}')
    print(f'{len(pieces)} pieces: {failures} with problems, {written_files} written, {unchanged} unchanged')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
