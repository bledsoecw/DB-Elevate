import { NextResponse } from 'next/server';
import { handler } from '@/server/api';
import { ValidationError } from '@/server/errors';
import {
  isAttachmentOwnerType,
  listAttachments,
  uploadAttachment,
} from '@/server/services/attachments';
import { MAX_UPLOAD_BYTES } from '@/server/storage/files';

export const GET = handler(async ({ actor, request }) => {
  const url = new URL(request.url);
  const ownerType = url.searchParams.get('ownerType') ?? '';
  const ownerId = url.searchParams.get('ownerId') ?? '';
  if (!isAttachmentOwnerType(ownerType) || !ownerId) {
    throw new ValidationError('Specify a valid ownerType and ownerId.');
  }
  const attachments = await listAttachments(actor, ownerType, ownerId);
  return { attachments };
});

/**
 * Multipart upload. The file never touches the filesystem under a name the
 * user chose: the body is read into memory, size-checked, type-checked against
 * an allowlist, and written under a generated opaque key.
 */
export const POST = handler(async ({ actor, request }) => {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new ValidationError('Send the file as multipart/form-data.');
  }

  // Reject on the declared length before reading the body at all, so an
  // oversized upload is refused rather than buffered.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_UPLOAD_BYTES * 1.1) {
    return NextResponse.json(
      {
        error: {
          code: 'payload_too_large',
          message: `That file is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
        },
      },
      { status: 413 },
    );
  }

  const form = await request.formData();
  const ownerType = String(form.get('ownerType') ?? '');
  const ownerId = String(form.get('ownerId') ?? '');
  const file = form.get('file');

  if (!isAttachmentOwnerType(ownerType) || !ownerId) {
    throw new ValidationError('Specify a valid ownerType and ownerId.');
  }
  if (!(file instanceof File)) {
    throw new ValidationError('No file was included in the upload.');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const attachment = await uploadAttachment(actor, {
    ownerType,
    ownerId,
    filename: file.name || 'upload',
    mimeType: file.type,
    bytes,
  });
  return { id: attachment.id, filename: attachment.filename, sizeBytes: attachment.sizeBytes };
});
