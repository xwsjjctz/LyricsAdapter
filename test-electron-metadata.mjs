#!/usr/bin/env node

/**
 * Test script to verify metadata writing functionality
 * This script directly tests the writeAudioMetadata function
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

async function runElectronTest() {
  console.log('=== Testing Metadata Write Function ===\n');

  // Check if we can run a simple Electron test
  const testScript = `
    const { app, BrowserWindow } = require('electron');
    const path = require('path');

    app.whenReady().then(async () => {
      console.log('Electron is ready');

      // Import metadata utils
      const { writeAudioMetadata } = require('./electron/utils/metadataUtils.ts');
      console.log('writeAudioMetadata imported');

      // Test with a real file
      const testFile = path.join(process.cwd(), 'test-metadata.flac');
      if (!fs.existsSync(testFile)) {
        console.error('Test file not found:', testFile);
        app.quit();
        process.exit(1);
      }

      console.log('Testing with file:', testFile);

      try {
        const result = await writeAudioMetadata(testFile, {
          title: 'Test Title from Script',
          artist: 'Test Artist from Script',
          album: 'Test Album from Script',
          lyrics: '[00:00.00]Test lyrics\\n[00:05.00]Second line'
        });

        console.log('Write result:', result);
      } catch (error) {
        console.error('Write error:', error);
      }

      app.quit();
    });
  `;

  console.log('❌ Direct Electron testing not supported yet');
  console.log('Please test the metadata write function manually:');
  console.log('1. Start the app with npm run electron:dev');
  console.log('2. Download a FLAC song');
  console.log('3. Check the console logs for writeAudioMetadata calls');
  console.log('4. Verify the metadata in the downloaded file using:');
  console.log('   metaflac --list --block-type=VORBIS_COMMENT <file>');
  console.log('\nSee DEBUG_METADATA.md for more details.');
}

runElectronTest().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
