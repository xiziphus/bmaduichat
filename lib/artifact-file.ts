/**
 * Artifact file typing — the pure logic behind the raw-file download endpoint
 * (GET /api/artifacts/[id]?download=1) and the persistence `kind` decision.
 *
 * An artifact is an HTML file when its stored `kind` is 'html' OR its body opens
 * with an HTML sentinel (`<!doctype html…` or `<html…`, case-insensitive);
 * otherwise it's markdown. This module is server-safe and dependency-free so it
 * can be unit-tested in isolation and reused by the route.
 */

export type ArtifactFileKind = 'html' | 'markdown';

export type ArtifactFileMeta = {
  kind: ArtifactFileKind;
  ext: 'html' | 'md';
  mime: string;
  filename: string;
};

/**
 * Does this artifact body (optionally with a stored `kind`) represent HTML? True
 * when `kind === 'html'` or the trimmed body starts with `<!doctype html` or
 * `<html` (case-insensitive). Everything else is markdown.
 */
export function isHtmlArtifact(body: string, kind?: string | null): boolean {
  if (kind === 'html') return true;
  const head = body.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/**
 * Slugify a title into a filename stem: lowercase, a-z0-9 runs joined by single
 * hyphens, trimmed of leading/trailing hyphens. Falls back to `document` when
 * the title is null/empty or slugifies to nothing.
 */
export function slugifyTitle(title: string | null | undefined): string {
  if (!title) return 'document';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'document';
}

/**
 * Full download metadata for an artifact: its file kind, extension, MIME type,
 * and `<slug>.<ext>` filename for Content-Disposition.
 */
export function artifactFileMeta(input: {
  title: string | null | undefined;
  body: string;
  kind?: string | null;
}): ArtifactFileMeta {
  const html = isHtmlArtifact(input.body, input.kind);
  const ext = html ? 'html' : 'md';
  const mime = html ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8';
  return {
    kind: html ? 'html' : 'markdown',
    ext,
    mime,
    filename: `${slugifyTitle(input.title)}.${ext}`,
  };
}
