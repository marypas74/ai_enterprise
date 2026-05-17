import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { detectLayout } from './LayoutDetector.js';

async function makeBlankPage(width = 800, height = 1000): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

async function makeTextPage(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="800" height="1000">' +
            Array.from({ length: 20 })
              .map(
                (_, i) =>
                  `<text x="40" y="${40 + i * 40}" font-size="24" fill="black">Riga di testo numero ${i + 1} con qualche parola</text>`,
              )
              .join('') +
            '</svg>',
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

async function makeTablePage(): Promise<Buffer> {
  // Heavy grid: 6 horizontal + 5 vertical lines (>= MIN_LINES default 4)
  const lines = [
    ...Array.from({ length: 6 }, (_, i) => `<line x1="40" y1="${100 + i * 120}" x2="760" y2="${100 + i * 120}" stroke="black" stroke-width="3"/>`),
    ...Array.from({ length: 5 }, (_, i) => `<line x1="${100 + i * 140}" y1="40" x2="${100 + i * 140}" y2="960" stroke="black" stroke-width="3"/>`),
  ].join('');
  return sharp({
    create: { width: 800, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: Buffer.from(`<svg width="800" height="1000">${lines}</svg>`), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

describe('LayoutDetector', () => {
  it('classifies a blank page as text (no lines)', async () => {
    const img = await makeBlankPage();
    const r = await detectLayout(img);
    expect(r.classification).toBe('text');
    expect(r.horizontalLines).toBe(0);
    expect(r.verticalLines).toBe(0);
  });

  it('classifies a plain text page as text', async () => {
    const img = await makeTextPage();
    const r = await detectLayout(img);
    expect(r.classification).toBe('text');
  });

  it('classifies a table page as layout', async () => {
    const img = await makeTablePage();
    const r = await detectLayout(img);
    expect(r.classification).toBe('layout');
    expect(r.horizontalLines + r.verticalLines).toBeGreaterThanOrEqual(4);
  });

  it('returns text classification on invalid input (safe fallback)', async () => {
    const r = await detectLayout(Buffer.from('not-an-image'));
    expect(r.classification).toBe('text');
  });
});
