import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Match Next.js: use the automatic JSX runtime so components (e.g.
  // components/Markdown.tsx) need no explicit `import React`.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only`'s default entry throws when imported outside a React
      // Server Component. Next.js swaps it for the empty build via the
      // `react-server` export condition; vitest has no such condition, so map it
      // to the same no-op empty module for unit tests.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
  },
});
