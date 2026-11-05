import { prisma } from '@/server/db';
import { handler } from '@/server/api';

/** Marks the signed-in person's own notifications as read. Scoped to them. */
export const POST = handler(async ({ actor }) => {
  if (!actor.employeeId) return { updated: 0 };
  const result = await prisma.notification.updateMany({
    where: { recipientEmployeeId: actor.employeeId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
});
