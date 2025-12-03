/**
 * Configuration for the code verifier service
 */

export const config = {
  // Server
  port: Number(process.env.PORT || 4005),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",

  // Sandbox mode: 'dev' for development, 'strict' for production
  sandboxMode: (process.env.SANDBOX_MODE || "dev") as "dev" | "strict",

  // Execution limits
  execTimeoutMs: Number(process.env.EXEC_TIMEOUT_MS || 5000),
  memoryLimitMb: Number(process.env.MEMORY_LIMIT_MB || 128),
  maxCodeBytes: Number(process.env.MAX_CODE_BYTES || 64 * 1024), // 64KB

  // Output limits
  maxOutputBytes: Number(process.env.MAX_OUTPUT_BYTES || 16 * 1024), // 16KB

  // File system
  tempDir: process.env.TEMP_DIR || "/tmp/nooterra-sandbox",
} as const;

// Validate configuration
if (config.execTimeoutMs < 1000 || config.execTimeoutMs > 30000) {
  throw new Error("EXEC_TIMEOUT_MS must be between 1000 and 30000");
}

if (config.memoryLimitMb < 32 || config.memoryLimitMb > 512) {
  throw new Error("MEMORY_LIMIT_MB must be between 32 and 512");
}
