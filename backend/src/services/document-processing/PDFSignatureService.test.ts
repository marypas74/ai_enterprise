import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  generateSelfSignedCertificate,
  encryptPrivateKey,
  decryptPrivateKey,
  signPdfSimple,
  signPdfCertified,
  verifySignatures,
} from './PDFSignatureService.js';
import forge from 'node-forge';

async function createTestPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('Document to be signed', { x: 50, y: 700, size: 20 });
  return Buffer.from(await doc.save());
}

describe('PDFSignatureService', () => {
  let testPdf: Buffer;

  beforeAll(async () => {
    testPdf = await createTestPdf();
  });

  describe('generateSelfSignedCertificate', () => {
    it('generates a self-signed certificate with given CN', () => {
      const { certificate, privateKey } = generateSelfSignedCertificate('Mario Rossi');
      expect(certificate).toContain('-----BEGIN CERTIFICATE-----');
      expect(privateKey).toContain('-----BEGIN RSA PRIVATE KEY-----');

      const cert = forge.pki.certificateFromPem(certificate);
      expect(cert.subject.getField('CN').value).toBe('Mario Rossi');
    });
  });

  describe('encryptPrivateKey / decryptPrivateKey', () => {
    it('round-trips private key encryption with AES-256-GCM', () => {
      const { privateKey } = generateSelfSignedCertificate('Test');
      const passphrase = 'mySecretPass';

      const { encrypted, iv, salt } = encryptPrivateKey(privateKey, passphrase);
      expect(encrypted).toBeTruthy();
      expect(iv).toBeTruthy();
      expect(salt).toBeTruthy();

      const decrypted = decryptPrivateKey(encrypted, passphrase, iv, salt);
      expect(decrypted).toBe(privateKey);
    });

    it('throws on wrong passphrase', () => {
      const { privateKey } = generateSelfSignedCertificate('Test');
      const { encrypted, iv, salt } = encryptPrivateKey(privateKey, 'correct');
      expect(() => decryptPrivateKey(encrypted, 'wrong', iv, salt)).toThrow();
    });
  });

  describe('signPdfSimple', () => {
    it('adds a visual signature image to PDF', async () => {
      // Minimal 1x1 PNG
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64',
      );
      const result = await signPdfSimple(testPdf, 0, 100, 100, pngBuffer, 150, 50);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(testPdf.length);
    });
  });

  describe('signPdfCertified', () => {
    it('creates a certified signature with visual appearance', async () => {
      const { certificate, privateKey } = generateSelfSignedCertificate('Signer');
      const result = await signPdfCertified(testPdf, {
        certificatePem: certificate,
        privateKeyPem: privateKey,
        reason: 'Approval',
        location: 'Milan, IT',
        contactInfo: 'signer@test.com',
        page: 0,
        x: 100,
        y: 100,
        width: 200,
        height: 60,
      });
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(testPdf.length);

      // Verify it's a valid PDF
      const doc = await PDFDocument.load(result);
      expect(doc.getPageCount()).toBe(1);
    });
  });

  describe('verifySignatures', () => {
    it('detects signatures in a signed PDF', async () => {
      const { certificate, privateKey } = generateSelfSignedCertificate('Verifier');
      const signed = await signPdfCertified(testPdf, {
        certificatePem: certificate,
        privateKeyPem: privateKey,
        reason: 'Test',
        location: 'Test',
        page: 0,
        x: 100,
        y: 100,
        width: 200,
        height: 60,
      });
      const sigs = await verifySignatures(signed);
      expect(sigs.length).toBeGreaterThan(0);
      expect(sigs[0].signerName).toBe('Verifier');
    });

    it('returns empty array for unsigned PDF', async () => {
      const sigs = await verifySignatures(testPdf);
      expect(sigs).toEqual([]);
    });
  });
});
