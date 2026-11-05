import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';

/** Shortcut to the signed-in person's own profile. */
export default async function MyProfilePage() {
  const actor = await requireActor();
  if (!actor.employeeId) redirect('/account');
  redirect(`/people/${actor.employeeId}`);
}
