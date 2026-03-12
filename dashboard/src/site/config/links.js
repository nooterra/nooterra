const rawGithubRepo =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_GITHUB_REPO_URL
    ? String(import.meta.env.VITE_GITHUB_REPO_URL).trim()
    : "https://github.com/nooterra/nooterra";

export const ossLinks = {
  repo: rawGithubRepo.replace(/\/+$/, ""),
  issues: `${rawGithubRepo.replace(/\/+$/, "")}/issues`,
  discussions: `${rawGithubRepo.replace(/\/+$/, "")}/discussions`
};

export const docsLinks = {
  home: "/docs",
  quickstart: "/docs/quickstart",
  designPartnerKit: "/docs/partner-kit",
  hostQuickstart: "/docs/launch-hosts",
  claudeDesktopQuickstart: "/docs/claude-desktop",
  openClawQuickstart: "/docs/openclaw",
  codexEngineeringQuickstart: "/docs/codex",
  localEnvironment: "/docs/local-environment",
  architecture: "/docs/architecture",
  api: "/docs/api",
  integrations: "/docs/integrations",
  security: "/docs/security",
  ops: "/docs/ops",
  launchChecklist: "/docs/launch-checklist",
  incidents: "/docs/incidents",
  roadmap: "/docs",
  faq: "/docs"
};
