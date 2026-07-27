#!/usr/bin/env python3
"""
Tuning sweep: load the scene once, then re-render it under a list of lighting /
tone-mapping settings, scoring each against the reference photograph.

    python3 tools/sweep.py --preset exposure
    python3 tools/sweep.py --js-file my_variants.json

Each variant is a dict of knobs applied through `window.__factory` before the
frame is captured. Scores are the mean per-region colour distance used by
tools/compare.py, so lower is better.
"""
import argparse
import base64
import json
import time

from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright

REGIONS = {
    'ceiling': (60, 10, 620, 110),
    'crane': (150, 150, 600, 180),
    'windows': (790, 110, 950, 260),
    'rightwall': (760, 300, 860, 420),
    'backwall': (620, 240, 720, 330),
    'floorNear': (120, 640, 300, 780),
    'floorMid': (300, 500, 430, 600),
    'floorFar': (600, 430, 690, 470),
    'aisle': (250, 470, 330, 520),
    'robot': (400, 600, 470, 690),
    'conveyor': (520, 490, 660, 620),
    'leftClutter': (80, 300, 300, 430),
    'cnc': (490, 240, 570, 300),
    'pedestal': (280, 690, 350, 780),
}

APPLY_JS = """(v) => {
  const F = window.__factory; if (!F) return 'no __factory';
  const { renderer, lighting, fx, scene } = F;
  if (v.exposure   !== undefined) renderer.toneMappingExposure = v.exposure;
  if (v.tone       !== undefined && fx.setToneMapping) fx.setToneMapping(v.tone);
  if (v.bloom      !== undefined && fx.setBloom) fx.setBloom(v.bloom);
  if (v.ssao       !== undefined && fx.setSSAO) fx.setSSAO(v.ssao);
  if (v.sun        !== undefined) lighting.sun.intensity = v.sun;
  if (v.hemi       !== undefined) lighting.hemi.intensity = v.hemi;
  if (v.ambient    !== undefined) lighting.ambient.intensity = v.ambient;
  if (v.fill       !== undefined) lighting.fill.intensity = v.fill;
  if (v.rect       !== undefined) lighting.rectLights.forEach(r => r.intensity = v.rect);
  if (v.points     !== undefined) lighting.pointLights.forEach(p => p.intensity = v.points);
  if (v.envInt     !== undefined) scene.environmentIntensity = v.envInt;
  if (v.emissive   !== undefined) {
    scene.traverse(o => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (m && m.emissiveIntensity !== undefined && m.__baseEmissive === undefined) {
          m.__baseEmissive = m.emissiveIntensity;
        }
        if (m && m.__baseEmissive !== undefined) m.emissiveIntensity = m.__baseEmissive * v.emissive;
      }
    });
  }
  return 'ok';
}"""


def score(ref, ren):
    tot, detail = 0.0, {}
    for name, bb in REGIONS.items():
        r = ImageStat.Stat(ref.crop(bb)).mean
        n = ImageStat.Stat(ren.crop(bb)).mean
        d = sum(abs(r[i] - n[i]) for i in range(3)) / 3
        detail[name] = round(d, 1)
        tot += d
    return tot / len(REGIONS), detail


PRESETS = {
    'exposure': [{'exposure': e, 'bloom': b}
                 for e in (0.20, 0.30, 0.40, 0.50, 0.65, 0.80, 1.05)
                 for b in (False,)],
    'bloom': [{'exposure': 0.4, 'bloom': b} for b in (False, True)],
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--url', default='http://127.0.0.1:5173/')
    p.add_argument('--ref', default='img01.jpg')
    p.add_argument('--preset', default=None)
    p.add_argument('--variants', default=None, help='JSON file: list of knob dicts')
    p.add_argument('--outdir', default='/tmp/sweep')
    p.add_argument('--w', type=int, default=960)
    p.add_argument('--h', type=int, default=800)
    p.add_argument('--settle', type=float, default=2.5)
    p.add_argument('--save-best', default=None)
    a = p.parse_args()

    variants = (json.load(open(a.variants)) if a.variants
                else PRESETS.get(a.preset) or PRESETS['exposure'])

    import os
    os.makedirs(a.outdir, exist_ok=True)
    ref = Image.open(a.ref).convert('RGB')

    results = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=[
            '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--no-sandbox', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'])
        page = b.new_page(viewport={'width': a.w, 'height': a.h}, device_scale_factor=1)
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)[:200]))
        page.goto(a.url, wait_until='domcontentloaded', timeout=60000)

        def ready(limit=120):
            """Wait until the scene is built. Survives Vite reloading the page."""
            t0 = time.time()
            while time.time() - t0 < limit:
                try:
                    if page.evaluate(
                            "()=>!!document.querySelector('#loader.done') && !!window.__factory"):
                        page.evaluate("""()=>{for(const id of ['hud','stats','help','slider']){
                            const e=document.getElementById(id); if(e) e.style.display='none';}}""")
                        return True
                except Exception:
                    pass  # execution context destroyed mid-reload — just retry
                time.sleep(0.4)
            return False

        def retrying(fn, tries=4):
            """Run fn(); if the page reloaded underneath us, re-settle and retry."""
            for t in range(tries):
                try:
                    return fn()
                except Exception as e:
                    if t == tries - 1:
                        raise
                    print(f'  (page reloaded: {str(e)[:60]}…) re-settling')
                    ready()
                    time.sleep(a.settle)

        ready()
        time.sleep(1.0)

        for i, v in enumerate(variants):
            r = retrying(lambda: page.evaluate(APPLY_JS, v))
            if r != 'ok':
                print(f'  apply failed: {r}')
            time.sleep(a.settle)
            # The renderer runs without preserveDrawingBuffer, so the colour
            # buffer is gone by the time a later task reads it. Render and grab
            # the pixels inside ONE JS task so the buffer is still intact.
            data = retrying(lambda: page.evaluate("""() => {
              const F = window.__factory;
              if (F && F.fx && F.fx.render) F.fx.render(0.016);
              else if (F) F.renderer.render(F.scene, F.cam.camera);
              const c = document.querySelector('canvas');
              return c ? c.toDataURL('image/png') : null; }"""))
            path = f'{a.outdir}/v{i:02d}.png'
            with open(path, 'wb') as fh:
                fh.write(base64.b64decode(data.split(',', 1)[1]))
            im = Image.open(path).convert('RGB')
            if im.size != ref.size:
                # Sweeps run at reduced resolution for speed; scoring is on
                # region colour means, which survive the resample.
                im = im.resize(ref.size, Image.LANCZOS)
                im.save(path)
            if max(ImageStat.Stat(im).mean) < 2:
                print('  !! frame came back black — capture failed, not a lighting result')
            s, detail = score(ref, im)
            results.append((s, v, path, detail))
            print(f'{i:2d}  score={s:6.2f}  {json.dumps(v)}')
        b.close()

    results.sort(key=lambda t: t[0])
    print('\n=== best ===')
    for s, v, path, detail in results[:3]:
        print(f'{s:6.2f}  {json.dumps(v)}\n        {json.dumps(detail)}\n        {path}')
    if a.save_best:
        import shutil
        shutil.copy(results[0][2], a.save_best)
        print(f'best copied to {a.save_best}')


if __name__ == '__main__':
    main()
