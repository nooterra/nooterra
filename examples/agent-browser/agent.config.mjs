import { defineAgent } from "@nooterra/agent-sdk";
import { chromium } from "playwright";

// Browser instance (reused across requests)
let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

async function scrapeUrl(url, options = {}) {
  const { selector, waitFor, screenshot, fullPage } = options;
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "NooterraBot/1.0 (+https://nooterra.ai/bot)",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
    }

    // Get page content
    const title = await page.title();
    const content = selector
      ? await page.locator(selector).allTextContents()
      : await page.locator("body").innerText();

    // Optional screenshot
    let screenshotBase64 = null;
    if (screenshot) {
      const buffer = await page.screenshot({ fullPage: fullPage ?? false });
      screenshotBase64 = buffer.toString("base64");
    }

    return {
      url,
      title,
      content: Array.isArray(content) ? content.join("\n") : content,
      screenshot: screenshotBase64,
    };
  } finally {
    await context.close();
  }
}

async function extractLinks(url, options = {}) {
  const { selector, limit } = options;
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "NooterraBot/1.0 (+https://nooterra.ai/bot)",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    const linkSelector = selector || "a[href]";
    const links = await page.locator(linkSelector).evaluateAll((anchors) =>
      anchors.map((a) => ({
        href: a.href,
        text: a.textContent?.trim() || "",
      }))
    );

    const filteredLinks = links
      .filter((l) => l.href && l.href.startsWith("http"))
      .slice(0, limit || 50);

    return { url, links: filteredLinks, count: filteredLinks.length };
  } finally {
    await context.close();
  }
}

async function fillForm(url, formData, options = {}) {
  const { submitSelector, waitForNavigation } = options;
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: "NooterraBot/1.0 (+https://nooterra.ai/bot)",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Fill each field
    for (const [selector, value] of Object.entries(formData)) {
      await page.locator(selector).fill(String(value));
    }

    // Submit if selector provided
    if (submitSelector) {
      if (waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ timeout: 30000 }),
          page.locator(submitSelector).click(),
        ]);
      } else {
        await page.locator(submitSelector).click();
        await page.waitForTimeout(2000);
      }
    }

    const resultUrl = page.url();
    const title = await page.title();
    const content = await page.locator("body").innerText();

    return {
      success: true,
      originalUrl: url,
      resultUrl,
      title,
      content: content.slice(0, 5000), // Truncate to avoid huge payloads
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      originalUrl: url,
    };
  } finally {
    await context.close();
  }
}

export default defineAgent({
  did: process.env.AGENT_DID || "did:noot:genesis-browser",
  registryUrl: process.env.REGISTRY_URL || "https://api.nooterra.ai",
  coordinatorUrl: process.env.COORDINATOR_URL || "https://coord.nooterra.ai",
  endpoint: process.env.AGENT_ENDPOINT || "http://localhost:3001",
  privateKey: process.env.PRIVATE_KEY || "",
  publicKey: process.env.PUBLIC_KEY || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "change-me",
  port: Number(process.env.PORT || 3001),
  hooks: {
    onDispatch: (d) => console.log("[browser] dispatch", d.capabilityId, d.workflowId),
    onResult: (r) => console.log("[browser] result", r.capabilityId),
    onError: (e) => console.warn("[browser] error", e.capabilityId, e.error?.message),
    onHeartbeat: (h) => {
      if (!h.ok) console.warn("[browser] heartbeat failed", h.error);
    },
  },
  capabilities: [
    {
      id: "cap.browser.scrape.v1",
      description: "Scrape a webpage and extract text content. Supports CSS selectors, optional screenshots.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
          selector: { type: "string", description: "CSS selector to extract (default: body)" },
          waitFor: { type: "string", description: "CSS selector to wait for before scraping" },
          screenshot: { type: "boolean", description: "Include base64 screenshot" },
          fullPage: { type: "boolean", description: "Full page screenshot" },
        },
        required: ["url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          screenshot: { type: "string" },
        },
      },
      handler: async ({ inputs }) => {
        const start = Date.now();
        const result = await scrapeUrl(inputs.url, {
          selector: inputs.selector,
          waitFor: inputs.waitFor,
          screenshot: inputs.screenshot,
          fullPage: inputs.fullPage,
        });
        return {
          result,
          metrics: { latency_ms: Date.now() - start },
        };
      },
    },
    {
      id: "cap.browser.links.v1",
      description: "Extract all links from a webpage",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to extract links from" },
          selector: { type: "string", description: "CSS selector for link elements" },
          limit: { type: "number", description: "Maximum links to return (default: 50)" },
        },
        required: ["url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          links: {
            type: "array",
            items: {
              type: "object",
              properties: {
                href: { type: "string" },
                text: { type: "string" },
              },
            },
          },
          count: { type: "number" },
        },
      },
      handler: async ({ inputs }) => {
        const start = Date.now();
        const result = await extractLinks(inputs.url, {
          selector: inputs.selector,
          limit: inputs.limit,
        });
        return {
          result,
          metrics: { latency_ms: Date.now() - start },
        };
      },
    },
    {
      id: "cap.browser.form.v1",
      description: "Fill and submit a web form",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL of the form page" },
          formData: {
            type: "object",
            description: "Map of CSS selector → value to fill",
          },
          submitSelector: { type: "string", description: "CSS selector for submit button" },
          waitForNavigation: { type: "boolean", description: "Wait for page navigation after submit" },
        },
        required: ["url", "formData"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          originalUrl: { type: "string" },
          resultUrl: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          error: { type: "string" },
        },
      },
      handler: async ({ inputs }) => {
        const start = Date.now();
        const result = await fillForm(inputs.url, inputs.formData, {
          submitSelector: inputs.submitSelector,
          waitForNavigation: inputs.waitForNavigation,
        });
        return {
          result,
          metrics: { latency_ms: Date.now() - start },
        };
      },
    },
    {
      id: "cap.browser.screenshot.v1",
      description: "Take a screenshot of a webpage",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to screenshot" },
          fullPage: { type: "boolean", description: "Capture full scrollable page" },
          waitFor: { type: "string", description: "CSS selector to wait for before screenshot" },
        },
        required: ["url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          screenshot: { type: "string", description: "Base64-encoded PNG" },
        },
      },
      handler: async ({ inputs }) => {
        const start = Date.now();
        const result = await scrapeUrl(inputs.url, {
          screenshot: true,
          fullPage: inputs.fullPage ?? true,
          waitFor: inputs.waitFor,
        });
        return {
          result: {
            url: result.url,
            screenshot: result.screenshot,
          },
          metrics: { latency_ms: Date.now() - start },
        };
      },
    },
  ],
});

// Cleanup on shutdown
process.on("SIGTERM", async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
