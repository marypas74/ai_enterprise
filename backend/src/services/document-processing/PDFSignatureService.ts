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

/**
 * Reserved size for the CMS signature hex in /Contents.
 * 16384 bytes of DER -> 32768 hex chars. Sufficient for RSA-2048 + cert chain.
 */
const SIGNATURE_MAX_LENGTH = 16384;

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

  // Step 2: PAdES-B-B ByteRange-based signature
  // Insert a /Sig dictionary with a placeholder /Contents and /ByteRange,
  // then compute the hash of everything outside /Contents and sign it.
  const pdfWithPlaceholder = insertSignaturePlaceholder(
    Buffer.from(pdfBytes),
    signerName,
    options.reason ?? 'Approval',
    options.location ?? '',
    options.contactInfo ?? '',
  );

  // Step 3: Find the /Contents hex placeholder in the PDF and compute ByteRange hash
  const contentsTag = Buffer.from('/Contents <');
  const contentsStart = pdfWithPlaceholder.indexOf(contentsTag);
  if (contentsStart === -1) {
    throw new Error('Failed to find /Contents placeholder in prepared PDF');
  }
  // Offset of the '<' that starts the hex string
  const hexStart = contentsStart + contentsTag.length - 1;
  // The hex string is SIGNATURE_MAX_LENGTH * 2 hex chars + '<' + '>'
  const hexEnd = hexStart + 1 + SIGNATURE_MAX_LENGTH * 2; // position of closing '>'

  // ByteRange: [0, hexStart, hexEnd+1, totalLength - (hexEnd+1)]
  const byteRange = [0, hexStart, hexEnd + 1, pdfWithPlaceholder.length - (hexEnd + 1)];

  // Update the /ByteRange value in the PDF
  const updatedPdf = updateByteRange(pdfWithPlaceholder, byteRange);

  // Step 4: Hash the two segments (everything outside /Contents hex value)
  const hash = crypto.createHash('sha256');
  hash.update(updatedPdf.subarray(byteRange[0], byteRange[0] + byteRange[1]));
  hash.update(updatedPdf.subarray(byteRange[2], byteRange[2] + byteRange[3]));
  const digest = hash.digest();

  // Step 5: Create CMS detached signature (PKCS#7 SignedData)
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer('');
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      {
        type: forge.pki.oids.messageDigest,
        value: forge.util.createBuffer(digest.toString('binary')),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      { type: forge.pki.oids.signingTime, value: new Date() as any },
    ],
  });
  p7.sign({ detached: true });

  const signedDer = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const signatureHex = Buffer.from(signedDer, 'binary').toString('hex');

  if (signatureHex.length > SIGNATURE_MAX_LENGTH * 2) {
    throw new Error(
      `CMS signature too large (${signatureHex.length / 2} bytes). Max: ${SIGNATURE_MAX_LENGTH} bytes.`,
    );
  }

  // Step 6: Write the CMS hex into the reserved /Contents placeholder
  const paddedHex = signatureHex.padEnd(SIGNATURE_MAX_LENGTH * 2, '0');
  const result = Buffer.from(updatedPdf);
  result.write(paddedHex, hexStart + 1, paddedHex.length, 'ascii');

  return result;
}

/**
 * Insert a signature placeholder dictionary at the end of the PDF.
 * Creates a proper /Sig dictionary with /ByteRange and /Contents placeholders
 * using an incremental save approach.
 */
function insertSignaturePlaceholder(
  pdfBuffer: Buffer,
  signerName: string,
  reason: string,
  location: string,
  contactInfo: string,
): Buffer {
  const pdfStr = pdfBuffer.toString('binary');
  const eofIdx = pdfStr.lastIndexOf('%%EOF');
  if (eofIdx === -1) throw new Error('Invalid PDF: no %%EOF marker found');

  const startxrefIdx = pdfStr.lastIndexOf('startxref', eofIdx);
  if (startxrefIdx === -1) throw new Error('Invalid PDF: no startxref found');

  const afterStartxref = pdfStr.substring(startxrefIdx + 'startxref'.length, eofIdx).trim();
  const oldXrefOffset = parseInt(afterStartxref, 10);

  // Find the next available object number
  let maxObj = 0;
  const objPattern = /(\d+)\s+0\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = objPattern.exec(pdfStr)) !== null) {
    const num = parseInt(match[1], 10);
    if (num > maxObj) maxObj = num;
  }
  const sigObjNum = maxObj + 1;

  // Build the signature object
  const byteRangePlaceholder = '/ByteRange [0 0000000000 0000000000 0000000000]';
  const contentPlaceholder = '0'.repeat(SIGNATURE_MAX_LENGTH * 2);

  const sigObjLines = [
    `${sigObjNum} 0 obj`,
    '<<',
    '/Type /Sig',
    '/Filter /Adobe.PPKLite',
    '/SubFilter /adbe.pkcs7.detached',
    byteRangePlaceholder,
    `/Contents <${contentPlaceholder}>`,
    `/Name (${escapePdfString(signerName)})`,
    `/M (D:${formatPdfDate(new Date())})`,
  ];
  if (reason) sigObjLines.push(`/Reason (${escapePdfString(reason)})`);
  if (location) sigObjLines.push(`/Location (${escapePdfString(location)})`);
  if (contactInfo) sigObjLines.push(`/ContactInfo (${escapePdfString(contactInfo)})`);
  sigObjLines.push('>>', 'endobj', '');

  const sigObj = sigObjLines.join('\n');

  const newObjOffset = eofIdx;
  const xrefStart = newObjOffset + sigObj.length;

  const xref = [
    'xref',
    `${sigObjNum} 1`,
    `${String(newObjOffset).padStart(10, '0')} 00000 n `,
    '',
    'trailer',
    `<< /Size ${sigObjNum + 1} /Prev ${oldXrefOffset} >>`,
    'startxref',
    `${xrefStart}`,
    '%%EOF',
    '',
  ].join('\n');

  const beforeEof = pdfBuffer.subarray(0, eofIdx);
  const appendix = Buffer.from(sigObj + xref, 'binary');
  return Buffer.concat([beforeEof, appendix]);
}

function updateByteRange(pdfBuffer: Buffer, byteRange: number[]): Buffer {
  const placeholder = '/ByteRange [0 0000000000 0000000000 0000000000]';
  const actual = `/ByteRange [${byteRange[0]} ${String(byteRange[1]).padStart(10, ' ')} ${String(byteRange[2]).padStart(10, ' ')} ${String(byteRange[3]).padStart(10, ' ')}]`;
  const padded = actual.padEnd(placeholder.length, ' ');

  const idx = pdfBuffer.indexOf(Buffer.from(placeholder, 'ascii'));
  if (idx === -1) throw new Error('ByteRange placeholder not found');

  const result = Buffer.from(pdfBuffer);
  result.write(padded, idx, padded.length, 'ascii');
  return result;
}

function escapePdfString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function formatPdfDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}Z`;
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

  // Method 1: Scan for ByteRange-based /Sig dictionaries in raw PDF
  try {
    extractByteRangeSignatures(buffer, signatures);
  } catch {
    // ByteRange scan failed — continue to embedded files method
  }

  // Method 2: Use mupdf to extract embedded signature.p7s files from the PDF Names tree
  // (for backward compatibility with older attachment-based signatures)
  if (signatures.length === 0) {
    try {
      const mupdf = await import('mupdf');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as any;

      const trailer = doc.getTrailer();
      const root = trailer?.get('Root');
      const names = root?.get('Names');
      const embeddedFiles = names?.get('EmbeddedFiles');

      if (embeddedFiles) {
        const namesArray = embeddedFiles.get('Names');
        if (namesArray) {
          const len = namesArray.length;
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
      // mupdf not available or failed
    }
  }

  return signatures;
}

/**
 * Extract ByteRange-based signatures from the raw PDF binary.
 * Scans for /Type /Sig dictionaries, extracts /Contents hex data, and parses the CMS.
 */
function extractByteRangeSignatures(buffer: Buffer, signatures: SignatureInfo[]): void {
  const pdfStr = buffer.toString('binary');

  // Find all /Type /Sig ... /Contents <hex> patterns
  const sigPattern = /\/Type\s*\/Sig\b/g;
  let sigMatch: RegExpExecArray | null;

  while ((sigMatch = sigPattern.exec(pdfStr)) !== null) {
    try {
      // Find the enclosing dictionary boundaries
      const searchStart = Math.max(0, sigMatch.index - 200);
      const searchEnd = Math.min(pdfStr.length, sigMatch.index + 100000);
      const region = pdfStr.substring(searchStart, searchEnd);

      // Extract /Contents <hex>
      const contentsMatch = region.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
      if (!contentsMatch) continue;

      const hexData = contentsMatch[1].replace(/0+$/, ''); // strip trailing zero padding
      if (hexData.length < 10) continue;

      const derBytes = Buffer.from(hexData, 'hex').toString('binary');
      const asn1 = forge.asn1.fromDer(derBytes);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const p7 = forge.pkcs7.messageFromAsn1(asn1) as any;
      extractSignaturesFromP7(p7, signatures);

      // Extract /Name if present
      const nameMatch = region.match(/\/Name\s*\(([^)]*)\)/);
      if (nameMatch && signatures.length > 0) {
        const lastSig = signatures[signatures.length - 1];
        if (lastSig.signerName === 'Unknown') {
          lastSig.signerName = nameMatch[1];
        }
      }

      // Extract /Reason if present
      const reasonMatch = region.match(/\/Reason\s*\(([^)]*)\)/);
      if (reasonMatch && signatures.length > 0) {
        signatures[signatures.length - 1].reason = reasonMatch[1];
      }
    } catch {
      // Could not parse this signature — skip
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
function extractSignaturesFromP7(p7: any, signatures: SignatureInfo[]): void {
  // forge.pkcs7.messageFromAsn1 doesn't populate signers array —
  // signer info is in rawCapture instead
  const rc = p7.rawCapture;
  const certs = p7.certificates ?? [];

  if (!rc?.signerInfos || rc.signerInfos.length === 0) {
    // Fall back to checking signers array (in case future forge versions fix this)
    if (p7.signers && p7.signers.length > 0) {
      for (const signer of p7.signers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  let signerCert: any = null;
  if (serialHex && certs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
function verifyCert(cert: any): boolean {
  if (!cert) return false;
  try {
    const caStore = forge.pki.createCaStore([cert]);
    return forge.pki.verifyCertificateChain(caStore, [cert]);
  } catch {
    return false;
  }
}
