import type { Config } from 'tailwindcss';

/**
 * Theme tokens resolve to CSS variables so the running organization's brand
 * colors (Admin -> Branding) can override them at runtime without a rebuild.
 * See src/app/globals.css for the default palette.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        accent: {
          50: 'rgb(var(--accent-50) / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
        },
        /*
         * Tailwind's `slate` is deliberately REPLACED rather than extended.
         *
         * The interface refers to slate in several hundred places. Rather than
         * rewrite every one, the ramp itself is remapped to the warm stone
         * neutrals the DB Portal uses, so the whole application shifts from
         * cool grey to warm in one move and stays consistent by construction.
         * The values are the portal's own where it defines them.
         *
         * Consequence worth knowing: `slate` here is NOT Tailwind's slate. A
         * contributor expecting the stock cool grey will get warm stone, which
         * is the point, but it is a surprise if you do not know.
         */
        slate: {
          50: '#faf8f4',
          100: '#f0ede6',
          200: '#e2ddd2',
          300: '#d4cdc0',
          400: '#a49d8f',
          500: '#8d8678',
          600: '#6f6a5f',
          700: '#534f47',
          800: '#2b3033',
          900: '#1a1e21',
          950: '#0e1113',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        head: ['var(--font-head)', 'var(--font-sans)', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.08)',
        pop: '0 12px 32px -8px rgb(16 24 40 / 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
