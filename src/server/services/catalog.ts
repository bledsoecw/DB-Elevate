import 'server-only';
import { z } from 'zod';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { canAdministerProgram } from '../authz/policy';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';

import { COMPETENCY_LEVELS } from '@/lib/enums';
import type {
  CompetencyLibraryPatchSchema,
  CompetencyLibrarySchema,
  CompetencyPatchSchema,
  CompetencySchema,
  RatingScalePatchSchema,
  RatingScaleSchema,
  RecognitionValuePatchSchema,
  RecognitionValueSchema,
  DepartmentSchema,
  JobTitleSchema,
} from '../validation/admin';

/**
 * The configurable catalogue: competencies and their behavioural descriptors,
 * competency libraries by role, rating scales, and recognition values.
 *
 * Two rules run through all of it:
 *
 *  1. Nothing here is hard-coded for construction. The seed ships a
 *     construction-shaped catalogue because the first rollout is a construction
 *     and remodeling company, but every row is editable and the application
 *     reads the database, never a constant.
 *
 *  2. Anything a completed review was written against cannot be rewritten.
 *     A rating scale used by a *published* template version is frozen: the
 *     level labels and descriptions a reviewer read when they answered must
 *     still be the ones shown on that review years later. Editing such a scale
 *     is refused with an explanation, and archiving is offered instead.
 */

type CompetencyInput = z.infer<typeof CompetencySchema>;
type CompetencyPatch = z.infer<typeof CompetencyPatchSchema>;
type LibraryInput = z.infer<typeof CompetencyLibrarySchema>;
type LibraryPatch = z.infer<typeof CompetencyLibraryPatchSchema>;
type ScaleInput = z.infer<typeof RatingScaleSchema>;
type ScalePatch = z.infer<typeof RatingScalePatchSchema>;
type RecognitionInput = z.infer<typeof RecognitionValueSchema>;
type RecognitionPatch = z.infer<typeof RecognitionValuePatchSchema>;

function requireProgramAdmin(actor: Actor): void {
  if (!canAdministerProgram(actor)) {
    throw new ForbiddenError('Only an HR administrator can change the performance catalogue.');
  }
}

/** Maps a unique-constraint failure onto the field that caused it. */
function nameTaken(err: unknown, what: string): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Unique constraint')) {
    throw new ValidationError(`A ${what} with that name already exists.`, [
      { path: 'name', message: 'This name is already in use.' },
    ]);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Competencies
// ---------------------------------------------------------------------------

export async function listCompetencies(actor: Actor) {
  requireProgramAdmin(actor);
  return prisma.competency.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    include: {
      behaviors: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { questions: true, libraryItems: true, devActions: true, feedbackItems: true } },
    },
  });
}

export async function getCompetency(actor: Actor, id: string) {
  requireProgramAdmin(actor);
  const competency = await prisma.competency.findFirst({
    where: { id, orgId: actor.orgId },
    include: {
      behaviors: { orderBy: { sortOrder: 'asc' } },
      libraryItems: { include: { library: { select: { id: true, name: true } } } },
      _count: { select: { questions: true, devActions: true, feedbackItems: true } },
    },
  });
  if (!competency) throw new NotFoundError();
  return competency;
}

/** Behaviours are stored in career-level order so the editor renders a ladder. */
function behaviorRows(behaviors: CompetencyInput['behaviors']) {
  return (behaviors ?? [])
    .filter((b) => b.descriptor.trim().length > 0)
    .map((b) => ({
      level: b.level,
      descriptor: b.descriptor.trim(),
      sortOrder: COMPETENCY_LEVELS.indexOf(b.level),
    }));
}

export async function createCompetency(actor: Actor, input: CompetencyInput) {
  requireProgramAdmin(actor);
  try {
    const competency = await prisma.competency.create({
      data: {
        orgId: actor.orgId,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        active: input.active ?? true,
        behaviors: { create: behaviorRows(input.behaviors) },
      },
      include: { behaviors: true },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.COMPETENCY_CREATED,
      entityType: 'competency',
      entityId: competency.id,
      summary: `Added competency "${competency.name}"`,
    });
    return competency;
  } catch (err) {
    return nameTaken(err, 'competency');
  }
}

export async function updateCompetency(actor: Actor, id: string, input: CompetencyPatch) {
  requireProgramAdmin(actor);
  const existing = await prisma.competency.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw new NotFoundError();

  try {
    const competency = await prisma.$transaction(async (tx) => {
      if (input.behaviors) {
        // Replace wholesale: the editor always submits the complete ladder, so
        // a removed descriptor must actually disappear.
        await tx.competencyBehavior.deleteMany({ where: { competencyId: id } });
        const rows = behaviorRows(input.behaviors);
        if (rows.length) {
          await tx.competencyBehavior.createMany({
            data: rows.map((r) => ({ ...r, competencyId: id })),
          });
        }
      }
      return tx.competency.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          description: input.description === undefined ? undefined : input.description,
          category: input.category === undefined ? undefined : input.category,
          active: input.active ?? undefined,
        },
        include: { behaviors: { orderBy: { sortOrder: 'asc' } } },
      });
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.COMPETENCY_UPDATED,
      entityType: 'competency',
      entityId: id,
      summary: `Updated competency "${competency.name}"`,
    });
    return competency;
  } catch (err) {
    return nameTaken(err, 'competency');
  }
}

/**
 * Competencies are retired, never deleted, once a review question references
 * one — deleting would orphan the question on an answered review. A competency
 * nothing references yet can be removed outright.
 */
export async function retireCompetency(actor: Actor, id: string) {
  requireProgramAdmin(actor);
  const competency = await prisma.competency.findFirst({
    where: { id, orgId: actor.orgId },
    include: { _count: { select: { questions: true, feedbackItems: true, devActions: true } } },
  });
  if (!competency) throw new NotFoundError();

  const referenced =
    competency._count.questions + competency._count.feedbackItems + competency._count.devActions > 0;

  if (referenced) {
    await prisma.competency.update({ where: { id }, data: { active: false } });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.COMPETENCY_UPDATED,
      entityType: 'competency',
      entityId: id,
      summary: `Retired competency "${competency.name}" (kept: referenced by existing records)`,
    });
    return { deleted: false, reason: 'referenced' as const };
  }

  await prisma.competency.delete({ where: { id } });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.COMPETENCY_UPDATED,
    entityType: 'competency',
    entityId: id,
    summary: `Deleted unused competency "${competency.name}"`,
  });
  return { deleted: true, reason: null };
}

// ---------------------------------------------------------------------------
// Competency libraries (the per-role sets)
// ---------------------------------------------------------------------------

export async function listLibraries(actor: Actor) {
  requireProgramAdmin(actor);
  return prisma.competencyLibrary.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: { competency: { select: { id: true, name: true, category: true, active: true } } },
      },
      jobTitles: { select: { id: true, name: true, level: true } },
    },
  });
}

export async function createLibrary(actor: Actor, input: LibraryInput) {
  requireProgramAdmin(actor);
  await assertCompetenciesInOrg(actor, (input.items ?? []).map((i) => i.competencyId));
  try {
    const library = await prisma.$transaction(async (tx) => {
      const created = await tx.competencyLibrary.create({
        data: {
          orgId: actor.orgId,
          name: input.name,
          description: input.description ?? null,
          active: input.active ?? true,
          items: {
            create: (input.items ?? []).map((item, index) => ({
              competencyId: item.competencyId,
              weight: item.weight ?? 1,
              sortOrder: index,
            })),
          },
        },
      });
      if (input.jobTitleIds?.length) {
        await tx.jobTitle.updateMany({
          where: { id: { in: input.jobTitleIds }, orgId: actor.orgId },
          data: { competencyLibraryId: created.id },
        });
      }
      return created;
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.LIBRARY_CREATED,
      entityType: 'competency_library',
      entityId: library.id,
      summary: `Added competency library "${library.name}"`,
    });
    return library;
  } catch (err) {
    return nameTaken(err, 'library');
  }
}

export async function updateLibrary(actor: Actor, id: string, input: LibraryPatch) {
  requireProgramAdmin(actor);
  const existing = await prisma.competencyLibrary.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw new NotFoundError();
  await assertCompetenciesInOrg(actor, (input.items ?? []).map((i) => i.competencyId));

  try {
    const library = await prisma.$transaction(async (tx) => {
      if (input.items) {
        await tx.competencyLibraryItem.deleteMany({ where: { libraryId: id } });
        if (input.items.length) {
          await tx.competencyLibraryItem.createMany({
            data: input.items.map((item, index) => ({
              libraryId: id,
              competencyId: item.competencyId,
              weight: item.weight ?? 1,
              sortOrder: index,
            })),
          });
        }
      }
      if (input.jobTitleIds) {
        // Detach titles no longer listed, attach the ones that are.
        await tx.jobTitle.updateMany({
          where: { orgId: actor.orgId, competencyLibraryId: id, id: { notIn: input.jobTitleIds } },
          data: { competencyLibraryId: null },
        });
        if (input.jobTitleIds.length) {
          await tx.jobTitle.updateMany({
            where: { id: { in: input.jobTitleIds }, orgId: actor.orgId },
            data: { competencyLibraryId: id },
          });
        }
      }
      return tx.competencyLibrary.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          description: input.description === undefined ? undefined : input.description,
          active: input.active ?? undefined,
        },
      });
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.LIBRARY_UPDATED,
      entityType: 'competency_library',
      entityId: id,
      summary: `Updated competency library "${library.name}"`,
    });
    return library;
  } catch (err) {
    return nameTaken(err, 'library');
  }
}

async function assertCompetenciesInOrg(actor: Actor, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = await prisma.competency.count({
    where: { id: { in: unique }, orgId: actor.orgId },
  });
  if (found !== unique.length) {
    throw new ValidationError('One of the competencies selected does not belong to this organization.');
  }
}

// ---------------------------------------------------------------------------
// Rating scales
// ---------------------------------------------------------------------------

export async function listRatingScales(actor: Actor) {
  requireProgramAdmin(actor);
  return prisma.ratingScale.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ archived: 'asc' }, { name: 'asc' }],
    include: {
      levels: { orderBy: { value: 'asc' } },
      _count: { select: { questions: true, surveyQuestions: true } },
    },
  });
}

/**
 * True when a scale is referenced by a question on a template version that has
 * been published. Such a scale is frozen: the words next to a number are part
 * of what the reviewer answered.
 */
export async function scaleIsFrozen(orgId: string, scaleId: string): Promise<boolean> {
  const used = await prisma.templateQuestion.count({
    where: {
      ratingScaleId: scaleId,
      section: { version: { publishedAt: { not: null }, template: { orgId } } },
    },
  });
  if (used > 0) return true;
  return (
    (await prisma.surveyQuestion.count({
      where: { ratingScaleId: scaleId, survey: { orgId, status: { not: 'DRAFT' } } },
    })) > 0
  );
}

export async function createRatingScale(actor: Actor, input: ScaleInput) {
  requireProgramAdmin(actor);
  assertDistinctLevels(input.levels);
  try {
    const scale = await prisma.ratingScale.create({
      data: {
        orgId: actor.orgId,
        name: input.name,
        description: input.description ?? null,
        numeric: input.numeric,
        levels: {
          create: input.levels.map((level, index) => ({
            value: level.value,
            label: level.label,
            description: level.description ?? null,
            sortOrder: index,
          })),
        },
      },
      include: { levels: { orderBy: { value: 'asc' } } },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.SCALE_CREATED,
      entityType: 'rating_scale',
      entityId: scale.id,
      summary: `Added rating scale "${scale.name}" with ${scale.levels.length} levels`,
    });
    return scale;
  } catch (err) {
    return nameTaken(err, 'rating scale');
  }
}

export async function updateRatingScale(actor: Actor, id: string, input: ScalePatch) {
  requireProgramAdmin(actor);
  const existing = await prisma.ratingScale.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw new NotFoundError();

  const changesMeaning =
    input.levels !== undefined || input.numeric !== undefined;

  if (changesMeaning && (await scaleIsFrozen(actor.orgId, id))) {
    throw new ConflictError(
      'This scale is used by a published template or a launched survey, so its levels cannot be changed — ' +
        'the wording beside a number is part of what people answered. Create a new scale instead, or archive ' +
        'this one to stop it being offered for new templates.',
    );
  }

  if (input.levels) assertDistinctLevels(input.levels);

  try {
    const scale = await prisma.$transaction(async (tx) => {
      if (input.levels) {
        await tx.ratingScaleLevel.deleteMany({ where: { scaleId: id } });
        await tx.ratingScaleLevel.createMany({
          data: input.levels.map((level, index) => ({
            scaleId: id,
            value: level.value,
            label: level.label,
            description: level.description ?? null,
            sortOrder: index,
          })),
        });
      }
      return tx.ratingScale.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          description: input.description === undefined ? undefined : input.description,
          numeric: input.numeric ?? undefined,
          archived: input.archived ?? undefined,
        },
        include: { levels: { orderBy: { value: 'asc' } } },
      });
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.SCALE_UPDATED,
      entityType: 'rating_scale',
      entityId: id,
      summary:
        input.archived === true
          ? `Archived rating scale "${scale.name}"`
          : `Updated rating scale "${scale.name}"`,
    });
    return scale;
  } catch (err) {
    return nameTaken(err, 'rating scale');
  }
}

function assertDistinctLevels(levels: { value: number; label: string }[]): void {
  const values = levels.map((l) => l.value);
  if (new Set(values).size !== values.length) {
    throw new ValidationError('Each level needs a different numeric value.', [
      { path: 'levels', message: 'Two levels share the same value.' },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Recognition values
// ---------------------------------------------------------------------------

export async function listRecognitionValues(actor: Actor) {
  requireProgramAdmin(actor);
  return prisma.recognitionValue.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { feedbackItems: true } } },
  });
}

export async function createRecognitionValue(actor: Actor, input: RecognitionInput) {
  requireProgramAdmin(actor);
  try {
    const max = await prisma.recognitionValue.aggregate({
      where: { orgId: actor.orgId },
      _max: { sortOrder: true },
    });
    const value = await prisma.recognitionValue.create({
      data: {
        orgId: actor.orgId,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? 'award',
        colorHex: input.colorHex ?? '#e07a1f',
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? (max._max.sortOrder ?? 0) + 1,
      },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.RECOGNITION_CREATED,
      entityType: 'recognition_value',
      entityId: value.id,
      summary: `Added recognition value "${value.name}"`,
    });
    return value;
  } catch (err) {
    return nameTaken(err, 'recognition value');
  }
}

export async function updateRecognitionValue(actor: Actor, id: string, input: RecognitionPatch) {
  requireProgramAdmin(actor);
  const existing = await prisma.recognitionValue.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw new NotFoundError();
  try {
    const value = await prisma.recognitionValue.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        icon: input.icon ?? undefined,
        colorHex: input.colorHex ?? undefined,
        active: input.active ?? undefined,
        sortOrder: input.sortOrder ?? undefined,
      },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.RECOGNITION_UPDATED,
      entityType: 'recognition_value',
      entityId: id,
      summary: `Updated recognition value "${value.name}"`,
    });
    return value;
  } catch (err) {
    return nameTaken(err, 'recognition value');
  }
}

/**
 * Recognition already given keeps its value, so a value in use is deactivated
 * rather than deleted.
 */
export async function retireRecognitionValue(actor: Actor, id: string) {
  requireProgramAdmin(actor);
  const value = await prisma.recognitionValue.findFirst({
    where: { id, orgId: actor.orgId },
    include: { _count: { select: { feedbackItems: true } } },
  });
  if (!value) throw new NotFoundError();

  if (value._count.feedbackItems > 0) {
    await prisma.recognitionValue.update({ where: { id }, data: { active: false } });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.RECOGNITION_UPDATED,
      entityType: 'recognition_value',
      entityId: id,
      summary: `Deactivated recognition value "${value.name}" (kept: ${value._count.feedbackItems} recognitions reference it)`,
    });
    return { deleted: false, reason: 'referenced' as const };
  }

  await prisma.recognitionValue.delete({ where: { id } });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.RECOGNITION_UPDATED,
    entityType: 'recognition_value',
    entityId: id,
    summary: `Deleted unused recognition value "${value.name}"`,
  });
  return { deleted: true, reason: null };
}

// ---------------------------------------------------------------------------
// Job titles and departments (needed by the library editor)
// ---------------------------------------------------------------------------

export async function listJobTitles(actor: Actor) {
  requireProgramAdmin(actor);
  return prisma.jobTitle.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      department: { select: { id: true, name: true } },
      competencyLibrary: { select: { id: true, name: true } },
      // Active only. A headcount that includes people who have left makes a
      // title look occupied when it is not, and it is the active count that
      // decides whether the title can be archived.
      _count: { select: { employees: { where: { employmentStatus: 'active' } } } },
    },
  });
}

// ---------------------------------------------------------------------------
// Departments and job titles
// ---------------------------------------------------------------------------

/*
 * These two were reachable only through the seed, which meant a real
 * installation could never populate the pickers on an employee record. The
 * consequence was not cosmetic: a job title carries the competency library a
 * review is built from and the salary band a pay recommendation is measured
 * against, and a department scopes reporting and feedback visibility. Without
 * them, three modules quietly have nothing to work with.
 */

export async function listDepartments(actor: Actor) {
  requireProgramAdmin(actor);
  return prisma.department.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      parent: { select: { id: true, name: true } },
      _count: {
        select: {
          employees: { where: { employmentStatus: 'active' } },
          jobTitles: true,
          children: true,
        },
      },
    },
  });
}

export type DepartmentInput = z.infer<typeof DepartmentSchema>;

export async function createDepartment(actor: Actor, input: DepartmentInput) {
  requireProgramAdmin(actor);
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError('A department needs a name.');

  if (input.parentId) await assertDepartmentExists(actor, input.parentId);

  try {
    const department = await prisma.department.create({
      data: {
        orgId: actor.orgId,
        name,
        code: input.code?.trim() || null,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? 0,
        active: input.active ?? true,
      },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.DEPARTMENT_CREATED,
      entityType: 'department',
      entityId: department.id,
      summary: `Added department "${department.name}"`,
    });
    return department;
  } catch (err) {
    return nameTaken(err, 'department');
  }
}

export async function updateDepartment(
  actor: Actor,
  id: string,
  input: Partial<DepartmentInput>,
) {
  requireProgramAdmin(actor);
  const existing = await prisma.department.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw new NotFoundError();

  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === id) {
      throw new ValidationError('A department cannot report to itself.');
    }
    await assertDepartmentExists(actor, input.parentId);
    // Walk up from the proposed parent. If this department is anywhere on
    // that path, the move would create a cycle and the tree would never
    // render again.
    let cursor: string | null = input.parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        throw new ValidationError(
          'That would put the department inside one of its own sub-departments.',
        );
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const parent: { parentId: string | null } | null = await prisma.department.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  // Deactivating a department with people still in it hides a group from
  // every picker while their records still point at it.
  if (input.active === false && existing.active) {
    const people = await prisma.employee.count({
      where: { departmentId: id, employmentStatus: 'active' },
    });
    if (people > 0) {
      throw new ConflictError(
        `${people} active ${people === 1 ? 'person is' : 'people are'} in this department. ` +
          'Move them first, then archive it.',
      );
    }
  }

  try {
    const department = await prisma.department.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.code !== undefined ? { code: input.code?.trim() || null } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.DEPARTMENT_UPDATED,
      entityType: 'department',
      entityId: id,
      summary: `Updated department "${department.name}"`,
    });
    return department;
  } catch (err) {
    return nameTaken(err, 'department');
  }
}

async function assertDepartmentExists(actor: Actor, id: string): Promise<void> {
  const found = await prisma.department.findFirst({
    where: { id, orgId: actor.orgId },
    select: { id: true },
  });
  if (!found) throw new ValidationError('That parent department does not exist.');
}

export type JobTitleInput = z.infer<typeof JobTitleSchema>;

export async function createJobTitle(actor: Actor, input: JobTitleInput) {
  requireProgramAdmin(actor);
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError('A job title needs a name.');

  if (input.departmentId) await assertDepartmentExists(actor, input.departmentId);
  if (input.competencyLibraryId) await assertLibraryExists(actor, input.competencyLibraryId);

  try {
    const jobTitle = await prisma.jobTitle.create({
      data: {
        orgId: actor.orgId,
        name,
        level: input.level?.trim() || null,
        departmentId: input.departmentId ?? null,
        competencyLibraryId: input.competencyLibraryId ?? null,
        active: input.active ?? true,
      },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.JOB_TITLE_CREATED,
      entityType: 'job_title',
      entityId: jobTitle.id,
      summary: `Added job title "${jobTitle.name}"`,
    });
    return jobTitle;
  } catch (err) {
    return nameTaken(err, 'job title');
  }
}

export async function updateJobTitle(actor: Actor, id: string, input: Partial<JobTitleInput>) {
  requireProgramAdmin(actor);
  const existing = await prisma.jobTitle.findFirst({ where: { id, orgId: actor.orgId } });
  if (!existing) throw new NotFoundError();

  if (input.departmentId) await assertDepartmentExists(actor, input.departmentId);
  if (input.competencyLibraryId) await assertLibraryExists(actor, input.competencyLibraryId);

  /*
   * A title is deactivated, never deleted, once anybody holds it. Deleting
   * would take the salary band with it (the band is keyed on the title) and
   * strip the title from every historical employee record — including the
   * snapshots a past review and a past pay decision were made against.
   * Deactivating removes it from the pickers and leaves the record intact.
   */
  if (input.active === false && existing.active) {
    const holders = await prisma.employee.count({
      where: { jobTitleId: id, employmentStatus: 'active' },
    });
    if (holders > 0) {
      throw new ConflictError(
        `${holders} active ${holders === 1 ? 'person holds' : 'people hold'} this title. ` +
          'Move them to another title first, then archive it.',
      );
    }
  }

  try {
    const jobTitle = await prisma.jobTitle.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.level !== undefined ? { level: input.level?.trim() || null } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.competencyLibraryId !== undefined
          ? { competencyLibraryId: input.competencyLibraryId }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.JOB_TITLE_UPDATED,
      entityType: 'job_title',
      entityId: id,
      summary: `Updated job title "${jobTitle.name}"`,
    });
    return jobTitle;
  } catch (err) {
    return nameTaken(err, 'job title');
  }
}

async function assertLibraryExists(actor: Actor, id: string): Promise<void> {
  const found = await prisma.competencyLibrary.findFirst({
    where: { id, orgId: actor.orgId },
    select: { id: true },
  });
  if (!found) throw new ValidationError('That competency library does not exist.');
}
