#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';

interface LocaleData {
  [key: string]: string | LocaleData;
}

const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');
const SOURCE_LOCALE = 'en';
const TARGET_LOCALES = ['ha', 'ig', 'pcm', 'yo'];

function flattenKeys(obj: LocaleData, prefix = ''): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else if (typeof value === 'string') {
      keys.push(fullKey);
    }
  }

  return keys.sort();
}

function getNestedValue(obj: LocaleData, path: string): string | undefined {
  // First try direct key access (for flat structures like "nav.dashboard")
  if (path in obj) {
    const value = obj[path];
    return typeof value === 'string' ? value : undefined;
  }

  // Then try nested access
  const keys = path.split('.');
  let current: any = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return typeof current === 'string' ? current : undefined;
}

function setNestedValue(obj: LocaleData, path: string, value: string): void {
  const keys = path.split('.');
  let current: any = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

async function main() {
  console.log('🌍 i18n Verification Starting...\n');

  // Load source locale
  const sourcePath = path.join(LOCALES_DIR, `${SOURCE_LOCALE}.json`);
  const sourceData: LocaleData = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  const sourceKeys = flattenKeys(sourceData);

  console.log(`✓ Loaded source locale (${SOURCE_LOCALE}): ${sourceKeys.length} keys\n`);

  let hasErrors = false;
  let totalMissing = 0;
  const updatedLocales: string[] = [];

  // Check each target locale
  for (const locale of TARGET_LOCALES) {
    const localePath = path.join(LOCALES_DIR, `${locale}.json`);

    if (!fs.existsSync(localePath)) {
      console.error(`❌ Missing locale file: ${locale}.json`);
      hasErrors = true;
      continue;
    }

    const localeData: LocaleData = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
    const missingKeys: string[] = [];
    let updated = false;

    // Check for missing keys
    for (const key of sourceKeys) {
      const value = getNestedValue(localeData, key);

      if (value === undefined) {
        missingKeys.push(key);
        const sourceValue = getNestedValue(sourceData, key);

        if (sourceValue) {
          // Auto-fill with English value
          setNestedValue(localeData, key, `[${SOURCE_LOCALE.toUpperCase()}] ${sourceValue}`);
          updated = true;
        }
      }
    }

    if (missingKeys.length > 0) {
      console.log(`⚠️  ${locale}.json: ${missingKeys.length} missing keys`);
      totalMissing += missingKeys.length;

      if (missingKeys.length <= 10) {
        missingKeys.forEach(key => console.log(`   - ${key}`));
      } else {
        missingKeys.slice(0, 10).forEach(key => console.log(`   - ${key}`));
        console.log(`   ... and ${missingKeys.length - 10} more`);
      }

      if (updated) {
        // Write updated file
        fs.writeFileSync(
          localePath,
          JSON.stringify(localeData, null, 2) + '\n',
          'utf-8'
        );
        updatedLocales.push(locale);
        console.log(`   ✓ Auto-filled with [EN] prefix\n`);
      }

      hasErrors = true;
    } else {
      console.log(`✓ ${locale}.json: All keys present (${sourceKeys.length} keys)\n`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Summary');
  console.log('='.repeat(50));
  console.log(`Source locale: ${SOURCE_LOCALE} (${sourceKeys.length} keys)`);
  console.log(`Target locales: ${TARGET_LOCALES.join(', ')}`);
  console.log(`Total missing keys: ${totalMissing}`);

  if (updatedLocales.length > 0) {
    console.log(`\nAuto-filled locales: ${updatedLocales.join(', ')}`);
    console.log('⚠️  Please review and translate the [EN] prefixed values');
  }

  if (hasErrors) {
    console.log('\n❌ i18n validation FAILED');
    console.log('Fix missing translations before committing.\n');
    process.exit(1);
  } else {
    console.log('\n✅ i18n validation PASSED\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
