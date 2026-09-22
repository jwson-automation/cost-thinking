"""社員が選ぶアバター。16x16 のドット絵を手で置く。

AI 生成は規格が揃わないので使わない（顔の位置・目の高さが毎回ずれる）。
1匹につき 4コマ：通常 → まばたき → 通常 → 少し沈む（呼吸）。
"""
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public', 'assets', 'avatars')

# 共通パレット。K=輪郭 F=顔 S=影 M=口まわり E=目 W=光 N=鼻 A=差し色
def palette(face, shade, muzzle, accent, line=(48, 33, 28, 255)):
    return {
        'K': line,
        'F': face,
        'S': shade,
        'M': muzzle,
        'A': accent,
        'E': (38, 28, 26, 255),
        'W': (255, 255, 255, 255),
        'N': (60, 42, 40, 255),
        '.': (0, 0, 0, 0),
    }

CAT = [
    '................',
    '..KK........KK..',
    '.KAAK......KAAK.',
    '.KAAAK....KAAAK.',
    '.KFAAKKKKKKAAFK.',
    '.KFFFFFFFFFFFFK.',
    'KFFFFFFFFFFFFFFK',
    'KFFEEFFFFFFEEFFK',
    'KFFEWFFFFFFEWFFK',
    'KFFFFFMMMMFFFFFK',
    'KSFFFMMNNMMFFFSK',
    '.KFFFMMMMMMFFFK.',
    '.KFFFFMMMMFFFFK.',
    '..KFFFFFFFFFFK..',
    '...KKFFFFFFKK...',
    '.....KKKKKK.....',
]

DOG = [
    '................',
    '...KKKKKKKKKK...',
    '..KFFFFFFFFFFK..',
    '.KAKFFFFFFFFKAK.',
    'KAAAKFFFFFFKAAAK',
    'KAAAAKFFFFKAAAAK',
    'KAAAAKFFFFKAAAAK',
    'KAAAAFEWFFWEFAAK',
    'KAAAAFEEFFEEFAAK',
    'KAAAKFFFFFFFKAAK',
    '.KAAKMMMNNMMKAK.',
    '..KKMMMMMMMMKK..',
    '...KMMMMMMMMK...',
    '...KKMMMMMMKK...',
    '.....KKKKKK.....',
    '................',
]

BEAR = [
    '................',
    '.KKK......KKK...',
    'KAAAK....KAAAK..',
    'KAAAAK..KAAAAK..',
    '.KFFFKKKKFFFK...',
    '.KFFFFFFFFFFK...',
    'KFFFFFFFFFFFFK..',
    'KFFEEFFFFEEFFFK.',
    'KFFEWFFFFEWFFFK.',
    'KFFFFFFFFFFFFFK.',
    'KSFFFMMMMMFFFSK.',
    '.KFFMMMNNMMMFK..',
    '.KFFMMMMMMMMFK..',
    '..KFFMMMMMMFK...',
    '...KKFFFFFKK....',
    '.....KKKKK......',
]

LION = [
    '................',
    '....AAAAAAAA....',
    '..AAAKKKKKKAAA..',
    '.AAKKFFFFFFKKAA.',
    '.AAKFFFFFFFFKAA.',
    'AAKFFFFFFFFFFKAA',
    'AAKFFEEFFEEFFKAA',
    'AAKFFEWFFEWFFKAA',
    'AAKFFFFFFFFFFKAA',
    'AAKFFFMMNNMMFKAA',
    '.AKFFMMMMMMMFKA.',
    '.AKFFFMMMMMFFKA.',
    '..AAKFFFFFFKAA..',
    '...AAKKFFKKAA...',
    '....AAAKKAAA....',
    '......AAAA......',
]

SHEETS = {
    'cat':  (CAT,  palette((246, 226, 196, 255), (214, 190, 160, 255), (255, 245, 230, 255), (240, 176, 128, 255))),
    'dog':  (DOG,  palette((226, 200, 168, 255), (196, 168, 136, 255), (250, 240, 226, 255), (150, 110, 78, 255))),
    'bear': (BEAR, palette((184, 138, 100, 255), (156, 112, 78, 255), (236, 212, 184, 255), (132, 94, 64, 255))),
    'lion': (LION, palette((244, 206, 140, 255), (214, 176, 112, 255), (252, 238, 210, 255), (214, 138, 58, 255))),
}


def draw(rows, pal, blink=False, drop=0):
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            c = ch
            if blink and ch in ('E', 'W'):
                c = 'K' if ch == 'E' else 'F'   # 目を閉じる
            yy = y + drop
            if 0 <= yy < 16:
                px[x, yy] = pal[c]
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (rows, pal) in SHEETS.items():
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        frames = [draw(rows, pal), draw(rows, pal, blink=True), draw(rows, pal), draw(rows, pal, drop=1)]
        for i, f in enumerate(frames, 1):
            f.save(os.path.join(d, f'idle-0{i}.png'))
        print(name, 'ok')


if __name__ == '__main__':
    main()
