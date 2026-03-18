/**
 * PDFFormService — PDF form operations using pdf-lib
 * Provides: addFormField, fillFormFields, extractFormData
 */
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown } from 'pdf-lib';

interface FormFieldDef {
  type: 'text' | 'checkbox' | 'dropdown';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  options?: string[];
}

/**
 * Add a form field to a PDF page.
 * @param pageIndex - 0-based page index
 */
export async function addFormField(
  buffer: Buffer,
  pageIndex: number,
  field: FormFieldDef,
): Promise<Buffer> {
  const doc = await PDFDocument.load(buffer);
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    throw new Error(`Page ${pageIndex} out of range`);
  }
  const page = doc.getPage(pageIndex);
  const form = doc.getForm();

  switch (field.type) {
    case 'text': {
      const tf = form.createTextField(field.name);
      tf.addToPage(page, { x: field.x, y: field.y, width: field.width, height: field.height });
      break;
    }
    case 'checkbox': {
      const cb = form.createCheckBox(field.name);
      cb.addToPage(page, { x: field.x, y: field.y, width: field.width, height: field.height });
      break;
    }
    case 'dropdown': {
      const dd = form.createDropdown(field.name);
      if (field.options) dd.setOptions(field.options);
      dd.addToPage(page, { x: field.x, y: field.y, width: field.width, height: field.height });
      break;
    }
    default:
      throw new Error(`Unsupported field type: ${field.type}`);
  }

  return Buffer.from(await doc.save());
}

/**
 * Fill form fields in a PDF.
 * @param values - Map of field name to value string
 */
export async function fillFormFields(
  buffer: Buffer,
  values: Record<string, string>,
): Promise<Buffer> {
  const doc = await PDFDocument.load(buffer);
  const form = doc.getForm();
  const fieldNames = form.getFields().map(f => f.getName());

  for (const [name, value] of Object.entries(values)) {
    if (!fieldNames.includes(name)) {
      throw new Error(`Form field "${name}" not found. Available: ${fieldNames.join(', ')}`);
    }

    const field = form.getField(name);
    if (field instanceof PDFTextField) {
      field.setText(value);
    } else if (field instanceof PDFCheckBox) {
      value === 'true' ? field.check() : field.uncheck();
    } else if (field instanceof PDFDropdown) {
      field.select(value);
    } else {
      throw new Error(`Unsupported field type for "${name}"`);
    }
  }

  return Buffer.from(await doc.save());
}

/**
 * Detect potential form fields from a PDF page image using Ollama Vision.
 * Returns suggestions for where to place form fields.
 * Falls back gracefully if Ollama is not available.
 */
export async function detectFormFields(
  buffer: Buffer,
  pageIndex: number = 0,
): Promise<{ fields: FormFieldDef[]; visionUsed: boolean }> {
  try {
    const { analyzeImageWithVision } = await import('./OllamaVisionHelper.js');
    const { renderPageToImage } = await import('./PDFConversionService.js');

    const pageImage = await renderPageToImage(buffer, pageIndex, 'png', 200);
    const visionResult = await analyzeImageWithVision(
      pageImage,
      `Analyze this document page image and identify areas where form fields should be placed.
For each field found, provide a JSON array entry with these properties:
- type: "text", "checkbox", or "dropdown"
- name: a descriptive field name (e.g., "full_name", "email", "agree_terms")
- x: approximate x position in points from left edge (page is ~595pt wide)
- y: approximate y position in points from bottom edge (page is ~842pt tall)
- width: suggested field width in points
- height: suggested field height in points

Look for: blank lines next to labels, underscored areas, checkbox squares, signature lines, date fields.
Respond ONLY with a valid JSON array. If no fields are found, respond with [].`,
    );

    if (!visionResult.available) {
      console.warn('[detectFormFields] Ollama Vision not available');
      return { fields: [], visionUsed: false };
    }

    // Parse the JSON response
    try {
      const jsonMatch = visionResult.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return { fields: [], visionUsed: true };

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        type?: string;
        name?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }>;

      const fields: FormFieldDef[] = parsed
        .filter(f => f.name && f.type && f.x != null && f.y != null)
        .map(f => ({
          type: (['text', 'checkbox', 'dropdown'].includes(f.type!) ? f.type! : 'text') as 'text' | 'checkbox' | 'dropdown',
          name: f.name!,
          x: f.x!,
          y: f.y!,
          width: f.width ?? 150,
          height: f.height ?? 24,
        }));

      return { fields, visionUsed: true };
    } catch {
      console.warn('[detectFormFields] Failed to parse Vision response as JSON');
      return { fields: [], visionUsed: true };
    }
  } catch (err) {
    console.warn('[detectFormFields] Vision detection failed:', err);
    return { fields: [], visionUsed: false };
  }
}

/**
 * Extract all form field values from a PDF.
 */
export async function extractFormData(buffer: Buffer): Promise<Record<string, string>> {
  const doc = await PDFDocument.load(buffer);
  const form = doc.getForm();
  const result: Record<string, string> = {};

  for (const field of form.getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      result[name] = field.getText() ?? '';
    } else if (field instanceof PDFCheckBox) {
      result[name] = field.isChecked() ? 'true' : 'false';
    } else if (field instanceof PDFDropdown) {
      const selected = field.getSelected();
      result[name] = selected.length > 0 ? selected[0] : '';
    }
  }

  return result;
}
