import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { canManageTemplates } from '../authz/policy';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { QUESTION_TYPES, SCOREABLE_QUESTION_TYPES, TEMPLATE_CATEGORIES } from '@/lib/enums';
import { parseJsonArray } from '@/lib/utils';

/**
 * Review template builder.
 *
 * Versioning is the part that matters. A version is editable only while it is
 * unpublished. Publishing freezes it, and any later edit creates a new version
 * by deep copy. Cycles reference a *version*, never the template, so editing a
 * template can never change the questions a completed review was answered
 * against — the single most common way performance systems corrupt their own
 * history.
 */

export async function listTemplates(actor: Actor) {
  if (!canManageTemplates(actor)) {
    throw new ForbiddenError('Only an HR administrator can manage review templates.');
  }
  return prisma.reviewTemplate.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          versionNumber: true,
          publishedAt: true,
          createdAt: true,
          changeNote: true,
          _count: { select: { cycles: true, sections: true, participants: true } },
        },
      },
    },
  });
}

export async function getTemplate(actor: Actor, templateId: string, versionId?: string) {
  if (!canManageTemplates(actor)) {
    throw new ForbiddenError('Only an HR administrator can manage review templates.');
  }
  const template = await prisma.reviewTemplate.findFirst({
    where: { id: templateId, orgId: actor.orgId },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        include: { _count: { select: { cycles: true, participants: true } } },
      },
    },
  });
  if (!template) throw new NotFoundError();

  const targetId = versionId ?? template.versions[0]?.id;
  if (!targetId) throw new NotFoundError('That template has no versions.');

  const version = await prisma.reviewTemplateVersion.findFirst({
    where: { id: targetId, templateId },
    include: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        include: {
          questions: {
            orderBy: { sortOrder: 'asc' },
            include: {
              ratingScale: { include: { levels: { orderBy: { value: 'asc' } } } },
              competency: { select: { id: true, name: true } },
            },
          },
        },
      },
      _count: { select: { cycles: true, participants: true } },
    },
  });
  if (!version) throw new NotFoundError();

  // A published version that has been used is frozen; an unused published
  // version can still be unpublished and edited, which saves an administrator
  // from a pointless version bump after a typo.
  const inUse = version._count.cycles > 0 || version._count.participants > 0;

  return {
    template,
    version,
    editable: version.publishedAt === null,
    inUse,
    canUnpublish: version.publishedAt !== null && !inUse,
  };
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export interface TemplateQuestionInput {
  type: string;
  prompt: string;
  helpText?: string | null;
  required?: boolean;
  weight?: number;
  allowNotApplicable?: boolean;
  commentEnabled?: boolean;
  commentRequired?: boolean;
  maxLength?: number | null;
  ratingScaleId?: string | null;
  competencyId?: string | null;
  goalScope?: string | null;
  choices?: string[];
  appliesTo?: string | null;
}

export interface TemplateSectionInput {
  title: string;
  instructions?: string | null;
  weight?: number;
  appliesTo?: string;
  questions: TemplateQuestionInput[];
}

export interface TemplateInput {
  name: string;
  description?: string | null;
  category: string;
  selfWeight: number;
  managerWeight: number;
  peerWeight: number;
  sections: TemplateSectionInput[];
}

function validateTemplate(input: TemplateInput): void {
  if (!input.name || input.name.trim().length < 3) {
    throw new ValidationError('Give the template a name of at least 3 characters.');
  }
  if (!TEMPLATE_CATEGORIES.includes(input.category as never)) {
    throw new ValidationError('Unknown template category.');
  }
  if (input.sections.length === 0) {
    throw new ValidationError('A template needs at least one section.');
  }
  const totalWeight = input.selfWeight + input.managerWeight + input.peerWeight;
  if (totalWeight <= 0) {
    throw new ValidationError(
      'At least one reviewer type needs a weight above zero, otherwise no score can ever be calculated.',
    );
  }

  let scoreable = 0;
  for (const section of input.sections) {
    if (!section.title.trim()) throw new ValidationError('Every section needs a title.');
    if (section.questions.length === 0) {
      throw new ValidationError(`The section "${section.title}" has no questions.`);
    }
    for (const q of section.questions) {
      if (!QUESTION_TYPES.includes(q.type as never)) {
        throw new ValidationError(`Unknown question type "${q.type}".`);
      }
      if (!q.prompt.trim()) throw new ValidationError('Every question needs a prompt.');
      if (SCOREABLE_QUESTION_TYPES.includes(q.type as never) && !q.ratingScaleId) {
        throw new ValidationError(`"${q.prompt}" is a rating question, so it needs a rating scale.`);
      }
      if (q.type === 'COMPETENCY_RATING' && !q.competencyId) {
        throw new ValidationError(`"${q.prompt}" is a competency assessment, so it needs a competency.`);
      }
      if ((q.type === 'MULTIPLE_CHOICE' || q.type === 'MULTI_SELECT') && (q.choices ?? []).filter((c) => c.trim()).length < 2) {
        throw new ValidationError(`"${q.prompt}" needs at least two options.`);
      }
      if (q.commentRequired && !q.commentEnabled) {
        throw new ValidationError(
          `"${q.prompt}" requires a comment, so the comment box has to be switched on.`,
        );
      }
      if (SCOREABLE_QUESTION_TYPES.includes(q.type as never)) scoreable += 1;
    }
    const sectionScoreable = section.questions.filter((q) =>
      SCOREABLE_QUESTION_TYPES.includes(q.type as never),
    ).length;
    if ((section.weight ?? 1) > 0 && sectionScoreable === 0) {
      throw new ValidationError(
        `The section "${section.title}" has a weight but no rating questions, so its weight could never apply. Set its weight to 0, or add a rating question.`,
      );
    }
  }
  void scoreable;
}

async function writeSections(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  versionId: string,
  sections: TemplateSectionInput[],
): Promise<void> {
  for (const [si, section] of sections.entries()) {
    const created = await tx.templateSection.create({
      data: {
        versionId,
        title: section.title.trim(),
        instructions: section.instructions?.trim() || null,
        sortOrder: si,
        weight: section.weight ?? 1,
        appliesTo: section.appliesTo ?? 'SELF,MANAGER,PEER',
      },
    });
    for (const [qi, q] of section.questions.entries()) {
      await tx.templateQuestion.create({
        data: {
          sectionId: created.id,
          sortOrder: qi,
          type: q.type,
          prompt: q.prompt.trim(),
          helpText: q.helpText?.trim() || null,
          required: q.required ?? false,
          weight: q.weight ?? 1,
          allowNotApplicable: q.allowNotApplicable ?? false,
          commentEnabled: q.commentEnabled ?? false,
          commentRequired: q.commentRequired ?? false,
          maxLength: q.maxLength ?? null,
          ratingScaleId: q.ratingScaleId || null,
          competencyId: q.competencyId || null,
          goalScope: q.goalScope || null,
          choicesJson:
            q.choices && q.choices.filter((c) => c.trim()).length > 0
              ? JSON.stringify(q.choices.filter((c) => c.trim()))
              : null,
          appliesTo: q.appliesTo || null,
        },
      });
    }
  }
}

export async function createTemplate(actor: Actor, input: TemplateInput) {
  if (!canManageTemplates(actor)) {
    throw new ForbiddenError('Only an HR administrator can create review templates.');
  }
  validateTemplate(input);

  const existing = await prisma.reviewTemplate.findFirst({
    where: { orgId: actor.orgId, name: input.name.trim() },
  });
  if (existing) throw new ConflictError(`A template called "${input.name.trim()}" already exists.`);

  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.reviewTemplate.create({
      data: {
        orgId: actor.orgId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        category: input.category,
        status: 'draft',
        createdById: actor.userId,
      },
    });
    const version = await tx.reviewTemplateVersion.create({
      data: {
        templateId: created.id,
        versionNumber: 1,
        changeNote: 'First version.',
        selfWeight: input.selfWeight,
        managerWeight: input.managerWeight,
        peerWeight: input.peerWeight,
        createdById: actor.userId,
      },
    });
    await writeSections(tx, version.id, input.sections);
    return created;
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.TEMPLATE_CREATED,
    entityType: 'review_template',
    entityId: template.id,
    summary: `Created the review template "${template.name}".`,
  });
  return template;
}

/**
 * Saves an edit.
 *
 * If the target version is unpublished the edit is applied in place. If it is
 * published, a new version is created by copy, so the published one stays
 * exactly as any cycle using it saw it.
 */
export async function saveTemplateVersion(
  actor: Actor,
  templateId: string,
  versionId: string,
  input: TemplateInput,
  changeNote?: string,
): Promise<{ versionId: string; createdNewVersion: boolean }> {
  if (!canManageTemplates(actor)) {
    throw new ForbiddenError('Only an HR administrator can edit review templates.');
  }
  validateTemplate(input);

  const version = await prisma.reviewTemplateVersion.findFirst({
    where: { id: versionId, templateId, template: { orgId: actor.orgId } },
    include: { template: true, _count: { select: { cycles: true, participants: true } } },
  });
  if (!version) throw new NotFoundError();

  const mustFork = version.publishedAt !== null;

  const result = await prisma.$transaction(async (tx) => {
    await tx.reviewTemplate.update({
      where: { id: templateId },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        category: input.category,
      },
    });

    if (!mustFork) {
      // Replace the structure in place. Responses cannot exist against an
      // unpublished version, so nothing is orphaned.
      await tx.templateSection.deleteMany({ where: { versionId } });
      await tx.reviewTemplateVersion.update({
        where: { id: versionId },
        data: {
          selfWeight: input.selfWeight,
          managerWeight: input.managerWeight,
          peerWeight: input.peerWeight,
          changeNote: changeNote?.trim() || version.changeNote,
        },
      });
      await writeSections(tx, versionId, input.sections);
      return { versionId, createdNewVersion: false };
    }

    const latest = await tx.reviewTemplateVersion.findFirst({
      where: { templateId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const next = await tx.reviewTemplateVersion.create({
      data: {
        templateId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        changeNote:
          changeNote?.trim() ||
          `Edited from version ${version.versionNumber}, which is in use and therefore unchanged.`,
        selfWeight: input.selfWeight,
        managerWeight: input.managerWeight,
        peerWeight: input.peerWeight,
        createdById: actor.userId,
      },
    });
    await writeSections(tx, next.id, input.sections);
    return { versionId: next.id, createdNewVersion: true };
  });

  await recordAudit(actor, {
    action: result.createdNewVersion
      ? AUDIT_ACTIONS.TEMPLATE_VERSION_CREATED
      : AUDIT_ACTIONS.TEMPLATE_UPDATED,
    entityType: 'review_template',
    entityId: templateId,
    summary: result.createdNewVersion
      ? `Created a new version of "${input.name.trim()}" because version ${version.versionNumber} was already published. Existing reviews are unaffected.`
      : `Edited the draft version of "${input.name.trim()}".`,
    metadata: { versionId: result.versionId, forked: result.createdNewVersion },
  });

  return result;
}

export async function publishVersion(actor: Actor, templateId: string, versionId: string) {
  if (!canManageTemplates(actor)) throw new ForbiddenError('Only an HR administrator can publish a template.');
  const version = await prisma.reviewTemplateVersion.findFirst({
    where: { id: versionId, templateId, template: { orgId: actor.orgId } },
    include: { template: true, sections: { include: { questions: true } } },
  });
  if (!version) throw new NotFoundError();
  if (version.publishedAt) throw new ConflictError('That version is already published.');
  if (version.sections.length === 0) throw new ConflictError('Add at least one section before publishing.');

  await prisma.$transaction(async (tx) => {
    await tx.reviewTemplateVersion.update({
      where: { id: versionId },
      data: { publishedAt: new Date(), publishedById: actor.userId },
    });
    await tx.reviewTemplate.update({ where: { id: templateId }, data: { status: 'published' } });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.TEMPLATE_PUBLISHED,
    entityType: 'review_template',
    entityId: templateId,
    summary: `Published version ${version.versionNumber} of "${version.template.name}". It is now frozen and can be used by a cycle.`,
  });
}

export async function unpublishVersion(actor: Actor, templateId: string, versionId: string) {
  if (!canManageTemplates(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const version = await prisma.reviewTemplateVersion.findFirst({
    where: { id: versionId, templateId, template: { orgId: actor.orgId } },
    include: { _count: { select: { cycles: true, participants: true } }, template: true },
  });
  if (!version) throw new NotFoundError();
  if (!version.publishedAt) throw new ConflictError('That version is not published.');
  if (version._count.cycles > 0 || version._count.participants > 0) {
    throw new ConflictError(
      'This version has been used by a cycle, so it cannot be unpublished. Edit it instead — that creates a new version and leaves the existing reviews untouched.',
    );
  }
  await prisma.reviewTemplateVersion.update({
    where: { id: versionId },
    data: { publishedAt: null, publishedById: null },
  });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
    entityType: 'review_template',
    entityId: templateId,
    summary: `Unpublished version ${version.versionNumber} of "${version.template.name}" (it had not been used).`,
  });
}

export async function duplicateTemplate(actor: Actor, templateId: string, versionId: string, newName: string) {
  if (!canManageTemplates(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const source = await getTemplate(actor, templateId, versionId);

  const input: TemplateInput = {
    name: newName.trim(),
    description: source.template.description,
    category: source.template.category,
    selfWeight: source.version.selfWeight,
    managerWeight: source.version.managerWeight,
    peerWeight: source.version.peerWeight,
    sections: source.version.sections.map((s) => ({
      title: s.title,
      instructions: s.instructions,
      weight: s.weight,
      appliesTo: s.appliesTo,
      questions: s.questions.map((q) => ({
        type: q.type,
        prompt: q.prompt,
        helpText: q.helpText,
        required: q.required,
        weight: q.weight,
        allowNotApplicable: q.allowNotApplicable,
        commentEnabled: q.commentEnabled,
        commentRequired: q.commentRequired,
        maxLength: q.maxLength,
        ratingScaleId: q.ratingScaleId,
        competencyId: q.competencyId,
        goalScope: q.goalScope,
        choices: parseJsonArray(q.choicesJson),
        appliesTo: q.appliesTo,
      })),
    })),
  };

  const created = await createTemplate(actor, input);
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.TEMPLATE_DUPLICATED,
    entityType: 'review_template',
    entityId: created.id,
    summary: `Duplicated "${source.template.name}" as "${created.name}".`,
  });
  return created;
}

export async function archiveTemplate(actor: Actor, templateId: string) {
  if (!canManageTemplates(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const template = await prisma.reviewTemplate.findFirst({
    where: { id: templateId, orgId: actor.orgId },
  });
  if (!template) throw new NotFoundError();

  const activeCycles = await prisma.reviewCycle.count({
    where: {
      templateVersion: { templateId },
      status: { in: ['DRAFT', 'SCHEDULED', 'ACTIVE'] },
    },
  });
  if (activeCycles > 0) {
    throw new ConflictError(
      `This template is used by ${activeCycles} cycle${activeCycles === 1 ? '' : 's'} that ${activeCycles === 1 ? 'is' : 'are'} not closed. Close those first.`,
    );
  }

  await prisma.reviewTemplate.update({ where: { id: templateId }, data: { status: 'archived' } });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.TEMPLATE_ARCHIVED,
    entityType: 'review_template',
    entityId: templateId,
    summary: `Archived the template "${template.name}". Completed reviews that used it are unaffected.`,
  });
}

/** Published versions a cycle can be built from. */
export async function listPublishedVersions(actor: Actor) {
  if (!canManageTemplates(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const versions = await prisma.reviewTemplateVersion.findMany({
    where: {
      publishedAt: { not: null },
      template: { orgId: actor.orgId, status: { not: 'archived' } },
    },
    orderBy: [{ template: { name: 'asc' } }, { versionNumber: 'desc' }],
    include: {
      template: { select: { id: true, name: true, category: true } },
      _count: { select: { sections: true } },
    },
  });

  // Only the newest published version per template is offered for a new cycle.
  const seen = new Set<string>();
  return versions.filter((v) => {
    if (seen.has(v.templateId)) return false;
    seen.add(v.templateId);
    return true;
  });
}
