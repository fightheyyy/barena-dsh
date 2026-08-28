import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const packageId = '@barena/dsh-eval'

await rm('lib', { recursive: true, force: true })

await Promise.all([
  build({
    entryPoints: ['src/index.ts'],
    outfile: 'lib/index.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    packages: 'external',
    logLevel: 'info',
  }),
  build({
    entryPoints: ['src/core.ts'],
    outfile: 'lib/core.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    logLevel: 'info',
  }),
  build({
    entryPoints: ['src/client/index.tsx'],
    outfile: 'lib/client.js',
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-store',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: {
      js: 'return module.exports; } });',
    },
    logLevel: 'info',
  }),
])
