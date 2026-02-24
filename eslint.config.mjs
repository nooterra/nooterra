import globals from "globals";

const bugBaselineRules = {
  "constructor-super": "warn",
  "for-direction": "warn",
  "getter-return": "warn",
  "no-async-promise-executor": "warn",
  "no-compare-neg-zero": "warn",
  "no-const-assign": "warn",
  "no-constant-binary-expression": "warn",
  "no-constant-condition": "warn",
  "no-control-regex": "warn",
  "no-debugger": "warn",
  "no-dupe-args": "warn",
  "no-dupe-keys": "warn",
  "no-duplicate-case": "warn",
  "no-func-assign": "warn",
  "no-import-assign": "warn",
  "no-invalid-regexp": "warn",
  "no-irregular-whitespace": "warn",
  "no-loss-of-precision": "warn",
  "no-obj-calls": "warn",
  "no-self-assign": "warn",
  "no-setter-return": "warn",
  "no-sparse-arrays": "warn",
  "no-this-before-super": "warn",
  "no-undef": "warn",
  "no-unexpected-multiline": "warn",
  "no-unreachable": "warn",
  "no-unsafe-finally": "warn",
  "no-unsafe-negation": "warn",
  "no-unsafe-optional-chaining": "warn",
  "no-unused-private-class-members": "warn",
  "no-useless-backreference": "warn",
  "require-yield": "warn",
  "use-isnan": "warn",
  "valid-typeof": "warn"
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      ".vercel-venv/**",
      ".venv/**",
      ".python/**",
      "dashboard/dist/**",
      "mkdocs/site/**",
      "coverage/**",
      "artifacts/**",
      ".cache/**",
      ".git/**"
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2024
      }
    },
    rules: { ...bugBaselineRules }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs"
    }
  },
  {
    files: ["scripts/load/*.k6.js"],
    languageOptions: {
      globals: {
        __ENV: "readonly"
      }
    }
  }
];
