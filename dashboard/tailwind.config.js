/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        settld: {
          dark: "#111a23",
          card: "#172430",
          border: "#2b4050",
          accent: "#cb7a5f",
          success: "#4fa784",
          warning: "#d6a253",
          error: "#d16557"
        }
      }
    }
  },
  plugins: []
};
