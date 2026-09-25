#!/usr/bin/env python3
"""Carry the fingerings of a Mutopia engraving onto a MusicXML score.

    mutopia.py setup                          # download LilyPond (~40 MB, once)
    mutopia.py list <dir>                     # .ly files under ftp/<dir>, with fingerings
    mutopia.py get <dir> [--to dir]           # copy a piece's files out
    mutopia.py fingerings <file.ly> <score>   # what would land where
    mutopia.py fingerings <file.ly> <score> --apply <out.mxl>

The Mutopia Project (mutopiaproject.org, sources on GitHub) engraves public-
domain editions in LilyPond, and many of its piano pieces are fingered: a
free source for the library's scores that have none. `list` answers "does it
have this piece, and fingered?" (`list BeethovenLv/O27`; the directory layout
is ftp/<Composer>/<Opus>/<piece>/). The count is a quick textual estimate;
`fingerings` gives the real one. `get` copies every file of a piece, include
files and all, to `<dir>/<piece>/` (default `tmp/mutopia`).

`fingerings` lets LilyPond read the file, whatever its syntax age (convert-ly
brings it to 2.24 first, on a copy): mutopia-dump.ly prints every note it
engraves with its time from the start, pitch, staff, voice and fingerings.
The two scores are then lined up the way diff lines up two texts, chord by
chord — a chord being its pitches and the time to the next one — so that a
repeat written out on one side only, or a bar one edition has and the other
not, costs the passage it affects and nothing after it. A long stretch left
over on either side is looked for again, which finds a repeated section on
the side that writes it once.

The report starts with the check that makes the rest trustworthy: how many
engraved notes, fingered or not, fell on a note of the score, then each
chord where the editions differ and each passage one of them lacks. Then,
per fingering, what is not plain:

- a unison, two voices on one key: the score voice the engraved voice matches
  most elsewhere gets it;
- a fingering on a tie's continuation;
- the **other hand**: the score puts the note on the other staff (the page
  tells the hands apart by staff) — not carried. The engraving's hand is its
  voice's staff, since cross-staff notes are drawn on the other one (#363);
  a voice with no staff of its own, one that passes between the hands, is
  judged by the staff each note is drawn on;
- a note the score already fingers — kept;
- fingerings written after a whole chord, which LilyPond gives to no note:
  a \\finger \\column with one per note goes top to bottom, as printed;
  separate digits, one per note, bottom to top, as LilyPond stacks them (said
  in the report: the print does not tie each to its note); any other count
  is not carried.

A substitution ("4-5") stays one label, as the engraving prints it — OSMD
would stack two <fingering> elements like a chord's. `--apply` writes the
score with the fingerings in, nothing else changed; `--score N` picks a
\\score block in a file holding several.

LilyPond lives outside the repository, in $LILYPOND_DIR or ~/.cache/lilypond;
one already on the PATH is used when there is none there.
"""
import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from fractions import Fraction

from compare import STEPS, pitch_name

HOME = os.environ.get('LILYPOND_DIR', os.path.expanduser('~/.cache/lilypond'))
VERSION = '2.24.4'
INSTALL = os.path.join(HOME, f'lilypond-{VERSION}')
RELEASES = 'https://gitlab.com/api/v4/projects/18695663/packages/generic/lilypond'
REPO = 'MutopiaProject/MutopiaProject'
DUMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mutopia-dump.ly')
MIN_RUN = 8        # chords a repeat found in a second pass must share: a section, not a coincidence
HOME_SHARE = 0.75  # a voice with this share of its notes on one staff belongs to that hand
# A digit after a note or chord, or a \finger markup: an estimate for `list`.
FINGERING = re.compile(r"(?:[a-g](?:isis|eses|is|es|s)?[',]*\d*\.*|>\d*\.*)\s*[-^_]\s*[1-5]\b|\\finger\s*\"?\d")


# --- LilyPond

def setup():
    system = {'Linux': 'linux', 'Darwin': 'darwin'}.get(platform.system())
    if not system:
        sys.exit('LilyPond binaries exist for Linux and macOS only; install it and put it on the PATH.')
    # No arm64 build of 2.24 for macOS: the x86_64 one runs under Rosetta.
    name = f'lilypond-{VERSION}-{system}-x86_64.tar.gz'
    os.makedirs(HOME, exist_ok=True)
    if not os.path.isdir(INSTALL):
        print(f'Downloading {name}…')
        target = os.path.join(HOME, name)
        subprocess.run(['curl', '-L', '--fail', '-o', target, f'{RELEASES}/{VERSION}/{name}'], check=True)
        subprocess.run(['tar', '-xzf', name], cwd=HOME, check=True)
        os.remove(target)
    print(f'Ready: {os.path.join(INSTALL, "bin", "lilypond")}')


def tool(name):
    local = os.path.join(INSTALL, 'bin', name)
    if os.path.exists(local):
        return local
    found = shutil.which(name)
    if not found:
        sys.exit(f'No {name}: run `mutopia.py setup` first.')
    return found


def engraving(path, score):
    """The notes LilyPond engraves from a .ly, read on a converted copy of its directory:
    ([note], [loose fingering], [score block]). See mutopia-dump.ly for the fields."""
    with tempfile.TemporaryDirectory() as work:
        copy = os.path.join(work, 'src')
        shutil.copytree(os.path.dirname(os.path.abspath(path)), copy)
        main = os.path.join(copy, os.path.basename(path))
        sources = [os.path.join(d, n) for d, _, ns in os.walk(copy) for n in ns if n.endswith(('.ly', '.ily'))]
        done = subprocess.run([tool('convert-ly'), '-e', '--loglevel=ERROR', *sources], capture_output=True, text=True)
        if done.returncode:
            sys.exit(f'convert-ly failed:\n{done.stderr}')
        run = subprocess.run([tool('lilypond'), f'-dinclude-settings={DUMP}', '-dno-print-pages',
                              '-o', os.path.join(work, 'out'), main],
                             cwd=os.path.dirname(main), capture_output=True, text=True)
    errors = [l for l in run.stderr.splitlines() if re.search(r'\berror:', l)]
    notes, loose, scores, ended = [], [], set(), set()
    for line in run.stdout.splitlines():
        kind, *f = line.split('\t')
        if kind == 'END':
            ended.add(int(f[0]))
        if kind not in ('NOTE', 'LOOSE'):
            continue
        block = int(f[0])
        scores.add(block)
        if block != score:
            continue
        rec = {'staff': int(f[1]), 'voice': f[2], 'time': Fraction(f[3]), 'grace': f[4] == '1'}
        fingers = [re.sub(r'\s+', '', x) for x in f[-1].split(',') if x != '-']  # "4 - 5" is 4-5
        if kind == 'NOTE':
            notes.append({**rec, 'midi': int(f[5]), 'fingers': fingers, 'after_chord': False})
        else:
            loose.append({**rec, 'fingers': fingers})
    # Old files carry settings 2.24 rejects without touching the notes: those errors only
    # matter when a score was not read to its end.
    if score in scores and score not in ended:
        sys.exit(f'LilyPond stopped before the end of score {score}:\n' + '\n'.join(errors[:10]))
    if not notes:
        sys.exit(f'LilyPond engraved no notes for score {score} (scores found: {sorted(scores)}).\n' + '\n'.join(errors[:10]))
    if errors:
        print(f'LilyPond reported {len(errors)} error(s) outside the notes, which were read in full; first: {errors[0]}')
    return notes, loose, sorted(scores)


def place_loose(notes, loose):
    """Give fingerings written after a whole chord to its notes; return the ones that
    could not be placed. A \\finger \\column with one per note goes top to bottom, as
    printed. Separate digits, one per note, go bottom to top, as LilyPond stacks them --
    marked, since the print does not say which note each is for."""
    chord = defaultdict(list)
    for n in notes:
        chord[(n['voice'], n['time'], n['grace'])].append(n)
    orphans = []
    for l in loose:
        ns = sorted(chord[(l['voice'], l['time'], l['grace'])], key=lambda n: n['midi'])
        column = l['fingers'][0].split('|') if len(l['fingers']) == 1 else []
        if len(ns) > 1 and len(column) == len(ns):
            for n, f in zip(reversed(ns), column):
                n['fingers'].append(f)
        elif len(ns) == len(l['fingers']) and not any('|' in f for f in l['fingers']):
            for n, f in zip(ns, l['fingers']):
                n['fingers'].append(f)
                n['after_chord'] = True
        else:
            orphans.append({**l, 'notes': ns})
    return orphans


def hands(notes):
    """The staff each engraved voice plays from: its own when it keeps to one, else None."""
    staves = defaultdict(Counter)
    for n in notes:
        staves[n['voice']][n['staff']] += 1
    home = {}
    for voice, c in staves.items():
        staff, count = c.most_common(1)[0]
        home[voice] = staff if count >= HOME_SHARE * sum(c.values()) else None
    return home


# --- MusicXML

def read_archive(path):
    """(root file name, its text, the archive's other members) — or the file itself."""
    if not path.endswith('.mxl'):
        return None, open(path, encoding='utf-8').read(), {}
    z = zipfile.ZipFile(path)
    container = ET.fromstring(z.read('META-INF/container.xml'))
    name = next(e for e in container.iter() if e.tag.endswith('rootfile')).get('full-path')
    return name, z.read(name).decode('utf-8'), {n: z.read(n) for n in z.namelist() if n != name}


def write_archive(path, name, text, others):
    if name is None:
        open(path, 'w', encoding='utf-8').write(text)
        return
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, data in others.items():
            z.writestr(n, data)
        z.writestr(name, text)


def score_notes(text):
    """Every pitched note, with its place among the file's <note> elements, its
    measure (index and printed number) and beat, and its time from the start in
    written order."""
    part = ET.fromstring(text).find('part')
    notes = []
    index, divisions, start = 0, 1, Fraction(0)
    for mi, measure in enumerate(part.findall('measure')):
        t = last = end = Fraction(0)
        for el in measure:
            if el.tag == 'attributes' and el.find('divisions') is not None:
                divisions = int(el.findtext('divisions'))
            elif el.tag in ('backup', 'forward'):
                d = Fraction(int(el.findtext('duration')), divisions)
                t += d if el.tag == 'forward' else -d
            elif el.tag == 'note':
                chord, grace = el.find('chord') is not None, el.find('grace') is not None
                p = el.find('pitch')
                onset = last if chord else t
                if p is not None and el.find('cue') is None:
                    notes.append({
                        'index': index, 'mi': mi, 'bar': measure.get('number', str(mi)), 'beat': onset,
                        'time': start + onset, 'grace': grace,
                        'midi': 12 * (int(p.findtext('octave')) + 1) + STEPS[p.findtext('step')] + int(float(p.findtext('alter') or 0)),
                        'staff': int(el.findtext('staff') or 1), 'voice': el.findtext('voice') or '1',
                        'tied': el.find('tie[@type="stop"]') is not None,
                        'fingered': el.find('notations/technical/fingering') is not None,
                    })
                index += 1
                if not chord and not grace:
                    last = t
                    t += Fraction(int(el.findtext('duration')), divisions)
            end = max(end, t)
        start += end
    return notes


def insert_fingerings(text, labels):
    """labels: note index -> label. Each goes into its note's <notations><technical>."""
    starts = [m.start() for m in re.finditer(r'<note[ >]', text)]
    out, done = [], 0
    for index in sorted(labels):
        start = starts[index]
        end = text.index('</note>', start)
        technical = f'<technical>\n            <fingering>{labels[index]}</fingering>\n            </technical>\n          '
        cut = text.find('</notations>', start, end)
        if cut < 0:
            cut, technical = end, '<notations>\n          ' + technical + '</notations>\n        '
        out += [text[done:cut], technical]
        done = cut
    return ''.join(out) + text[done:]


# --- Lining the two up

def chords(notes):
    """Notes grouped by moment, grace notes apart from and ahead of their main notes.
    Each carries the token the alignment compares: its pitches and the time to the
    next moment, so that a matching run is the same music, not just the same harmony."""
    groups = defaultdict(list)
    for n in notes:
        groups[(n['time'], not n['grace'])].append(n)
    times = sorted({t for t, _ in groups})
    following = dict(zip(times, times[1:]))
    return [{'notes': groups[k],
             'token': (k[1], frozenset(n['midi'] for n in groups[k]), following.get(k[0], k[0]) - k[0])}
            for k in sorted(groups)]


def runs(indices):
    run = []
    for i in indices:
        if run and i != run[-1] + 1:
            yield run
            run = []
        run.append(i)
    if run:
        yield run


def long_matches(a, ai, b, bi):
    """Pairs from the runs of at least MIN_RUN tokens a[ai] and b[bi] share, as indices of a and b."""
    m = SequenceMatcher(None, [a[k] for k in ai], [b[k] for k in bi], autojunk=False)
    return {(ai[x + k], bi[y + k]) for x, y, size in m.get_matching_blocks() if size >= MIN_RUN for k in range(size)}


def align(theirs, ours):
    """(engraved chord, score chord) pairs, found the way diff lines up two texts.

    Same token in the same order pairs; a stretch that differs pairs chord for chord
    when both sides have as many chords in the same rhythm (an edition's different
    note). Then what one side has twice and the other once -- a repeat written out,
    or taken with repeat signs -- is looked for again, in runs long enough not to be
    a coincidence."""
    et, st = [c['token'] for c in theirs], [c['token'] for c in ours]
    rhythm = lambda ts: [(t[0], t[2]) for t in ts]
    pairs = set()
    for op, i1, i2, j1, j2 in SequenceMatcher(None, et, st, autojunk=False).get_opcodes():
        if op == 'equal' or (op == 'replace' and rhythm(et[i1:i2]) == rhythm(st[j1:j2])):
            pairs.update(zip(range(i1, i2), range(j1, j2)))
    for run in runs(sorted(set(range(len(st))) - {j for _, j in pairs})):
        if len(run) >= MIN_RUN:
            pairs |= long_matches(et, range(len(et)), st, run)
    for run in runs(sorted(set(range(len(et))) - {i for i, _ in pairs})):
        if len(run) >= MIN_RUN:
            pairs |= long_matches(et, run, st, range(len(st)))
    return sorted(pairs)


def where(n):
    return f"bar {n['bar']} beat {float(n['beat']) + 1:g}"


def bars(ns):
    """'3-7, 12': the bars a set of score notes fall in, by printed number."""
    number = {n['mi']: n['bar'] for n in ns}
    return ', '.join(f'{number[r[0]]}-{number[r[-1]]}' if len(r) > 1 else number[r[0]]
                     for r in runs(sorted(number)))


def report_alignment(theirs, ours, pairs, hits):
    placed = len({id(n) for n, _, c in hits if c})  # a chord paired twice (a repeat) counts once
    print(f'{placed} of {sum(len(c["notes"]) for c in theirs)} engraved notes fall on a note of the score.')
    names = lambda ms: ' '.join(pitch_name(m) for m in sorted(ms)) or '-'
    for i, j in pairs:
        if theirs[i]['token'] != ours[j]['token']:
            mine, other = ({n['midi'] for n in c['notes']} for c in (ours[j], theirs[i]))
            print(f"  {where(ours[j]['notes'][0])}: engraving only [{names(other - mine)}]  score only [{names(mine - other)}]")
    paired_e, paired_s = {i for i, _ in pairs}, {j for _, j in pairs}
    for run in runs(i for i in range(len(theirs)) if i not in paired_e):
        before = max((j for i, j in pairs if i < run[0]), default=None)
        count = sum(len(theirs[i]['notes']) for i in run)
        print(f"  {count} engraved notes after {where(ours[before]['notes'][0]) if before is not None else 'the start'}"
              ' found no place: a passage the score does not have.')
    bare = [n for j, c in enumerate(ours) if j not in paired_s for n in c['notes']]
    if bare:
        print(f'  {len(bare)} notes of the score have no engraved counterpart, in bar(s) {bars(bare)}.')


def carry(theirs, ours, hits, home):
    """Choose the label of each score note: (labels, skipped, flagged, remarks, after_chord).
    flagged: what needed a choice, as a message -> the score notes it concerns."""
    votes = defaultdict(Counter)  # which score voice each engraved voice is
    for n, _, c in hits:
        if len(c) == 1:
            votes[n['voice']][c[0]['voice']] += 1
    labels, skipped, flagged, remarks, after_chord = {}, Counter(), defaultdict(list), [], 0
    for n, j, c in hits:
        if not n['fingers']:
            continue
        label = '-'.join(n['fingers']).replace('|', '-')  # a column on one note: a substitution, top first
        hand = home[n['voice']] or n['staff']
        if not c:
            skipped['on a note the score does not have'] += 1
            continue
        target = c[0]
        if len(c) > 1:
            target = max([x for x in c if x['staff'] == hand] or c, key=lambda x: votes[n['voice']][x['voice']])
            flagged['unison      on a key two voices share: given to the score voice the engraved one matches elsewhere'].append(target)
        if target['staff'] != hand:
            flagged[f'OTHER HAND  engraved for the hand of staff {hand}, on staff {target["staff"]} in the score — '
                    'not carried'].append(target)
            skipped['on the other hand'] += 1
        elif target['fingered']:
            skipped['already fingered in the score'] += 1
        elif target['index'] in labels:
            if labels[target['index']] != label:
                remarks.append(f"twice       {where(target)} {pitch_name(n['midi'])}: [{label}] where the note "
                               f"already took [{labels[target['index']]}] — kept")
        else:
            if target['tied']:
                flagged['tied        on the continuation of a tie, as engraved'].append(target)
            after_chord += n['after_chord']
            labels[target['index']] = label
    return labels, skipped, flagged, remarks, after_chord


# --- Commands

def fingerings(ly, score_path, score, apply):
    engraved, loose, scores = engraving(ly, score)
    if len(scores) > 1:
        print(f'{len(scores)} \\score blocks in {os.path.basename(ly)}: reading {score} (--score to pick another).')
    orphans = place_loose(engraved, loose)
    name, text, others = read_archive(score_path)
    theirs, ours = chords(engraved), chords(score_notes(text))
    pairs = align(theirs, ours)
    # Each engraved note, in each score chord its chord was paired with, and the notes it could be there.
    hits = [(n, j, [x for x in ours[j]['notes'] if x['midi'] == n['midi']]) for i, j in pairs for n in theirs[i]['notes']]
    report_alignment(theirs, ours, pairs, hits)
    labels, skipped, flagged, remarks, after_chord = carry(theirs, ours, hits, hands(engraved))

    paired_e = {i for i, _ in pairs}
    skipped['in a passage the score does not have'] = sum(
        bool(n['fingers']) for i, c in enumerate(theirs) if i not in paired_e for n in c['notes'])
    if orphans:
        pair_of = {id(n): j for n, j, _ in hits}
        at = sorted({ours[pair_of[id(o['notes'][0])]]['notes'][0]['bar'] for o in orphans
                     if o['notes'] and id(o['notes'][0]) in pair_of}, key=lambda b: (len(b), b))
        remarks.append(f"no note     {sum(len(o['fingers']) for o in orphans)} fingering(s) written after a chord of "
                       f"another size, bar(s) {', '.join(at) or '?'}: which note each is for is a guess — not carried")

    written = sum(bool(n['fingers']) for n in engraved)
    print(f'{len(labels)} notes of the score fingered from {written} fingered engraved notes'
          + ''.join(f'; {v} {k}' for k, v in skipped.items() if v) + '.')
    if after_chord:
        print(f'{after_chord} of them written after a chord, one per note: given bottom to top, as LilyPond stacks them.')
    subs = Counter(l for l in labels.values() if '-' in l)
    if subs:
        print(f'{sum(subs.values())} substitutions, as one label: ' + ', '.join(f'{l} ×{c}' for l, c in subs.most_common()))
    for message, ns in flagged.items():
        kind, _, why = message.partition('  ')
        print(f'  {kind:<11} {len(ns)} fingering(s), bar(s) {bars(ns)}: {why.strip()}')
    for line in remarks:
        print('  ' + line)
    if apply:
        write_archive(apply, name, insert_fingerings(text, labels), others)
        print(f'Wrote {apply}.')


def tree(directory):
    d = directory.strip('/').removeprefix('ftp/')
    with urllib.request.urlopen(f'https://api.github.com/repos/{REPO}/git/trees/master:ftp/{d}?recursive=1') as r:
        found = json.load(r)
    return d, [e['path'] for e in found['tree'] if e['type'] == 'blob']


def raw(path):
    with urllib.request.urlopen(f'https://raw.githubusercontent.com/{REPO}/master/{path}') as r:
        return r.read()


def fetch(paths):
    with ThreadPoolExecutor(8) as pool:
        return list(pool.map(raw, paths))


def list_dir(directory):
    d, paths = tree(directory)
    lys = sorted(p for p in paths if p.endswith('.ly'))
    for p, data in zip(lys, fetch(f'ftp/{d}/{p}' for p in lys)):
        src = data.decode('utf-8', 'ignore')
        version = (re.search(r'\\version\s*"([^"]+)"', src) or [None, '?'])[1]
        print(f'{d}/{p:<60} ~{len(FINGERING.findall(src)):>4} fingerings  (LilyPond {version})')


def get(directory, to):
    d, paths = tree(directory)
    dest = os.path.join(to, os.path.basename(d))
    for p, data in zip(paths, fetch(f'ftp/{d}/{p}' for p in paths)):
        target = os.path.join(dest, p)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as f:
            f.write(data)
    print(f'{len(paths)} file(s) in {dest}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup', help='download LilyPond')
    lp = sub.add_parser('list', help='.ly files of a Mutopia directory, with fingerings')
    lp.add_argument('dir', help='under ftp/, e.g. BeethovenLv/O27')
    gp = sub.add_parser('get', help="copy a piece's files out")
    gp.add_argument('dir', help='under ftp/, e.g. BeethovenLv/O27/moonlight')
    gp.add_argument('--to', default='tmp/mutopia')
    fp = sub.add_parser('fingerings', help="carry an engraving's fingerings onto a score")
    fp.add_argument('ly')
    fp.add_argument('score', help='MusicXML (.mxl, .xml, .musicxml)')
    fp.add_argument('--score', dest='index', type=int, default=0, help='which \\score block (0-based)')
    fp.add_argument('--apply', metavar='OUT', help='write the fingered score here')
    args = ap.parse_args()
    if args.cmd == 'setup':
        setup()
    elif args.cmd == 'list':
        list_dir(args.dir)
    elif args.cmd == 'get':
        get(args.dir, args.to)
    else:
        fingerings(args.ly, args.score, args.index, args.apply)
