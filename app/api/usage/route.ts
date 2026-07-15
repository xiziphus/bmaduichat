import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { isPersistenceEnabled } from '@/lib/db';
import { monthToDateSpend } from '@/lib/repo/usage';
import { budgetCap, capStatus } from '@/lib/usage';

// DB access → Node runtime.
export const runtime = 'nodejs';

/**
 * GET /api/usage — month-to-date spend vs the monthly cap, for the header meter.
 * When persistence is off there's no metering: returns `enabled:false` with a
 * zero spend so the meter simply hides. Never errors.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await verifyAuthCookie(cookie, process.env.AUTH_SECRET))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cap = budgetCap();
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, spent: 0, cap, ratio: 0, level: 'ok' });
  }
  try {
    const spent = await monthToDateSpend();
    const { ratio, level } = capStatus(spent, cap);
    return NextResponse.json({ enabled: true, spent, cap, ratio, level });
  } catch (err) {
    console.error('[usage] month spend failed', err instanceof Error ? err.name : typeof err);
    // Degrade rather than error — the meter just hides.
    return NextResponse.json({ enabled: false, spent: 0, cap, ratio: 0, level: 'ok' });
  }
}
