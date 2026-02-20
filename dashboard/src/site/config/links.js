const rawDocsBase =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_DOCS_BASE_URL
    ? String(import.meta.env.VITE_DOCS_BASE_URL).trim()
    : "https://docs.settld.work";

export const docsBaseUrl = rawDocsBase.replace(/\/+$/, "");
const rawGithubRepo =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_GITHUB_REPO_URL
    ? String(import.meta.env.VITE_GITHUB_REPO_URL).trim()
    : "https://github.com/aidenlippert/settld";

export const ossLinks = {
  repo: rawGithubRepo.replace(/\/+$/, ""),
  issues: `${rawGithubRepo.replace(/\/+$/, "")}/issues`,
  discussions: `${rawGithubRepo.replace(/\/+$/, "")}/discussions`
};

export const docsLinks = {
  home: `${docsBaseUrl}/`,
  quickstart: `${docsBaseUrl}/getting-started/quickstart/`,
  localEnvironment: `${docsBaseUrl}/getting-started/local-environment/`,
  architecture: `${docsBaseUrl}/architecture/control-plane/`,
  api: `${docsBaseUrl}/reference/api-surface/`,
  integrations: `${docsBaseUrl}/reference/integrations/`,
  security: `${docsBaseUrl}/reference/security-model/`,
  ops: `${docsBaseUrl}/runbooks/operations/`,
  incidents: `${docsBaseUrl}/runbooks/incidents/`,
  roadmap: `${docsBaseUrl}/roadmap/`,
  faq: `${docsBaseUrl}/faq/`
};
