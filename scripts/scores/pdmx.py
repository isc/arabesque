#!/usr/bin/env python3
"""Find candidate transcriptions of a piece in PDMX, and copy them out.

    pdmx.py setup                       # download the dataset (~2.1 GB, once)
    pdmx.py search <word> [<word> ...]  # candidates, most viewed first
    pdmx.py get <id> [<id> ...] [--to dir]

PDMX (Long et al., 2024, zenodo.org/records/15571083) is 254,000 scores
scraped from musescore.com with their MusicXML, kept only when the uploader
had put them in the public domain or under CC0 — so anything taken from it can
ship in the app without asking anyone. It is a snapshot: nothing uploaded
after 2023, and none of the many free-to-download scores whose uploader kept
"all rights reserved". When it has nothing good, the fallback is musescore.com
itself, by hand.

`search` matches every word, case- and accent-insensitively, against the
title, subtitle and composer, and prints for each hit the MuseScore score id,
views, rating (and how many votes), parts, measures, and licence — the id is
what `get` and the musescore.com URL take. Transcriptions for another
instrument are common (a Bach invention for two clarinets); `--piano` keeps
only scores with a single part, which is what a piano score is. `get` copies
each file to `<dir>/<id>.mxl` (default `tmp/candidates`).

The dataset lives outside the repository, in $PDMX_DIR or ~/.cache/pdmx.
"""
import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
import unicodedata

HOME = os.environ.get('PDMX_DIR', os.path.expanduser('~/.cache/pdmx'))
RECORD = 'https://zenodo.org/records/15571083/files'
LIMIT = 40  # search hits printed


def fold(s):
    s = s.lower()
    if s.isascii():  # most titles: nothing to strip, and the scan is 250k rows
        return s
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def rows():
    path = os.path.join(HOME, 'PDMX.csv')
    if not os.path.exists(path):
        sys.exit(f'No dataset in {HOME}: run `pdmx.py setup` first.')
    csv.field_size_limit(1 << 30)
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            r['id'] = re.search(r'/(\d+)\.json$', r['metadata']).group(1)
            yield r


def setup():
    os.makedirs(HOME, exist_ok=True)
    for name in ('PDMX.csv', 'mxl.tar.gz'):
        target = os.path.join(HOME, name)
        if not os.path.exists(target):
            print(f'Downloading {name}…')
            subprocess.run(['curl', '-L', '--fail', '-o', target, f'{RECORD}/{name}?download=1'], check=True)
    if not os.path.isdir(os.path.join(HOME, 'mxl')):
        print('Extracting…')
        subprocess.run(['tar', '-xzf', 'mxl.tar.gz'], cwd=HOME, check=True)
        os.remove(os.path.join(HOME, 'mxl.tar.gz'))
    print(f'Ready in {HOME}.')


def search(words, piano):
    needles = [fold(w) for w in words]
    hits = []
    for r in rows():
        hay = fold(' '.join((r['title'], r['song_name'], r['subtitle'], r['composer_name'], r['artist_name'])))
        if all(n in hay for n in needles) and (not piano or r['n_tracks'] == '1'):
            hits.append(r)
    for r in hits:
        r['views'] = int(r['n_views'] or 0)
    hits.sort(key=lambda r: r['views'], reverse=True)
    for r in hits[:LIMIT]:
        rating = f"{float(r['rating']):.2f}×{r['n_ratings']}" if r['n_ratings'] != '0' else '—'
        print(f"{r['id']:>9}  {r['views']:>7} views  {rating:>9}  {r['n_tracks']:>2} part(s)  "
              f"{r['song_length.bars']:>4} bars  {r['license']:<13} {r['title'][:70]}")
    print(f'{len(hits)} match(es)' + (f' (first {LIMIT} shown)' if len(hits) > LIMIT else ''))


def get(ids, to):
    wanted = set(ids)
    os.makedirs(to, exist_ok=True)
    for r in rows():
        if r['id'] in wanted:
            dest = os.path.join(to, f"{r['id']}.mxl")
            shutil.copy(os.path.join(HOME, r['mxl']), dest)
            print(f"{dest}  ← {r['title']} (musescore.com/score/{r['id']}, {r['license']})")
            wanted.discard(r['id'])
            if not wanted:
                break
    for i in sorted(wanted):
        print(f'{i}: not in PDMX', file=sys.stderr)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('setup', help='download and unpack the dataset')
    sp = sub.add_parser('search', help='candidates for a piece, most viewed first')
    sp.add_argument('words', nargs='+')
    sp.add_argument('--piano', action='store_true', help='single-part scores only')
    gp = sub.add_parser('get', help='copy scores out by MuseScore id')
    gp.add_argument('ids', nargs='+')
    gp.add_argument('--to', default='tmp/candidates')
    args = ap.parse_args()
    if args.cmd == 'setup':
        setup()
    elif args.cmd == 'search':
        search(args.words, args.piano)
    else:
        get(args.ids, args.to)
