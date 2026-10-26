"""把 Gemini 產的零件圖去背並切成 15 個零件。

用法：python3 playcall/tools/cut-parts.py nyk_11
輸入：playcall/art/src/{id}_parts.png（純綠 #00FF00 背景）
輸出：playcall/art/players/{id}/{part}.png（透明背景）與 parts.json（各零件尺寸）
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

# 零件圖的固定排列（由上到下、由左到右），名稱以「畫面」左右區分
ORDER = [
    'head', 'torso', 'hips', 'upperArmA', 'upperArmB',
    'forearmA', 'forearmB', 'handA', 'handB', 'thighA',
    'thighB', 'shinA', 'shinB', 'shoeA', 'shoeB',
]

ROOT = Path(__file__).resolve().parent.parent


def key_green(rgb):
    """綠幕去背：依「綠色比其他色多多少」算半透明，並去除邊緣綠光。"""
    f = rgb.astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    greenness = g - np.maximum(r, b)
    alpha = np.clip((120 - greenness) / (120 - 40), 0, 1)
    spill = np.maximum(r, b)
    g2 = np.where(greenness > 0, np.minimum(g, spill + 4), g)
    out = np.dstack([r, g2, b, alpha * 255]).round().astype(np.uint8)
    return out


def main(pid):
    src = Image.open(ROOT / 'art' / 'src' / f'{pid}_parts.png').convert('RGB')
    rgba = key_green(np.array(src))
    mask = rgba[..., 3] > 128
    # 稍微膨脹，避免細線把一個零件切成好幾塊
    labels, n = ndimage.label(ndimage.binary_dilation(mask, iterations=3))
    boxes = ndimage.find_objects(labels)
    comps = []
    for i, sl in enumerate(boxes):
        area = int((labels[sl] == i + 1).sum())
        if area < 800:
            continue
        ys, xs = sl
        comps.append({'id': i + 1, 'x0': xs.start, 'y0': ys.start, 'x1': xs.stop, 'y1': ys.stop, 'area': area})
    if len(comps) != len(ORDER):
        sys.exit(f'找到 {len(comps)} 個零件，預期 {len(ORDER)} 個，請檢查零件圖')

    # 依列分組：中心 y 相近的同一列，再依 x 排序
    comps.sort(key=lambda c: (c['y0'] + c['y1']) / 2)
    rows, cur = [], [comps[0]]
    for c in comps[1:]:
        prev = cur[-1]
        if (c['y0'] + c['y1']) / 2 - (prev['y0'] + prev['y1']) / 2 > 120:
            rows.append(cur)
            cur = [c]
        else:
            cur.append(c)
    rows.append(cur)
    ordered = [c for row in rows for c in sorted(row, key=lambda c: c['x0'])]

    out_dir = ROOT / 'art' / 'players' / pid
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {}
    for name, c in zip(ORDER, ordered):
        sl = (slice(c['y0'], c['y1']), slice(c['x0'], c['x1']))
        part = rgba[sl].copy()
        part[..., 3] = np.where(labels[sl] == c['id'], part[..., 3], 0)
        Image.fromarray(part).save(out_dir / f'{name}.png')
        meta[name] = {'w': c['x1'] - c['x0'], 'h': c['y1'] - c['y0']}
    (out_dir / 'parts.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(f'{pid}: {len(meta)} parts -> {out_dir.relative_to(ROOT.parent)}')
    for k, v in meta.items():
        print(f'  {k:10s} {v["w"]:4d} x {v["h"]:4d}')


if __name__ == '__main__':
    main(sys.argv[1])
