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
  hostQuickstart: `${repoBlobUrl}/docs/QUICKSTART_MCP_HOSTS.md`,
  claudeDesktopQuickstart: `${repoBlobUrl}/docs/integrations/claude-desktop/PUBLIC_QUICKSTART.md`,
  openClawQuickstart: `${repoBlobUrl}/docs/integrations/openclaw/PUBLIC_QUICKSTART.md`,
  codexEngineeringQuickstart: `${repoBlobUrl}/docs/integrations/codex/ENGINEERING_QUICKSTART.md`,
  localEnvironment: `${docsBaseUrl}/guides/local-environment/`,
  architecture: `${docsBaseUrl}/architecture/control-plane/`,
  api: `${docsBaseUrl}/reference/api-surface/`,
  integrations: `${docsBaseUrl}/reference/integrations/`,
  security: `${docsBaseUrl}/reference/security-model/`,
  ops: `${docsBaseUrl}/runbooks/operations/`,
  incidents: `${docsBaseUrl}/runbooks/incidents/`,
  roadmap: `${docsBaseUrl}/roadmap/`,
  faq: `${docsBaseUrl}/faq/`
};
