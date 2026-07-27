#!/usr/bin/env python3
"""
Headless screenshot harness for the factory scene.

    python3 tools/shot.py [--out out.png] [--url http://127.0.0.1:5173]
                          [--w 960] [--h 800] [--view photo] [--wait 12]
                          [--no-ui]

Loads the page in headless Chromium, waits for the scene to finish building,
captures the canvas, and prints every console error/warning it saw. Exit code is
non-zero if the page threw.
"""
import argparse
import json
import sys
import time

from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument('--url', default='http://127.0.0.1:5173/')
p.add_argument('--out', default='/tmp/shot.png')
p.add_argument('--w', type=int, default=960)
p.add_argument('--h', type=int, default=800)
p.add_argument('--view', default=None, help='photo|aisle|cell|crane|top')
p.add_argument('--wait', type=float, default=15.0, help='max seconds to wait for readiness')
p.add_argument('--settle', type=float, default=2.0, help='extra seconds after ready')
p.add_argument('--no-ui', action='store_true', help='hide the HUD panels before shooting')
p.add_argument('--full', action='store_true', help='capture the whole viewport, not just the letterbox')
p.add_argument('--shot-timeout', type=float, default=180.0, help='screenshot timeout in seconds')
a = p.parse_args()

logs, errors = [], []

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        args=[
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--disable-gpu-sandbox',
            '--no-sandbox',
            '--ignore-gpu-blocklist',
        ],
    )
    page = browser.new_page(viewport={'width': a.w, 'height': a.h}, device_scale_factor=1)

    page.on('console', lambda m: (logs.append(f'[{m.type}] {m.text}'),
                                  errors.append(m.text) if m.type == 'error' else None))
    page.on('pageerror', lambda e: errors.append(f'PAGEERROR: {e}'))

    page.goto(a.url, wait_until='domcontentloaded', timeout=45000)

    # Wait for the loader to be dismissed, or for a hard failure.
    ok = False
    t0 = time.time()
    while time.time() - t0 < a.wait:
        try:
            state = page.evaluate("""() => {
              const l = document.getElementById('loader');
              const c = document.querySelector('canvas');
              return { done: !!l && l.classList.contains('done'), canvas: !!c,
                       msg: (document.getElementById('loader-msg')||{}).textContent || '' };
            }""")
        except Exception as e:
            errors.append(f'EVAL: {e}')
            break
        if state['done'] and state['canvas']:
            ok = True
            break
        time.sleep(0.25)

    time.sleep(a.settle)

    if a.view:
        try:
            page.select_option('#sel-view', a.view)
            time.sleep(1.6)
        except Exception as e:
            errors.append(f'setView: {e}')

    if a.no_ui:
        page.evaluate("""() => {
          for (const id of ['hud','stats','help','slider']) {
            const e = document.getElementById(id); if (e) e.style.display='none';
          }
        }""")
        time.sleep(0.4)

    # Prefer the letterboxed photo-match rect so the shot lines up with img01.jpg.
    # main.js publishes it as window.__photoRect = {x, y, w, h} in CSS pixels.
    clip = None
    if not a.full:
        try:
            r = page.evaluate("() => window.__photoRect || null")
            if r and r.get('w', 0) > 8 and r.get('h', 0) > 8:
                clip = {'x': r['x'], 'y': r['y'], 'width': r['w'], 'height': r['h']}
        except Exception:
            clip = None

    try:
        page.screenshot(path=a.out, clip=clip if clip else None,
                        timeout=a.shot_timeout * 1000, animations='disabled', caret='hide')
    except Exception as e:
        errors.append(f'SCREENSHOT: {e}')
        # Fall back to pulling the pixels straight off the canvas.
        try:
            data = page.evaluate("""() => {
              const c = document.querySelector('canvas');
              return c ? c.toDataURL('image/png') : null;
            }""")
            if data:
                import base64
                with open(a.out, 'wb') as fh:
                    fh.write(base64.b64decode(data.split(',', 1)[1]))
                errors.append('SCREENSHOT: recovered via canvas.toDataURL')
        except Exception as e2:
            errors.append(f'CANVAS-FALLBACK: {e2}')
    browser.close()

print(json.dumps({
    'ok': ok,
    'out': a.out,
    'errors': errors[:40],
    'errorCount': len(errors),
    'logTail': logs[-15:],
}, indent=2, ensure_ascii=False))

sys.exit(0 if ok and not errors else 1)
