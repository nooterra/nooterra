import { log } from './shared.js';

export async function runCode(args = {}) {
  const { code, timeout_ms = 5000 } = args;
  if (!code) return { success: false, error: 'code is required' };
  if (timeout_ms > 10000) return { success: false, error: 'Maximum timeout is 10000ms' };
  if (code.length > 50000) return { success: false, error: 'Code too long (max 50KB)' };

  try {
    const vm = await import('node:vm');
    const outputs = [];

    const sandbox = {
      console: {
        log: (...a) => { outputs.push(a.map(String).join(' ')); },
        error: (...a) => { outputs.push(`[error] ${a.map(String).join(' ')}`); },
      },
      Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
      Array, Object, String, Number, Boolean, Map, Set, RegExp,
      setTimeout: undefined, setInterval: undefined,
      fetch: undefined, require: undefined, import: undefined,
      process: undefined, __dirname: undefined, __filename: undefined,
    };

    const context = vm.createContext(sandbox);
    const script = new vm.Script(code, { filename: 'worker-code.js' });
    const execResult = script.runInContext(context, { timeout: timeout_ms });

    let resultStr;
    try {
      resultStr = JSON.stringify(execResult, null, 2);
    } catch {
      resultStr = String(execResult);
    }

    return {
      success: true,
      result: {
        value: resultStr?.slice(0, 50000) || 'undefined',
        console_output: outputs.slice(0, 100).join('\n').slice(0, 10000) || null,
        type: typeof execResult,
      },
    };
  } catch (err) {
    const isTimeout = err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
    return {
      success: false,
      error: isTimeout ? `Code execution timed out after ${timeout_ms}ms` : `Execution error: ${err.message}`,
    };
  }
}

export async function generateImage(args = {}) {
  const { prompt, size = '1024x1024', quality = 'standard' } = args;
  if (!prompt) return { success: false, error: 'prompt is required' };
  if (prompt.length > 4000) return { success: false, error: 'Prompt too long (max 4000 chars)' };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Image generation requires OPENAI_API_KEY to be configured' };
  }

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        quality,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `OpenAI API error ${res.status}: ${errText.slice(0, 300)}` };
    }

    const data = await res.json();
    const image = data.data?.[0];
    if (!image) return { success: false, error: 'No image returned' };

    return {
      success: true,
      result: {
        url: image.url,
        revised_prompt: image.revised_prompt || prompt,
        size,
        quality,
        model: 'dall-e-3',
      },
    };
  } catch (err) {
    return { success: false, error: `Image generation failed: ${err.message}` };
  }
}

export async function waitForEvent(args = {}) {
  const { seconds, reason = 'waiting' } = args;
  if (!seconds || seconds <= 0) return { success: false, error: 'seconds must be positive' };
  if (seconds > 300) return { success: false, error: 'Maximum wait is 300 seconds (5 minutes)' };

  log('info', `Worker waiting ${seconds}s: ${reason}`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  return {
    success: true,
    result: {
      waited_seconds: seconds,
      reason,
      resumed_at: new Date().toISOString(),
    },
  };
}
