#!/usr/bin/env python3
"""Put two or more MusicXML transcriptions of one piece side by side.

    compare.py a.mxl b.mxl [c.mxl ...] [--ref edition.krn] [--bars 3-7] [--notes]

Picking a base among candidate files used to be done by reading them; this
does the reading. For every file it prints what decides between transcriptions
of the same piece for the score page — how many measures, fingerings,
dynamics and texts it carries, and the defects that have cost a pull request
before: left-hand notes written on the treble staff (the page tells the hands
apart by staff, #363), a note doubled in a voice of its own, a metronome mark
at every inflection, a title left over from a template (#361), a part written
for another instrument.

Then the notes themselves, measure by measure. Each file's notes are reduced
to (onset, pitch, staff), and every measure where a file departs from the
baseline is listed with each file's reading. The baseline is the reference
edition when `--ref` gives one, otherwise the reading most files share — the
usual way a wrong note shows itself. A departure from a majority is a
question, not a verdict: an engraver can be the only one right, which is why a
disagreement gets read against the fingering and the pattern of the
neighbouring bars before a note is changed. Ornaments are judged the same way.

`--ref` takes a proofread edition in Humdrum **kern (see `Kern`). It catches
what a majority cannot: the mistake every upload copied from one source.
Some older encodings keep both hands in a single spine; the staves are then
left out of the comparison, and the report says so.

`--notes` prints every measure, not only those in dispute; `--bars` narrows
either to a range of measure indices (1-based, pickup included).

Standard library only, so it runs wherever python3 does.
"""
import argparse
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from fractions import Fraction

STEPS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
# kern's M is MusicXML's inverted mordent (main, upper, main: the Pralltriller)
# and its W the lower one — the two vocabularies call opposite things "inverted".
KERN_ORNAMENTS = {'T': 'trill-mark', 't': 'trill-mark', 'M': 'inverted-mordent', 'm': 'inverted-mordent',
                  'W': 'mordent', 'w': 'mordent', 'S': 'turn', '$': 'inverted-turn'}


def pitch_name(midi):
    return f'{NAMES[midi % 12]}{midi // 12 - 1}'


def squash(s):
    return ' '.join(s.split()) if s else ''


def text(el, path, default=''):
    found = el.find(path)
    return found.text.strip() if found is not None and found.text else default


class Source:
    """What the comparison reads from a file: its notes and ornaments, by measure.

    notes: measure index -> [(onset in quarters, midi pitch, staff, voice)]
    ornaments: {(measure index, onset, staff, kind)}
    """

    def __init__(self, path):
        self.path = path
        self.name = os.path.splitext(os.path.basename(path))[0]
        self.notes = defaultdict(list)
        self.ornaments = set()
        self.measures = 0
        self.staves = 1

    def reading(self, mi, staffless=False):
        return tuple(sorted((o, m, 1 if staffless else s) for o, m, s, _ in self.notes.get(mi, [])))

    def ornament_set(self, staffless=False):
        return {(mi, o, 1 if staffless else s, k) for mi, o, s, k in self.ornaments}


class Score(Source):
    def __init__(self, path):
        super().__init__(path)
        self.issues = []
        self.counts = Counter()
        self.words = Counter()
        self.parse(self.read_xml(path))
        self.find_defects()

    @staticmethod
    def read_xml(path):
        if not path.endswith('.mxl'):
            return ET.parse(path).getroot()
        z = zipfile.ZipFile(path)
        container = ET.fromstring(z.read('META-INF/container.xml'))
        rootfile = next(e for e in container.iter() if e.tag.endswith('rootfile'))
        return ET.fromstring(z.read(rootfile.get('full-path')))

    def parse(self, r):
        self.title = text(r, 'work/work-title') or text(r, 'movement-title')
        self.credits = [squash(w.text) for w in r.iter('credit-words') if squash(w.text)]
        self.source = text(r, 'identification/source')
        self.software = text(r, 'identification/encoding/software')
        self.rights = squash(text(r, 'identification/rights'))
        self.part_names = [text(sp, 'part-name') for sp in r.findall('part-list/score-part')]
        parts = r.findall('part')
        self.measures = len(parts[0].findall('measure')) if parts else 0
        staff_base = 0
        for pi, part in enumerate(parts):
            staves, divisions, transpose = 1, 1, 0
            for mi, measure in enumerate(part.findall('measure')):
                t = last_onset = Fraction(0)
                for el in measure:
                    if el.tag == 'attributes':
                        divisions = int(text(el, 'divisions') or divisions)
                        staves = int(text(el, 'staves') or staves)
                        tr = el.find('transpose')
                        if tr is not None:
                            # Written pitch to sounding pitch: a clarinet part reads a tone high.
                            transpose = int(text(tr, 'chromatic') or 0) + 12 * int(text(tr, 'octave-change') or 0)
                    elif el.tag in ('backup', 'forward'):
                        d = Fraction(int(text(el, 'duration')), divisions)
                        t += d if el.tag == 'forward' else -d
                    elif el.tag == 'direction':
                        self.words.update(squash(w.text) for w in el.iter('words') if squash(w.text))
                        for tag, key in (('metronome', 'metronome marks'), ('dynamics', 'dynamics')):
                            if el.find('.//' + tag) is not None:
                                self.counts[key] += 1
                        if any(w.get('type') in ('crescendo', 'diminuendo') for w in el.iter('wedge')):
                            self.counts['hairpins'] += 1
                    elif el.tag == 'note' and el.find('cue') is None:
                        t, last_onset = self.read_note(el, mi, t, last_onset, divisions, staff_base, pi, transpose)
            staff_base += staves
        self.staves = staff_base

    def read_note(self, el, mi, t, last_onset, divisions, staff_base, pi, transpose):
        """Record one <note>; return the measure's time and last onset after it."""
        chord = el.find('chord') is not None
        grace = el.find('grace') is not None
        onset = last_onset if chord else t
        staff = staff_base + int(text(el, 'staff') or 1)
        self.counts['fingerings'] += sum(1 for f in el.iter('fingering') if squash(f.text))
        self.counts['ties'] += el.find('notations/tied[@type="start"]') is not None
        self.counts['slurs'] += el.find('notations/slur[@type="start"]') is not None
        for orn in el.findall('notations/ornaments/*'):
            if orn.tag != 'accidental-mark':
                self.ornaments.add((mi, onset, staff, orn.tag))
        p = el.find('pitch')
        if grace:
            self.counts['grace notes'] += 1
        elif p is not None:
            midi = 12 * (int(text(p, 'octave')) + 1) + STEPS[text(p, 'step')] + int(float(text(p, 'alter') or 0)) + transpose
            self.counts['notes'] += 1
            # A tie's continuation is the same sound held, even when it ties on
            # again into the next bar: only the attack counts.
            if el.find('tie[@type="stop"]') is None:
                self.notes[mi].append((onset, midi, staff, (pi, text(el, 'voice') or '1')))
        if chord or grace:
            return t, last_onset
        return t + Fraction(int(text(el, 'duration') or 0), divisions), t

    def find_defects(self):
        # A voice lives on one staff; notes of it written on another are the
        # cross-staff kind the score page cannot tell apart from the other hand.
        per_voice = defaultdict(Counter)
        for notes in self.notes.values():
            for _, _, staff, voice in notes:
                per_voice[voice][staff] += 1
        home = {v: c.most_common(1)[0][0] for v, c in per_voice.items()}
        for mi, notes in sorted(self.notes.items()):
            away = [(s, v) for _, _, s, v in notes if home[v] != s]
            if away:
                s, v = away[0]
                self.issues.append(f'm{mi + 1}: {len(away)} note(s) of voice {v[1]} on staff {s}, away from its staff {home[v]}')
            seen = Counter((o, m, s) for o, m, s, _ in notes)
            doubled = [m for (_, m, _), c in seen.items() if c > 1]
            if doubled:
                self.issues.append(f'm{mi + 1}: doubled ' + ', '.join(map(pitch_name, doubled)))
        others = [n for n in self.part_names if not re.search(r'piano|klavier|keyboard', n, re.I)]
        if others:
            self.issues.append(f'not written for piano: {others}')
        if self.counts['metronome marks'] > 3:
            self.issues.append(f"{self.counts['metronome marks']} metronome marks (playback rubato written on the page?)")


class Kern(Source):
    """A Humdrum **kern encoding, read into the same shape as a Score.

    The reference editions of the classical keyboard repertoire (the Bach
    inventions, Beethoven's and Mozart's sonatas, Chopin's preludes...) are
    proofread and published as **kern, not MusicXML. Only notes and ornaments
    are read. A spine's staff is its *staffN when it has one, otherwise the
    **kern spines count the staves from the right (kern writes the lowest
    staff first); spines of another kind (**dynam, **text) are skipped. Spine
    splits (*^, *v) keep the staff of the spine they come from.
    """

    def __init__(self, path):
        super().__init__(path)
        self.name = 'reference'
        with open(path, encoding='utf-8') as f:
            self.parse(f.read().splitlines())

    def parse(self, lines):
        staff_of, ends = [], []          # per sub-spine: staff (0: no notes), end of its current event
        t = bar_start = Fraction(0)
        bar = 0                          # every barline counts; bars holding nothing are dropped below
        by_bar = defaultdict(list)
        ornaments = set()
        filled = set()
        for line in lines:
            if not line or line.startswith('!'):
                continue
            tokens = line.split('\t')
            if line.startswith('**'):
                kern = [i for i, tok in enumerate(tokens) if tok == '**kern']
                staff_of = [len(kern) - kern.index(i) if i in kern else 0 for i in range(len(tokens))]
                ends = [Fraction(0)] * len(tokens)
            elif line.startswith('*'):
                staff_of, ends = self.interpret(tokens, staff_of, ends)
            elif line.startswith('='):
                bar += 1
                bar_start = t
            else:
                for i, tok in enumerate(tokens):
                    if tok == '.' or not staff_of[i]:
                        continue
                    filled.add(bar)
                    durations = []
                    for note in tok.split(' '):
                        d = re.search(r'(\d+)(\.*)', note)
                        if not d or 'q' in note:
                            continue
                        dur = Fraction(4, int(d.group(1))) if int(d.group(1)) else Fraction(8)
                        durations.append(dur * (2 - Fraction(1, 2 ** len(d.group(2)))))
                        p = re.search(r'([a-gA-G])\1*', note)
                        if 'r' in note or not p or ']' in note or '_' in note:
                            continue
                        letters = p.group(0)
                        octave = 3 + len(letters) if letters[0].islower() else 4 - len(letters)
                        midi = 12 * (octave + 1) + STEPS[letters[0].upper()] + note.count('#') - note.count('-')
                        by_bar[bar].append((t - bar_start, midi, staff_of[i], i))
                        for sign in re.findall(r'[TtMmWwS$]', note[p.end():]):
                            ornaments.add((bar, t - bar_start, staff_of[i], KERN_ORNAMENTS[sign]))
                    if durations:
                        ends[i] = t + min(durations)
                later = [e for e in ends if e > t]
                if later:
                    t = min(later)
        # A measure is a stretch between barlines that holds something, rests
        # included: the opening barline of a piece without pickup, and the
        # closing one, open nothing. Renumber so indices match MusicXML's.
        index = {b: n for n, b in enumerate(sorted(filled))}
        for b, notes in by_bar.items():
            self.notes[index[b]] = notes
        self.ornaments = {(index[b], o, s, k) for b, o, s, k in ornaments}
        self.measures = len(index)
        self.staves = max((s for ns in self.notes.values() for _, _, s, _ in ns), default=1)

    @staticmethod
    def interpret(tokens, staff_of, ends):
        """Follow an interpretation line: *staffN, spine splits, joins and ends."""
        new_staff, new_ends = [], []
        i = 0
        while i < len(tokens):
            tok = tokens[i]
            m = re.fullmatch(r'\*staff(\d+)', tok)
            if m and staff_of[i]:
                staff_of[i] = int(m.group(1))
            if tok == '*^':
                new_staff += [staff_of[i]] * 2
                new_ends += [ends[i]] * 2
            elif tok == '*v':
                j = i
                while j < len(tokens) and tokens[j] == '*v':
                    j += 1
                new_staff.append(staff_of[i])
                new_ends.append(max(ends[i:j]))
                i = j
                continue
            elif tok != '*-':
                new_staff.append(staff_of[i])
                new_ends.append(ends[i])
            i += 1
        return new_staff, new_ends


def fmt_reading(reading, staves):
    out = []
    for staff in range(1, staves + 1):
        by_onset = defaultdict(list)
        for o, m, s in reading:
            if s == staff:
                by_onset[o].append(pitch_name(m))
        out.append(' '.join('+'.join(v) for _, v in sorted(by_onset.items())) or '—')
    return ' || '.join(out)


def fmt_notes(notes, limit=8):
    shown = ', '.join(f'{pitch_name(m)}@{float(o):g} st{s}' for o, m, s in notes[:limit])
    return shown + (f' … ({len(notes)} notes)' if len(notes) > limit else '')


def majority(values):
    """The value most sources share, if strictly more share it than any other."""
    ranked = Counter(values).most_common(2)
    if ranked[0][1] > 1 and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
        return ranked[0][0]
    return None


def print_files(scores, ref, width):
    print('== Files')
    if ref:
        print(f'{ref.name:{width}}  {ref.measures} measures ({ref.path})')
    keys = ['notes', 'fingerings', 'dynamics', 'hairpins', 'slurs', 'ties', 'grace notes', 'metronome marks']
    pad = ' ' * width
    for s in scores:
        print(f'{s.name:{width}}  {s.measures} measures, {s.staves} staves in {len(s.part_names)} part(s) {s.part_names}')
        print(f'{pad}  ' + ', '.join(f'{k} {s.counts[k]}' for k in keys) + f', ornaments {len(s.ornaments)}')
        print(f'{pad}  title {s.title!r}; credits {s.credits}')
        if s.rights or s.source:
            print(f'{pad}  rights {s.rights!r}; source {s.source!r}')
        print(f'{pad}  {s.software}')
        if s.words:
            print(f'{pad}  texts: ' + '; '.join(f'{w!r}' + (f' ×{c}' if c > 1 else '') for w, c in s.words.most_common()))
        for issue in s.issues:
            print(f'{pad}  ⚠ {issue}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('files', nargs='+', help='MusicXML (.mxl, .xml, .musicxml)')
    ap.add_argument('--ref', help='reference edition, Humdrum **kern')
    ap.add_argument('--bars', help='measure range, e.g. 3-7 (1-based)')
    ap.add_argument('--notes', action='store_true', help='print every measure, not only disputed ones')
    args = ap.parse_args()

    scores = [Score(p) for p in args.files]
    ref = Kern(args.ref) if args.ref else None
    rows = ([ref] if ref else []) + scores
    width = max(len(s.name) for s in rows)
    print_files(scores, ref, width)

    staves = max(s.staves for s in scores)
    staffless = bool(ref) and ref.staves < staves
    if staffless:
        staves = 1
        print('\n(the reference does not separate the staves: they are left out below)')
    measure_counts = Counter(s.measures for s in rows)
    if len(measure_counts) > 1:
        print(f'\n⚠ Measure counts differ: {dict(measure_counts)}. The comparison assumes they line up from the start.')

    total = max(s.measures for s in rows)
    lo, _, hi = (args.bars or f'1-{total}').partition('-')
    print('\n== Notes, measure by measure' + ('' if args.notes else ' (disputes only)')
          + (' against the reference' if ref else ''))
    disputed = 0
    for mi in range(int(lo) - 1, min(int(hi or lo), total)):
        readings = [s.reading(mi, staffless) for s in rows]
        baseline = readings[0] if ref else majority(readings)
        agree = len(set(readings)) == 1
        disputed += not agree
        if agree and not args.notes:
            continue
        print(f'm{mi + 1}')
        for s, r in zip(rows, readings):
            mark = ' ' if agree or baseline is None else ('=' if r == baseline else '≠')
            print(f'  {mark} {s.name:{width}}  {fmt_reading(r, staves)}')
        if baseline is not None:
            for s, r in zip(rows, readings):
                missing, extra = sorted(set(baseline) - set(r)), sorted(set(r) - set(baseline))
                desc = (['lacks ' + fmt_notes(missing)] if missing else []) + (['has ' + fmt_notes(extra)] if extra else [])
                if desc:
                    print(f'    {s.name}: ' + '; '.join(desc))
    print(f'\n{disputed} measure(s) in dispute out of {total}.')

    print('\n== Ornaments' + (' against the reference' if ref else ' against the majority'))
    sets = {s.name: s.ornament_set(staffless) for s in rows}
    if ref:
        base = sets[ref.name]
    else:
        tally = Counter(o for found in sets.values() for o in found)
        base = {o for o, c in tally.items() if c * 2 > len(scores)}
    for s in scores:
        diffs = [(verb, o) for verb, d in (('adds', sets[s.name] - base), ('lacks', base - sets[s.name])) for o in sorted(d)]
        for verb, (mi, o, st, kind) in diffs:
            print(f'  {s.name}: {verb} {kind} m{mi + 1} beat {float(o) + 1:g} staff {st}')
        if not diffs:
            print(f'  {s.name}: same')


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        pass
