/**
 * mBHR clinical design system — Tailwind theme.
 *
 * Colour is reserved for meaning. Surfaces, borders and typography carry the
 * hierarchy; semantic colours (info / success / warning / danger / critical)
 * carry clinical and operational state. Stage colours identify where a
 * patient is in the registration → vitals → consult → pharmacy flow.
 *
 * Each semantic colour exposes:
 *   DEFAULT  solid fill / icon colour
 *   fg       text on the soft background (AA contrast on `soft`)
 *   soft     tinted background for badges, banners, highlighted rows
 *   line     border that pairs with `soft`
 *
 * The same values are mirrored as CSS custom properties in src/index.css.
 */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0A7A3B",
          hover: "#086631",
          active: "#065227",
          soft: "#EAF4EE",
          line: "#B9DCC7",
          fg: "#075A2B",
        },
        accent: "#FFD700",

        // Surfaces: page canvas → content surface → sunken wells
        background: "#F4F5F3",
        canvas: "#F4F5F3",
        surface: {
          DEFAULT: "#FFFFFF",
          sunken: "#F8F9F7",
          hover: "#F1F3F0",
        },

        // Staff navigation rail (dark brand green). Text colours keep
        // ≥4.5:1 contrast on the rail background.
        rail: {
          DEFAULT: "#0F3D2E",
          hover: "#16503D",
          active: "#1E644C",
          line: "#245A47",
          text: "#E3EFE8",
          muted: "#9CC0AF",
        },

        // Borders
        line: {
          DEFAULT: "#E2E5E0",
          strong: "#C8CDC5",
        },

        // Text
        text: "#1B211D",
        ink: {
          DEFAULT: "#1B211D",
          secondary: "#474F4A",
          muted: "#636C66",
          disabled: "#9AA29C",
        },

        // Semantic state
        info: {
          DEFAULT: "#1D5FBF",
          fg: "#174C99",
          soft: "#EBF2FB",
          line: "#BDD2EF",
        },
        success: {
          DEFAULT: "#15803D",
          fg: "#0F5A30",
          soft: "#E9F5EC",
          line: "#B7DDC2",
        },
        warning: {
          DEFAULT: "#B45309",
          fg: "#8A3F06",
          soft: "#FDF4E6",
          line: "#F0D2A4",
        },
        danger: {
          DEFAULT: "#C0262D",
          fg: "#9B1C22",
          soft: "#FCECEC",
          line: "#F1BEC0",
        },
        critical: {
          DEFAULT: "#8E1016",
          fg: "#FFFFFF",
          soft: "#F9E1E2",
          line: "#E4A5A8",
        },

        // Patient-flow stages
        stage: {
          registration: "#1E40AF",
          "registration-soft": "#EFF4FF",
          "registration-line": "#C3D3F5",
          vitals: "#166534",
          "vitals-soft": "#EEF8F1",
          "vitals-line": "#BFE1CB",
          consult: "#6B21A8",
          "consult-soft": "#F6F0FC",
          "consult-line": "#DCC8F0",
          pharmacy: "#9A3412",
          "pharmacy-soft": "#FDF3EC",
          "pharmacy-line": "#F2CFB6",
        },
      },

      // Type scale. Sizes outside this set should be rare.
      fontSize: {
        caption: ["0.75rem", { lineHeight: "1rem" }],
        label: ["0.8125rem", { lineHeight: "1.125rem", fontWeight: "500" }],
        body: ["0.9375rem", { lineHeight: "1.375rem" }],
        h3: ["1rem", { lineHeight: "1.5rem", fontWeight: "600" }],
        h2: ["1.125rem", { lineHeight: "1.625rem", fontWeight: "600" }],
        h1: ["1.5rem", { lineHeight: "2rem", fontWeight: "600" }],
        display: ["2rem", { lineHeight: "2.5rem", fontWeight: "600" }],
        stat: ["1.75rem", { lineHeight: "2.25rem", fontWeight: "600" }],
        lg: "1.125rem",
        xl: "1.25rem",
      },

      // Radius scale: controls are 6px, containers 8px, overlays at most 12px.
      borderRadius: {
        DEFAULT: "0.375rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.625rem",
        "2xl": "0.75rem",
        "3xl": "0.75rem",
      },

      // Elevation. Content surfaces use borders, not shadows; the larger
      // shadows are for things that actually float (menus, dialogs, drawers).
      boxShadow: {
        sm: "0 1px 2px 0 rgb(16 24 20 / 0.05)",
        DEFAULT: "0 1px 2px 0 rgb(16 24 20 / 0.06)",
        md: "0 1px 3px 0 rgb(16 24 20 / 0.07)",
        lg: "0 4px 12px -2px rgb(16 24 20 / 0.10)",
        xl: "0 8px 24px -4px rgb(16 24 20 / 0.14)",
        "2xl": "0 16px 40px -8px rgb(16 24 20 / 0.20)",
        focus: "0 0 0 3px rgb(10 122 59 / 0.30)",
      },

      minHeight: {
        "touch-target": "44px",
        control: "2.75rem",
      },
      minWidth: {
        "touch-target": "44px",
      },
      height: {
        control: "2.75rem",
      },
      spacing: {
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
        "safe-left": "env(safe-area-inset-left)",
        "safe-right": "env(safe-area-inset-right)",
      },
      screens: {
        xs: "375px",
        touch: { raw: "(hover: none) and (pointer: coarse)" },
      },
      animation: {
        "slide-up": "slideUp 0.2s ease-out",
        "slide-down": "slideDown 0.2s ease-out",
        "fade-in": "fadeIn 0.15s ease-out",
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        slideDown: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
