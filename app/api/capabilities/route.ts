import { NextRequest, NextResponse } from 'next/server';
import { authContext } from '@/lib/session';
import { resolveModalitySupport } from '@/lib/attachments';

// Reads env only → Node runtime.
export const runtime = 'nodejs';

/**
 * Resolved per-provider modality support for the current server config. The
 * client uses it to gate attachments (and toast) BEFORE sending. Env stays
 * server-side; only the resolved booleans cross the wire.
 */
export async function GET(req: NextRequest) {
  if (!(await authContext(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const support = resolveModalitySupport({
    openrouterModel: process.env.OPENROUTER_MODEL,
    openrouterMultimodal: process.env.OPENROUTER_MULTIMODAL === 'true',
  });
  return NextResponse.json({ support });
}
