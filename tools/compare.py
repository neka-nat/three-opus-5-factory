#!/usr/bin/env python3
"""
Compare a render against the reference photograph.

    python3 tools/compare.py render.png [--ref img01.jpg] [--out /tmp/cmp]

Writes:
    <out>_side.png    reference | render, side by side at matched size
    <out>_diff.png    absolute difference, boosted
    <out>_blend.png   50/50 blend, for checking alignment of major lines
and prints per-region mean colour for both images so the palette can be tuned.
"""
import argparse
import os

from PIL import Image, ImageChops, ImageEnhance, ImageStat

p = argparse.ArgumentParser()
p.add_argument('render')
p.add_argument('--ref', default='img01.jpg')
p.add_argument('--out', default='/tmp/cmp')
a = p.parse_args()

ref = Image.open(a.ref).convert('RGB')
ren = Image.open(a.render).convert('RGB')
if ren.size != ref.size:
    ren = ren.resize(ref.size, Image.LANCZOS)

W, H = ref.size

side = Image.new('RGB', (W * 2 + 8, H), (18, 18, 20))
side.paste(ref, (0, 0))
side.paste(ren, (W + 8, 0))
side.save(f'{a.out}_side.png')

diff = ImageChops.difference(ref, ren)
ImageEnhance.Brightness(diff).enhance(2.4).save(f'{a.out}_diff.png')

Image.blend(ref, ren, 0.5).save(f'{a.out}_blend.png')

REGIONS = {
    'ceiling      ': (60, 10, 620, 110),
    'crane girder ': (150, 150, 600, 180),
    'right windows': (790, 110, 950, 260),
    'right wall   ': (760, 300, 860, 420),
    'back wall    ': (620, 240, 720, 330),
    'floor near   ': (120, 640, 300, 780),
    'floor mid    ': (300, 500, 430, 600),
    'floor far    ': (600, 430, 690, 470),
    'aisle line   ': (250, 470, 330, 520),
    'robot yellow ': (400, 600, 470, 690),
    'conveyor     ': (520, 490, 660, 620),
    'left clutter ': (80, 300, 300, 430),
    'cnc dark     ': (490, 240, 570, 300),
    'pedestal     ': (280, 690, 350, 780),
    'overall      ': (0, 0, W, H),
}

print(f'{"region":15s} {"reference":>18s} {"render":>18s}   Δ')
print('-' * 66)
tot = 0
for name, bboxx in REGIONS.items():
    r = ImageStat.Stat(ref.crop(bboxx)).mean
    n = ImageStat.Stat(ren.crop(bboxx)).mean
    d = sum(abs(r[i] - n[i]) for i in range(3)) / 3
    if name.strip() != 'overall':
        tot += d
    rr = f'#{int(r[0]):02X}{int(r[1]):02X}{int(r[2]):02X}'
    nn = f'#{int(n[0]):02X}{int(n[1]):02X}{int(n[2]):02X}'
    flag = '  <<<' if d > 34 else ('  <<' if d > 20 else '')
    print(f'{name:15s} {rr:>18s} {nn:>18s}  {d:5.1f}{flag}')
print('-' * 66)
print(f'mean regional Δ (excl. overall): {tot / (len(REGIONS) - 1):.1f}')
print(f'\nwrote {a.out}_side.png  {a.out}_diff.png  {a.out}_blend.png')
