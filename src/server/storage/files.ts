import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Private file storage.
 *
 * Files are written under STORAGE_DIR, which is outside ./public and therefore
 * not served by the web server at all. The only way to read one back is through
 * an authorized route that resolves the owning record first. There is no URL
 * that returns a file without a permission check, because there is no URL that
 * maps to the filesystem.
 *
 * Storage keys are opaque random values, not filenames. Two consequences worth
 * stating: a key cannot be guessed from a document's name, and a filename a
 * user chose never reaches the filesystem, so "../../etc/passwd" is simply
 * stored as a label in the database and never used as a path.
 *
 * Swapping this for object storage means reimplementing the four functions
 * below; nothing else in the application touches the filesystem.
 */

const DEFAULT_DIR = './storage/attachments';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Types accepted for upload. An allowlist, not a blocklist: anything not named
 * here is refused. HTML and SVG are deliberately absent — both can carry script
 * that would run in a viewer's session if the file were ever rendered inline.
 */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR || DEFAULT_DIR);
}

/**
 * Guards against the configuration mistake that would undo the whole design:
 * pointing STORAGE_DIR inside ./public, where the web server would hand out
 * every file with no permission check at all.
 */
export function storageMisconfigured(): string | null {
  const root = storageRoot();
  const publicDir = path.resolve('./public');
  if (root === publicDir || root.startsWith(publicDir + path.sep)) {
    return (
      'STORAGE_DIR points inside ./public, which would let the web server return every attachment ' +
      'without any permission check. Move it outside the public directory.'
    );
  }
  return null;
}

/** An opaque key. Sharded two levels so a directory never holds a million files. */
function newStorageKey(): string {
  const id = randomBytes(24).toString('hex');
  return `${id.slice(0, 2)}/${id.slice(2, 4)}/${id.slice(4)}`;
}

function resolveKey(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, key);
  // Defence in depth: keys are generated, never user-supplied, but a path that
  // escapes the root must fail loudly rather than read an arbitrary file.
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Refusing to resolve a storage key outside the storage root.');
  }
  return full;
}

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  checksum: string;
}

export async function writeStoredFile(bytes: Buffer): Promise<StoredFile> {
  const misconfigured = storageMisconfigured();
  if (misconfigured) throw new Error(misconfigured);

  const storageKey = newStorageKey();
  const full = resolveKey(storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  // Owner-only permissions; nothing else on the host needs to read these.
  await writeFile(full, bytes, { mode: 0o600 });

  return {
    storageKey,
    sizeBytes: bytes.byteLength,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(resolveKey(storageKey));
}

export async function storedFileExists(storageKey: string): Promise<boolean> {
  try {
    const info = await stat(resolveKey(storageKey));
    return info.isFile();
  } catch {
    return false;
  }
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveKey(storageKey));
  } catch {
    // Already gone is the desired end state.
  }
}

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * Quotes, control characters and path separators are stripped, and the result
 * is sent as both the plain `filename` and the RFC 5987 `filename*` form so a
 * non-ASCII name survives without letting the header be split.
 */
export function contentDisposition(filename: string): string {
  const fallback = filename
    .replace(/[\\/]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const safe = fallback.length > 0 ? fallback : 'download';
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function extensionFor(mimeType: string): string | null {
  return ALLOWED_MIME_TYPES[mimeType] ?? null;
}
