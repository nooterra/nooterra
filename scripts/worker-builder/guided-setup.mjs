#!/usr/bin/env node

/**
 * Guided Setup — profile-aware worker onboarding.
 *
 * Instead of a generic "pick some tools" list, this module knows what each
 * worker type actually needs and walks the user through connecting exactly
 * those things.
 *
 *   detectWorkerType("handle customer emails") → "customer-support"
 *   runGuidedSetup(profile, rl) → { tools, knowledge, charter_overrides }
 */

import readline from "node:readline";
import { installTool, TOOL_REGISTRY } from "./tool-installer.mjs";

// ---------------------------------------------------------------------------
// Worker profiles
// ---------------------------------------------------------------------------

const WORKER_PROFILES = {
  "customer-support": {
    name: "Customer Support Bot",
    description: "Handles customer inquiries, answers FAQs, escalates complex issues",
    required: [
      { tool: "email", why: "To read and respond to customer messages" },
    ],
    optional: [
      { tool: "slack", why: "To escalate complex issues to your team" },
    ],
    knowledge: [
      { type: "prompt", question: "What does your company do? (1-2 sentences)", key: "company_overview" },
      { type: "prompt", question: "What is your refund/return policy?", key: "refund_policy" },
      { type: "prompt", question: "What are your business hours?", key: "business_hours" },
      { type: "url", question: "URL to your FAQ or help center (optional)", key: "faq_url" },
      { type: "prompt", question: "What tone should the bot use? (friendly/formal/casual)", key: "tone", default: "friendly" },
    ],
    charter_overrides: {
      canDo: ["Read customer emails", "Send helpful replies", "Look up FAQ answers", "Escalate to human when unsure"],
      askFirst: ["Issue refunds", "Make promises about features", "Share internal information"],
      neverDo: ["Share customer data with other customers", "Make up information", "Be rude or dismissive"],
    },
  },

  "sales-assistant": {
    name: "Sales Assistant",
    description: "Researches leads, drafts outreach, tracks competitors",
    required: [
      { tool: "browser", why: "To research companies and contacts" },
    ],
    optional: [
      { tool: "email", why: "To send outreach emails" },
      { tool: "slack", why: "To notify you about hot leads" },
      { tool: "github", why: "To research technical prospects" },
    ],
    knowledge: [
      { type: "prompt", question: "What does your company sell? (1-2 sentences)", key: "product_overview" },
      { type: "prompt", question: "Who is your ideal customer?", key: "ideal_customer" },
      { type: "prompt", question: "What are your main competitors?", key: "competitors" },
      { type: "url", question: "URL to your pricing page (optional)", key: "pricing_url" },
      { type: "prompt", question: "What's your value proposition? Why choose you over competitors?", key: "value_prop" },
    ],
    charter_overrides: {
      canDo: ["Research companies and contacts", "Draft outreach messages", "Track competitor activity", "Search the web"],
      askFirst: ["Send emails to prospects", "Make pricing commitments"],
      neverDo: ["Spam contacts", "Make false claims about the product", "Share confidential information"],
    },
  },

  "content-writer": {
    name: "Content Writer",
    description: "Writes blog posts, social media content, newsletters",
    required: [
      { tool: "browser", why: "To research topics and check facts" },
    ],
    optional: [
      { tool: "slack", why: "To share drafts for review" },
    ],
    knowledge: [
      { type: "prompt", question: "What topics does your company write about?", key: "topics" },
      { type: "prompt", question: "What tone/style? (professional/casual/witty/academic)", key: "writing_style" },
      { type: "url", question: "URL to your blog or content (for style reference)", key: "blog_url" },
      { type: "prompt", question: "Who is your target audience?", key: "audience" },
      { type: "prompt", question: "Any words/phrases to always use or never use?", key: "style_guide" },
    ],
    charter_overrides: {
      canDo: ["Research topics on the web", "Write drafts", "Search for trending topics"],
      askFirst: ["Publish content", "Post to social media"],
      neverDo: ["Plagiarize content", "Write misleading information", "Use competitor brand names negatively"],
    },
  },

  "data-monitor": {
    name: "Data Monitor",
    description: "Watches websites, APIs, or data sources for changes",
    required: [
      { tool: "browser", why: "To check websites and APIs" },
    ],
    optional: [
      { tool: "slack", why: "To send alerts when changes are detected" },
      { tool: "email", why: "To email reports" },
    ],
    knowledge: [
      { type: "prompt", question: "What URLs or data sources should be monitored?", key: "sources" },
      { type: "prompt", question: "What changes are you looking for? (price drops, new content, errors, etc.)", key: "watch_for" },
      { type: "prompt", question: "How often should it check? (every 15m, hourly, daily)", key: "frequency" },
      { type: "prompt", question: "Who should be notified and how? (slack channel, email, etc.)", key: "notify_who" },
    ],
    charter_overrides: {
      canDo: ["Fetch monitored URLs", "Compare current vs previous state", "Send alerts on changes", "Search the web"],
      askFirst: ["Take action based on changes (beyond alerting)"],
      neverDo: ["Modify any data on monitored sites", "Share monitored data externally"],
    },
  },

  "hr-onboarding": {
    name: "HR Onboarding Assistant",
    description: "Helps new employees get set up and answers HR questions",
    required: [],
    optional: [
      { tool: "email", why: "To send welcome emails and reminders" },
      { tool: "slack", why: "To answer questions in a channel" },
    ],
    knowledge: [
      { type: "prompt", question: "What is your company name and what do you do?", key: "company_info" },
      { type: "prompt", question: "What are the first-week tasks for new employees?", key: "first_week" },
      { type: "prompt", question: "What benefits does your company offer?", key: "benefits" },
      { type: "url", question: "URL to your employee handbook (optional)", key: "handbook_url" },
      { type: "prompt", question: "Who should new employees contact for IT/access issues?", key: "it_contact" },
    ],
    charter_overrides: {
      canDo: ["Answer common HR questions", "Send welcome messages", "Share onboarding checklists"],
      askFirst: ["Access employee personal information", "Modify any records"],
      neverDo: ["Share salary information", "Make promises about promotions/raises", "Discuss other employees"],
    },
  },

  "meeting-assistant": {
    name: "Meeting Assistant",
    description: "Summarizes meetings, creates action items, sends follow-ups",
    required: [
      { tool: "slack", why: "To read meeting notes and post summaries" },
    ],
    optional: [
      { tool: "email", why: "To send follow-up emails" },
    ],
    knowledge: [
      { type: "prompt", question: "What meeting channels or threads should it watch?", key: "channels" },
      { type: "prompt", question: "What format should summaries use? (bullets, narrative, action items only)", key: "format" },
      { type: "prompt", question: "Who are the regular participants? (helps identify names)", key: "participants" },
    ],
    charter_overrides: {
      canDo: ["Read meeting transcripts", "Summarize discussions", "Extract action items", "Post summaries"],
      askFirst: ["Send follow-up emails", "Create calendar events"],
      neverDo: ["Share meeting notes outside the team", "Modify original transcripts"],
    },
  },
};

// ---------------------------------------------------------------------------
// Detection — match natural language to a profile
// ---------------------------------------------------------------------------

const DETECTION_PATTERNS = [
  {
    id: "customer-support",
    patterns: [
      /customer\s*support/i,
      /help\s*desk/i,
      /answer\s*(customer\s*)?questions/i,
      /handle\s*tickets/i,
      /support\s*bot/i,
      /customer\s*(service|care)/i,
      /faq/i,
      /respond\s*to\s*(customer|user)\s*(emails?|messages?|inquir)/i,
    ],
  },
  {
    id: "sales-assistant",
    patterns: [
      /sales/i,
      /outreach/i,
      /\bleads?\b/i,
      /prospecting/i,
      /\bcold\s*(email|call)/i,
      /business\s*development/i,
      /\bbdr\b/i,
      /\bsdr\b/i,
    ],
  },
  {
    id: "content-writer",
    patterns: [
      /\bwrite\b.*\b(blog|article|post|content)/i,
      /\bblog\b/i,
      /content\s*(writer|creation|marketing)/i,
      /newsletter/i,
      /social\s*media\s*(post|content|writing)/i,
      /copywriting/i,
    ],
  },
  {
    id: "data-monitor",
    patterns: [
      /monitor/i,
      /\bwatch\b/i,
      /\btrack\b.*\b(price|change|update|website)/i,
      /\balert\b.*\b(when|if|on)\b/i,
      /price\s*(drop|change|track)/i,
      /uptime/i,
      /scrape\s*and\s*(alert|notify)/i,
    ],
  },
  {
    id: "hr-onboarding",
    patterns: [
      /\bonboard/i,
      /\bhr\b/i,
      /human\s*resources/i,
      /new\s*employee/i,
      /new\s*hire/i,
      /welcome\s*(kit|pack|email)/i,
    ],
  },
  {
    id: "meeting-assistant",
    patterns: [
      /meeting\s*(summary|summarize|notes|assistant)/i,
      /standup/i,
      /action\s*items/i,
      /meeting\s*follow[\s-]*up/i,
      /summarize\s*meetings/i,
    ],
  },
];

/**
 * Detect which worker profile matches a natural-language description.
 * Returns the profile ID string, or null if no match.
 */
function detectWorkerType(description) {
  if (!description || typeof description !== "string") return null;

  // Score each profile — first match wins, but we prioritise profiles with
  // more pattern hits so "customer support meeting notes" goes to the right
  // bucket.
  let best = null;
  let bestScore = 0;

  for (const entry of DETECTION_PATTERNS) {
    let score = 0;
    for (const re of entry.patterns) {
      if (re.test(description)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry.id;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Interactive helpers
// ---------------------------------------------------------------------------

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askYesNo(rl, question) {
  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// ---------------------------------------------------------------------------
// Guided setup flow
// ---------------------------------------------------------------------------

/**
 * Run the full guided setup for a given profile.
 *
 * @param {object}              profile  — one of the WORKER_PROFILES values
 * @param {readline.Interface}  rl       — an existing readline interface
 * @returns {{ tools: object[], knowledge: object, charter_overrides: object }}
 */
async function runGuidedSetup(profile, rl) {
  const tools = [];        // { id, status: "connected"|"skipped"|"failed", name }
  const knowledge = {};    // key → value from profile.knowledge questions

  console.log();
  console.log(`  Setting up: ${profile.name}`);
  console.log(`  ${profile.description}`);
  console.log();

  // ------------------------------------------------------------------
  // 1. Required tools
  // ------------------------------------------------------------------
  if (profile.required.length > 0) {
    console.log("  Required connections:");
    console.log();
  }

  for (const req of profile.required) {
    const reg = TOOL_REGISTRY[req.tool];
    const label = reg ? reg.name : req.tool;

    console.log(`  Your ${profile.name.toLowerCase()} needs ${label.toLowerCase()} access.`);
    console.log(`  Why: ${req.why}`);
    console.log();

    if (reg && (reg.builtIn || !reg.needsAuth)) {
      // No auth needed — auto-connect
      const result = await installTool(req.tool);
      tools.push({ id: req.tool, status: result.success ? "connected" : "failed", name: label });
      if (result.success) {
        console.log(`  ✓ ${label} ready.`);
      } else {
        console.log(`  ✗ ${label} setup failed: ${result.message}`);
      }
    } else {
      console.log(`  Let's connect ${label} now.`);
      const result = await installTool(req.tool);
      tools.push({ id: req.tool, status: result.success ? "connected" : "failed", name: label });
      if (result.success) {
        console.log(`  ✓ ${result.message}`);
      } else {
        console.log(`  ✗ ${result.message}`);
      }
    }
    console.log();
  }

  // ------------------------------------------------------------------
  // 2. Optional tools
  // ------------------------------------------------------------------
  if (profile.optional.length > 0) {
    console.log("  Optional connections:");
    console.log();
  }

  for (const opt of profile.optional) {
    const reg = TOOL_REGISTRY[opt.tool];
    const label = reg ? reg.name : opt.tool;

    const want = await askYesNo(rl, `  Connect ${label}? ${opt.why}`);
    if (!want) {
      tools.push({ id: opt.tool, status: "skipped", name: label });
      continue;
    }

    if (reg && (reg.builtIn || !reg.needsAuth)) {
      const result = await installTool(opt.tool);
      tools.push({ id: opt.tool, status: result.success ? "connected" : "failed", name: label });
      if (result.success) {
        console.log(`  ✓ ${label} ready.`);
      } else {
        console.log(`  ✗ ${label} setup failed: ${result.message}`);
      }
    } else {
      const result = await installTool(opt.tool);
      tools.push({ id: opt.tool, status: result.success ? "connected" : "failed", name: label });
      if (result.success) {
        console.log(`  ✓ ${result.message}`);
      } else {
        console.log(`  ✗ ${result.message}`);
      }
    }
    console.log();
  }

  // ------------------------------------------------------------------
  // 3. Knowledge collection
  // ------------------------------------------------------------------
  if (profile.knowledge.length > 0) {
    console.log("  Now let's teach your worker about your business.");
    console.log();
  }

  for (const item of profile.knowledge) {
    const defaultHint = item.default ? ` [${item.default}]` : "";
    const answer = await ask(rl, `  ${item.question}${defaultHint}: `);

    if (!answer && item.default) {
      knowledge[item.key] = item.default;
    } else if (answer) {
      knowledge[item.key] = answer;
    }
    // Empty answer with no default → skip
  }

  console.log();

  return {
    tools,
    knowledge,
    charter_overrides: profile.charter_overrides,
  };
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary of what was connected during guided setup.
 *
 * @param {{ tools: object[], knowledge: object }} setupResult
 * @returns {string}
 */
function buildSetupSummary(setupResult) {
  const lines = [];

  // Tools
  for (const t of setupResult.tools) {
    if (t.status === "connected") {
      lines.push(`  ✓ ${t.name} connected`);
    } else if (t.status === "skipped") {
      lines.push(`  ○ ${t.name} skipped`);
    } else {
      lines.push(`  ✗ ${t.name} failed`);
    }
  }

  // Knowledge count
  const knowledgeCount = Object.keys(setupResult.knowledge).length;
  if (knowledgeCount > 0) {
    lines.push(`  ✓ ${knowledgeCount} knowledge item${knowledgeCount === 1 ? "" : "s"} added`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  WORKER_PROFILES,
  detectWorkerType,
  runGuidedSetup,
  buildSetupSummary,
};
