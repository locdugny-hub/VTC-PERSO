#!/usr/bin/env python3
"""Banc d'essai SYNTHÉTIQUE : génère des images d'offres FICTIVES (formats hypothétiques),
les lit avec Tesseract (OCR de substitution, PAS l'OCR Apple) et enregistre texte + vérité terrain.

Objectif : vérifier que le parseur résiste au bruit d'un OCR réel (mode sombre, texte agrandi,
bandeau masquant). Ce banc NE mesure PAS la précision sur de vraies offres Uber/Bolt.

Usage : python3 tools/synthetic_ocr_bench.py [nombre] -> tests/fixtures/synthetic/cases.json
"""
import json, random, sys, subprocess, os, tempfile
from PIL import Image, ImageDraw, ImageFont

N = int(sys.argv[1]) if len(sys.argv) > 1 else 80
OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'synthetic')
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONTB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
rnd = random.Random(20261008)

def fr(x, d=2):
    return f"{x:.{d}f}".replace('.', ',')

def make_case(i):
    plat = rnd.choice(['uber', 'bolt'])
    dark = rnd.random() < 0.5
    big = rnd.random() < 0.3
    masked = rnd.random() < 0.15  # bandeau de notification sur le bas (trajet masqué)
    price = round(rnd.uniform(6, 60), 2)
    a_km = round(rnd.uniform(0.3, 6), 1); a_min = max(1, int(a_km * rnd.uniform(1.5, 3)))
    t_km = round(rnd.uniform(1.5, 40), 1); t_min = max(3, int(t_km * rnd.uniform(1.2, 2.5)))
    if plat == 'uber':
        layout = rnd.choice(['fr', 'en'])
        if layout == 'fr':
            lines = ['UberX', 'Exclusif', f'{fr(price)} €', '4,93 ★', f'À {a_min} min ({fr(a_km,1)} km)', '12 rue Fictive, Paris', f'Trajet de {t_min} min ({fr(t_km,1)} km)', 'Avenue Imaginaire, Paris', 'Accepter']
        else:
            lines = ['Uber Green', f'€{price:.2f}', '4.93 ★', f'{a_min} mins ({a_km:.1f} km) away', '12 rue Fictive', f'{t_min} mins ({t_km:.1f} km) trip', 'Avenue Imaginaire', 'Accept']
    else:
        layout = rnd.choice(['dot', 'kmfirst'])
        if layout == 'dot':
            lines = ['Bolt', f'{fr(price)} €', f'Prise en charge · {a_min} min · {fr(a_km,1)} km', '12 rue Fictive', f'Destination · {t_min} min · {fr(t_km,1)} km', 'Avenue Imaginaire', 'Accepter']
        else:
            lines = ['Bolt', f'{fr(price)} €', 'Prise en charge', f'{fr(a_km,1)} km • {a_min} min', 'Trajet', f'{fr(t_km,1)} km • {t_min} min', 'Accepter']
    W = 390 * 2
    size = 44 if big else 32
    font = ImageFont.truetype(FONT, size)
    fontb = ImageFont.truetype(FONTB, int(size * 1.6))
    H = 120 + len(lines) * int(size * 2.0) + 80
    bg, fg = ((18, 18, 20), (235, 235, 240)) if dark else ((250, 250, 250), (20, 20, 24))
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img)
    y = 60
    for ln in lines:
        isprice = '€' in ln and ('·' not in ln)
        f = fontb if isprice else font
        # Texte trop long : retour à la ligne (simule le texte agrandi)
        words, cur = ln.split(' '), ''
        for w in words:
            test = (cur + ' ' + w).strip()
            if d.textlength(test, font=f) > W - 80 and cur:
                d.text((40, y), cur, font=f, fill=fg); y += int(f.size * 1.35); cur = w
            else:
                cur = test
        d.text((40, y), cur, font=f, fill=fg); y += int(f.size * 1.6)
    truth = {'price': price, 'approachKm': a_km, 'approachMin': a_min, 'tripKm': t_km, 'tripMin': t_min}
    if masked:
        # Bandeau opaque couvrant la moitié basse : le trajet n'est plus lisible.
        d.rectangle([0, int(H * 0.55), W, H], fill=(60, 60, 70))
        d.text((40, int(H * 0.6)), 'Messages : Nouveau message', font=font, fill=(255, 255, 255))
    path = os.path.join(tempfile.gettempdir(), f'synth_{i}.png')
    img = img.resize((W // 2, H // 2)) if not big else img
    img.save(path)
    txt = subprocess.run(['tesseract', path, '-', '-l', 'eng', '--psm', '6'], capture_output=True, text=True).stdout
    os.remove(path)
    return {'id': f'synth-{i:03d}', 'platform': plat, 'layout': layout, 'dark': dark, 'big': big, 'masked': masked, 'truth': truth, 'ocrText': txt}

cases = [make_case(i) for i in range(N)]
with open(os.path.join(OUT, 'cases.json'), 'w') as fh:
    json.dump({'note': 'Offres FICTIVES, formats hypothétiques, OCR Tesseract (substitut). Ne mesure pas la précision réelle sur Uber/Bolt.', 'cases': cases}, fh, ensure_ascii=False, indent=1)
print(f'{N} cas écrits dans {OUT}/cases.json')
