import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Legacy (keep for backward compatibility while we migrate)
        cream: '#FAF6FF',
        charcoal: '#0F0A1F',
        accent: '#FF5E94',
        'accent-light': '#FFB4D1',
        muted: '#6B6480',

        // New vibrant party-room palette
        canvas: '#FAF6FF',           // soft lavender white background
        ink: '#0F0A1F',              // deep purple-black for text
        'ink-soft': '#3A2F55',       // softer ink for secondary text
        pink: {
          DEFAULT: '#FF5E94',
          light: '#FFB4D1',
          glow: '#FF8FB8',
        },
        coral: {
          DEFAULT: '#FF8A65',
          light: '#FFC4AC',
        },
        lavender: {
          DEFAULT: '#B084FF',
          light: '#D9C5FF',
          deep: '#7C5BE0',
        },
        sky: {
          DEFAULT: '#5BD8E5',
          light: '#B0EDF3',
        },
        lime: {
          DEFAULT: '#D6FF6B',
          light: '#EAFFAB',
        },
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
        '5xl': '40px',
        pill: '9999px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        display: ['clamp(2.75rem, 7.5vw, 7rem)', { lineHeight: '0.95', fontWeight: '700', letterSpacing: '-0.03em' }],
        heading: ['clamp(2rem, 4.5vw, 4rem)', { lineHeight: '1.05', fontWeight: '700', letterSpacing: '-0.02em' }],
        subheading: ['clamp(1.25rem, 2vw, 1.75rem)', { lineHeight: '1.3', fontWeight: '600' }],
      },
      maxWidth: {
        content: '1400px',
      },
      spacing: {
        section: '96px',
        'section-sm': '56px',
      },
      backgroundImage: {
        'gradient-pink': 'linear-gradient(135deg, #FF5E94 0%, #B084FF 100%)',
        'gradient-warm': 'linear-gradient(135deg, #FF8A65 0%, #FF5E94 100%)',
        'gradient-cool': 'linear-gradient(135deg, #5BD8E5 0%, #B084FF 100%)',
        'gradient-sunset': 'linear-gradient(135deg, #FFB4D1 0%, #FF8A65 50%, #B084FF 100%)',
        'gradient-canvas': 'radial-gradient(ellipse at top left, #F5E8FF 0%, #FAF6FF 40%, #FFE9F2 100%)',
        'glass-shine': 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.15) 100%)',
      },
      boxShadow: {
        glow: '0 10px 40px -10px rgba(255, 94, 148, 0.5)',
        'glow-purple': '0 10px 40px -10px rgba(176, 132, 255, 0.5)',
        'glow-soft': '0 20px 60px -20px rgba(176, 132, 255, 0.3)',
        glass: '0 8px 32px 0 rgba(31, 14, 70, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.6)',
        'glass-lg': '0 20px 60px -10px rgba(31, 14, 70, 0.12), inset 0 1px 0 0 rgba(255, 255, 255, 0.7)',
      },
      animation: {
        marquee: 'marquee 30s linear infinite',
        'float-slow': 'float 14s ease-in-out infinite',
        'float-medium': 'float 10s ease-in-out infinite',
        'float-fast': 'float 7s ease-in-out infinite',
        'spin-slow': 'spin 24s linear infinite',
        'pulse-glow': 'pulseGlow 4s ease-in-out infinite',
        shimmer: 'shimmer 3s linear infinite',
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        float: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(30px, -40px) scale(1.05)' },
          '66%': { transform: 'translate(-20px, 30px) scale(0.95)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
