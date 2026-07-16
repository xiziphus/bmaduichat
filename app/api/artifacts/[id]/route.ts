import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authContext } from '@/lib/session';
import { isPersistenceEnabled } from '@/lib/db';
import { getById } from '@/lib/repo/artifacts';
import { renderMarkdownToHtml } from '@/lib/markdown';

// react-dom/server + DB access → Node runtime.
export const runtime = 'nodejs';

/**
 * With `?print=1` we auto-open the browser's print dialog (→ Save as PDF). The
 * sandbox forbids scripts (CSP default-src 'none'), so we allow EXACTLY this one
 * snippet via a CSP script-hash — the sanitized markdown still can't execute
 * anything else. Waits for web fonts so the PDF renders with the right type.
 */
const PRINT_SCRIPT =
  "window.addEventListener('load',function(){(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(function(){setTimeout(function(){window.print();},250);});});";
const PRINT_SCRIPT_HASH = createHash('sha256').update(PRINT_SCRIPT).digest('base64');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * GET /api/artifacts/[id] — a stable, authed, sandboxed render of one artifact.
 *
 * The markdown is rendered through the SAME sanitized renderer the app uses, so
 * the output is inert (no scripts). A strict CSP (default-src 'none') plus
 * nosniff turns the page into a hard sandbox — even if something slipped
 * through, nothing could execute. 404 when missing; 401 when unauthed.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const wantsPrint = req.nextUrl.searchParams.get('print') === '1';

  const { id } = await ctx.params;
  let markdown: string | null = null;
  let title: string | null = null;
  try {
    // Owner-scoped: another user's artifact returns null → 404 (isolation).
    const artifact = await getById(id, undefined, auth.userId);
    if (!artifact || !artifact.markdown) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    markdown = artifact.markdown;
    title = artifact.title;
  } catch (err) {
    console.error('[artifacts] fetch failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const bodyHtml = renderMarkdownToHtml(markdown, 'docbody');
  const heading = title ? `<div class="doctitle">${escapeHtml(title)}</div>` : '';
  const pageTitle = escapeHtml(title || 'Playground document');

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,900;1,9..144,600&family=Nunito:wght@400;600;700;900&family=Newsreader:opsz,wght@6..72,400;6..72,600&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--vio:#7048a8;--coral:#ff7d6b;--mint:#e4f4e0;--mint-ink:#2e7040;}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#faf6f1;font-family:'Nunito',sans-serif;padding:40px 20px;display:flex;justify-content:center}
#paper{width:min(760px,100%);background:#fffdf9;border-radius:20px;box-shadow:0 14px 44px rgba(90,60,130,.16);padding:44px 48px}
.doctitle{font-family:'Fraunces',serif;font-weight:900;font-size:27px;line-height:1.12;color:#2c2433;letter-spacing:-.01em}
.docmeta{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#a89bb5;margin:10px 0 6px;letter-spacing:.05em}
.rule{height:3px;background:linear-gradient(90deg,var(--vio) 0 56px,#efe6f7 56px);border-radius:2px;margin:14px 0 22px}
.docbody{white-space:normal}
.docbody h1{font-family:'Fraunces',serif;font-weight:900;font-size:24px;color:#2c2433;margin:22px 0 8px}
.docbody h2,.docbody h3{font-family:'Fraunces',serif;font-weight:700;font-size:17px;color:#2c2433;margin:24px 0 8px}
.docbody h4{font-family:'Fraunces',serif;font-weight:600;font-size:15px;color:#2c2433;margin:18px 0 6px}
.docbody p{font-family:'Newsreader',serif;font-size:14.5px;line-height:1.75;color:#4a4152;margin-bottom:10px}
.docbody strong{font-weight:700;color:#2c2433}
.docbody em{font-style:italic}
.docbody a{color:var(--vio);text-decoration:underline}
.docbody blockquote{font-family:'Fraunces',serif;font-style:italic;font-weight:600;font-size:18.5px;line-height:1.4;color:#2c2433;border-left:4px solid var(--coral);padding:6px 0 6px 18px;margin:18px 0}
.docbody blockquote p{font-family:inherit;font-size:inherit;color:inherit;margin:0}
.docbody ul,.docbody ol{margin:6px 0 12px 4px}
.docbody ul{list-style:none}
.docbody ul li{font-family:'Newsreader',serif;font-size:14px;line-height:1.7;color:#4a4152;padding-left:24px;position:relative;margin-bottom:5px}
.docbody ul li::before{content:"\\25C6";position:absolute;left:4px;color:var(--coral);font-size:9px;top:7px}
.docbody ol{padding-left:22px}
.docbody ol li{font-family:'Newsreader',serif;font-size:14px;line-height:1.7;color:#4a4152;margin-bottom:5px}
.docbody table{width:100%;border-collapse:collapse;margin:12px 0 18px;font-family:'Nunito'}
.docbody th{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#a89bb5;text-align:left;padding:7px 10px;border-bottom:2px solid #efe6f7}
.docbody td{font-size:13px;font-weight:700;color:#4a4152;padding:9px 10px;border-bottom:1px solid #f4eef8}
.docbody code{font-family:'IBM Plex Mono',monospace;font-size:12.5px;background:#f3ebfa;color:var(--vio);border-radius:4px;padding:1px 5px}
.docbody pre{background:#f3ebfa;border-radius:10px;padding:12px 14px;overflow:auto;margin:12px 0}
.docbody pre code{background:none;padding:0}
.sig{margin-top:26px;padding-top:14px;border-top:1px solid #efe6f7;font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#a89bb5;letter-spacing:.08em}
@media print{
  html,body{background:#fff}
  body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  #paper{box-shadow:none;border-radius:0;width:100%;padding:0 6px}
  .docbody pre,.docbody blockquote,.docbody table,.docbody tr,.docbody img,.docbody li{break-inside:avoid}
  .docbody h1,.docbody h2,.docbody h3,.docbody h4{break-after:avoid}
}
@page{margin:16mm}
</style>
</head>
<body>
<div id="paper">
${heading}
<div class="docmeta">SHAPED WITH MARY · LIVE DOCUMENT</div>
<div class="rule"></div>
${bodyHtml}
<div class="sig">MADE IN PLAYGROUND</div>
</div>${wantsPrint ? `\n<script>${PRINT_SCRIPT}</script>` : ''}
</body>
</html>`;

  return new Response(page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Hard sandbox: styles/fonts/images only. The rendered markdown is already
      // sanitized; this is defense in depth. In print mode we additionally allow
      // EXACTLY the auto-print snippet via its hash — nothing else can execute.
      'Content-Security-Policy':
        `default-src 'none'; script-src ${wantsPrint ? `'sha256-${PRINT_SCRIPT_HASH}'` : "'none'"}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; base-uri 'none'; form-action 'none'`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
