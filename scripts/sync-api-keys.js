#!/usr/bin/env node
/**
 * Sync API keys from database to Kubernetes secret
 * This script decrypts API keys stored in the database and outputs them
 * for use with kubectl to update the Kubernetes secret.
 */

const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production!!';

function decrypt(text) {
  try {
    const [ivHex, encrypted] = text.split(':');
    if (!ivHex || !encrypted) return text;
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Decryption error:', e.message);
    return text;
  }
}

// Get encrypted key from command line argument
const encryptedKey = process.argv[2];
if (!encryptedKey) {
  console.error('Usage: node sync-api-keys.js <encrypted_key>');
  process.exit(1);
}

const decrypted = decrypt(encryptedKey);
console.log(decrypted);
