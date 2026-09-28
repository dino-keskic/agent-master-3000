/** @type {import('tailwindcss').Config} */

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

/**
 * A palette family whose every shade resolves through a CSS variable.
 *
 * `<alpha-value>` is the placeholder Tailwind substitutes when a class carries
 * an opacity modifier, which is why the variables hold bare `R G B` triplets:
 * it keeps `bg-slate-900/40` working after the swap. See `src/theme.css` for
 * the values each scheme puts behind them.
 */
const themed = (family) =>
  Object.fromEntries(
    SHADES.map((shade) => [shade, `rgb(var(--c-${family}-${shade}) / <alpha-value>)`])
  );

const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-mantine-color-scheme="dark"]'],
  theme: {
    extend: {
      colors: {
        slate: themed('slate'),
        teal: themed('teal'),
        emerald: themed('emerald'),
        amber: themed('amber'),
        rose: themed('rose'),
        red: themed('red'),
        violet: themed('violet'),
        sky: themed('sky'),
        cyan: themed('cyan'),
        blue: themed('blue'),

        // Semantic names for surfaces written against the token layer directly,
        // rather than borrowing a slate shade for its side effects.
        canvas: token('canvas'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        'ink-3': token('ink-3'),
        'ink-4': token('ink-4'),
        accent: token('accent'),
        add: token('add'),
        del: token('del'),

        // Roles the design defines as a finished colour per scheme — a wash in
        // the dark, a flat tint on paper. They carry their own alpha, so these
        // deliberately skip `<alpha-value>`: never append an opacity modifier.
        s3: 'var(--s3)',
        s3h: 'var(--s3h)',
        s4: 'var(--s4)',
        code: 'var(--code)',
        hairline: 'var(--hairline)',
        dash: 'var(--dash)',
        scrim: 'var(--scrim)',
        'acc-tile': 'var(--acc-tile)',
        'acc-bg': 'var(--acc-bg)',
        'acc-fg': 'var(--acc-fg)',
        'acc-bd': 'var(--acc-bd)',
        run: 'var(--run)',
        'run-bg': 'var(--run-bg)',
        'run-fg': 'var(--run-fg)',
        'run-bd': 'var(--run-bd)',
        wait: 'var(--wait)',
        'wait-bg': 'var(--wait-bg)',
        'wait-fg': 'var(--wait-fg)',
        'wait-bd': 'var(--wait-bd)',
        'wait-ink': 'var(--wait-ink)',
        err: 'var(--err)',
        'err-bg': 'var(--err-bg)',
        'err-fg': 'var(--err-fg)',
        'err-bd': 'var(--err-bd)',
        ok: 'var(--ok)'
      },
      boxShadow: {
        card: 'var(--card-sh)',
        panel: 'var(--panel-sh)'
      },
      backdropBlur: {
        panel: '8px'
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Menlo',
          'Consolas',
          'monospace'
        ]
      },
      fontSize: {
        // The transcript reads at `log`; `log-sm` is its labels and gutters,
        // `log-ui` the tool-call chrome, `log-code` the tool and code panes.
        meta: ['10px', { lineHeight: '1.4' }],
        'log-sm': ['11px', { lineHeight: '1.45' }],
        'log-ui': ['12px', { lineHeight: '1.45' }],
        log: ['13px', { lineHeight: '1.6' }],
        'log-code': ['12px', { lineHeight: '1.55' }]
      }
    }
  },
  plugins: []
};
