/**
 * Worker Builder AI Core
 * 
 * The conversational engine that creates workers through adaptive questioning.
 * This is the brain that:
 * - Understands what the user wants from natural language
 * - Asks smart follow-up questions one at a time
 * - Infers what capabilities are needed
 * - Generates a complete charter
 * - Deploys the worker
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { inferCapabilities, getCapability, getSetupQuestions, getAllCapabilities } from './capability-registry.mjs';
import { 
  createEmptyCharter, 
  buildCharterFromContext, 
  inferCharterRules, 
  inferSchedule,
  generateCharterSummary,
  validateCharter
} from './charter-compiler.mjs';

/**
 * Conversation state machine
 * Tracks where we are in the worker creation flow
 */
export const CONVERSATION_STATES = {
  INITIAL: "initial",                    // Waiting for task description
  CLARIFYING_TASK: "clarifying_task",    // Asking follow-up about the task
  CONFIRMING_CAPABILITIES: "confirming_capabilities",  // Confirming inferred capabilities
  SETTING_UP_CAPABILITY: "setting_up_capability",      // Configuring a specific capability
  SELECTING_PROVIDER: "selecting_provider",  // Which AI provider to use
  DEFINING_RULES: "defining_rules",      // Defining canDo/askFirst/neverDo
  SETTING_SCHEDULE: "setting_schedule",  // Defining when worker runs
  SETTING_BUDGET: "setting_budget",      // Defining spending limits
  SETTING_NOTIFICATIONS: "setting_notifications",  // Where to send alerts
  NAMING_WORKER: "naming_worker",        // Final name
  REVIEWING_CHARTER: "reviewing_charter", // Review before deploy
  DEPLOYING: "deploying",                // Creating the worker
  COMPLETE: "complete"                   // Worker created
};

/**
 * Create a new conversation context
 */
export function createConversation() {
  return {
    id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    state: CONVERSATION_STATES.INITIAL,
    history: [],
    context: {
      taskDescription: null,
      capabilities: [],
      capabilityConfigs: {},
      canDo: [],
      askFirst: [],
      neverDo: [],
      schedule: null,
      budget: null,
      notifications: null,
      workerName: null
    },
    currentCapabilityIndex: 0,
    pendingQuestion: null,
    charter: null,
    createdAt: new Date().toISOString()
  };
}

/**
 * Process user input and generate next response
 * This is the main conversation loop
 */
export function processInput(conversation, userInput) {
  // Add to history
  conversation.history.push({
    role: "user",
    content: userInput,
    timestamp: new Date().toISOString()
  });

  let response;

  switch (conversation.state) {
    case CONVERSATION_STATES.INITIAL:
      response = handleInitialInput(conversation, userInput);
      break;
    case CONVERSATION_STATES.CLARIFYING_TASK:
      response = handleClarifyingInput(conversation, userInput);
      break;
    case CONVERSATION_STATES.CONFIRMING_CAPABILITIES:
      response = handleCapabilityConfirmation(conversation, userInput);
      break;
    case CONVERSATION_STATES.SETTING_UP_CAPABILITY:
      response = handleCapabilitySetup(conversation, userInput);
      break;
    case CONVERSATION_STATES.SELECTING_PROVIDER:
      response = handleProviderSelection(conversation, userInput);
      break;
    case CONVERSATION_STATES.DEFINING_RULES:
      response = handleRulesInput(conversation, userInput);
      break;
    case CONVERSATION_STATES.SETTING_SCHEDULE:
      response = handleScheduleInput(conversation, userInput);
      break;
    case CONVERSATION_STATES.SETTING_BUDGET:
      response = handleBudgetInput(conversation, userInput);
      break;
    case CONVERSATION_STATES.SETTING_NOTIFICATIONS:
      response = handleNotificationsInput(conversation, userInput);
      break;
    case CONVERSATION_STATES.NAMING_WORKER:
      response = handleNamingInput(conversation, userInput);
      break;
    case CONVERSATION_STATES.REVIEWING_CHARTER:
      response = handleReviewInput(conversation, userInput);
      break;
    default:
      response = { 
        message: "I'm not sure what to do. Let's start over. What kind of worker do you want to create?",
        state: CONVERSATION_STATES.INITIAL
      };
  }

  // Update state
  if (response.state) {
    conversation.state = response.state;
  }

  // Store pending question if any
  conversation.pendingQuestion = response.question || null;

  // Add to history
  conversation.history.push({
    role: "assistant",
    content: response.message,
    timestamp: new Date().toISOString()
  });

  return response;
}

export async function generateResponse(conversation, userInput = null) {
  if (userInput === null || userInput === undefined) {
    return {
      message: "What kind of worker do you want to create?",
      question: { type: "text", placeholder: "e.g., Monitor my inbox and forward urgent emails to Slack" },
      state: conversation.state
    };
  }
  return processInput(conversation, userInput);
}

/**
 * Handle initial task description
 */
function handleInitialInput(conversation, userInput) {
  const input = userInput.trim();
  
  if (input.length < 10) {
    return {
      message: "Tell me more! What do you want this worker to do? The more detail you give, the better I can help.",
      question: { type: "text", placeholder: "e.g., Monitor my inbox and forward urgent emails to Slack" },
      state: CONVERSATION_STATES.INITIAL
    };
  }

  // Store task description
  conversation.context.taskDescription = input;

  // Infer capabilities
  const inferredCaps = inferCapabilities(input);
  conversation.context.capabilities = inferredCaps.map(cap => ({ ...cap, confirmed: false }));

  // Infer schedule
  const inferredSchedule = inferSchedule(input);
  conversation.context.schedule = inferredSchedule;

  // Build a proactive, guided response
  const capList = inferredCaps.length > 0
    ? inferredCaps.map(c => `  ${c.icon} ${c.name}`).join("\n")
    : "  (none detected)";

  // Suggest additional capabilities the user might not have thought of
  const allCaps = getAllCapabilities();
  const inferredIds = new Set(inferredCaps.map(c => c.id));
  const suggestions = allCaps
    .filter(c => !inferredIds.has(c.id))
    .slice(0, 4)
    .map(c => `${c.icon} ${c.name}`)
    .join(", ");

  // Proactive message that LEADS the user
  let message = `Here's what I'm thinking for this worker:\n\n`;
  message += `Tools needed:\n${capList}\n\n`;

  if (suggestions) {
    message += `Other tools available: ${suggestions}\n\n`;
  }

  message += `I also need to know:\n`;
  message += `  • Can this worker spend money? If so, what's the budget?\n`;
  message += `  • Should it need approval before taking action?\n`;
  message += `  • Any services it should NEVER access?\n\n`;
  message += `Let's start — are these tools right? (yes / add more / change)`;

  if (inferredCaps.length === 0) {
    message = `I'd love to help build that worker! I need to know what tools it should connect to.\n\n`;
    message += `Available tools: ${allCaps.slice(0, 6).map(c => `${c.icon} ${c.name}`).join(", ")}\n\n`;
    message += `Which ones does this worker need?`;
    return {
      message,
      question: { type: "text", placeholder: "e.g., Email, Slack, Browser" },
      state: CONVERSATION_STATES.CLARIFYING_TASK
    };
  }

  return {
    message,
    question: {
      type: "confirm",
      options: ["Yes, that's right", "Add more capabilities", "Change these"]
    },
    state: CONVERSATION_STATES.CONFIRMING_CAPABILITIES
  };
}

/**
 * Handle clarifying questions about the task
 */
function handleClarifyingInput(conversation, userInput) {
  const input = userInput.toLowerCase();

  // Try to infer capabilities from the clarification
  const additionalCaps = inferCapabilities(input);
  
  if (additionalCaps.length > 0) {
    // Add new capabilities
    for (const cap of additionalCaps) {
      if (!conversation.context.capabilities.find(c => c.id === cap.id)) {
        conversation.context.capabilities.push({ ...cap, confirmed: false });
      }
    }
  }

  // Check if we have capabilities now
  if (conversation.context.capabilities.length === 0) {
    // Show capability picker
    const categories = {};
    for (const cap of getAllCapabilities()) {
      if (!categories[cap.category]) categories[cap.category] = [];
      categories[cap.category].push(cap);
    }

    let message = "Let me show you what's available. Which of these does your worker need?\n\n";
    for (const [category, caps] of Object.entries(categories).slice(0, 4)) {
      message += `**${category}**\n`;
      for (const cap of caps.slice(0, 3)) {
        message += `  ${cap.icon} ${cap.name}\n`;
      }
    }
    message += "\nJust tell me what you need (e.g., 'browser and slack')";

    return {
      message,
      question: { type: "text" },
      state: CONVERSATION_STATES.CLARIFYING_TASK
    };
  }

  // Move to capability confirmation
  const capList = conversation.context.capabilities.map(c => `${c.icon} ${c.name}`).join("\n  ");
  
  return {
    message: `Okay! So this worker will use:\n\n  ${capList}\n\nDoes that look right?`,
    question: {
      type: "confirm",
      options: ["Yes, continue", "Add more", "Remove some"]
    },
    state: CONVERSATION_STATES.CONFIRMING_CAPABILITIES
  };
}

/**
 * Handle capability confirmation
 */
function handleCapabilityConfirmation(conversation, userInput) {
  const input = userInput.toLowerCase();

  if (/yes|right|correct|continue|good|perfect|looks good/.test(input)) {
    // Mark all as confirmed
    for (const cap of conversation.context.capabilities) {
      cap.confirmed = true;
    }

    // Start setting up capabilities
    conversation.currentCapabilityIndex = 0;
    return startCapabilitySetup(conversation);
  }

  if (/add|more|also need/.test(input)) {
    return {
      message: "What else does this worker need access to?",
      question: { type: "text", placeholder: "e.g., email, calendar" },
      state: CONVERSATION_STATES.CLARIFYING_TASK
    };
  }

  if (/remove|don't need|change/.test(input)) {
    const capList = conversation.context.capabilities.map((c, i) => `${i + 1}. ${c.icon} ${c.name}`).join("\n");
    return {
      message: `Which one should I remove?\n\n${capList}`,
      question: { type: "text", placeholder: "e.g., 2 or 'email'" },
      state: CONVERSATION_STATES.CONFIRMING_CAPABILITIES
    };
  }

  // Check if they're specifying a number or name to remove
  const numMatch = input.match(/^(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < conversation.context.capabilities.length) {
      const removed = conversation.context.capabilities.splice(idx, 1)[0];
      const capList = conversation.context.capabilities.map(c => `${c.icon} ${c.name}`).join("\n  ");
      return {
        message: `Removed ${removed.name}. Updated list:\n\n  ${capList}\n\nLooks good?`,
        question: { type: "confirm", options: ["Yes, continue", "Remove more"] },
        state: CONVERSATION_STATES.CONFIRMING_CAPABILITIES
      };
    }
  }

  // Try to find by name
  const capToRemove = conversation.context.capabilities.find(c => 
    input.includes(c.name.toLowerCase()) || input.includes(c.id)
  );
  if (capToRemove) {
    conversation.context.capabilities = conversation.context.capabilities.filter(c => c.id !== capToRemove.id);
    const capList = conversation.context.capabilities.map(c => `${c.icon} ${c.name}`).join("\n  ");
    return {
      message: `Removed ${capToRemove.name}. Updated list:\n\n  ${capList}\n\nLooks good?`,
      question: { type: "confirm", options: ["Yes, continue", "Remove more"] },
      state: CONVERSATION_STATES.CONFIRMING_CAPABILITIES
    };
  }

  return {
    message: "Sorry, I didn't understand that. Should I continue with these capabilities, or do you want to make changes?",
    question: { type: "confirm", options: ["Continue", "Make changes"] },
    state: CONVERSATION_STATES.CONFIRMING_CAPABILITIES
  };
}

/**
 * Start setting up capabilities
 *
 * Skip individual capability OAuth/setup questions — MCP connections happen
 * at runtime, not during creation. Go straight to provider selection.
 */
function startCapabilitySetup(conversation) {
  // Mark all capabilities as confirmed — they'll connect via MCP at runtime
  for (const cap of conversation.context.capabilities) {
    cap.confirmed = true;
  }

  const capNames = conversation.context.capabilities.map(c => `${c.icon} ${c.name}`).join(', ');

  // Skip to provider selection
  return startProviderSelection(conversation);
}

/**
 * Handle capability setup input
 */
function handleCapabilitySetup(conversation, userInput) {
  const pending = conversation.pendingCapabilityQuestion;
  if (!pending) {
    return startCapabilitySetup(conversation);
  }

  const { capId, questions, questionIndex } = pending;
  const currentQuestion = questions[questionIndex];

  // Store the answer
  if (!conversation.context.capabilityConfigs[capId]) {
    conversation.context.capabilityConfigs[capId] = {};
  }
  
  if (currentQuestion.field) {
    conversation.context.capabilityConfigs[capId][currentQuestion.field] = userInput;
  }
  
  // Mark as authenticated if OAuth
  if (currentQuestion.type === "oauth" || /yes|connect|authorize/.test(userInput.toLowerCase())) {
    conversation.context.capabilityConfigs[capId].authenticated = true;
  }

  // Check if there are more questions for this capability
  if (questionIndex + 1 < questions.length) {
    const nextQuestion = questions[questionIndex + 1];
    conversation.pendingCapabilityQuestion.questionIndex++;
    
    return {
      message: nextQuestion.question,
      question: nextQuestion,
      state: CONVERSATION_STATES.SETTING_UP_CAPABILITY
    };
  }

  // Move to next capability
  conversation.currentCapabilityIndex++;
  conversation.pendingCapabilityQuestion = null;
  
  return startCapabilitySetup(conversation);
}

/**
 * Get configured providers (sync — reads from disk)
 */
function getConfiguredProviderIds() {
  try {
    const credDir = path.join(os.homedir(), '.nooterra', 'credentials');
    const configFile = path.join(os.homedir(), '.nooterra', 'config.json');
    const providers = [];

    // Check for OAuth tokens
    if (fs.existsSync(path.join(credDir, 'chatgpt-oauth.json'))) providers.push('chatgpt');

    // Check for encrypted API keys
    const knownProviders = ['openai', 'anthropic', 'google', 'openrouter', 'groq'];
    for (const id of knownProviders) {
      if (fs.existsSync(path.join(credDir, `${id}.enc`))) providers.push(id);
    }

    // Check env vars as fallback
    if (!providers.includes('openai') && process.env.OPENAI_API_KEY) providers.push('openai');
    if (!providers.includes('anthropic') && process.env.ANTHROPIC_API_KEY) providers.push('anthropic');

    // Always include local
    if (providers.length === 0) providers.push('local');

    return providers;
  } catch {
    return ['local'];
  }
}

/**
 * Start provider selection
 */
function startProviderSelection(conversation) {
  const configuredProviders = getConfiguredProviderIds();

  // If only one provider, auto-select and skip the question
  if (configuredProviders.length === 1) {
    conversation.context.provider = configuredProviders[0];
    return startDefiningRules(conversation);
  }

  // If multiple, ask which one
  const providerList = configuredProviders.map((id, i) => `  ${i + 1}. ${id}`).join('\n');
  return {
    message: `Which AI should this worker use?\n\n${providerList}\n\n(Type the number or name)`,
    question: { type: 'text', placeholder: 'e.g., 1 or chatgpt' },
    state: CONVERSATION_STATES.SELECTING_PROVIDER
  };
}

/**
 * Handle provider selection input
 */
function handleProviderSelection(conversation, userInput) {
  const input = userInput.trim().toLowerCase();
  const configuredProviders = getConfiguredProviderIds();

  // Try numeric selection
  const num = parseInt(input, 10);
  if (num > 0 && num <= configuredProviders.length) {
    conversation.context.provider = configuredProviders[num - 1];
    return startDefiningRules(conversation);
  }

  // Try name match
  const match = configuredProviders.find(id => id.includes(input));
  if (match) {
    conversation.context.provider = match;
    return startDefiningRules(conversation);
  }

  // Not recognized — ask again
  const providerList = configuredProviders.map((id, i) => `  ${i + 1}. ${id}`).join('\n');
  return {
    message: `I didn't recognize that. Pick one:\n\n${providerList}`,
    question: { type: 'text' },
    state: CONVERSATION_STATES.SELECTING_PROVIDER
  };
}

/**
 * Start defining rules (canDo/askFirst/neverDo)
 */
function startDefiningRules(conversation) {
  // Infer rules from task and capabilities
  const inferredRules = inferCharterRules(
    conversation.context.taskDescription,
    conversation.context.capabilities
  );

  conversation.context.canDo = inferredRules.canDo;
  conversation.context.askFirst = inferredRules.askFirst;
  conversation.context.neverDo = inferredRules.neverDo;

  // Ask about restrictions
  return {
    message: "Almost there! Is there anything this worker should NEVER do?\n\n" +
             "For example:\n" +
             "  • Never delete anything\n" +
             "  • Never contact specific people\n" +
             "  • Never spend more than $X\n\n" +
             "(Or say 'none' if the defaults are fine)",
    question: { type: "text", placeholder: "e.g., Never delete files or contact the CEO" },
    state: CONVERSATION_STATES.DEFINING_RULES
  };
}

/**
 * Handle rules input
 */
function handleRulesInput(conversation, userInput) {
  const input = userInput.toLowerCase();

  if (!/none|skip|default|fine|ok|good/.test(input)) {
    // Parse restrictions
    const restrictions = userInput.split(/,|\n|and/).map(r => r.trim()).filter(r => r.length > 0);
    for (const r of restrictions) {
      if (!conversation.context.neverDo.includes(r)) {
        conversation.context.neverDo.push(r);
      }
    }
  }

  // Check if task involves money
  if (/spend|buy|purchase|pay|cost|price|budget|money|\$/.test(conversation.context.taskDescription)) {
    return {
      message: "This worker might spend money. What's the budget?\n\n" +
               "Examples:\n" +
               "  • $100/month\n" +
               "  • $50 per task, max $500/month\n" +
               "  • No budget (ask for approval every time)",
      question: { type: "text", placeholder: "e.g., $100/month" },
      state: CONVERSATION_STATES.SETTING_BUDGET
    };
  }

  // Skip budget, go to notifications
  return askAboutNotifications(conversation);
}

/**
 * Handle budget input
 */
function handleBudgetInput(conversation, userInput) {
  const input = userInput.toLowerCase();

  if (/no budget|none|ask|approval/.test(input)) {
    conversation.context.budget = {
      amount: 0,
      currency: "USD",
      period: "transaction",
      approvalThreshold: 0
    };
  } else {
    // Parse budget
    const amountMatch = input.match(/\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(",", "")) : 0;
    
    const period = /month/.test(input) ? "monthly" :
                   /week/.test(input) ? "weekly" :
                   /day/.test(input) ? "daily" :
                   /task|transaction/.test(input) ? "transaction" : "monthly";

    // Check for approval threshold
    const thresholdMatch = input.match(/above\s*\$?(\d+)/);
    const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : amount;

    conversation.context.budget = {
      amount,
      currency: "USD",
      period,
      approvalThreshold: threshold
    };
  }

  return askAboutNotifications(conversation);
}

/**
 * Ask about notifications
 */
function askAboutNotifications(conversation) {
  return {
    message: "How should this worker notify you?\n\n" +
             "Options:\n" +
             "  • Slack (channel or DM)\n" +
             "  • Email\n" +
             "  • SMS\n" +
             "  • Just in the app\n\n" +
             "(You can pick multiple)",
    question: { 
      type: "choice",
      options: ["Slack", "Email", "SMS", "Just the app"],
      multiple: true
    },
    state: CONVERSATION_STATES.SETTING_NOTIFICATIONS
  };
}

/**
 * Handle notifications input
 */
function handleNotificationsInput(conversation, userInput) {
  const input = userInput.toLowerCase();
  const channels = [];

  if (/slack/.test(input)) channels.push("slack");
  if (/email/.test(input)) channels.push("email");
  if (/sms|text/.test(input)) channels.push("sms");
  if (/app|none|just/.test(input) || channels.length === 0) channels.push("app");

  conversation.context.notifications = {
    channels,
    events: ["approval_needed", "task_complete", "error"]
  };

  // Ask for name
  return {
    message: "Last thing - what should I call this worker?\n\n" +
             "(Give it a memorable name like 'Price Monitor' or 'Inbox Triage')",
    question: { type: "text", placeholder: "e.g., Price Monitor" },
    state: CONVERSATION_STATES.NAMING_WORKER
  };
}

/**
 * Handle naming input
 */
function handleNamingInput(conversation, userInput) {
  conversation.context.workerName = userInput.trim();

  // Build the charter
  const charter = buildCharterFromContext(conversation.context);
  conversation.charter = charter;

  // Generate summary
  const summary = generateCharterSummary(charter);

  return {
    message: `Here's your worker:\n\n${summary}\n\nReady to deploy?`,
    question: {
      type: "confirm",
      options: ["Deploy worker", "Edit charter", "Start over"]
    },
    state: CONVERSATION_STATES.REVIEWING_CHARTER,
    charter
  };
}

/**
 * Handle review input
 */
function handleReviewInput(conversation, userInput) {
  const input = userInput.toLowerCase();

  if (/deploy|yes|go|create|launch|ship/.test(input)) {
    // Validate charter
    const validation = validateCharter(conversation.charter);
    if (!validation.valid) {
      return {
        message: `Almost, but there's an issue:\n\n${validation.errors.join("\n")}\n\nLet's fix that.`,
        question: { type: "text" },
        state: CONVERSATION_STATES.REVIEWING_CHARTER
      };
    }

    return {
      message: `🚀 Deploying "${conversation.charter.name}"...\n\n` +
               `Worker ID: wrk_${Date.now().toString(36)}\n` +
               `Status: Active\n` +
               `Schedule: ${formatSchedule(conversation.charter.schedule)}\n\n` +
               `Your worker is now running! Use /workers to manage it.`,
      state: CONVERSATION_STATES.COMPLETE,
      charter: conversation.charter,
      deployed: true
    };
  }

  if (/edit|change|modify/.test(input)) {
    return {
      message: "What would you like to change?\n\n" +
               "1. Capabilities\n" +
               "2. Rules (can do / ask first / never do)\n" +
               "3. Schedule\n" +
               "4. Budget\n" +
               "5. Name",
      question: { type: "text" },
      state: CONVERSATION_STATES.REVIEWING_CHARTER
    };
  }

  if (/start over|reset|cancel/.test(input)) {
    return {
      message: "No problem! What kind of worker do you want to create?",
      question: { type: "text" },
      state: CONVERSATION_STATES.INITIAL
    };
  }

  return {
    message: "Ready to deploy this worker, or do you want to make changes?",
    question: { type: "confirm", options: ["Deploy", "Edit", "Cancel"] },
    state: CONVERSATION_STATES.REVIEWING_CHARTER
  };
}

/**
 * Format schedule for display
 */
function formatSchedule(schedule) {
  if (!schedule) return "On demand";
  
  switch (schedule.type) {
    case "continuous":
      return "Continuous (24/7)";
    case "interval":
      return `Every ${schedule.value}`;
    case "cron":
      return `Scheduled: ${schedule.value}`;
    case "trigger":
      return "On demand / triggered";
    default:
      return "On demand";
  }
}

/**
 * Get conversation state for UI
 */
export function getConversationState(conversation) {
  return {
    id: conversation.id,
    state: conversation.state,
    history: conversation.history,
    pendingQuestion: conversation.pendingQuestion,
    charter: conversation.charter,
    progress: calculateProgress(conversation)
  };
}

/**
 * Calculate progress percentage
 */
function calculateProgress(conversation) {
  const stateOrder = [
    CONVERSATION_STATES.INITIAL,
    CONVERSATION_STATES.CLARIFYING_TASK,
    CONVERSATION_STATES.CONFIRMING_CAPABILITIES,
    CONVERSATION_STATES.SETTING_UP_CAPABILITY,
    CONVERSATION_STATES.DEFINING_RULES,
    CONVERSATION_STATES.SETTING_SCHEDULE,
    CONVERSATION_STATES.SETTING_BUDGET,
    CONVERSATION_STATES.SETTING_NOTIFICATIONS,
    CONVERSATION_STATES.NAMING_WORKER,
    CONVERSATION_STATES.REVIEWING_CHARTER,
    CONVERSATION_STATES.COMPLETE
  ];

  const currentIndex = stateOrder.indexOf(conversation.state);
  return Math.round((currentIndex / (stateOrder.length - 1)) * 100);
}

/**
 * Instant worker creation — one sentence in, working worker out.
 *
 * This is the "just do it" mode. The user says "monitor my competitor's prices"
 * and we infer EVERYTHING: name, capabilities, rules, schedule. No questions.
 *
 * Returns a complete conversation context ready for buildCharterFromContext().
 */
export function instantCreate(description) {
  const context = {
    taskDescription: description,
    capabilities: [],
    capabilityConfigs: {},
    canDo: [],
    askFirst: [],
    neverDo: [],
    schedule: null,
    budget: null,
    notifications: { channels: ['app'], events: ['approval_needed', 'task_complete', 'error'] },
    workerName: null
  };

  // Infer capabilities
  const inferredCaps = inferCapabilities(description);
  context.capabilities = inferredCaps.map(cap => ({ ...cap, confirmed: true }));

  // If no capabilities detected, default to browser (most useful general-purpose tool)
  if (context.capabilities.length === 0) {
    const allCaps = getAllCapabilities();
    const browser = allCaps.find(c => c.id === 'browser');
    if (browser) context.capabilities.push({ ...browser, confirmed: true });
  }

  // Infer schedule
  context.schedule = inferSchedule(description);

  // Infer rules
  const rules = inferCharterRules(description, context.capabilities);
  context.canDo = rules.canDo;
  context.askFirst = rules.askFirst;
  context.neverDo = rules.neverDo;

  // Generate a name from the description
  context.workerName = generateWorkerName(description);

  return context;
}

/**
 * Generate a worker name from a task description.
 * Produces short, memorable names like "Price Monitor" or "Inbox Triage".
 */
function generateWorkerName(description) {
  const desc = description.toLowerCase();

  // Pattern: "monitor X" → "X Monitor"
  const monitorMatch = desc.match(/monitor\s+(?:my\s+)?(?:the\s+)?(.+?)(?:\s+(?:and|for|on|every|daily|hourly).*)?$/);
  if (monitorMatch) {
    const subject = monitorMatch[1].replace(/['"]/g, '').trim();
    return titleCase(subject) + ' Monitor';
  }

  // Pattern: "check X" → "X Checker"
  const checkMatch = desc.match(/check\s+(?:my\s+)?(?:the\s+)?(.+?)(?:\s+(?:and|for|on|every|daily|hourly).*)?$/);
  if (checkMatch) {
    const subject = checkMatch[1].replace(/['"]/g, '').trim();
    return titleCase(subject) + ' Checker';
  }

  // Pattern: "send X" → "X Sender"
  const sendMatch = desc.match(/send\s+(?:my\s+)?(?:the\s+)?(.+?)(?:\s+(?:to|via|through|every).*)?$/);
  if (sendMatch) {
    const subject = sendMatch[1].replace(/['"]/g, '').trim();
    return titleCase(subject) + ' Sender';
  }

  // Pattern: "track X" → "X Tracker"
  const trackMatch = desc.match(/track\s+(?:my\s+)?(?:the\s+)?(.+?)(?:\s+(?:and|for|on|every).*)?$/);
  if (trackMatch) {
    const subject = trackMatch[1].replace(/['"]/g, '').trim();
    return titleCase(subject) + ' Tracker';
  }

  // Pattern: verb + object → "Object Verb-er"
  const verbMatch = desc.match(/^(?:i want to |i need to |please |can you )?(\w+)\s+(?:my\s+)?(?:the\s+)?(?:for\s+)?(.+?)(?:\s+(?:every|daily|hourly|and|on\s+\w+).*)?$/);
  if (verbMatch) {
    const verb = verbMatch[1];
    const object = verbMatch[2].replace(/['"]/g, '').replace(/\s+(on|from|in|at|to|via|through)\s+.*$/, '').trim();
    // Common verb→noun mappings
    const nounMap = {
      summarize: 'Summarizer', organize: 'Organizer', analyze: 'Analyzer',
      process: 'Processor', automate: 'Automator', manage: 'Manager',
      schedule: 'Scheduler', clean: 'Cleaner', sort: 'Sorter',
      filter: 'Filter', forward: 'Forwarder', respond: 'Responder',
      notify: 'Notifier', report: 'Reporter', review: 'Reviewer',
      scrape: 'Scraper', collect: 'Collector', aggregate: 'Aggregator',
      watch: 'Watcher', alert: 'Alerter', backup: 'Backup',
      sync: 'Sync', update: 'Updater', draft: 'Drafter',
    };
    const suffix = nounMap[verb] || titleCase(verb) + 'er';
    const shortObj = object.split(/\s+/).slice(0, 3).join(' ');
    return titleCase(shortObj) + ' ' + suffix;
  }

  // Fallback: first 3-4 meaningful words + "Worker"
  const words = description.replace(/^(i want to |i need |please |can you |create a |make a |build a )/i, '')
    .split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  return words.length > 0 ? titleCase(words.join(' ')) : 'My Worker';
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Worker templates — pre-built charters for common use cases.
 * Users can pick a template and customize from there.
 */
export const WORKER_TEMPLATES = [
  {
    id: 'price-monitor',
    name: 'Price Monitor',
    description: 'Track prices on websites and alert you when they change',
    icon: '💰',
    context: {
      taskDescription: 'Monitor product prices on specified websites and send alerts when prices drop',
      capabilities: [{ id: 'browser', name: 'Web Browser', icon: '🌐', confirmed: true }],
      canDo: ['Browse specified websites', 'Extract prices from pages', 'Send price alerts'],
      askFirst: ['Make purchases'],
      neverDo: ['Browse websites not in the allowed list', 'Share pricing data externally'],
      schedule: { type: 'interval', value: '1h' },
      notifications: { channels: ['app'], events: ['approval_needed', 'task_complete', 'error'] },
      workerName: 'Price Monitor'
    }
  },
  {
    id: 'inbox-triage',
    name: 'Inbox Triage',
    description: 'Read your email, categorize messages, and forward urgent ones',
    icon: '📧',
    context: {
      taskDescription: 'Read incoming emails, categorize by urgency, and forward urgent messages to Slack',
      capabilities: [
        { id: 'email', name: 'Email (Gmail/IMAP)', icon: '📧', confirmed: true },
        { id: 'slack', name: 'Slack', icon: '💬', confirmed: true }
      ],
      canDo: ['Read emails', 'Categorize messages', 'Forward urgent messages to Slack'],
      askFirst: ['Reply to emails', 'Archive messages'],
      neverDo: ['Delete emails permanently', 'Share email content externally'],
      schedule: { type: 'interval', value: '15m' },
      notifications: { channels: ['slack'], events: ['approval_needed', 'task_complete', 'error'] },
      workerName: 'Inbox Triage'
    }
  },
  {
    id: 'standup-summarizer',
    name: 'Standup Summarizer',
    description: 'Read team standup messages and create a daily summary',
    icon: '📋',
    context: {
      taskDescription: 'Read standup messages from Slack, summarize what everyone is working on, and post a digest',
      capabilities: [{ id: 'slack', name: 'Slack', icon: '💬', confirmed: true }],
      canDo: ['Read messages from standup channels', 'Create summary posts', 'Tag team members'],
      askFirst: ['Send direct messages'],
      neverDo: ['Post to channels not in the allowed list', 'Share private conversations'],
      schedule: { type: 'cron', value: '0 10 * * 1-5' },
      notifications: { channels: ['slack'], events: ['task_complete', 'error'] },
      workerName: 'Standup Summarizer'
    }
  },
  {
    id: 'competitor-watcher',
    name: 'Competitor Watcher',
    description: 'Monitor competitor websites for changes and new content',
    icon: '🔍',
    context: {
      taskDescription: 'Monitor competitor websites for new products, pricing changes, and blog posts',
      capabilities: [{ id: 'browser', name: 'Web Browser', icon: '🌐', confirmed: true }],
      canDo: ['Browse competitor websites', 'Extract content and pricing', 'Send change alerts'],
      askFirst: [],
      neverDo: ['Create accounts on competitor sites', 'Scrape customer data'],
      schedule: { type: 'cron', value: '0 8 * * *' },
      notifications: { channels: ['app'], events: ['task_complete', 'error'] },
      workerName: 'Competitor Watcher'
    }
  },
  {
    id: 'github-reviewer',
    name: 'PR Reviewer',
    description: 'Review pull requests and leave comments on code quality',
    icon: '🔀',
    context: {
      taskDescription: 'Review new pull requests on GitHub, check for code quality issues, and leave review comments',
      capabilities: [{ id: 'github', name: 'GitHub', icon: '🔀', confirmed: true }],
      canDo: ['Read repository contents', 'Read pull requests', 'Leave review comments'],
      askFirst: ['Approve pull requests', 'Request changes'],
      neverDo: ['Merge pull requests', 'Delete branches', 'Modify repository settings'],
      schedule: { type: 'interval', value: '30m' },
      notifications: { channels: ['app'], events: ['task_complete', 'error'] },
      workerName: 'PR Reviewer'
    }
  },
  {
    id: 'social-monitor',
    name: 'Social Monitor',
    description: 'Track mentions of your brand across the web',
    icon: '📡',
    context: {
      taskDescription: 'Search the web for mentions of your brand and products, alert on negative sentiment',
      capabilities: [{ id: 'browser', name: 'Web Browser', icon: '🌐', confirmed: true }],
      canDo: ['Search websites and social media', 'Analyze sentiment', 'Send alerts'],
      askFirst: ['Post responses to mentions'],
      neverDo: ['Post content without approval', 'Share internal data publicly'],
      schedule: { type: 'interval', value: '2h' },
      notifications: { channels: ['app'], events: ['task_complete', 'error'] },
      workerName: 'Social Monitor'
    }
  },
];

export default {
  createConversation,
  processInput,
  generateResponse,
  getConversationState,
  instantCreate,
  generateWorkerName,
  WORKER_TEMPLATES,
  CONVERSATION_STATES
};
