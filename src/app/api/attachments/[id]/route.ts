import { NextResponse } from 'next/server';
import { errorResponse, handler } from '@/server/api';
import { requireActor } from '@/server/authz/actor';
import { deleteAttachment, readAttachment } from '@/server/services/attachments';
import { contentDisposition } from '@/server/storage/files';

/**
 * Downloads a file.
 *
 * Not wrapped in `handler` because the success path returns raw bytes rather
 * than JSON. Authentication and authorization are identical: the actor is
 * resolved the same way, and the service re-checks the owning record's
 * visibility before it reads anything from disk.
 *
 * Always Content-Disposition: attachment, never inline. A personnel document
 * rendered inline would run in the viewer's session if it happened to contain
 * markup, and the allowlist should not be the only thing standing between a
 * crafted upload and a viewer's cookies.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireActor();
    const { id } = await ctx.params;
    const file = await readAttachment(actor, id);

    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': contentDisposition(file.filename),
        'Content-Length': String(file.bytes.byteLength),
        // Never cached by a shared cache: the same URL is authorized per person.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export const DELETE = handler(async ({ actor, params }) => {
  await deleteAttachment(actor, params.id as string);
  return { ok: true };
});
