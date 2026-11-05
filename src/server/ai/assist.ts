import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import {
  PAID_PROVIDERS,
  digestContext,
  providerByName,
  type AiProviderName,
  type SuggestionResult,
} from './provider';

/**
 * Optional AI assistance: the gate, the context rules, and the record.
 *
 * Three guarantees this module exists to keep.
 *
 * **It is off unless four things are true at once.** A provider chosen, the
 * switch on, a budget above zero for a paid provider, and — for a paid provider
 * — AI_BILLING_APPROVED=true in the server environment plus a credential there.
 * Any one of them missing and `resolveAiRuntime` returns a reason, which is
 * what the interface shows. A browser toggle cannot start a metered service.
 *
 * **Context never widens access.** Every assembler below takes the requesting
 * actor and loads only what that actor could already open. Two categories are
 * excluded outright, at this layer, regardless of who is asking and regardless
 * of what the model is told: private one-on-one notes, and anonymous survey
 * responses. Their protection does not depend on a prompt being obeyed.
 *
 * **Nothing becomes a decision.** A suggestion is text with a label. It is
 * stored as SUGGESTED, and a person accepts, edits or discards it. No path here
 * writes a rating, a score, a compensation figure or an employment outcome.
 */

export interface AiRuntime {
  enabled: boolean;
  provider: AiProviderName;
  model: string | null;
  /** Present when disabled: why, in words a person can act on. */
  reason?: string;
  /** True when the active provider makes no network call and bills nothing. */
  local: boolean;
}

export async function resolveAiRuntime(orgId: string): Promise<AiRuntime> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { aiEnabled: true, aiProvider: true, aiModel: true, aiMonthlyCallBudget: true },
  });
  if (!org) return { enabled: false, provider: 'none', model: null, local: true, reason: 'No organization.' };

  const provider = org.aiProvider as AiProviderName;

  if (!org.aiEnabled) {
    return {
      enabled: false,
      provider,
      model: org.aiModel,
      local: true,
      reason: 'AI assistance is switched off for this organization.',
    };
  }
  if (provider === 'none') {
    return {
      enabled: false,
      provider,
      model: org.aiModel,
      local: true,
      reason: 'No AI provider has been chosen.',
    };
  }

  const paid = PAID_PROVIDERS.includes(provider);

  if (paid) {
    if (process.env.AI_BILLING_APPROVED !== 'true') {
      return {
        enabled: false,
        provider,
        model: org.aiModel,
        local: false,
        reason:
          'A paid provider is selected but the server has not recorded approval for the spend ' +
          '(AI_BILLING_APPROVED is not set). No request will be made.',
      };
    }
    if (!credentialPresent(provider)) {
      return {
        enabled: false,
        provider,
        model: org.aiModel,
        local: false,
        reason: `No credential for ${provider} is configured on the server.`,
      };
    }
    if (org.aiMonthlyCallBudget <= 0) {
      return {
        enabled: false,
        provider,
        model: org.aiModel,
        local: false,
        reason: 'The monthly call budget is zero, so no billable request will be made.',
      };
    }
    const used = await billableCallsThisMonth(orgId);
    if (used >= org.aiMonthlyCallBudget) {
      return {
        enabled: false,
        provider,
        model: org.aiModel,
        local: false,
        reason:
          `This month's budget of ${org.aiMonthlyCallBudget} calls is used up (${used} so far). ` +
          'Everything else in the application is unaffected.',
      };
    }
  }

  return { enabled: true, provider, model: org.aiModel, local: provider === 'mock' };
}

function credentialPresent(provider: AiProviderName): boolean {
  switch (provider) {
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY);
    case 'azure-openai':
      return Boolean(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT);
    default:
      return true;
  }
}

export async function billableCallsThisMonth(orgId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return prisma.aiSuggestion.count({
    where: { orgId, createdAt: { gte: start }, provider: { notIn: ['mock'] } },
  });
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

export type AssistKind =
  | 'review_question'
  | 'feedback_clarity'
  | 'review_summary'
  | 'goal_wording'
  | 'meeting_summary';

export interface AssistRequest {
  kind: AssistKind;
  contextType: string;
  contextId: string;
  /** Text the person has already written, which they are asking for help with. */
  draft?: string;
}

/**
 * Builds the context for a suggestion.
 *
 * Every branch loads through the same service-layer reads a page would use, so
 * nothing reaches a model that the requesting person could not already read on
 * screen. Where a record type has content that is private even to people who
 * can see the record — a private meeting note, an anonymous survey answer —
 * that content is not loaded at all. It is excluded by the query, not filtered
 * from a result, so there is no version of this function that accidentally
 * includes it.
 */
async function assembleContext(actor: Actor, request: AssistRequest): Promise<string> {
  const lines: string[] = [];

  switch (request.kind) {
    case 'review_question': {
      // Template authoring: the competency catalogue, which is configuration
      // rather than anybody's personal data.
      if (!actor.isHrAdmin) {
        throw new ForbiddenError('Only an HR administrator drafts review questions.');
      }
      const competencies = await prisma.competency.findMany({
        where: { orgId: actor.orgId, active: true },
        select: { name: true, description: true, category: true },
        take: 40,
      });
      lines.push('Competencies this organization assesses:');
      for (const c of competencies) {
        lines.push(`- ${c.name}${c.category ? ` (${c.category})` : ''}: ${c.description ?? 'no description'}`);
      }
      if (request.draft) lines.push('', 'Draft section title:', request.draft);
      break;
    }

    case 'feedback_clarity':
    case 'goal_wording': {
      // Only the person's own draft text. No record is read at all, which makes
      // this the narrowest context in the system: nothing about anybody else
      // leaves the building.
      if (!request.draft || request.draft.trim().length === 0) {
        throw new ValidationError('Write something first; there is nothing to improve yet.');
      }
      lines.push('Text the author wrote and would like clearer:', request.draft.trim());
      break;
    }

    case 'review_summary': {
      // Summarising a review defers to the same participant read the screen
      // uses, so access is decided by one function rather than re-derived here
      // and allowed to drift from it.
      const { getParticipantDetail } = await import('../services/reviews');
      const detail = await getParticipantDetail(actor, request.contextId);
      const subject = detail.participant.employee;
      lines.push(`Review of ${subject.firstName} ${subject.lastName}.`);
      lines.push(
        'Only the submitted content visible to the requesting person is included; drafts are not.',
      );
      break;
    }

    case 'meeting_summary': {
      const meeting = await prisma.meeting.findFirst({
        where: { id: request.contextId, orgId: actor.orgId },
        select: {
          id: true,
          title: true,
          participants: { select: { employeeId: true } },
          agendaItems: { select: { title: true, notes: true }, orderBy: { sortOrder: 'asc' } },
          // SHARED notes only. Private notes are excluded by the query itself,
          // so no later change to this function can start including them.
          notes: {
            where: { visibility: 'SHARED' },
            select: { body: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!meeting) throw new NotFoundError();
      const isParticipant = meeting.participants.some((p) => p.employeeId === actor.employeeId);
      if (!isParticipant && !actor.isHrAdmin) throw new NotFoundError();

      lines.push(`One-on-one: ${meeting.title}`);
      lines.push('', 'Shared agenda:');
      for (const item of meeting.agendaItems) {
        lines.push(`- ${item.title}${item.notes ? `: ${item.notes}` : ''}`);
      }
      lines.push('', 'Shared notes:');
      for (const note of meeting.notes) lines.push(note.body);
      lines.push(
        '',
        '(Private notes are deliberately excluded and were not read when building this.)',
      );
      break;
    }
  }

  return lines.join('\n');
}

/**
 * Requests a suggestion, records it, and returns it for a person to decide on.
 *
 * Survey data never appears in any branch above, and that is not an oversight:
 * an anonymous response has no author stored, so there is nothing to assemble
 * per-person, and feeding aggregate answers to a model would put verbatim
 * comments from a promised-anonymous survey into a third party's hands. If
 * survey summarisation is ever wanted it needs its own design and its own
 * consent language — see docs/EXTENSION-PLAN.md.
 */
export async function requestSuggestion(
  actor: Actor,
  request: AssistRequest,
): Promise<SuggestionResult & { id: string }> {
  const runtime = await resolveAiRuntime(actor.orgId);
  if (!runtime.enabled) {
    throw new ConflictError(
      runtime.reason ?? 'AI assistance is not available.',
      { reason: runtime.reason },
    );
  }

  const provider = providerByName(runtime.provider);
  if (!provider) {
    throw new ConflictError('No AI provider is active.');
  }

  const context = await assembleContext(actor, request);
  const digest = digestContext(context);

  const result = await provider.suggest({
    kind: request.kind,
    context,
    instruction: instructionFor(request.kind),
    maxWords: 220,
  });

  const stored = await prisma.aiSuggestion.create({
    data: {
      orgId: actor.orgId,
      kind: request.kind,
      contextType: request.contextType,
      contextId: request.contextId,
      requestedByEmployeeId: actor.employeeId,
      provider: result.provider,
      model: result.model,
      promptSummary: instructionFor(request.kind),
      // The digest proves what was sent without the log holding the content.
      contextDigest: digest,
      suggestionText: result.text,
      status: 'SUGGESTED',
    },
    select: { id: true },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.AI_SUGGESTION_REQUESTED,
    entityType: request.contextType,
    entityId: request.contextId,
    summary: `Requested an AI ${request.kind.replace('_', ' ')} suggestion via ${result.provider}`,
    metadata: {
      suggestionId: stored.id,
      provider: result.provider,
      local: result.local,
      contextDigest: digest,
    },
  });

  return { ...result, id: stored.id };
}

function instructionFor(kind: AssistKind): string {
  switch (kind) {
    case 'review_question':
      return 'Suggest review questions for this section. Return questions only, as editable drafts.';
    case 'feedback_clarity':
      return 'Suggest how to make this feedback clearer and more specific. Do not judge the person.';
    case 'review_summary':
      return 'Summarise the submitted review content. Do not propose a rating or a decision.';
    case 'goal_wording':
      return 'Suggest how to make this goal measurable.';
    case 'meeting_summary':
      return 'Summarise the shared agenda and shared notes.';
  }
}

/**
 * Records what the person did with a suggestion. This is the step that makes
 * the human decision auditable: a suggestion that ended up in a record is
 * marked ACCEPTED or EDITED with the text that was actually kept, and one that
 * was thrown away says so.
 */
export async function decideSuggestion(
  actor: Actor,
  suggestionId: string,
  decision: 'ACCEPTED' | 'EDITED' | 'DISCARDED',
  acceptedText?: string,
): Promise<void> {
  const suggestion = await prisma.aiSuggestion.findFirst({
    where: { id: suggestionId, orgId: actor.orgId },
    select: { id: true, kind: true, requestedByEmployeeId: true, contextType: true, contextId: true },
  });
  if (!suggestion) throw new NotFoundError();
  // Only the person who asked decides what happens to it.
  if (suggestion.requestedByEmployeeId !== actor.employeeId) throw new NotFoundError();

  if (decision !== 'DISCARDED' && !acceptedText?.trim()) {
    throw new ValidationError('Include the text that was kept.');
  }

  await prisma.aiSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: decision,
      acceptedText: decision === 'DISCARDED' ? null : (acceptedText ?? '').trim(),
      decidedAt: new Date(),
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.AI_SUGGESTION_DECIDED,
    entityType: suggestion.contextType,
    entityId: suggestion.contextId,
    summary: `${decision === 'ACCEPTED' ? 'Accepted' : decision === 'EDITED' ? 'Accepted an edited' : 'Discarded'} an AI suggestion`,
    metadata: { suggestionId, decision },
  });
}
