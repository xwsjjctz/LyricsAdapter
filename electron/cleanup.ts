import fs from 'fs';
import path from 'path';

function sanitizeTrackId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function runCleanup(userDataPath: string, activeTrackIds: string[]): void {
  const results = {
    coversRemoved: 0,
    audioDirDeleted: false,
    libraryJsonDeleted: false,
    errors: [] as string[]
  };

  if (activeTrackIds.length === 0) {
    console.log('[Cleanup] No active tracks, skipping covers cleanup to prevent accidental deletion');
  } else {
    const activeSet = new Set(activeTrackIds.map(id => sanitizeTrackId(id)));
    const coversDir = path.join(userDataPath, 'covers');

    if (fs.existsSync(coversDir)) {
      try {
        const files = fs.readdirSync(coversDir);
        for (const file of files) {
          const trackId = file.replace(/\.(jpg|jpeg|png|webp)$/i, '');
          if (!activeSet.has(trackId)) {
            try {
              fs.unlinkSync(path.join(coversDir, file));
              results.coversRemoved++;
            } catch (e) {
              results.errors.push(`Failed to delete cover ${file}: ${(e as Error).message}`);
            }
          }
        }
      } catch (e) {
        results.errors.push(`Failed to read covers directory: ${(e as Error).message}`);
      }
    }
  }

  const audioDir = path.join(userDataPath, 'audio');
  if (fs.existsSync(audioDir)) {
    try {
      fs.rmSync(audioDir, { recursive: true, force: true });
      results.audioDirDeleted = true;
      console.log('[Cleanup] Deleted audio directory');
    } catch (e) {
      results.errors.push(`Failed to delete audio directory: ${(e as Error).message}`);
    }
  }

  const libraryJsonPath = path.join(userDataPath, 'library.json');
  if (fs.existsSync(libraryJsonPath)) {
    try {
      fs.unlinkSync(libraryJsonPath);
      results.libraryJsonDeleted = true;
      console.log('[Cleanup] Deleted legacy library.json');
    } catch (e) {
      results.errors.push(`Failed to delete library.json: ${(e as Error).message}`);
    }
  }

  console.log('[Cleanup] Results:', JSON.stringify(results));
}

const userDataPath = process.argv[2];
const activeTrackIdsStr = process.argv[3] || '[]';

if (!userDataPath) {
  console.error('[Cleanup] Missing userDataPath argument');
  process.exit(1);
}

let activeTrackIds: string[] = [];
try {
  activeTrackIds = JSON.parse(activeTrackIdsStr);
} catch {
  activeTrackIds = [];
}

console.log('[Cleanup] Starting cleanup...');
runCleanup(userDataPath, activeTrackIds);
console.log('[Cleanup] Done');
process.exit(0);
