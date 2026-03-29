#!/usr/bin/env node

/**
 * Test script to verify metadata writing functionality
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add the project root to the path for imports
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

async function testFlacMetadataWrite() {
  console.log('=== FLAC Metadata Write Test ===\n');

  // Create a temporary test FLAC file path
  const testFlacPath = path.join(projectRoot, 'test.flac');

  // Check if we have a test FLAC file
  if (!fs.existsSync(testFlacPath)) {
    console.error('❌ Test FLAC file not found:', testFlacPath);
    console.log('Please place a test FLAC file at:', testFlacPath);
    process.exit(1);
  }

  console.log('✅ Test FLAC file found:', testFlacPath);

  // Check if binaries are available
  const { spawnSync } = await import('child_process');

  console.log('\n--- Checking binary availability ---');

  // Check ffmpeg
  const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  if (ffmpegCheck.status === 0) {
    console.log('✅ ffmpeg is available');
    console.log('   Version:', ffmpegCheck.stdout.toString().split('\n')[0]);
  } else {
    console.log('❌ ffmpeg is not available');
  }

  // Check metaflac
  const metaflacCheck = spawnSync('metaflac', ['--version'], { stdio: 'pipe' });
  if (metaflacCheck.status === 0) {
    console.log('✅ metaflac is available');
    console.log('   Version:', metaflacCheck.stdout.toString().split('\n')[0]);
  } else {
    console.log('❌ metaflac is not available');
  }

  // Check file format
  console.log('\n--- File format detection ---');
  const fileBuffer = fs.readFileSync(testFlacPath);
  const header = fileBuffer.slice(0, 4).toString();
  console.log('File size:', fileBuffer.length, 'bytes');
  console.log('File header:', header, `(${fileBuffer.slice(0, 4).toString('hex')})`);

  if (fileBuffer[0] === 0x66 && fileBuffer[1] === 0x4C &&
      fileBuffer[2] === 0x61 && fileBuffer[3] === 0x43) {
    console.log('✅ Valid FLAC file detected');
  } else {
    console.log('❌ Not a valid FLAC file');
  }

  // Test current metadata
  console.log('\n--- Current metadata ---');
  const currentMeta = spawnSync('metaflac', [
    '--list',
    '--block-type=VORBIS_COMMENT',
    testFlacPath
  ], { stdio: 'pipe', encoding: 'utf-8' });

  if (currentMeta.status === 0) {
    console.log('Current VORBIS_COMMENT blocks:');
    console.log(currentMeta.stdout || '(empty)');
  } else {
    console.log('❌ Failed to read metadata:', currentMeta.stderr);
  }

  // Test metadata write with metaflac
  console.log('\n--- Testing metadata write (metaflac) ---');

  const testMetadata = {
    title: 'Test Title',
    artist: 'Test Artist',
    album: 'Test Album',
    lyrics: '[00:00.00]Test lyrics line 1\n[00:05.00]Test lyrics line 2'
  };

  console.log('Writing test metadata:', JSON.stringify(testMetadata, null, 2));

  try {
    // Create backup
    const backupPath = testFlacPath + '.backup';
    fs.copyFileSync(testFlacPath, backupPath);
    console.log('✅ Backup created:', backupPath);

    // Write metadata
    const writeResult = spawnSync('metaflac', [
      '--remove-all-tags',
      testFlacPath
    ], { stdio: 'pipe', encoding: 'utf-8' });

    if (writeResult.status !== 0) {
      throw new Error('Failed to remove tags: ' + writeResult.stderr);
    }
    console.log('✅ Old tags removed');

    // Add new tags
    const tags = [
      { field: 'TITLE', value: testMetadata.title },
      { field: 'ARTIST', value: testMetadata.artist },
      { field: 'ALBUM', value: testMetadata.album },
      { field: 'LYRICS', value: testMetadata.lyrics }
    ];

    for (const tag of tags) {
      const tagFile = testFlacPath + `.${tag.field}.txt`;
      fs.writeFileSync(tagFile, tag.value, 'utf-8');

      const tagResult = spawnSync('metaflac', [
        `--set-tag-from-file=${tag.field}=${tagFile}`,
        testFlacPath
      ], { stdio: 'pipe', encoding: 'utf-8' });

      fs.unlinkSync(tagFile);

      if (tagResult.status !== 0) {
        throw new Error(`Failed to set ${tag.field}: ${tagResult.stderr}`);
      }
      console.log(`✅ ${tag.field} tag written`);
    }

    // Verify written metadata
    console.log('\n--- Verification ---');
    const verifyMeta = spawnSync('metaflac', [
      '--list',
      '--block-type=VORBIS_COMMENT',
      testFlacPath
    ], { stdio: 'pipe', encoding: 'utf-8' });

    if (verifyMeta.status === 0) {
      console.log('✅ Metadata verification:');
      console.log(verifyMeta.stdout || '(empty)');
    } else {
      console.log('❌ Failed to verify metadata:', verifyMeta.stderr);
    }

    // Restore backup
    fs.copyFileSync(backupPath, testFlacPath);
    fs.unlinkSync(backupPath);
    console.log('\n✅ Test completed, backup restored');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testFlacMetadataWrite().catch(error => {
  console.error('❌ Test script failed:', error);
  process.exit(1);
});
