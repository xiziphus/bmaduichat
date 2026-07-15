/**
 * Attachment model + capability logic. Pure/isomorphic — safe to import from the
 * client composer, the API route (for `resolveModalitySupport`), and unit tests.
 *
 * FileReader-based helpers only RUN in the browser; they are never invoked
 * server-side, so referencing DOM globals here is harmless for the Node bundle.
 */

import type { MsgPart, Provider } from './llm';

export type Modality = 'image' | 'pdf' | 'text';

/** In-memory attachment staged in the composer. Binaries are ephemeral. */
export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modality: Modality;
  /** base64 (no data: prefix) for image/pdf. */
  data?: string;
  /** decoded content for text/markdown. */
  text?: string;
};

/** The lightweight metadata persisted on a message row (never the binary). */
export type AttachmentMeta = { name: string; mimeType: string; size: number };

/** Per-provider modality support. */
export type ModalitySupport = { image: boolean; pdf: boolean };
export type SupportMap = Record<Provider, ModalitySupport>;

/* ---------------- limits & accepted types ---------------- */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB / file
export const MAX_FILES = 4;

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const TEXT_MIMES = ['text/plain', 'text/markdown'];

/** `accept` attribute for the file picker. */
export const ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.md,.markdown,.txt';

/* ---------------- classification & validation ---------------- */

/** Map a file's mime/name to a modality, or null when unsupported. */
export function classify(mimeType: string, name: string): Modality | null {
  const mt = (mimeType || '').toLowerCase();
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (IMAGE_MIMES.includes(mt)) return 'image';
  if (mt === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (TEXT_MIMES.includes(mt) || ext === 'md' || ext === 'markdown' || ext === 'txt') return 'text';
  return null;
}

export type ValidateResult =
  | { ok: true; modality: Modality }
  | { ok: false; reason: string };

/** Validate one file for type + size. Returns a toast-ready reason on reject. */
export function validateFile(file: { name: string; type: string; size: number }): ValidateResult {
  const modality = classify(file.type, file.name);
  if (!modality) return { ok: false, reason: `${file.name} — unsupported file type` };
  if (file.size > MAX_FILE_BYTES) {
    const mb = Math.round(MAX_FILE_BYTES / 1024 / 1024);
    return { ok: false, reason: `${file.name} is too large (max ${mb}MB)` };
  }
  return { ok: true, modality };
}

/* ---------------- capability map + gate ---------------- */

/**
 * Builder-tunable allowlist of OpenRouter model-id patterns known to accept
 * vision input. Tune via `OPENROUTER_MODEL` or force with `OPENROUTER_MULTIMODAL`.
 */
export const OPENROUTER_VISION_PATTERNS: RegExp[] = [
  /gpt-4o/,
  /claude-3/,
  /gemini/,
  /llama-3\.2-vision/,
  /qwen[\w.-]*-vl/,
  /pixtral/,
];

/** True when the configured OpenRouter model is known-multimodal (or forced). */
export function openrouterSupportsVision(model: string, envOverride?: boolean): boolean {
  if (envOverride) return true;
  const m = (model || '').toLowerCase();
  return OPENROUTER_VISION_PATTERNS.some((re) => re.test(m));
}

/** Safe default used before the server capability probe resolves. */
export const DEFAULT_SUPPORT: SupportMap = {
  gemini: { image: true, pdf: true },
  openrouter: { image: false, pdf: false },
};

/** Resolve the live support map from env (server-side). */
export function resolveModalitySupport(env: {
  openrouterModel?: string;
  openrouterMultimodal?: boolean;
}): SupportMap {
  const vision = openrouterSupportsVision(env.openrouterModel ?? '', env.openrouterMultimodal);
  return {
    gemini: { image: true, pdf: true },
    openrouter: { image: vision, pdf: vision },
  };
}

/**
 * The capability gate. Text docs always pass (they are inlined as text). An
 * image/PDF the current provider can't read blocks the send and names the
 * offending modality so the caller can toast + retain the attachment.
 */
export function canSend(
  provider: Provider,
  attachments: Pick<Attachment, 'modality'>[],
  support: SupportMap,
): { ok: true } | { ok: false; blocked: Modality } {
  for (const a of attachments) {
    if (a.modality === 'text') continue;
    if (!support[provider][a.modality]) return { ok: false, blocked: a.modality };
  }
  return { ok: true };
}

/* ---------------- text inlining + outgoing payload ---------------- */

/** Label + inline one text/markdown attachment into the prompt. */
export function inlineTextAttachment(name: string, content: string): string {
  return `[Attached: ${name}]\n${content}`;
}

/** Compose the outgoing message text: the user's typed text + any inlined docs. */
export function composeOutgoingText(
  baseText: string,
  textAttachments: { name: string; text: string }[],
): string {
  const inlined = textAttachments
    .map((a) => inlineTextAttachment(a.name, a.text))
    .join('\n\n');
  if (!inlined) return baseText;
  return baseText ? `${baseText}\n\n${inlined}` : inlined;
}

/** Build provider-native parts (images/PDFs) from staged attachments. */
export function toMsgParts(attachments: Attachment[]): MsgPart[] {
  const parts: MsgPart[] = [];
  for (const a of attachments) {
    if (a.modality === 'image' && a.data) {
      parts.push({ type: 'image', mimeType: a.mimeType, data: a.data });
    } else if (a.modality === 'pdf' && a.data) {
      parts.push({ type: 'pdf', mimeType: a.mimeType, data: a.data });
    }
  }
  return parts;
}

/** Reduce an attachment to persistable metadata. */
export function toMeta(a: Attachment | AttachmentMeta): AttachmentMeta {
  return { name: a.name, mimeType: a.mimeType, size: a.size };
}

/** A small icon per modality for chips. */
export function modalityIcon(modality: Modality): string {
  if (modality === 'image') return '🖼️';
  if (modality === 'pdf') return '📄';
  return '📝';
}

/* ---------------- browser file readers (client-only) ---------------- */

/** Read a file as base64 (no data: prefix). Browser only. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Read a file as UTF-8 text. Browser only. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}
