"""
Build dataset 'ocr-pdf-it-v1' for OCR benchmark.

Produces:
  - test-data/ocr-pdf-it-v1/<category>/<name>.pdf
  - test-data/ocr-pdf-it-v1/<category>/<name>.txt   (ground truth)
  - test-data/ocr-pdf-it-v1/<category>/<name>.png   (rendered page 1 image used as OCR input)

Categories: native-clean, scan-clean, scan-noisy, forms, tables, mixed
Strategy: render each document via reportlab; for 'scan-*' categories rasterize
the page into a PIL image and re-embed as image-only PDF; for 'scan-noisy' add
JPEG compression, gaussian noise, slight rotation.
"""

from __future__ import annotations
import io, os, random, math
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(42)

ROOT = Path(__file__).resolve().parents[2] / "test-data" / "ocr-pdf-it-v1"
PAGE_W, PAGE_H = A4
DPI = 200  # rasterization for scan
PX_W = int(PAGE_W / 72 * DPI)
PX_H = int(PAGE_H / 72 * DPI)

# ---------- Italian sample content ----------
ITALIAN_PARAGRAPHS = [
    "Il sistema di gestione documentale enterprise garantisce la tracciabilita' completa di ogni operazione. La piattaforma supporta i principali formati di file e si integra con le applicazioni esistenti.",
    "La fatturazione elettronica e' obbligatoria per tutte le partite IVA dal primo gennaio 2024. I documenti devono essere conservati a norma per dieci anni presso un conservatore accreditato AgID.",
    "Per accedere ai servizi della Pubblica Amministrazione e' necessario utilizzare SPID, CIE o CNS. L'autenticazione a due fattori e' obbligatoria per le operazioni a rischio elevato.",
    "Il bilancio di esercizio deve essere depositato presso il Registro delle Imprese entro trenta giorni dalla data dell'assemblea che lo ha approvato. Sono previste sanzioni amministrative in caso di ritardo.",
]

FORM_FIELDS = [
    ("Nome e Cognome", "Mario Rossi"),
    ("Codice Fiscale", "RSSMRA80A01H501Z"),
    ("Indirizzo", "Via Garibaldi 12, 00100 Roma"),
    ("Email", "mario.rossi@example.it"),
    ("Telefono", "+39 06 12345678"),
    ("Data di nascita", "01/01/1980"),
]

TABLE_HEADERS = ["Codice", "Descrizione", "Quantita'", "Prezzo", "Totale"]
TABLE_ROWS = [
    ["A001", "Servizio consulenza", "10", "150.00", "1500.00"],
    ["A002", "Licenza software annuale", "1", "2400.00", "2400.00"],
    ["A003", "Manutenzione hardware", "12", "80.00", "960.00"],
    ["B101", "Formazione personale", "3", "500.00", "1500.00"],
    ["B102", "Audit sicurezza", "1", "1800.00", "1800.00"],
]


def normalize_gt(text: str) -> str:
    """Normalize ground truth: collapse whitespace."""
    return " ".join(text.split()).strip()


# ---------- PDF generators (return: pdf_bytes, ground_truth_text) ----------

def make_native_text(idx: int) -> tuple[bytes, str]:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 16)
    title = f"Documento {idx+1} — Relazione operativa"
    c.drawString(20*mm, 270*mm, title)
    c.setFont("Helvetica", 11)
    y = 255*mm
    gt_parts = [title]
    for p in ITALIAN_PARAGRAPHS:
        # word-wrap manuale a ~85 char
        line = ""
        for word in p.split():
            if len(line) + len(word) + 1 > 85:
                c.drawString(20*mm, y, line)
                gt_parts.append(line)
                y -= 6*mm
                line = word
            else:
                line = (line + " " + word).strip()
        if line:
            c.drawString(20*mm, y, line)
            gt_parts.append(line)
            y -= 9*mm
    c.showPage(); c.save()
    return buf.getvalue(), normalize_gt(" ".join(gt_parts))


def make_form(idx: int) -> tuple[bytes, str]:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(20*mm, 270*mm, f"Modulo richiesta n. {idx+1}")
    gt_parts = [f"Modulo richiesta n. {idx+1}"]
    c.setFont("Helvetica", 11)
    y = 255*mm
    for label, value in FORM_FIELDS:
        c.drawString(20*mm, y, f"{label}:")
        c.drawString(80*mm, y, value)
        gt_parts.append(f"{label}: {value}")
        y -= 10*mm
    c.showPage(); c.save()
    return buf.getvalue(), normalize_gt(" ".join(gt_parts))


def make_table(idx: int) -> tuple[bytes, str]:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(20*mm, 270*mm, f"Fattura {idx+1} — Riepilogo")
    gt_parts = [f"Fattura {idx+1} — Riepilogo"]
    c.setFont("Helvetica-Bold", 10)
    cols_x = [20*mm, 45*mm, 105*mm, 130*mm, 160*mm]
    y = 250*mm
    for i, h in enumerate(TABLE_HEADERS):
        c.drawString(cols_x[i], y, h)
    gt_parts.append(" ".join(TABLE_HEADERS))
    y -= 6*mm
    c.setFont("Helvetica", 10)
    for row in TABLE_ROWS:
        for i, cell in enumerate(row):
            c.drawString(cols_x[i], y, cell)
        gt_parts.append(" ".join(row))
        y -= 6*mm
    c.showPage(); c.save()
    return buf.getvalue(), normalize_gt(" ".join(gt_parts))


# ---------- Rasterization (PDF → PIL Image) via reportlab text replay ----------
# We do not depend on poppler. Instead, for 'scan-*' categories, we render
# the SAME content directly into a PIL image with truetype-equivalent font,
# then wrap that image into a PDF. Ground truth is the same text.

def _load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def _draw_text_image(lines: list[str], bold_first: bool = True) -> Image.Image:
    img = Image.new("RGB", (PX_W, PX_H), "white")
    d = ImageDraw.Draw(img)
    font_regular = _load_font(28)
    font_bold = _load_font(38)
    y = 80
    for i, line in enumerate(lines):
        font = font_bold if (bold_first and i == 0) else font_regular
        d.text((100, y), line, fill="black", font=font)
        y += int(font.size * 1.6)
    return img


def _image_to_pdf(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    img_io = io.BytesIO()
    img.save(img_io, format="PNG")
    img_io.seek(0)
    from reportlab.lib.utils import ImageReader
    c.drawImage(ImageReader(img_io), 0, 0, width=PAGE_W, height=PAGE_H)
    c.showPage(); c.save()
    return buf.getvalue()


def _content_lines_for_scan(idx: int) -> tuple[list[str], str]:
    title = f"Documento {idx+1} — Relazione operativa"
    lines = [title]
    gt = [title]
    for p in ITALIAN_PARAGRAPHS[: 2 + (idx % 2)]:
        # wrap a ~55 char per linea (font piu' grande)
        line = ""
        for w in p.split():
            if len(line) + len(w) + 1 > 55:
                lines.append(line); gt.append(line); line = w
            else:
                line = (line + " " + w).strip()
        if line:
            lines.append(line); gt.append(line)
        lines.append("")  # blank
    return lines, normalize_gt(" ".join(gt))


def make_scan_clean(idx: int) -> tuple[bytes, str, Image.Image]:
    lines, gt = _content_lines_for_scan(idx)
    img = _draw_text_image(lines)
    return _image_to_pdf(img), gt, img


def make_scan_noisy(idx: int) -> tuple[bytes, str, Image.Image]:
    lines, gt = _content_lines_for_scan(idx)
    img = _draw_text_image(lines)
    # degradation: JPEG compression + gaussian noise + slight rotation
    img = img.rotate(random.uniform(-1.5, 1.5), fillcolor="white", resample=Image.BICUBIC)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.8))
    # JPEG round-trip at low quality
    jpg_io = io.BytesIO()
    img.save(jpg_io, format="JPEG", quality=35)
    jpg_io.seek(0)
    img = Image.open(jpg_io).convert("RGB")
    # add salt-and-pepper noise
    px = img.load()
    for _ in range(int(PX_W * PX_H * 0.0015)):
        x = random.randint(0, PX_W-1); y = random.randint(0, PX_H-1)
        px[x, y] = (0, 0, 0) if random.random() < 0.5 else (255, 255, 255)
    return _image_to_pdf(img), gt, img


def make_mixed(idx: int) -> tuple[bytes, str]:
    """Native page 1 + scan page 2."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    # Page 1: native
    c.setFont("Helvetica-Bold", 14)
    title = f"Pratica {idx+1} — Frontespizio"
    c.drawString(20*mm, 270*mm, title)
    c.setFont("Helvetica", 11)
    gt_parts = [title]
    y = 255*mm
    for p in ITALIAN_PARAGRAPHS[:1]:
        line = ""
        for w in p.split():
            if len(line) + len(w) + 1 > 85:
                c.drawString(20*mm, y, line); gt_parts.append(line); y -= 6*mm; line = w
            else:
                line = (line + " " + w).strip()
        if line:
            c.drawString(20*mm, y, line); gt_parts.append(line)
    c.showPage()
    # Page 2: scan image
    lines, gt2 = _content_lines_for_scan(idx)
    img = _draw_text_image(lines)
    img_io = io.BytesIO(); img.save(img_io, format="PNG"); img_io.seek(0)
    from reportlab.lib.utils import ImageReader
    c.drawImage(ImageReader(img_io), 0, 0, width=PAGE_W, height=PAGE_H)
    c.showPage(); c.save()
    return buf.getvalue(), normalize_gt(" ".join(gt_parts) + " " + gt2)


# ---------- For scan-* we also need the rendered PNG used as OCR input ----------

def _render_native_to_image(make_fn, idx: int) -> tuple[bytes, str, Image.Image]:
    """For native/forms/tables we still need a PNG to send to vision models.
    We reuse the lines used to draw the PDF by rendering the same text on a PIL canvas."""
    pdf_bytes, gt = make_fn(idx)
    # Build a parallel image from the same text content
    lines = gt.split(". ")
    img = _draw_text_image([l.strip() + ("." if not l.endswith(".") else "") for l in lines if l.strip()][:30], bold_first=False)
    return pdf_bytes, gt, img


# ---------- Driver ----------
DEFINITIONS = [
    ("native-clean", 2, "native"),
    ("scan-clean", 2, "scan"),
    ("scan-noisy", 2, "noisy"),
    ("forms", 2, "form"),
    ("tables", 2, "table"),
    ("mixed", 2, "mixed"),
]


def main():
    total = 0
    for cat, count, kind in DEFINITIONS:
        outdir = ROOT / cat
        outdir.mkdir(parents=True, exist_ok=True)
        for i in range(count):
            name = f"{cat}-{i+1:02d}"
            if kind == "native":
                pdf, gt, img = _render_native_to_image(make_native_text, i)
            elif kind == "form":
                pdf, gt, img = _render_native_to_image(make_form, i)
            elif kind == "table":
                pdf, gt, img = _render_native_to_image(make_table, i)
            elif kind == "scan":
                pdf, gt, img = make_scan_clean(i)
            elif kind == "noisy":
                pdf, gt, img = make_scan_noisy(i)
            elif kind == "mixed":
                pdf, gt = make_mixed(i)
                lines, _ = _content_lines_for_scan(i)
                img = _draw_text_image(lines)
            (outdir / f"{name}.pdf").write_bytes(pdf)
            (outdir / f"{name}.txt").write_text(gt, encoding="utf-8")
            img.save(outdir / f"{name}.png", format="PNG", optimize=True)
            print(f"  {cat}/{name}: pdf={len(pdf)//1024}KB gt={len(gt)}c img={img.size}")
            total += 1
    print(f"\n[OK] Dataset built: {total} samples under {ROOT}")


if __name__ == "__main__":
    main()
