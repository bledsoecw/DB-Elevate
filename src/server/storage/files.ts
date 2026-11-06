import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';

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
 * Two drivers, same four functions, and nothing else in the application knows
 * which is in use:
 *
 *  - **database** (the default): the bytes live in a `file_blobs` row. This is
 *    what makes attachments work on a serverless host, which has no writable
 *    disk that survives between requests — a file written during an upload is
 *    simply gone by the time somebody asks for it back. It also means backups
 *    and restores cover attachments without a second procedure.
 *  - **filesystem**: the original behaviour, for a self-hosted installation
 *    with a real disk. Set STORAGE_DRIVER=filesystem.
 *
 * The database is the default rather than the fallback so that the path which
 * runs in production is also the one that runs in development and in the
 * tests. A driver that is only exercised after deployment is a driver nobody
 * has tested.
 */

const DEFAULT_DIR = './storage/attachments';

export type StorageDriver = 'database' | 'filesystem';

export function storageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER === 'filesystem' ? 'filesystem' : 'database';
}

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
/**
 * Only meaningful for the filesystem driver. With the database driver there is
 * no directory to point in the wrong place, which removes the footgun rather
 * than guarding it.
 */
export function storageMisconfigured(): string | null {
  if (storageDriver() === 'database') return null;
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
  const storageKey = newStorageKey();
  const result: StoredFile = {
    storageKey,
    sizeBytes: bytes.byteLength,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };

  if (storageDriver() === 'database') {
    await prisma.fileBlob.create({
      // Prisma's Bytes maps to Uint8Array. A Buffer is one, but TypeScript
      // cannot prove its backing store is an ArrayBuffer rather than a
      // SharedArrayBuffer, so this copies. At a 15 MB ceiling, once per
      // upload, that is not worth an assertion to avoid.
      data: { storageKey, bytes: Uint8Array.from(bytes), sizeBytes: bytes.byteLength },
    });
    return result;
  }

  const misconfigured = storageMisconfigured();
  if (misconfigured) throw new Error(misconfigured);

  const full = resolveKey(storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  // Owner-only permissions; nothing else on the host needs to read these.
  await writeFile(full, bytes, { mode: 0o600 });
  return result;
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  if (storageDriver() === 'database') {
    const row = await prisma.fileBlob.findUnique({
      where: { storageKey },
      select: { bytes: true },
    });
    if (!row) throw new Error('No stored file for that key.');
    return Buffer.from(row.bytes);
  }
  return readFile(resolveKey(storageKey));
}

export async function storedFileExists(storageKey: string): Promise<boolean> {
  if (storageDriver() === 'database') {
    // Counts rather than selects: the point is whether it is there, and the
    // bytes can be fifteen megabytes.
    return (await prisma.fileBlob.count({ where: { storageKey } })) > 0;
  }
  try {
    const info = await stat(resolveKey(storageKey));
    return info.isFile();
  } catch {
    return false;
  }
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  if (storageDriver() === 'database') {
    // Already gone is the desired end state, so a missing row is not an error.
    await prisma.fileBlob.deleteMany({ where: { storageKey } });
    return;
  }
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
