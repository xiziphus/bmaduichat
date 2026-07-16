import { NextRequest, NextResponse } from 'next/server';
import { authContext } from '@/lib/session';
import { getTechniques } from '@/lib/techniques-catalog';

// fs read of brain-methods.csv → Node runtime (not Edge).
export const runtime = 'nodejs';

/** Authed catalog feed so the browser never does an fs read for techniques. */
export async function GET(req: NextRequest) {
  if (!(await authContext(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ techniques: getTechniques() });
}
