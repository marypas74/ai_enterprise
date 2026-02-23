import crypto from 'crypto';

// ENCRYPTION_KEY is validated at startup in index.ts
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const NEW_SALT = ENCRYPTION_KEY ? ENCRYPTION_KEY.slice(0, 16) : 'salt';
const OLD_SALT = 'salt';

/**
 * Encrypt a secret value using AES-256-CBC with scryptSync key derivation.
 * Always uses the new salt (ENCRYPTION_KEY.slice(0, 16)).
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, NEW_SALT, 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a secret value from the database.
 * Tries new salt first, then falls back to old salt ('salt') for backward compatibility
 * with keys encrypted before the salt migration.
 */
export function decrypt(text: string): string {
  if (!text || !text.includes(':')) return text;

  // Try new salt first
  try {
    const [ivHex, encrypted] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, NEW_SALT, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Fall through to old salt
  }

  // Fallback: try old salt for backward compatibility
  try {
    const [ivHex, encrypted] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, OLD_SALT, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return text; // Return as-is if both fail
  }
}

// Alias for backward compatibility
export const decryptSecret = decrypt;
