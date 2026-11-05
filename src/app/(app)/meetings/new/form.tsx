'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { Checkbox, FormActions, FormError, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { MEETING_CADENCES, MEETING_CADENCE_LABELS, type MeetingCadence } from '@/lib/enums';

export function NewMeetingForm({
  people,
  directReportIds,
  defaultWith,
}: {
  people: { id: string; firstName: string; lastName: string; preferredName: string | null; jobTitle: { name: string } | null }[];
  directReportIds: string[];
  defaultWith: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [otherEmployeeId, setOther] = useState(defaultWith);
  // Left empty for the server render and filled on mount: computing a default
  // from the clock during render makes the server and client disagree, which
  // React reports as a hydration mismatch.
  const [scheduledAt, setScheduledAt] = useState('');
  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduledAt(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  }, []);
  const [durationMinutes, setDuration] = useState('30');
  const [location, setLocation] = useState('');
  const [cadence, setCadence] = useState<string>('BIWEEKLY');
  const [createSeries, setCreateSeries] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>('/api/meetings', {
        otherEmployeeId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: Number(durationMinutes),
        location: location.trim() || null,
        cadence: createSeries ? cadence : 'NONE',
        createSeries,
      });
      toast.success('Meeting scheduled', 'They have been notified.');
      router.push(`/meetings/${r.id}`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="max-w-2xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormError message={error} />
      <Card>
        <CardHeader title="Details" />
        <CardBody className="space-y-4">
          <Select
            label="With"
            required
            value={otherEmployeeId}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Choose a colleague"
          >
            {directReportIds.length > 0 && (
              <optgroup label="My direct reports">
                {people
                  .filter((p) => directReportIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.preferredName || p.firstName} {p.lastName}
                      {p.jobTitle ? ` — ${p.jobTitle.name}` : ''}
                    </option>
                  ))}
              </optgroup>
            )}
            <optgroup label="Everyone else">
              {people
                .filter((p) => !directReportIds.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.preferredName || p.firstName} {p.lastName}
                    {p.jobTitle ? ` — ${p.jobTitle.name}` : ''}
                  </option>
                ))}
            </optgroup>
          </Select>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="When"
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <Select
              label="How long"
              value={durationMinutes}
              onChange={(e) => setDuration(e.target.value)}
            >
              {['15', '20', '30', '45', '60'].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Where"
            required={false}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Site trailer, main office, phone…"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Repeat" />
        <CardBody className="space-y-3">
          <Checkbox
            label="Make this a recurring series"
            description="When a meeting is completed, the next one is scheduled and anything left on the agenda moves to it."
            checked={createSeries}
            onChange={(e) => setCreateSeries(e.target.checked)}
          />
          {createSeries && (
            <Select label="How often" value={cadence} onChange={(e) => setCadence(e.target.value)}>
              {MEETING_CADENCES.filter((c) => c !== 'NONE').map((c) => (
                <option key={c} value={c}>
                  {MEETING_CADENCE_LABELS[c as MeetingCadence]}
                </option>
              ))}
            </Select>
          )}
        </CardBody>
      </Card>

      <FormActions>
        <Button
          type="submit"
          variant="primary"
          icon={<CalendarPlus className="h-4 w-4" />}
          loading={loading}
          disabled={!otherEmployeeId}
        >
          Schedule it
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
