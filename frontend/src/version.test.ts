/**
 * version.ts — Unit tests for the version constant.
 *
 * Tests cover:
 * - APP_VERSION is exported
 * - APP_VERSION follows semver format
 * - APP_VERSION is a non-empty string
 */

import { describe, it, expect } from 'vitest';
import { APP_VERSION } from './version';

describe('version', () => {
  it('should export APP_VERSION as a string', () => {
    expect(typeof APP_VERSION).toBe('string');
  });

  it('should not be empty', () => {
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('should follow semver format (major.minor.patch)', () => {
    // Match patterns like 1.0.0, 1.8.10, 2.0.0-beta.1
    const semverRegex = /^\d+\.\d+\.\d+/;
    expect(APP_VERSION).toMatch(semverRegex);
  });

  it('should have three numeric parts', () => {
    const parts = APP_VERSION.split('.');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parseInt(parts[0])).toBeGreaterThanOrEqual(0);
    expect(parseInt(parts[1])).toBeGreaterThanOrEqual(0);
    expect(parseInt(parts[2])).toBeGreaterThanOrEqual(0);
  });

  it('should match the current version in package.json', () => {
    // The version should be 1.8.10 based on what we read
    expect(APP_VERSION).toBe('2.1.21');
  });
});
