/**
 * Values the main process hands to the sandboxed preload through
 * `webPreferences.additionalArguments`, since the preload cannot load Node
 * modules such as `node:os` itself.
 */
export const OS_RELEASE_ARGUMENT = '--lyrics-adapter-os-release=';

/** Kernel release from `os.release()` (Darwin 25.x for macOS 26), or '' when absent. */
export function readOsReleaseArgument(argv: readonly string[]): string {
  const argument = argv.find(value => value.startsWith(OS_RELEASE_ARGUMENT));
  return argument ? argument.slice(OS_RELEASE_ARGUMENT.length) : '';
}
