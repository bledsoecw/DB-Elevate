import { describe, it, expect } from 'vitest';
import {
  PAID_PROVIDERS,
  digestContext,
  mockProvider,
  providerByName,
} from '@/server/ai/provider';

/**
 * The AI provider boundary, exercised without a database.
 *
 * The properties asserted here are the ones the brief turns on: the mock
 * provider must make no network call and must be unmistakably labelled, a
 * provider that is not implemented must refuse rather than quietly fall back to
 * the mock, and the context digest must prove what was sent without storing it.
 */
describe('mock AI provider', () => {
  const request = {
    kind: 'feedback_clarity',
    context: 'Text the author wrote and would like clearer:\nGood job on the kitchen.',
    instruction: 'Suggest how to make this feedback clearer.',
  };

  it('is deterministic for the same input', async () => {
    const a = await mockProvider.suggest(request);
    const b = await mockProvider.suggest(request);
    expect(a.text).toBe(b.text);
    expect(a.contextDigest).toBe(b.contextDigest);
  });

  it('returns different text for different context', async () => {
    const a = await mockProvider.suggest(request);
    const b = await mockProvider.suggest({ ...request, context: request.context + ' extra' });
    // The digest must differ even when the fixture text happens to repeat,
    // because the digest is what an audit relies on.
    expect(a.contextDigest).not.toBe(b.contextDigest);
  });

  it('reports that it made no network call and billed nothing', async () => {
    const result = await mockProvider.suggest(request);
    expect(result.local).toBe(true);
    expect(result.provider).toBe('mock');
    expect(result.model).toBeNull();
    expect(result.sourceLabel).toMatch(/no AI service was contacted/i);
    expect(result.sourceLabel).toMatch(/nothing was billed/i);
  });

  it('labels its output inside the text, so it cannot be mistaken for real', async () => {
    // The label has to survive copy-and-paste into a review, which a separate
    // sourceLabel field would not.
    for (const kind of [
      'review_question',
      'feedback_clarity',
      'review_summary',
      'goal_wording',
      'meeting_summary',
      'an_unknown_kind',
    ]) {
      const result = await mockProvider.suggest({ ...request, kind });
      expect(result.text).toContain('[MOCK SUGGESTION');
    }
  });

  it('says so rather than inventing something when no fixture exists', async () => {
    const result = await mockProvider.suggest({ ...request, kind: 'not_a_real_kind' });
    expect(result.text).toMatch(/No fixture is defined/i);
  });

  it('never proposes a rating or a decision in the review summary fixture', async () => {
    const result = await mockProvider.suggest({ ...request, kind: 'review_summary' });
    expect(result.text).toMatch(/not a model’s to make|No rating, score or recommendation/i);
  });

  it('states that private notes are excluded from a meeting summary', async () => {
    const result = await mockProvider.suggest({ ...request, kind: 'meeting_summary' });
    expect(result.text).toMatch(/private notes are excluded/i);
  });
});

describe('provider selection', () => {
  it('returns nothing for "none"', () => {
    expect(providerByName('none')).toBeNull();
  });

  it('returns the mock provider for "mock"', () => {
    expect(providerByName('mock')?.name).toBe('mock');
  });

  it('refuses rather than falling back to the mock for an unimplemented provider', async () => {
    // Silently substituting placeholder text for a paid provider would mean
    // somebody told "AI is on" reads fixtures and believes them.
    for (const name of PAID_PROVIDERS) {
      const provider = providerByName(name);
      expect(provider?.name).toBe(name);
      await expect(
        provider!.suggest({ kind: 'goal_wording', context: 'x', instruction: 'y' }),
      ).rejects.toThrow(/no client is implemented/i);
    }
  });

  it('tells the caller nothing was sent or billed when it refuses', async () => {
    const provider = providerByName('anthropic');
    await expect(
      provider!.suggest({ kind: 'goal_wording', context: 'x', instruction: 'y' }),
    ).rejects.toThrow(/Nothing was sent anywhere and nothing was billed/i);
  });

  it('treats exactly the metered providers as paid', () => {
    expect(PAID_PROVIDERS).toEqual(['anthropic', 'openai', 'azure-openai']);
    expect(PAID_PROVIDERS).not.toContain('mock');
    expect(PAID_PROVIDERS).not.toContain('none');
  });
});

describe('context digest', () => {
  it('is stable, short, and not reversible to the content', () => {
    const context = 'Private-ish content that must not land in a log.';
    const digest = digestContext(context);
    expect(digest).toBe(digestContext(context));
    expect(digest).toHaveLength(32);
    expect(digest).toMatch(/^[0-9a-f]+$/);
    expect(digest).not.toContain('Private');
  });

  it('changes when a single character changes', () => {
    expect(digestContext('abc')).not.toBe(digestContext('abd'));
  });
});
