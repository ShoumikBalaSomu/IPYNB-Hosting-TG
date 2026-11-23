/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: 'var(--tg-theme-bg-color, #ffffff)',
          text: 'var(--tg-theme-text-color, #18181b)',
          secondary: 'var(--tg-theme-secondary-bg-color, #f4f4f5)',
          hint: 'var(--tg-theme-hint-color, #71717a)',
          button: 'var(--tg-theme-button-color, #2563eb)',
          buttonText: 'var(--tg-theme-button-text-color, #ffffff)',
          link: 'var(--tg-theme-link-color, #2563eb)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
