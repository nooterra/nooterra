export const BUILTIN_TOOL_NAMES = new Set([
  'web_search', 'browse_webpage', 'read_document',
  'send_sms', 'make_phone_call', 'send_email',
  'delegate_to_worker',
  'check_balance', 'make_payment', 'request_payment', 'store_file',
  'run_code', 'generate_image', 'wait_for_event',
  'check_processed', 'mark_processed',
]);

export const BUILTIN_TOOL_POLICIES = Object.freeze({
  send_sms: Object.freeze({ riskClass: 'communication', maxBodyChars: 1600, maxDailyCalls: 200 }),
  make_phone_call: Object.freeze({ riskClass: 'communication', maxMessageChars: 1000, maxDailyCalls: 50 }),
  send_email: Object.freeze({ riskClass: 'communication', maxSubjectChars: 200, maxBodyChars: 100000, maxDailyCalls: 200 }),
  make_payment: Object.freeze({
    riskClass: 'spend',
    maxAmountUsd: 100,
    maxDailySpendUsd: 100,
    maxTenantDailySpendUsd: 250,
    maxDailyCalls: 25,
    maxTargetDailySpendUsd: 100,
    duplicateWindowMinutes: 60,
  }),
  request_payment: Object.freeze({
    riskClass: 'billing',
    maxAmountUsd: 100000,
    maxDailyCalls: 100,
    maxDailyAmountUsd: 250000,
    maxTargetDailyAmountUsd: 250000,
    duplicateWindowMinutes: 60,
  }),
});

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information. Returns titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'integer', description: 'Number of results (max 10)', default: 5 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_webpage',
      description: 'Fetch a webpage and extract its text content. For reading articles, docs, or any URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          selector: { type: 'string', description: 'Optional CSS selector to extract specific content' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_document',
      description: 'Read content from a document URL (PDF, TXT, CSV, JSON, Markdown).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the document' },
          format: { type: 'string', description: 'Document format hint', enum: ['auto', 'pdf', 'txt', 'csv', 'json', 'md'] },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sms',
      description: 'Send an SMS text message via Twilio.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Phone number to send to (E.164 format, e.g. +1234567890)' },
          body: { type: 'string', description: 'Message text (max 1600 chars)' },
        },
        required: ['to', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_phone_call',
      description: 'Initiate a phone call via Twilio. The call plays a text-to-speech message.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Phone number to call (E.164 format)' },
          message: { type: 'string', description: 'Message to speak (text-to-speech)' },
          voice: { type: 'string', description: 'Voice to use', enum: ['alice', 'man', 'woman'], default: 'alice' },
        },
        required: ['to', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send a transactional email.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' },
          html: { type: 'boolean', description: 'Whether body is HTML', default: false },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate_to_worker',
      description: 'Delegate a subtask to another worker. Creates a new execution for the target worker and optionally waits for the result.',
      parameters: {
        type: 'object',
        properties: {
          worker_id: { type: 'string', description: 'ID of the target worker to delegate to' },
          task: { type: 'string', description: 'Description of the task to delegate' },
          context: { type: 'string', description: 'Additional context or data to pass to the target worker' },
          wait_for_result: { type: 'boolean', description: 'Whether to wait for the target worker to complete (max 5 min). If false, returns immediately with the execution ID.', default: false },
        },
        required: ['worker_id', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_balance',
      description: 'Check the current credit balance for this worker\'s account. Returns available balance and recent spend.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_payment',
      description: 'Spend credits from the account balance. Use for purchasing services, paying for API calls, or any authorized expenditure. Requires approval if amount exceeds charter limits.',
      parameters: {
        type: 'object',
        properties: {
          amount_usd: { type: 'number', description: 'Amount in USD to spend' },
          recipient: { type: 'string', description: 'Who or what the payment is for' },
          description: { type: 'string', description: 'What the payment is for' },
        },
        required: ['amount_usd', 'recipient', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_payment',
      description: 'Create a payment request or invoice. Records the request for the account owner to review.',
      parameters: {
        type: 'object',
        properties: {
          amount_usd: { type: 'number', description: 'Amount requested in USD' },
          from: { type: 'string', description: 'Who should pay (e.g., client name, vendor)' },
          description: { type: 'string', description: 'What the payment is for' },
          due_date: { type: 'string', description: 'When payment is due (ISO date, optional)' },
        },
        required: ['amount_usd', 'from', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_file',
      description: 'Save content to a file and get a download URL. Use for saving reports, data, or any generated content.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Name for the file (e.g., "report.csv", "analysis.json")' },
          content: { type: 'string', description: 'Content to write to the file' },
          content_type: { type: 'string', description: 'MIME type (e.g., "text/csv", "application/json")', default: 'text/plain' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description: 'Execute JavaScript code in a sandboxed environment. Use for calculations, data transformation, parsing, or any computation. Returns the result of the last expression.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code to execute. The result of the last expression is returned.' },
          timeout_ms: { type: 'integer', description: 'Execution timeout in milliseconds (max 10000)', default: 5000 },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an image from a text description using AI (DALL-E). Returns a URL to the generated image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the image to generate' },
          size: { type: 'string', description: 'Image size', enum: ['1024x1024', '1792x1024', '1024x1792'], default: '1024x1024' },
          quality: { type: 'string', description: 'Image quality', enum: ['standard', 'hd'], default: 'standard' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for_event',
      description: 'Pause execution for a specified duration or until a condition is met. Use for timed delays, waiting for external processes, or scheduled follow-ups.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'integer', description: 'Number of seconds to wait (max 300 = 5 minutes)' },
          reason: { type: 'string', description: 'Why the worker is waiting (logged for visibility)' },
        },
        required: ['seconds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_processed',
      description: 'Check if an item (email ID, message ID, etc.) has already been processed. Use this before processing to avoid duplicates.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string', description: 'Unique identifier of the item (e.g., email ID, message ID)' },
        },
        required: ['item_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_processed',
      description: 'Mark an item as processed so it won\'t be handled again on the next run.',
      parameters: {
        type: 'object',
        properties: {
          item_id: { type: 'string', description: 'Unique identifier of the item' },
          summary: { type: 'string', description: 'Brief summary of what was done (optional)' },
        },
        required: ['item_id'],
      },
    },
  },
];

export function getBuiltinToolPolicy(toolName) {
  return BUILTIN_TOOL_POLICIES[toolName] || null;
}

export function getBuiltinTools() {
  return [...TOOL_DEFINITIONS];
}

export function isBuiltinTool(name) {
  return BUILTIN_TOOL_NAMES.has(name);
}
