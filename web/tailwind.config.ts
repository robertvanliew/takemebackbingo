import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // paper + ink — the magazine substrate
        paper: {
          DEFAULT: "#F1E7D0",  // cream stock
          warm:    "#EADFC4",
          deep:    "#D8C9A6",
        },
        ink: {
          DEFAULT: "#0E0B0B",  // press black
          soft:    "#1E1818",
          mute:    "rgba(14,11,11,0.62)",
          faint:   "rgba(14,11,11,0.38)",
        },
        // hits — color used like a highlighter, not a wash
        tape:     "#EFC53A",   // brand yellow
        tapeHot:  "#FFD84D",
        acid:     "#E0341C",   // Vibe-mag red
        bruise:   "#5B1F6B",   // deeper plum, evolves the old purple
        ivy:      "#1F3D2B",   // editorial deep green for variety
      },
      fontFamily: {
        // display: condensed sans for cover-blast headlines
        display: ['"Anton"', '"Oswald"', "Impact", "sans-serif"],
        // serif: feature-article body, drop caps, pull quotes
        serif:   ['"Fraunces"', '"Newsreader"', "Georgia", "serif"],
        // body: clean, sturdy paragraph type
        body:    ['"Newsreader"', "Georgia", "serif"],
        // utility: small-caps captions, navigation, byline labels
        mono:    ['"JetBrains Mono"', "ui-monospace", "monospace"],
        // sticker / handwritten one-offs
        marker:  ['"Permanent Marker"', "cursive"],
      },
      letterSpacing: {
        masthead: "-0.04em",
        cover:    "-0.02em",
        caption:  "0.18em",
      },
      boxShadow: {
        cutout: "6px 6px 0 #0E0B0B",
        cutoutSm: "3px 3px 0 #0E0B0B",
        press: "inset 0 0 0 1.5px #0E0B0B",
      },
      backgroundImage: {
        halftone:
          "radial-gradient(circle, rgba(14,11,11,0.55) 1px, transparent 1.2px)",
        scanlines:
          "repeating-linear-gradient(0deg, rgba(14,11,11,0.06) 0 1px, transparent 1px 3px)",
      },
      backgroundSize: {
        halftone: "6px 6px",
      },
      animation: {
        marquee: "marquee 28s linear infinite",
        slowSpin: "spin 18s linear infinite",
        flicker: "flicker 2.6s steps(2, end) infinite",
      },
      keyframes: {
        marquee: {
          "0%":   { transform: "translate3d(0,0,0)" },
          "100%": { transform: "translate3d(-50%,0,0)" },
        },
        flicker: {
          "0%, 92%, 100%": { opacity: "1" },
          "94%": { opacity: "0.55" },
          "96%": { opacity: "1" },
          "98%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
