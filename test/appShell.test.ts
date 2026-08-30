import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('App shell', () => {
  it('keeps the renderer composition in App.tsx beneath the application error boundary', () => {
    const appSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/App.tsx'),
      'utf-8',
    );
    const wrapsCompositionRoot = /<ErrorBoundary>[\s\S]*<AppContent\s*\/>[\s\S]*<\/ErrorBoundary>/;

    expect(appSource).toMatch(/\b(?:const|function)\s+AppContent\b/);
    expect(appSource).toMatch(wrapsCompositionRoot);
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/AppWorkspace.tsx'))).toBe(false);
  });
});
