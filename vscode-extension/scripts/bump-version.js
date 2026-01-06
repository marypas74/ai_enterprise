#!/usr/bin/env node
/**
 * Bump Version Script
 * Automatically increments the patch version and updates all version references
 *
 * Usage: npm run bump
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const WEBVIEW_DIR = path.join(ROOT_DIR, 'webview-ui');

// Files to update
const FILES = {
  packageJson: path.join(ROOT_DIR, 'package.json'),
  extensionTs: path.join(ROOT_DIR, 'src', 'extension.ts'),
  mainLayoutTsx: path.join(WEBVIEW_DIR, 'src', 'claude-code', 'MainLayout.tsx'),
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function bumpVersion(version) {
  const parts = version.split('.');
  parts[2] = String(parseInt(parts[2], 10) + 1);
  return parts.join('.');
}

function updateFileVersion(filePath, oldVersion, newVersion) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  [SKIP] File not found: ${filePath}`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;

  // Replace version patterns
  const patterns = [
    // extension.ts: const extensionVersion = '2.9.9';
    new RegExp(`extensionVersion\\s*=\\s*['"]${oldVersion.replace(/\./g, '\\.')}['"]`, 'g'),
    // MainLayout.tsx: extension: '2.9.9' or || '2.9.9'
    new RegExp(`extension:\\s*['"]${oldVersion.replace(/\./g, '\\.')}['"]`, 'g'),
    new RegExp(`\\|\\|\\s*['"]${oldVersion.replace(/\./g, '\\.')}['"]`, 'g'),
  ];

  patterns.forEach(pattern => {
    content = content.replace(pattern, (match) => {
      return match.replace(oldVersion, newVersion);
    });
  });

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function main() {
  console.log('\n========================================');
  console.log('   Enterprise AI Chat - Version Bump');
  console.log('========================================\n');

  // Read current version
  const pkg = readJson(FILES.packageJson);
  const oldVersion = pkg.version;
  const newVersion = bumpVersion(oldVersion);

  console.log(`Current version: ${oldVersion}`);
  console.log(`New version:     ${newVersion}\n`);

  // Update package.json
  console.log('Updating files:');
  pkg.version = newVersion;
  writeJson(FILES.packageJson, pkg);
  console.log(`  [OK] package.json`);

  // Update extension.ts
  if (updateFileVersion(FILES.extensionTs, oldVersion, newVersion)) {
    console.log(`  [OK] src/extension.ts`);
  } else {
    // Try to find and update any version string
    let content = fs.readFileSync(FILES.extensionTs, 'utf8');
    content = content.replace(
      /const extensionVersion\s*=\s*['"][^'"]+['"]/,
      `const extensionVersion = '${newVersion}'`
    );
    fs.writeFileSync(FILES.extensionTs, content);
    console.log(`  [OK] src/extension.ts (forced)`);
  }

  // Update MainLayout.tsx
  if (updateFileVersion(FILES.mainLayoutTsx, oldVersion, newVersion)) {
    console.log(`  [OK] webview-ui/src/claude-code/MainLayout.tsx`);
  } else {
    // Force update the version strings
    let content = fs.readFileSync(FILES.mainLayoutTsx, 'utf8');
    // Update the default state
    content = content.replace(
      /extension:\s*['"][^'"]*['"]\s*\}/,
      `extension: '${newVersion}' }`
    );
    // Update the fallback
    content = content.replace(
      /\|\|\s*['"][0-9]+\.[0-9]+\.[0-9]+['"]/g,
      `|| '${newVersion}'`
    );
    fs.writeFileSync(FILES.mainLayoutTsx, content);
    console.log(`  [OK] webview-ui/src/claude-code/MainLayout.tsx (forced)`);
  }

  console.log('\n========================================');
  console.log(`   Version bumped to ${newVersion}`);
  console.log('========================================');
  console.log('\nNext steps:');
  console.log('  1. Run: npm run build:all');
  console.log('  2. Run: npm run package');
  console.log('  3. Install: install_update.bat (Windows)');
  console.log('');

  return newVersion;
}

// Export for use as module
module.exports = { bumpVersion, main };

// Run if called directly
if (require.main === module) {
  main();
}
