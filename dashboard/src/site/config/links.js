const rawDocsBase =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_DOCS_BASE_URL
    ? String(import.meta.env.VITE_DOCS_BASE_URL).trim()
    : "https://docs.nooterra.work";

export const docsBaseUrl = rawDocsBase.replace(/\/+$/, "");
const rawGithubRepo =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_GITHUB_REPO_URL
    ? String(import.meta.env.VITE_GITHUB_REPO_URL).trim()
    : "https://github.com/nooterra/nooterra";

export const ossLinks = {
  repo: rawGithubRepo.replace(/\/+$/, ""),
  issues: `${rawGithubRepo.replace(/\/+$/, "")}/issues`,
  discussions: `${rawGithubRepo.replace(/\/+$/, "")}/discussions`
};

const repoBlobUrl = `${ossLinks.repo}/blob/main`;

export const docsLinks = {
  home: `${docsBaseUrl}/`,
  quickstart: `${docsBaseUrl}/guides/quickstart/`,
  designPartnerKit: `${docsBaseUrl}/guides/design-partner-onboarding-kit/`,
  hostQuickstart: `${docsBaseUrl}/guides/launch-host-channels/`,
  claudeDesktopQuickstart: `${docsBaseUrl}/guides/claude-desktop-quickstart/`,
  openClawQuickstart: `${docsBaseUrl}/guides/openclaw-quickstart/`,
  codexEngineeringQuickstart: `${docsBaseUrl}/guides/codex-engineering-quickstart/`,
  localEnvironment: `${docsBaseUrl}/guides/local-environment/`,
  architecture: `${docsBaseUrl}/architecture/control-plane/`,
  api: `${docsBaseUrl}/reference/api-surface/`,
  integrations: `${docsBaseUrl}/reference/integrations/`,
  security: `${docsBaseUrl}/reference/security-model/`,
  ops: `${docsBaseUrl}/runbooks/operations/`,
  launchChecklist: `${docsBaseUrl}/runbooks/launch-checklist/`,
  incidents: `${docsBaseUrl}/runbooks/incidents/`,
  roadmap: `${docsBaseUrl}/roadmap/`,
  faq: `${docsBaseUrl}/faq/`
};
