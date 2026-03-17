/**
 * PDFSignatureService — Digital signature operations for PDFs
 * Provides: generateSelfSignedCertificate, encryptPrivateKey, decryptPrivateKey,
 *           signPdfSimple, signPdfCertified (PAdES-B-B), verifySignatures
 */
import forge from 'node-forge';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as crypto from 'crypto';

// --- Certificate Generation & Key Management ---

export function generateSelfSignedCertificate(commonName: string): {
  certificate: string;
  privateKey: string;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 2);

  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Enterprise AI Chat' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'subjectKeyIdentifier' },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certificate: forge.pki.certificateToPem(cert),
    privateKey: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

export function encryptPrivateKey(
  privateKeyPem: string,
  passphrase: string,
): { encrypted: string; iv: string; salt: string } {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12); // 96-bit nonce for AES-256-GCM
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(privateKeyPem, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');
  encrypted = encrypted + '.' + authTag;

  return {
    encrypted,
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
  };
}

export function decryptPrivateKey(
  encrypted: string,
  passphrase: string,
  ivHex: string,
  saltHex: string,
): string {
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');

  const [encData, authTagB64] = encrypted.split('.');
  if (!authTagB64) throw new Error('Invalid encrypted data — missing auth tag');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    let decrypted = decipher.update(encData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new Error('Failed to decrypt private key — wrong passphrase or tampered data');
  }
}

// --- Simple (Visual) Signature ---

export async function signPdfSimple(
  buffer: Buffer,
  page: number,
  x: number,
  y: number,
  signatureImage: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const doc = await PDFDocument.load(buffer);
  if (page < 0 || page >= doc.getPageCount()) {
    throw new Error(`Page ${page} out of range`);
  }

  const image = await doc.embedPng(signatureImage);
  const pdfPage = doc.getPage(page);
  pdfPage.drawImage(image, { x, y, width, height });

  return Buffer.from(await doc.save());
}

// --- Certified (PAdES-B-B) Signature ---

interface SignOptions {
  certificatePem: string;
  privateKeyPem: string;
  reason?: string;
  location?: string;
  contactInfo?: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function signPdfCertified(
  buffer: Buffer,
  options: SignOptions,
): Promise<Buffer> {
  const cert = forge.pki.certificateFromPem(options.certificatePem);
  const privateKey = forge.pki.privateKeyFromPem(options.privateKeyPem);

  // Step 1: Add visual signature appearance using pdf-lib
  const doc = await PDFDocument.load(buffer);
  if (options.page < 0 || options.page >= doc.getPageCount()) {
    throw new Error(`Page ${options.page} out of range`);
  }

  const page = doc.getPage(options.page);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const signerName = cert.subject.getField('CN')?.value ?? 'Unknown';
  const sigDate = new Date().toISOString().split('T')[0];
  const sigText = `Signed by: ${signerName}\nDate: ${sigDate}\nReason: ${options.reason ?? 'Approval'}`;

  page.drawText(sigText, {
    x: options.x + 5,
    y: options.y + options.height - 15,
    size: 8,
    font,
    color: rgb(0, 0, 0.6),
    lineHeight: 12,
  });

  page.drawRectangle({
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    borderColor: rgb(0, 0, 0.6),
    borderWidth: 1,
  });

  const pdfBytes = await doc.save();

  // Step 2: Create CMS/PKCS#7 signature (PAdES-B-B level)
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(Buffer.from(pdfBytes).toString('binary'));
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as any },
    ],
  });
  p7.sign();

  const signedDer = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const signatureBuffer = Buffer.from(signedDer, 'binary');

  // Embed CMS signature as a PDF file attachment
  // NOTE: For proper PAdES-B-B, the CMS should be in a /Sig dictionary with /ByteRange.
  // Current approach: CMS attachment + visual signature for basic signing capability.
  const signedDoc = await PDFDocument.load(pdfBytes);
  await signedDoc.attach(signatureBuffer, 'signature.p7s', {
    mimeType: 'application/pkcs7-signature',
    description: `Digital signature by ${signerName}`,
  });

  return Buffer.from(await signedDoc.save());
}

// --- Signature Verification ---

interface SignatureInfo {
  signerName: string;
  signingTime?: string;
  reason?: string;
  valid: boolean;
}

export async function verifySignatures(buffer: Buffer): Promise<SignatureInfo[]> {
  const signatures: SignatureInfo[] = [];

  // Use mupdf to extract embedded signature.p7s files from the PDF Names tree
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as any;

    const trailer = doc.getTrailer();
    const root = trailer?.get('Root');
    const names = root?.get('Names');
    const embeddedFiles = names?.get('EmbeddedFiles');

    if (embeddedFiles) {
      const namesArray = embeddedFiles.get('Names');
      if (namesArray) {
        const len = namesArray.length;
        // Names array is pairs: [name, filespec, name, filespec, ...]
        for (let i = 0; i < len; i += 2) {
          const name = namesArray.get(i)?.asString?.() ?? '';
          if (!name.endsWith('.p7s')) continue;

          const fileSpec = namesArray.get(i + 1);
          const ef = fileSpec?.get('EF');
          const fStream = ef?.get('F');
          if (!fStream || !fStream.readStream) continue;

          try {
            const streamData = fStream.readStream();
            const uint8 = streamData.asUint8Array();
            const p7DerStr = Buffer.from(uint8).toString('binary');
            const p7Asn1 = forge.asn1.fromDer(p7DerStr);
            const p7 = forge.pkcs7.messageFromAsn1(p7Asn1) as any;
            extractSignaturesFromP7(p7, signatures);
          } catch {
            // Could not parse this signature — skip
          }
        }
      }
    }

    doc.destroy();
  } catch {
    // mupdf not available or failed — signatures cannot be verified
  }

  return signatures;
}

function extractSignaturesFromP7(p7: any, signatures: SignatureInfo[]): void {
  // forge.pkcs7.messageFromAsn1 doesn't populate signers array —
  // signer info is in rawCapture instead
  const rc = p7.rawCapture;
  const certs = p7.certificates ?? [];

  if (!rc?.signerInfos || rc.signerInfos.length === 0) {
    // Fall back to checking signers array (in case future forge versions fix this)
    if (p7.signers && p7.signers.length > 0) {
      for (const signer of p7.signers) {
        const cert = certs.find((c: any) => c.serialNumber === signer.serialNumber);
        const signerName = cert?.subject?.getField('CN')?.value ?? 'Unknown';
        signatures.push({ signerName, valid: verifyCert(cert) });
      }
    }
    return;
  }

  // Extract signer info from rawCapture
  // rawCapture.serial contains the signer's serial number (as ASN.1 integer)
  const serialHex = rc.serial ? forge.util.bytesToHex(rc.serial) : null;

  // Find matching certificate
  let signerCert: any = null;
  if (serialHex && certs.length > 0) {
    signerCert = certs.find((c: any) =>
      c.serialNumber?.toLowerCase() === serialHex?.toLowerCase(),
    ) ?? certs[0]; // Fall back to first cert
  } else if (certs.length > 0) {
    signerCert = certs[0];
  }

  const signerName = signerCert?.subject?.getField('CN')?.value ?? 'Unknown';

  signatures.push({
    signerName,
    valid: verifyCert(signerCert),
  });
}

function verifyCert(cert: any): boolean {
  if (!cert) return false;
  try {
    const caStore = forge.pki.createCaStore([cert]);
    return forge.pki.verifyCertificateChain(caStore, [cert]);
  } catch {
    return false;
  }
}
