import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Pin the tracing root to this app — a stray lockfile in a parent
  // directory otherwise makes Next.js guess (and warn) about the workspace root.
  outputFileTracingRoot: path.join(__dirname),

  // Mary's system prompt is composed at runtime from these committed BMad
  // source files (see lib/bmad-source.ts). Next's tracer can't see the
  // fs.readFileSync paths, so bundle them into the /api/chat function
  // explicitly or they won't exist on Vercel.
  outputFileTracingIncludes: {
    '/api/chat': [
      './.claude/skills/bmad-agent-analyst/customize.toml',
      './.claude/skills/bmad-brainstorming/**',
    ],
    // The techniques catalog reads brain-methods.csv at runtime; ship it into
    // this function too (the tracer can't see the fs.readFileSync path).
    '/api/techniques': ['./.claude/skills/bmad-brainstorming/assets/brain-methods.csv'],
  },
};

export default nextConfig;
