"""
OCR benchmark over dataset ocr-pdf-it-v1.

For each image in the dataset, invoke each model via the Ollama proxy and
compute CER, WER, latency. Writes a CSV summary and a markdown report.

Models tested (must already be present in Ollama):
  - glm-ocr:latest         (CANDIDATE)
  - qwen2.5vl:7b           (BASELINE for vision-ocr)
  - deepseek-ocr:latest    (alternative OCR-specialized)

Output:
  scripts/ocr-bench/results/results.csv
  scripts/ocr-bench/results/report.md
"""
from __future__ import annotations
import base64, csv, json, os, statistics, sys, time
from pathlib import Path
import requests
import Levenshtein
from jiwer import wer as jiwer_wer

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "test-data" / "ocr-pdf-it-v1"
OUTDIR = Path(__file__).resolve().parent / "results"
OUTDIR.mkdir(parents=True, exist_ok=True)

OLLAMA_URL = os.environ.get("OLLAMA_PROXY_URL", "http://10.0.1.1:8086/ollama")
OLLAMA_KEY = os.environ.get("OLLAMA_AUTH_KEY", "mTLS-k8s-backend-2026")
TIMEOUT_S = 240

MODELS = [
    "glm-ocr:latest",
    "qwen2.5vl:7b",
    "deepseek-ocr:latest",
]

PROMPT = (
    "Trascrivi fedelmente tutto il testo visibile in questa immagine. "
    "Non aggiungere commenti, riassunti o spiegazioni. Restituisci SOLO il testo letterale, "
    "preservando l'ordine di lettura."
)


def normalize(s: str) -> str:
    return " ".join(s.split()).strip().lower()


def cer(ref: str, hyp: str) -> float:
    ref_n = normalize(ref); hyp_n = normalize(hyp)
    if not ref_n: return 0.0 if not hyp_n else 1.0
    return Levenshtein.distance(ref_n, hyp_n) / max(1, len(ref_n))


def wer(ref: str, hyp: str) -> float:
    ref_n = normalize(ref); hyp_n = normalize(hyp)
    if not ref_n.split(): return 0.0 if not hyp_n.split() else 1.0
    try:
        return float(jiwer_wer(ref_n, hyp_n))
    except Exception:
        return 1.0


def call_ollama(model: str, image_b64: str) -> tuple[str, float, str | None]:
    """Returns (text, elapsed_s, error_or_None)."""
    payload = {
        "model": model,
        "prompt": PROMPT,
        "images": [image_b64],
        "stream": False,
        "options": {"temperature": 0.0, "num_predict": 2048},
    }
    headers = {"X-Ollama-Key": OLLAMA_KEY, "Content-Type": "application/json"}
    t0 = time.time()
    try:
        r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload,
                          headers=headers, timeout=TIMEOUT_S)
        elapsed = time.time() - t0
        if r.status_code != 200:
            return "", elapsed, f"HTTP {r.status_code}: {r.text[:200]}"
        data = r.json()
        return data.get("response", ""), elapsed, None
    except Exception as e:
        return "", time.time() - t0, str(e)


def iter_samples():
    for cat_dir in sorted(DATASET.iterdir()):
        if not cat_dir.is_dir(): continue
        for png in sorted(cat_dir.glob("*.png")):
            txt = png.with_suffix(".txt")
            if not txt.exists(): continue
            yield cat_dir.name, png.stem, png, txt.read_text(encoding="utf-8")


def main():
    rows = []
    samples = list(iter_samples())
    print(f"[bench] {len(samples)} samples × {len(MODELS)} models = {len(samples)*len(MODELS)} calls")
    for i, (cat, name, png, gt) in enumerate(samples, 1):
        img_b64 = base64.b64encode(png.read_bytes()).decode("ascii")
        for model in MODELS:
            print(f"  [{i}/{len(samples)}] {cat}/{name} -> {model} ...", end=" ", flush=True)
            text, elapsed, err = call_ollama(model, img_b64)
            if err:
                print(f"ERR {err[:80]}")
                rows.append({
                    "category": cat, "sample": name, "model": model,
                    "cer": "", "wer": "", "latency_s": round(elapsed, 2),
                    "gt_len": len(gt), "hyp_len": 0, "error": err[:200],
                })
                continue
            c = cer(gt, text); w = wer(gt, text)
            print(f"cer={c:.3f} wer={w:.3f} t={elapsed:.1f}s len={len(text)}")
            rows.append({
                "category": cat, "sample": name, "model": model,
                "cer": round(c, 4), "wer": round(w, 4),
                "latency_s": round(elapsed, 2),
                "gt_len": len(gt), "hyp_len": len(text), "error": "",
            })

    # Write CSV
    csv_path = OUTDIR / "results.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    print(f"\n[OK] CSV: {csv_path}")

    # Aggregate per model
    by_model: dict[str, list[dict]] = {}
    for r in rows:
        by_model.setdefault(r["model"], []).append(r)

    md = ["# OCR benchmark report — ocr-pdf-it-v1", ""]
    md.append(f"Samples: {len(samples)} · Models: {len(MODELS)} · "
              f"Total calls: {len(rows)}")
    md.append("")
    md.append("## Aggregated per-model metrics")
    md.append("")
    md.append("| Model | n_ok | CER mean | CER p95 | WER mean | Latency p50 | Latency p95 |")
    md.append("|-------|------|----------|---------|----------|-------------|-------------|")
    for m in MODELS:
        rs = [r for r in by_model.get(m, []) if r["cer"] != ""]
        if not rs:
            md.append(f"| {m} | 0 | — | — | — | — | — |")
            continue
        cers = [float(r["cer"]) for r in rs]
        wers = [float(r["wer"]) for r in rs]
        lats = [float(r["latency_s"]) for r in rs]
        def p(arr, q):
            arr = sorted(arr); k = max(0, min(len(arr)-1, int(round((len(arr)-1)*q))))
            return arr[k]
        md.append(f"| {m} | {len(rs)} | {statistics.mean(cers):.3f} | {p(cers,0.95):.3f} | "
                  f"{statistics.mean(wers):.3f} | {p(lats,0.5):.1f}s | {p(lats,0.95):.1f}s |")
    md.append("")
    md.append("## Per-category breakdown (CER mean)")
    md.append("")
    cats = sorted({r["category"] for r in rows})
    md.append("| Category | " + " | ".join(MODELS) + " |")
    md.append("|----------|" + "|".join(["------"] * len(MODELS)) + "|")
    for cat in cats:
        cells = []
        for m in MODELS:
            rs = [r for r in rows if r["category"] == cat and r["model"] == m and r["cer"] != ""]
            if rs:
                cells.append(f"{statistics.mean([float(r['cer']) for r in rs]):.3f}")
            else:
                cells.append("—")
        md.append(f"| {cat} | " + " | ".join(cells) + " |")
    md.append("")
    errs = [r for r in rows if r["error"]]
    if errs:
        md.append("## Errors")
        for e in errs:
            md.append(f"- `{e['model']}` on `{e['category']}/{e['sample']}`: {e['error']}")

    rpt = OUTDIR / "report.md"
    rpt.write_text("\n".join(md), encoding="utf-8")
    print(f"[OK] Report: {rpt}")


if __name__ == "__main__":
    main()
