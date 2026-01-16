export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'novus-black': '#000000',
        'novus-white': '#FFFFFF',
        'novus-bg': '#F5F5F5',
        'novus-panel': '#FFFFFF',
        'novus-border': '#E0E0E0',
        'novus-accent': '#000000',
        'novus-red': '#ff0000',
        'novus-blue': '#0088ff',
        'novus-green': '#00ff00',
      },
      fontFamily: {
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace'],
        sans: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
