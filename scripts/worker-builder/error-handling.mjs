/**
 * Error Handling
 *
 * Graceful error handling with helpful messages and recovery options.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Error codes
 */
export const ERROR_CODES = {
  // Provider errors
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  
  // Worker errors
  WORKER_NOT_FOUND: 'WORKER_NOT_FOUND',
  WORKER_INVALID_CHARTER: 'WORKER_INVALID_CHARTER',
  WORKER_ALREADY_RUNNING: 'WORKER_ALREADY_RUNNING',
  WORKER_NOT_READY: 'WORKER_NOT_READY',
  
  // Capability errors
  CAPABILITY_NOT_FOUND: 'CAPABILITY_NOT_FOUND',
  CAPABILITY_NOT_CONNECTED: 'CAPABILITY_NOT_CONNECTED',
  CAPABILITY_AUTH_FAILED: 'CAPABILITY_AUTH_FAILED',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  
  // Charter violations
  CHARTER_VIOLATION: 'CHARTER_VIOLATION',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  
  // System errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  FILE_SYSTEM_ERROR: 'FILE_SYSTEM_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * User-friendly error messages
 */
const ERROR_MESSAGES = {
  [ERROR_CODES.PROVIDER_NOT_CONFIGURED]: {
    title: 'AI Provider Not Connected',
    message: 'You need to connect an AI provider (like OpenAI or Anthropic) first.',
    hint: 'Run /provider connect to set up your AI provider.',
    recoverable: true
  },
  [ERROR_CODES.PROVIDER_AUTH_FAILED]: {
    title: 'Authentication Failed',
    message: 'Your API key was rejected by the provider.',
    hint: 'Check that your API key is correct and has not expired.',
    recoverable: true
  },
  [ERROR_CODES.PROVIDER_RATE_LIMITED]: {
    title: 'Rate Limited',
    message: 'The AI provider is limiting requests. Please wait a moment.',
    hint: 'This usually resolves in a few seconds to minutes.',
    recoverable: true,
    retryable: true
  },
  [ERROR_CODES.PROVIDER_UNAVAILABLE]: {
    title: 'Provider Unavailable',
    message: 'Cannot reach the AI provider right now.',
    hint: 'Check your internet connection or the provider status page.',
    recoverable: true,
    retryable: true
  },
  [ERROR_CODES.WORKER_NOT_FOUND]: {
    title: 'Worker Not Found',
    message: 'Could not find that worker.',
    hint: 'Use /workers to see your available workers.',
    recoverable: true
  },
  [ERROR_CODES.WORKER_INVALID_CHARTER]: {
    title: 'Invalid Charter',
    message: 'The worker charter is missing required information.',
    hint: 'Edit the worker charter to fix the issues.',
    recoverable: true
  },
  [ERROR_CODES.WORKER_ALREADY_RUNNING]: {
    title: 'Worker Already Running',
    message: 'This worker is already executing a task.',
    hint: 'Wait for the current task to complete or use /stop to cancel it.',
    recoverable: true
  },
  [ERROR_CODES.WORKER_NOT_READY]: {
    title: 'Worker Not Ready',
    message: 'This worker cannot run yet.',
    hint: 'Use /worker ready to check what is missing.',
    recoverable: true
  },
  [ERROR_CODES.CAPABILITY_NOT_FOUND]: {
    title: 'Capability Not Found',
    message: 'That capability does not exist.',
    hint: 'Use /capabilities to see available capabilities.',
    recoverable: true
  },
  [ERROR_CODES.CAPABILITY_NOT_CONNECTED]: {
    title: 'Capability Not Connected',
    message: 'This capability needs to be connected first.',
    hint: 'Use /capability connect <name> to set it up.',
    recoverable: true
  },
  [ERROR_CODES.CAPABILITY_AUTH_FAILED]: {
    title: 'Capability Auth Failed',
    message: 'Could not authenticate with this service.',
    hint: 'Check your credentials and try reconnecting.',
    recoverable: true
  },
  [ERROR_CODES.CAPABILITY_UNAVAILABLE]: {
    title: 'Capability Unavailable',
    message: 'Cannot reach this service right now.',
    hint: 'Check if the service is running and accessible.',
    recoverable: true,
    retryable: true
  },
  [ERROR_CODES.CHARTER_VIOLATION]: {
    title: 'Charter Violation',
    message: 'This action is not allowed by the worker charter.',
    hint: 'The worker tried to do something outside its defined scope.',
    recoverable: false
  },
  [ERROR_CODES.BUDGET_EXCEEDED]: {
    title: 'Budget Exceeded',
    message: 'The worker has reached its spending limit.',
    hint: 'Increase the budget in /charter edit or wait for the next period.',
    recoverable: true
  },
  [ERROR_CODES.ACTION_NOT_ALLOWED]: {
    title: 'Action Not Allowed',
    message: 'This action is in the "never do" list.',
    hint: 'The worker charter explicitly forbids this action.',
    recoverable: false
  },
  [ERROR_CODES.APPROVAL_REQUIRED]: {
    title: 'Approval Required',
    message: 'This action needs your approval before proceeding.',
    hint: 'Use /approve to allow or /reject to deny.',
    recoverable: true
  },
  [ERROR_CODES.NETWORK_ERROR]: {
    title: 'Network Error',
    message: 'Could not connect to the network.',
    hint: 'Check your internet connection.',
    recoverable: true,
    retryable: true
  },
  [ERROR_CODES.FILE_SYSTEM_ERROR]: {
    title: 'File System Error',
    message: 'Could not read or write files.',
    hint: 'Check file permissions and disk space.',
    recoverable: true
  },
  [ERROR_CODES.CONFIGURATION_ERROR]: {
    title: 'Configuration Error',
    message: 'There is a problem with the configuration.',
    hint: 'Try running /doctor to diagnose issues.',
    recoverable: true
  },
  [ERROR_CODES.UNKNOWN_ERROR]: {
    title: 'Unexpected Error',
    message: 'Something unexpected went wrong.',
    hint: 'Please try again or report this issue.',
    recoverable: false
  }
};

/**
 * Custom error class
 */
export class NooteraError extends Error {
  constructor(code, details = {}) {
    const info = ERROR_MESSAGES[code] || ERROR_MESSAGES[ERROR_CODES.UNKNOWN_ERROR];
    super(info.message);
    
    this.name = 'NooteraError';
    this.code = code;
    this.title = info.title;
    this.hint = info.hint;
    this.recoverable = info.recoverable;
    this.retryable = info.retryable || false;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      code: this.code,
      title: this.title,
      message: this.message,
      hint: this.hint,
      recoverable: this.recoverable,
      retryable: this.retryable,
      details: this.details,
      timestamp: this.timestamp
    };
  }

  /**
   * Format for terminal display
   */
  format() {
    return [
      `❌ ${this.title}`,
      `   ${this.message}`,
      this.hint ? `   💡 ${this.hint}` : null
    ].filter(Boolean).join('\n');
  }
}

/**
 * Create error from code
 */
export function createError(code, details = {}) {
  return new NooteraError(code, details);
}

/**
 * Wrap async function with error handling
 */
export function withErrorHandling(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof NooteraError) {
        throw err;
      }
      
      // Convert common errors
      if (err.code === 'ENOENT') {
        throw createError(ERROR_CODES.FILE_SYSTEM_ERROR, { original: err.message });
      }
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        throw createError(ERROR_CODES.NETWORK_ERROR, { original: err.message });
      }
      if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
        throw createError(ERROR_CODES.PROVIDER_AUTH_FAILED, { original: err.message });
      }
      if (err.message?.includes('429') || err.message?.includes('rate limit')) {
        throw createError(ERROR_CODES.PROVIDER_RATE_LIMITED, { original: err.message });
      }
      
      throw createError(ERROR_CODES.UNKNOWN_ERROR, { original: err.message });
    }
  };
}

/**
 * Retry with exponential backoff
 */
export async function retry(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const baseDelay = options.baseDelay || 1000;
  
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      
      // Only retry if error is retryable
      if (err instanceof NooteraError && !err.retryable) {
        throw err;
      }
      
      // Wait with exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Format error for logging
 */
export function formatErrorForLog(err) {
  if (err instanceof NooteraError) {
    return {
      level: 'error',
      code: err.code,
      message: err.message,
      details: err.details,
      timestamp: err.timestamp
    };
  }
  
  return {
    level: 'error',
    code: 'UNKNOWN_ERROR',
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  };
}

/**
 * Log error to file
 */
export function logError(err, context = {}) {
  const logDir = path.join(os.homedir(), '.nooterra', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logFile = path.join(logDir, 'errors.log');
  const entry = {
    ...formatErrorForLog(err),
    context
  };
  
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

export default {
  ERROR_CODES,
  NooteraError,
  createError,
  withErrorHandling,
  retry,
  formatErrorForLog,
  logError
};
