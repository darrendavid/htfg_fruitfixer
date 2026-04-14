"""
extract-pptx-atoz.py

1. Extracts all text from atoz 2020 copy.pptx slide by slide.
2. Copies embedded images to atoz-pptx/{plant-slug}/ using the slide→image
   relationship files, so images are named/grouped by their fruit.
3. Writes slide-text.json with per-slide text for reference.
"""

import zipfile, os, re, json, shutil
from xml.etree import ElementTree as ET

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PPTX   = os.path.join(ROOT, 'content', 'source', 'HawaiiFruit. Net', 'atoz 2020 copy.pptx')
DEST   = os.path.join(ROOT, 'content', 'pass_01', 'unassigned', 'unclassified', 'atoz-pptx')
OUT    = os.path.join(ROOT, 'content', 'parsed', 'atoz_slide_text.json')

IMG_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.tiff', '.bmp'}
IMG_NS   = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

# Slide number → plant slug (None = skip / non-fruit slide)
# Slides 1, 35-43 are intro/business/closing — skip their images
SLIDE_PLANT = {
    2:  'alupag',
    3:  'loquat',
    4:  'bilimbi-buddhas-hand',   # two fruits on one slide
    5:  'ceylon-gooseberry',
    6:  'cowa',
    7:  'durian',
    8:  'eggfruit',
    9:  'finger-lime',
    10: 'green-sapote',
    11: 'grumichama',
    12: 'persimmon',
    13: 'banana',
    14: 'ice-cream-bean',
    15: 'jaboticaba',
    16: 'kokum',
    17: 'lulo',
    18: 'midyim-berry',
    19: 'jackfruit',
    20: 'ohelo',
    21: 'ooray',
    22: 'pulasan',
    23: 'quenepa',
    24: 'rollinia',
    25: 'soursop',
    26: 'surinam-cherry',
    27: 'tropical-apricot',
    28: 'ume',
    29: 'voavanga',
    30: 'wampi',
    31: 'water-apple',
    32: 'watermelon',
    33: 'yuzu',
    34: 'jujube',
}

def slide_number(name):
    m = re.search(r'slide(\d+)\.xml', name)
    return int(m.group(1)) if m else 0

def extract_text(xml_bytes):
    root = ET.fromstring(xml_bytes)
    paragraphs = []
    for para in root.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}p'):
        runs = []
        for r in para.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}t'):
            if r.text:
                runs.append(r.text)
        text = ''.join(runs).strip()
        if text:
            paragraphs.append(text)
    return paragraphs

def get_slide_images(z, slide_num):
    """Return list of media paths (relative to ppt/) for images on this slide."""
    rels_path = f'ppt/slides/_rels/slide{slide_num}.xml.rels'
    if rels_path not in z.namelist():
        return []
    root = ET.fromstring(z.read(rels_path))
    images = []
    for r in root:
        if r.attrib.get('Type') == IMG_NS:
            target = r.attrib['Target']  # e.g. ../media/image7.png
            # Resolve relative to ppt/slides/ → ppt/media/...
            media_path = 'ppt/media/' + os.path.basename(target)
            if media_path in z.namelist():
                images.append(media_path)
    return images

def safe_dest(dir_, filename):
    base, ext = os.path.splitext(filename)
    candidate = os.path.join(dir_, filename)
    i = 1
    while os.path.exists(candidate):
        candidate = os.path.join(dir_, f'{base}_{i}{ext}')
        i += 1
    return candidate

# Clear and recreate destination
if os.path.exists(DEST):
    shutil.rmtree(DEST)
os.makedirs(DEST, exist_ok=True)

slides_out = []
copied = 0
skipped_slides = 0
seen_media = set()  # avoid copying same image file twice (shared across slides)

with zipfile.ZipFile(PPTX, 'r') as z:
    slide_names = sorted(
        [n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)],
        key=slide_number
    )

    print(f'Processing {len(slide_names)} slides...\n')

    for sname in slide_names:
        num = slide_number(sname)
        xml = z.read(sname)
        paragraphs = extract_text(xml)
        slides_out.append({'slide': num, 'text': paragraphs})

        plant_slug = SLIDE_PLANT.get(num)
        slide_images = get_slide_images(z, num)
        ext_images = [m for m in slide_images if os.path.splitext(m)[1].lower() in IMG_EXTS]

        preview = ' | '.join(paragraphs[:2])[:80].encode('ascii','replace').decode('ascii')
        print(f'  Slide {num:02d} [{plant_slug or "SKIP":25s}] {len(ext_images)} img  {preview}')

        if not plant_slug:
            skipped_slides += 1
            continue

        dest_dir = os.path.join(DEST, plant_slug)
        os.makedirs(dest_dir, exist_ok=True)

        for media_path in ext_images:
            if media_path in seen_media:
                continue  # template/logo shared across slides
            seen_media.add(media_path)
            filename = os.path.basename(media_path)
            dest_path = safe_dest(dest_dir, filename)
            try:
                data = z.read(media_path)
                with open(dest_path, 'wb') as f:
                    f.write(data)
                copied += 1
            except Exception as e:
                print(f'    ERROR {media_path}: {e}')

print(f'\nImages copied: {copied}  |  Slides skipped: {skipped_slides}')
print(f'Destination: {DEST}')

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump({'source': PPTX, 'slide_count': len(slide_names), 'slides': slides_out}, f, indent=2, ensure_ascii=False)
print(f'Slide text: {OUT}')
