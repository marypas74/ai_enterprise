import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addFormField, fillFormFields, extractFormData } from './PDFFormService.js';

async function createTestPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

async function createPdfWithForm(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();

  const nameField = form.createTextField('name');
  nameField.addToPage(page, { x: 50, y: 700, width: 200, height: 30 });
  nameField.setText('');

  const emailField = form.createTextField('email');
  emailField.addToPage(page, { x: 50, y: 650, width: 200, height: 30 });
  emailField.setText('');

  const agreeField = form.createCheckBox('agree');
  agreeField.addToPage(page, { x: 50, y: 600, width: 20, height: 20 });

  return Buffer.from(await doc.save());
}

describe('PDFFormService', () => {
  let blankPdf: Buffer;
  let formPdf: Buffer;

  beforeAll(async () => {
    blankPdf = await createTestPdf();
    formPdf = await createPdfWithForm();
  });

  describe('addFormField', () => {
    it('adds a text field to a blank PDF', async () => {
      const result = await addFormField(blankPdf, 0, {
        type: 'text',
        name: 'fullName',
        x: 50, y: 700, width: 200, height: 30,
      });
      const doc = await PDFDocument.load(result);
      const form = doc.getForm();
      const field = form.getTextField('fullName');
      expect(field).toBeDefined();
    });

    it('adds a checkbox field', async () => {
      const result = await addFormField(blankPdf, 0, {
        type: 'checkbox',
        name: 'terms',
        x: 50, y: 600, width: 20, height: 20,
      });
      const doc = await PDFDocument.load(result);
      const form = doc.getForm();
      const field = form.getCheckBox('terms');
      expect(field).toBeDefined();
    });
  });

  describe('fillFormFields', () => {
    it('fills text fields', async () => {
      const result = await fillFormFields(formPdf, {
        name: 'John Doe',
        email: 'john@example.com',
      });
      const doc = await PDFDocument.load(result);
      const form = doc.getForm();
      expect(form.getTextField('name').getText()).toBe('John Doe');
      expect(form.getTextField('email').getText()).toBe('john@example.com');
    });

    it('fills checkbox fields', async () => {
      const result = await fillFormFields(formPdf, { agree: 'true' });
      const doc = await PDFDocument.load(result);
      const form = doc.getForm();
      expect(form.getCheckBox('agree').isChecked()).toBe(true);
    });

    it('throws on nonexistent field', async () => {
      await expect(fillFormFields(formPdf, { nonexistent: 'value' }))
        .rejects.toThrow('not found');
    });
  });

  describe('extractFormData', () => {
    it('extracts field values from a filled form', async () => {
      const filled = await fillFormFields(formPdf, {
        name: 'Jane',
        email: 'jane@test.com',
        agree: 'true',
      });
      const data = await extractFormData(filled);
      expect(data).toEqual({
        name: 'Jane',
        email: 'jane@test.com',
        agree: 'true',
      });
    });

    it('returns empty values for unfilled form', async () => {
      const data = await extractFormData(formPdf);
      expect(data.name).toBe('');
      expect(data.email).toBe('');
      expect(data.agree).toBe('false');
    });
  });
});
