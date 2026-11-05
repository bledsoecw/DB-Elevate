import 'server-only';
import { prisma } from '../db';
import { hexToRgbTriplet, mixWithBlack, mixWithWhite } from '@/lib/utils';

/**
 * Branding.
 *
 * Two hex values from Administration -> Branding are expanded into a full
 * colour ramp and emitted as CSS variables, so re-branding needs no rebuild and
 * no asset drop. If no logo has been uploaded the wordmark falls back to text,
 * which is why a fresh installation still looks finished.
 */

export interface Branding {
  orgId: string | null;
  orgName: string;
  productName: string;
  logoUrl: string | null;
  wordmarkText: string;
  brandPrimaryHex: string;
  brandAccentHex: string;
}

export const FALLBACK_BRANDING: Branding = {
  orgId: null,
  orgName: 'Your company',
  productName: 'DB Elevate',
  logoUrl: null,
  wordmarkText: 'DB Elevate',
  brandPrimaryHex: '#1d4e89',
  brandAccentHex: '#e07a1f',
};

/**
 * Branding for the sign-in page, where there is no session yet. This exposes
 * only the company name and colours — the same things a visitor would see on
 * the company website — and never any employee data.
 */
export async function getPublicBranding(): Promise<Branding> {
  try {
    const org = await prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        productName: true,
        logoUrl: true,
        wordmarkText: true,
        brandPrimaryHex: true,
        brandAccentHex: true,
      },
    });
    if (!org) return FALLBACK_BRANDING;
    return {
      orgId: org.id,
      orgName: org.name,
      productName: org.productName,
      logoUrl: org.logoUrl,
      wordmarkText: org.wordmarkText || org.productName,
      brandPrimaryHex: org.brandPrimaryHex,
      brandAccentHex: org.brandAccentHex,
    };
  } catch {
    // Before the first migration runs there is no table to read.
    return FALLBACK_BRANDING;
  }
}

/** Builds the `:root` overrides for the configured brand colours. */
export function brandingCss(branding: Pick<Branding, 'brandPrimaryHex' | 'brandAccentHex'>): string {
  const lines: string[] = [];
  const primary = branding.brandPrimaryHex;
  const accent = branding.brandAccentHex;

  const push = (name: string, value: string | null) => {
    if (value) lines.push(`${name}:${value};`);
  };

  if (hexToRgbTriplet(primary)) {
    push('--brand-50', mixWithWhite(primary, 0.93));
    push('--brand-100', mixWithWhite(primary, 0.84));
    push('--brand-200', mixWithWhite(primary, 0.68));
    push('--brand-300', mixWithWhite(primary, 0.48));
    push('--brand-400', mixWithWhite(primary, 0.26));
    push('--brand-500', mixWithWhite(primary, 0.1));
    push('--brand-600', hexToRgbTriplet(primary));
    push('--brand-700', mixWithBlack(primary, 0.18));
    push('--brand-800', mixWithBlack(primary, 0.36));
    push('--brand-900', mixWithBlack(primary, 0.54));
  }
  if (hexToRgbTriplet(accent)) {
    push('--accent-50', mixWithWhite(accent, 0.92));
    push('--accent-100', mixWithWhite(accent, 0.82));
    push('--accent-400', mixWithWhite(accent, 0.2));
    push('--accent-500', mixWithWhite(accent, 0.08));
    push('--accent-600', hexToRgbTriplet(accent));
    push('--accent-700', mixWithBlack(accent, 0.2));
  }

  return `:root{${lines.join('')}}`;
}
