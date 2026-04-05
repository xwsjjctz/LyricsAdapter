#!/usr/bin/env node

/**
 * Simple test to verify FFmpeg metadata write functionality
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

async function testFFmpegMetadataWrite() {
  console.log('=== FFmpeg Metadata Write Test ===\n');

  // Create test files
  const testDir = path.join(projectRoot, 'test-metadata');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const metadataFile = path.join(testDir, 'metadata.txt');
  const outputFile = path.join(testDir, 'output.txt');

  // Create metadata file
  const metadataContent = `;FFMETADATA1
TITLE=Test Title
ARTIST=Test Artist
ALBUM=Test Album
LYRICS=Test lyrics
`;

  fs.writeFileSync(metadataFile, metadataContent);
  console.log('✅ Created metadata file:', metadataFile);

  // Test FFmpeg command
  console.log('\n--- Testing FFmpeg metadata parsing ---');

  try {
    const result = execSync(`ffmpeg -f ffmetadata -i "${metadataFile}" - 2>&1`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    console.log('FFmpeg output:', result);
  } catch (error) {
    console.error('FFmpeg error:', error.message);
    console.error('FFmpeg stderr:', error.stderr);
  }

  // Cleanup
  fs.unlinkSync(metadataFile);
  console.log('\n✅ Test completed');
}

testFFmpegMetadataWrite().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
