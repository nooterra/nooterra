export const AI_PROVIDERS = [
  { key: "openai", name: "OpenAI", description: "GPT-4o, GPT-4 Turbo, GPT-4o mini", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "sk-...", validateEndpoint: "/v1/providers/openai/validate" },
  { key: "anthropic", name: "Anthropic", description: "Claude Opus, Sonnet, Haiku", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "sk-ant-...", validateEndpoint: "/v1/providers/anthropic/validate" },
];

export const AVAILABLE_INTEGRATIONS = [
  { key: "gmail", name: "Gmail", description: "Read and send emails", authType: "oauth", oauthUrl: "/v1/integrations/gmail/authorize" },
  { key: "slack", name: "Slack", description: "Send messages and get approvals", authType: "webhook", fieldLabel: "Webhook URL", fieldPlaceholder: "https://hooks.slack.com/services/..." },
  { key: "github", name: "GitHub", description: "Repos, issues, PRs", authType: "oauth", oauthUrl: "/v1/integrations/github/authorize" },
  { key: "google_calendar", name: "Google Calendar", description: "Schedule and manage events", authType: "oauth", oauthUrl: "/v1/integrations/google-calendar/authorize" },
  { key: "stripe", name: "Stripe", description: "Payment and billing data", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "sk_live_..." },
  { key: "notion", name: "Notion", description: "Notes and databases", authType: "oauth", oauthUrl: "/v1/integrations/notion/authorize" },
  { key: "linear", name: "Linear", description: "Issue tracking", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "lin_api_..." },
  { key: "custom_webhook", name: "Custom Webhook", description: "Any HTTP endpoint", authType: "webhook", fieldLabel: "URL", fieldPlaceholder: "https://example.com/webhook", hasSecret: true },
];
