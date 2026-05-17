/**
 * LayoutDetector — Fast heuristic to classify a page image as text-only or layout-heavy.
 *
 * Used by VisionService to choose between:
 *   - "text"   → small OCR-specialized model (e.g. glm-ocr) — fast, low VRAM
 *   - "layout" → general multimodal model (e.g. qwen2.5vl, vLLM 32B) — preserves
 *                tables, columns, form layouts
 *
 * Heuristic: detect axis-aligned straight lines (table borders, column separators,
 * form field underscores). Implemented via sharp:
 *   1. Convert to greyscale + threshold
 *   2. Count rows / columns that contain a high ratio of dark pixels
 *   3. If many rows or columns are "fully dark", we have a layout structure
 *
 * Tunable thresholds via env:
 *   LAYOUT_DARK_RATIO=0.6   (px ratio per row/col to count as "line")
 *   LAYOUT_MIN_LINES=4      (min lines to flag layout)
 */

import sharp from 'sharp';

export type LayoutClass = 'text' | 'layout';

export interface LayoutDetectionResult {
  readonly classification: LayoutClass;
  readonly horizontalLines: number;
  readonly verticalLines: number;
  readonly width: number;
  readonly height: number;
}

const DARK_RATIO = Number(process.env.LAYOUT_DARK_RATIO ?? 0.6);
const MIN_LINES = Number(process.env.LAYOUT_MIN_LINES ?? 4);
const THUMB_WIDTH = 800; // downscale for speed; preserves line structure
const DARK_THRESHOLD = 96; // 0..255, pixel below this counts as "ink"

/**
 * Classify a page image as 'text' or 'layout'.
 * Returns 'text' by default on errors (safe fallback — uses faster OCR model).
 */
export async function detectLayout(image: Buffer): Promise<LayoutDetectionResult> {
  try {
    const img = sharp(image).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).greyscale();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    let horizontalLines = 0;
    let verticalLines = 0;

    // Count horizontal "ink lines" — rows where dark pixel ratio exceeds DARK_RATIO
    for (let y = 0; y < height; y++) {
      let dark = 0;
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        if (data[rowStart + x] < DARK_THRESHOLD) dark++;
      }
      if (dark / width >= DARK_RATIO) horizontalLines++;
    }

    // Count vertical "ink lines" — columns where dark pixel ratio exceeds DARK_RATIO
    for (let x = 0; x < width; x++) {
      let dark = 0;
      for (let y = 0; y < height; y++) {
        if (data[y * width + x] < DARK_THRESHOLD) dark++;
      }
      if (dark / height >= DARK_RATIO) verticalLines++;
    }

    const classification: LayoutClass =
      horizontalLines + verticalLines >= MIN_LINES ? 'layout' : 'text';

    return { classification, horizontalLines, verticalLines, width, height };
  } catch {
    return {
      classification: 'text',
      horizontalLines: 0,
      verticalLines: 0,
      width: 0,
      height: 0,
    };
  }
}
