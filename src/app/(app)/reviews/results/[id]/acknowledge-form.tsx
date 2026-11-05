'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { FormError, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';

/**
 * Acknowledgement.
 *
 * The wording is deliberate and appears in three places (notification, page
 * banner, and here): acknowledging records receipt, not agreement. The optional
 * comment is stored with the review and is visible to the manager and HR, which
 * is said plainly before the employee writes it.
 */
export function AcknowledgeForm({
  participantId,
  cycleName,
}: {
  participantId: string;
  cycleName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/reviews/participants/${participantId}/acknowledge`, {
        comment: comment.trim() || null,
      });
      toast.success('Acknowledged', 'Your receipt has been recorded.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Acknowledge this review"
        description={`Confirm that you have received and read your ${cycleName}.`}
      />
      <CardBody className="space-y-4">
        <FormError message={error} />

        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
          <p className="font-medium text-slate-900">What acknowledging means</p>
          <p className="mt-1">
            It records that you received this review and had the chance to read it. It does{' '}
            <strong>not</strong> record that you agree with it. If you disagree with something, say
            so in the comment below — it is stored with the review permanently and your manager and
            HR can see it.
          </p>
        </div>

        <Textarea
          label="Your comment"
          required={false}
          help="Optional. Anything you want on the record — agreement, disagreement, context, or something you think was missed."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={5}
          maxLength={4000}
          hint={`${comment.length} / 4000`}
        />

        <Button
          variant="primary"
          icon={<CheckCircle2 className="h-4 w-4" />}
          onClick={() => void acknowledge()}
          loading={loading}
          loadingLabel="Recording…"
        >
          I have received and read this review
        </Button>
      </CardBody>
    </Card>
  );
}
