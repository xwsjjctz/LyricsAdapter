// Dependency boundary rules. `npm run deps:check` runs them from the repo root
// (rule paths and tsconfig resolve against it) with
// `--ignore-known`, so existing violations recorded in
// config/dependency-cruiser-known-violations.json do not fail the check; any new one
// does. After removing a known violation, run `npm run deps:baseline` to shrink
// the baseline. Never regenerate it to admit a new violation.

// i18n/index.ts initialises i18next in the renderer; only the locale JSON is shared.
const FOUNDATION = '^src/(types/|types\\.ts$|shared/|domain/|constants/|i18n/locales/)';
const RENDERER_UI = '^src/(components|commands|App\\.tsx|index\\.tsx)';
const RENDERER_STATE = '^src/(hooks|stores|controllers|viewmodels)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Runtime import cycles make module initialisation order fragile. Type-only cycles are ignored.',
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ['type-only'] },
      },
    },
    {
      name: 'main-imports-only-shared-renderer-code',
      severity: 'error',
      comment: 'electron/ may only reuse process-neutral code from src/ (types, shared, domain, constants, locale JSON).',
      from: { path: '^electron/' },
      to: { path: '^src/', pathNot: FOUNDATION },
    },
    {
      name: 'renderer-not-to-main',
      severity: 'error',
      comment: 'Renderer code reaches the main process through the preload bridge, never by import.',
      from: { path: '^src/' },
      to: { path: '^electron/' },
    },
    {
      name: 'foundation-stays-pure',
      severity: 'error',
      comment: 'types/shared/domain/constants/locales are shared with the main process and must not depend on renderer layers.',
      from: { path: FOUNDATION },
      to: { path: '^src/', pathNot: FOUNDATION },
    },
    {
      name: 'services-not-to-ui-or-state',
      severity: 'error',
      comment: 'Services and repositories sit below hooks, stores, controllers and components.',
      from: { path: '^src/(services|repositories)/' },
      to: { path: [RENDERER_STATE, RENDERER_UI] },
    },
    {
      name: 'stores-hold-state-only',
      severity: 'error',
      comment: 'src/stores holds external state containers; composition hooks that wire hooks together live in src/hooks.',
      from: { path: '^src/stores/' },
      to: { path: ['^src/(hooks|controllers|viewmodels)/', RENDERER_UI] },
    },
    {
      name: 'state-not-to-components',
      severity: 'error',
      comment: 'Hooks, stores, controllers and view models must not depend on UI components.',
      from: { path: RENDERER_STATE },
      to: { path: RENDERER_UI },
    },
    {
      name: 'main-services-not-to-ipc',
      severity: 'error',
      comment: 'electron/services is called by IPC handlers, not the other way round.',
      from: { path: '^electron/services/' },
      to: { path: '^electron/ipc/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(test|dist|dist-electron|release|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
