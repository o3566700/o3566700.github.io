"""把球員真實照片轉成點陣頭像（不需要 AI）。

作法（參考常見的照片轉像素流程）：
  1. 偵測臉 → GrabCut 去背
  2. 加強對比、銳化、提高飽和度（縮小後細節才不會糊掉）
  3. 區域平均縮小到目標尺寸
  4. 在 Lab 色彩空間用 k-means 收斂成少量顏色
  5. 眼睛、嘴巴加深（小尺寸下五官要誇張才看得出來）
  6. 加 1px 深色外框

用法：python3 photo2pixel.py 照片.jpg 輸出前綴
輸出：{前綴}_head.png（遊戲角色用頭，HEAD×HEAD）、{前綴}_portrait.png（球員卡頭像，64×64）、
      {前綴}_closeup.png（招牌技特寫，96×96）
照片有肖像權與著作權，只放在本機或私人雲端，不要提交到 repo。
"""
import sys

import cv2
import numpy as np

HEAD = 24
PORTRAIT = 64
CLOSEUP = 96
OUTLINE = (34, 18, 26)  # BGR


def detect_face(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    faces = cascade.detectMultiScale(gray, 1.1, 5, minSize=(80, 80))
    if len(faces) == 0:
        sys.exit('找不到臉，請換一張正面清楚的照片')
    return max(faces, key=lambda f: f[2] * f[3])


def cutout(img, face):
    """GrabCut 去背：臉一定是前景，畫面最外圈一定是背景。"""
    h, w = img.shape[:2]
    fx, fy, fw, fh = face
    mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    x0, x1 = max(0, int(fx - 1.0 * fw)), min(w, int(fx + 2.0 * fw))
    y0 = max(0, int(fy - 0.9 * fh))
    mask[y0:, x0:x1] = cv2.GC_PR_FGD
    mask[int(fy + fh * 0.2):int(fy + fh * 0.9), int(fx + fw * 0.2):int(fx + fw * 0.8)] = cv2.GC_FGD
    # 背景色：取照片四邊的中位數；和它顏色相近、而且連到邊框的區域一定是背景（棚拍單色背景很有效）
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 2), cv2.COLOR_BGR2LAB).astype(np.float32)
    border = np.concatenate([lab[:6].reshape(-1, 3), lab[:, :6].reshape(-1, 3), lab[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    near = (np.linalg.norm(lab - bg, axis=2) < 16).astype(np.uint8)
    n, comp = cv2.connectedComponents(near)
    edge_ids = set(np.unique(np.concatenate([comp[0], comp[:, 0], comp[:, -1]]))) - {0}
    mask[np.isin(comp, list(edge_ids))] = cv2.GC_BGD
    mask[int(fy + fh * 0.2):int(fy + fh * 0.9), int(fx + fw * 0.2):int(fx + fw * 0.8)] = cv2.GC_FGD
    mask[:4, :] = cv2.GC_BGD
    mask[:, :4] = mask[:, -4:] = cv2.GC_BGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(img, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return alpha


def enhance(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(l)
    img = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(img, (0, 0), 3)
    img = cv2.addWeighted(img, 1.6, blur, -0.6, 0)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.2, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def quantize(small, alpha, k):
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    on = alpha.reshape(-1) > 0
    data = lab[on]
    k = min(k, len(data))
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.5)
    _, labels, centers = cv2.kmeans(data, k, None, crit, 6, cv2.KMEANS_PP_CENTERS)
    out = lab.copy()
    out[on] = centers[labels.flatten()]
    return cv2.cvtColor(out.reshape(small.shape).astype(np.uint8), cv2.COLOR_LAB2BGR)


def pixelate(img, alpha, box, size, k, feature_pts):
    x0, y0, x1, y1 = box
    crop = img[y0:y1, x0:x1]
    a = alpha[y0:y1, x0:x1]
    small = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
    sa = cv2.resize(a, (size, size), interpolation=cv2.INTER_AREA)
    sa = np.where(sa > 110, 255, 0).astype(np.uint8)
    small = quantize(small, sa, k)
    # 五官加深：眼睛、嘴巴所在的像素壓暗，旁邊留亮點
    sx, sy = size / (x1 - x0), size / (y1 - y0)
    for (px, py, kind) in feature_pts:
        cx, cy = int((px - x0) * sx), int((py - y0) * sy)
        if 0 <= cx < size and 0 <= cy < size:
            c = small[cy, cx].astype(np.int32)
            small[cy, cx] = np.clip(c * (0.35 if kind == 'eye' else 0.6), 0, 255).astype(np.uint8)
    # 外框
    rgba = np.dstack([small, sa])
    pad = np.zeros((size + 2, size + 2, 4), np.uint8)
    pad[1:-1, 1:-1] = rgba
    ring = cv2.dilate(np.pad(sa, 1), np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], np.uint8)) - np.pad(sa, 1)
    pad[ring > 0] = (*OUTLINE, 255)
    return pad


def features(img, face):
    """用臉部比例估計眼睛與嘴巴位置（Haar 眼睛偵測不穩時的備案）。"""
    fx, fy, fw, fh = face
    gray = cv2.cvtColor(img[fy:fy + fh, fx:fx + fw], cv2.COLOR_BGR2GRAY)
    eyes = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml').detectMultiScale(gray, 1.1, 8)
    pts = []
    eyes = [e for e in eyes if e[1] < fh * 0.55]
    if len(eyes) >= 2:
        for ex, ey, ew, eh in sorted(eyes, key=lambda e: e[2] * e[3])[-2:]:
            pts.append((fx + ex + ew / 2, fy + ey + eh * 0.55, 'eye'))
    else:
        pts += [(fx + fw * 0.32, fy + fh * 0.42, 'eye'), (fx + fw * 0.68, fy + fh * 0.42, 'eye')]
    pts.append((fx + fw * 0.5, fy + fh * 0.8, 'mouth'))
    return pts


def main(src, prefix):
    img = cv2.imread(src)
    face = detect_face(img)
    alpha = cutout(img, face)
    img = enhance(img)
    fx, fy, fw, fh = face
    pts = features(img, face)
    h, w = img.shape[:2]

    def square(cx, cy, side):
        s = int(side)
        x0, y0 = int(cx - s / 2), int(cy - s / 2)
        x0, y0 = max(0, min(w - s, x0)), max(0, min(h - s, y0))
        return x0, y0, x0 + s, y0 + s

    # 遊戲用頭：臉 + 頭髮，略往上取
    head = pixelate(img, alpha, square(fx + fw / 2, fy + fh * 0.42, fw * 1.55), HEAD, 10, pts)
    # 球員卡頭像：頭 + 肩膀
    portrait = pixelate(img, alpha, square(fx + fw / 2, fy + fh * 0.85, fw * 2.6), PORTRAIT, 16, pts)
    # 招牌技特寫：較大、顏色較多
    closeup = pixelate(img, alpha, square(fx + fw / 2, fy + fh * 0.75, fw * 2.3), CLOSEUP, 24, pts)
    cv2.imwrite(f'{prefix}_head.png', head)  # BGRA
    cv2.imwrite(f'{prefix}_portrait.png', portrait)
    cv2.imwrite(f'{prefix}_closeup.png', closeup)
    print(f'{prefix}: head {head.shape[1]}x{head.shape[0]}, portrait {portrait.shape[1]}x{portrait.shape[0]}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
