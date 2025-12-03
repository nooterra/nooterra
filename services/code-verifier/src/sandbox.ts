/**
 * Sandbox execution module
 *
 * Provides isolated code execution with strict resource limits.
 * Uses Node.js child_process with security restrictions.
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { nanoid } from "nanoid";
import { config } from "./config.js";

export interface SandboxOptions {
  code: string;
  tests?: string;
  language: "javascript" | "typescript" | "js" | "ts";
  timeoutMs: number;
  memoryLimitMb: number;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
  memoryUsed?: number;
}

/**
 * Trim output to prevent memory issues
 */
function trimOutput(str: string, limit: number = config.maxOutputBytes): string {
  if (str.length <= limit) return str;
  return str.slice(0, limit) + "\n...output truncated...";
}

/**
 * Forbidden patterns in code (security check)
 */
const FORBIDDEN_PATTERNS = [
  /require\s*\(\s*['"`]child_process['"`]\s*\)/,
  /require\s*\(\s*['"`]fs['"`]\s*\)/,
  /require\s*\(\s*['"`]net['"`]\s*\)/,
  /require\s*\(\s*['"`]http['"`]\s*\)/,
  /require\s*\(\s*['"`]https['"`]\s*\)/,
  /require\s*\(\s*['"`]dgram['"`]\s*\)/,
  /require\s*\(\s*['"`]cluster['"`]\s*\)/,
  /require\s*\(\s*['"`]worker_threads['"`]\s*\)/,
  /import\s+.*from\s+['"`]child_process['"`]/,
  /import\s+.*from\s+['"`]fs['"`]/,
  /import\s+.*from\s+['"`]net['"`]/,
  /import\s+.*from\s+['"`]http['"`]/,
  /import\s+.*from\s+['"`]https['"`]/,
  /process\.exit/,
  /process\.kill/,
  /process\.env/,
  /eval\s*\(/,
  /Function\s*\(/,
  /new\s+Function/,
];

/**
 * Check code for forbidden patterns
 */
function checkForbiddenPatterns(code: string): string | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return `Forbidden pattern detected: ${pattern.source}`;
    }
  }
  return null;
}

/**
 * Generate safe wrapper code
 */
function wrapCode(code: string, tests?: string): string {
  const testSection = tests ? `\n// --- Tests ---\n${tests}` : "";

  return `
// Nooterra Code Verifier Sandbox
// This code runs in a restricted environment

// Override dangerous globals
const process = { exit: () => {}, kill: () => {}, env: {} };
const require = () => { throw new Error('require is not allowed'); };
const import = () => { throw new Error('dynamic import is not allowed'); };

// User code
${code}
${testSection}
`.trim();
}

/**
 * Run code in a sandboxed Node.js process
 */
export async function runInSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const { code, tests, timeoutMs, memoryLimitMb } = options;
  const executionId = nanoid(8);

  // Security check
  const forbidden = checkForbiddenPatterns(code);
  if (forbidden) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 0,
      timedOut: false,
      error: forbidden,
    };
  }

  if (tests) {
    const forbiddenTests = checkForbiddenPatterns(tests);
    if (forbiddenTests) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 0,
        timedOut: false,
        error: `In tests: ${forbiddenTests}`,
      };
    }
  }

  // Create temp file
  const tempDir = join(tmpdir(), "nooterra-sandbox");
  await fs.mkdir(tempDir, { recursive: true });
  const filePath = join(tempDir, `exec-${executionId}.mjs`);

  try {
    // Write wrapped code
    const wrappedCode = wrapCode(code, tests);
    await fs.writeFile(filePath, wrappedCode, "utf8");

    // Execute with restrictions
    return await new Promise<SandboxResult>((resolve) => {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killed = false;

      // Node.js flags for security and limits
      const nodeArgs = [
        "--no-warnings",
        "--disallow-code-generation-from-strings",
        `--max-old-space-size=${memoryLimitMb}`,
        filePath,
      ];

      // In strict mode, add more restrictions
      if (config.sandboxMode === "strict") {
        nodeArgs.unshift(
          "--experimental-permission",
          "--allow-fs-read=" + filePath,
          "--no-network-access"
        );
      }

      const child = spawn("node", nodeArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        env: {
          // Minimal environment
          NODE_ENV: "sandbox",
          PATH: process.env.PATH,
        },
        // Resource limits
        ...(process.platform !== "win32" && {
          uid: process.getuid?.(),
          gid: process.getgid?.(),
        }),
      });

      // Collect output
      child.stdout.on("data", (data) => {
        stdout += data.toString();
        if (stdout.length > config.maxOutputBytes * 2) {
          stdout = trimOutput(stdout);
          if (!killed) {
            killed = true;
            child.kill("SIGTERM");
          }
        }
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
        if (stderr.length > config.maxOutputBytes * 2) {
          stderr = trimOutput(stderr);
        }
      });

      // Timeout handling
      const timer = setTimeout(() => {
        timedOut = true;
        if (!killed) {
          killed = true;
          child.kill("SIGKILL");
        }
      }, timeoutMs);

      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        resolve({
          exitCode: exitCode ?? (signal ? 1 : 0),
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
          durationMs,
          timedOut,
          error: timedOut
            ? "Execution timed out"
            : signal
              ? `Process killed by signal: ${signal}`
              : undefined,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        resolve({
          exitCode: 1,
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
          durationMs,
          timedOut: false,
          error: err.message,
        });
      });
    });
  } finally {
    // Cleanup temp file
    await fs.unlink(filePath).catch(() => {});
  }
}
