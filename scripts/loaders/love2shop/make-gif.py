# Assembles PNG frames (f000.png, f001.png, ...) into a looping GIF with one shared
# palette. Usage: python3 make-gif.py <frame-dir> <out.gif> [fps]
import sys, os, glob
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
fps = int(sys.argv[3]) if len(sys.argv) > 3 else 25

# Colours that must survive quantisation exactly: the two Love2Shop brand
# colours and white. A near-miss on the background shows up as a faint box
# when the GIF sits on a white or brand-blue page.
KEEP = [(0x2F, 0x49, 0xEA), (0xE1, 0x00, 0x54), (0xFF, 0xFF, 0xFF)]

files = sorted(glob.glob(os.path.join(src, "f*.png")))
frames = [Image.open(f).convert("RGB") for f in files]
w, h = frames[0].size

# One shared palette for every frame, so nothing flickers between frames
sheet = Image.new("RGB", (w, h * len(frames)))
for i, fr in enumerate(frames):
    sheet.paste(fr, (0, i * h))
pal = sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT)

# Pin the brand colours: overwrite each one's nearest palette entry with the exact value
p = pal.getpalette()
entries = [tuple(p[i:i + 3]) for i in range(0, len(p), 3)]
for keep in KEEP:
    j = min(range(len(entries)), key=lambda k: sum((a - b) ** 2 for a, b in zip(entries[k], keep)))
    entries[j] = keep
flat_palette = [c for e in entries for c in e]

# Map every pixel to its exact nearest palette entry ourselves. Pillow's own
# lookup rounds colours to a coarse cache first, which sends pure white to a
# near-white neighbour. The artwork is flat colour, so no dithering is needed.
memo = {}
def index_of(px):
    j = memo.get(px)
    if j is None:
        j = memo[px] = min(range(len(entries)), key=lambda k: (entries[k][0] - px[0]) ** 2 + (entries[k][1] - px[1]) ** 2 + (entries[k][2] - px[2]) ** 2)
    return j

quant = []
for fr in frames:
    b = fr.tobytes()
    idx = bytes(index_of(px) for px in zip(b[0::3], b[1::3], b[2::3]))
    q = Image.frombytes("P", fr.size, idx)
    q.putpalette(flat_palette)
    quant.append(q)

# Fail loudly if a brand colour did not survive into the pixels
seen = set()
for q in (quant[0], quant[len(quant) // 2]):
    seen |= {entries[i] for i in set(q.tobytes())}
missing = [k for k in KEEP if k not in seen]
if missing:
    sys.exit(f"brand colours missing from the GIF: {missing}")

delay = round(1000 / fps)
quant[0].save(out, save_all=True, append_images=quant[1:], duration=delay, loop=0, optimize=True, disposal=1)
print(f"{os.path.relpath(out)}: {len(frames)} frames, {w}x{h}, {delay}ms/frame, {os.path.getsize(out) / 1024:.1f} KB")
