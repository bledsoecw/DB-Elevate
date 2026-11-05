import type { Metadata, Viewport } from 'next';
import './fonts.css';
import './globals.css';
import { ToastProvider } from '@/components/ui/toast';
import { getPublicBranding, brandingCss } from '@/server/services/branding';

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getPublicBranding();
  return {
    title: {
      default: `${branding.productName} — ${branding.orgName}`,
      template: `%s · ${branding.productName}`,
    },
    description: `Performance management for ${branding.orgName}: reviews, goals, feedback, one-on-ones and engagement surveys.`,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a4789',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await getPublicBranding();
  return (
    <html lang="en">
      <head>
        {/* Brand colours resolved at request time from Administration -> Branding. */}
        <style dangerouslySetInnerHTML={{ __html: brandingCss(branding) }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
