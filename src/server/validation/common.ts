import { z } from 'zod';

/** Primitives reused across the API contracts. */

export const Id = z.string().min(1).max(64);
export const OptionalId = Id.nullable().optional();
export const ShortText = z.string().trim().max(500);
export const LongText = z.string().trim().max(20000);
export const IsoDate = z.string().trim().max(40).nullable().optional();
export const Pct = z.number().min(0).max(100);
