/**
 * HuggingFace Adapter
 * 
 * Connects HuggingFace models to the Nooterra network.
 * Each HF model becomes a callable Nooterra agent.
 * 
 * Supported:
 * - Inference Providers (router.huggingface.co) - NEW API
 * - Inference Endpoints (dedicated)
 * - Spaces (Gradio apps)
 * 
 * Note: api-inference.huggingface.co was deprecated Dec 2025.
 * Now using router.huggingface.co with OpenAI-compatible API.
 */

import fetch from "node-fetch";

// New HuggingFace Router API (OpenAI-compatible)
const HF_ROUTER_API = "https://router.huggingface.co/v1";
// Legacy API (deprecated, kept for reference)
const HF_API_BASE_LEGACY = "https://api-inference.huggingface.co";
const HF_HUB_API = "https://huggingface.co/api";

export interface HFModel {
  id: string;
  modelId: string;
  author: string;
  tags: string[];
  pipeline_tag: string;
  downloads: number;
  likes: number;
  library_name: string;
}

export interface HFInferenceResult {
  success: boolean;
  result?: any;
  error?: string;
  latency_ms?: number;
}

/**
 * Call a HuggingFace model via the new Router API (OpenAI-compatible)
 */
export async function callHFModel(
  modelId: string,
  inputs: any,
  hfToken?: string
): Promise<HFInferenceResult> {
  const startTime = Date.now();
  const token = hfToken || process.env.HF_TOKEN;
  if (!token) {
    console.error("[hf-adapter] HF_TOKEN missing");
  } else {
    console.info("[hf-adapter] token info", {
      adapter: "huggingface",
      tokenPrefix: token.slice(0, 7),
      tokenLength: token.length,
    });
  }
  
  if (!token) {
    return {
      success: false,
      error: "HuggingFace token required (HF_TOKEN env or hfToken param)",
      latency_ms: Date.now() - startTime,
    };
  }
  
  try {
    // For chat/text-generation models, use OpenAI-compatible endpoint
    const isTextGen = typeof inputs === "string" || inputs.prompt || inputs.messages;
    
    if (isTextGen) {
      // Convert to chat completions format
      const messages = inputs.messages || [
        { role: "user", content: typeof inputs === "string" ? inputs : inputs.prompt || JSON.stringify(inputs) }
      ];
      
      const response = await fetch(`${HF_ROUTER_API}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: inputs.max_tokens || 512,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `HF Router API error: ${response.status} - ${error}`,
          latency_ms: Date.now() - startTime,
        };
      }

      const result = await response.json() as any;
      
      return {
        success: true,
        result: {
          generated_text: result.choices?.[0]?.message?.content || "",
          usage: result.usage,
          raw: result,
        },
        latency_ms: Date.now() - startTime,
      };
    }
    
    // For other tasks, fall back to legacy API (may not work)
    console.warn(`[HF Adapter] Non-chat task for ${modelId}, using legacy API (may fail)`);
    const response = await fetch(`${HF_API_BASE_LEGACY}/models/${modelId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ inputs }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        error: `HF Legacy API error: ${response.status} - ${error}`,
        latency_ms: Date.now() - startTime,
      };
    }

    const result = await response.json();
    
    return {
      success: true,
      result,
      latency_ms: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
      latency_ms: Date.now() - startTime,
    };
  }
}

/**
 * Get popular models from HuggingFace Hub
 */
export async function getPopularModels(
  task?: string,
  limit: number = 100
): Promise<HFModel[]> {
  try {
    let url = `${HF_HUB_API}/models?sort=downloads&direction=-1&limit=${limit}`;
    if (task) {
      url += `&pipeline_tag=${encodeURIComponent(task)}`;
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HF API error: ${response.status}`);
    }
    
    return await response.json() as HFModel[];
  } catch (err) {
    console.error("Failed to fetch HF models:", err);
    return [];
  }
}

/**
 * Convert HF pipeline_tag to Nooterra capability
 */
export function hfTaskToCapability(task: string, modelId: string): string {
  const taskMap: Record<string, string> = {
    "text-generation": "cap.llm.generate",
    "text2text-generation": "cap.llm.transform",
    "summarization": "cap.text.summarize",
    "translation": "cap.text.translate",
    "question-answering": "cap.qa.answer",
    "conversational": "cap.chat.conversation",
    "fill-mask": "cap.text.fillmask",
    "text-classification": "cap.text.classify",
    "token-classification": "cap.text.ner",
    "sentiment-analysis": "cap.text.sentiment",
    "image-classification": "cap.image.classify",
    "object-detection": "cap.image.detect",
    "image-segmentation": "cap.image.segment",
    "image-to-text": "cap.image.caption",
    "text-to-image": "cap.image.generate",
    "automatic-speech-recognition": "cap.audio.transcribe",
    "text-to-speech": "cap.audio.speak",
    "audio-classification": "cap.audio.classify",
    "feature-extraction": "cap.embedding.extract",
    "sentence-similarity": "cap.embedding.similarity",
    "zero-shot-classification": "cap.text.zeroshot",
    "table-question-answering": "cap.table.qa",
    "document-question-answering": "cap.document.qa",
    "visual-question-answering": "cap.vision.qa",
  };
  
  const base = taskMap[task] || `cap.hf.${task.replace(/-/g, "_")}`;
  const modelSlug = modelId.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 30);
  
  return `${base}.${modelSlug}.v1`;
}

/**
 * Register HF models as Nooterra agents
 * Uses the new router.huggingface.co endpoint format
 */
export async function registerHFModelsAsAgents(
  models: HFModel[],
  registryUrl: string,
  walletAddress?: string
): Promise<{ registered: number; failed: number }> {
  let registered = 0;
  let failed = 0;

  for (const model of models) {
    try {
      const did = `did:noot:hf:${model.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const capabilityId = hfTaskToCapability(model.pipeline_tag || "text-generation", model.id);
      
      // Use the new router API format
      const endpoint = `${HF_ROUTER_API}/chat/completions`;
      
      const response = await fetch(`${registryUrl}/v1/agent/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did,
          name: model.id.split("/").pop() || model.id,
          endpoint,
          walletAddress: walletAddress || null,
          metadata: {
            modelId: model.id,
            provider: "huggingface-router",
            pipelineTag: model.pipeline_tag,
          },
          capabilities: [{
            capabilityId,
            description: `HuggingFace model: ${model.id} (${model.pipeline_tag || "unknown"})`,
            tags: [
              "huggingface",
              model.pipeline_tag || "ml",
              model.library_name || "transformers",
              ...(model.tags || []).slice(0, 5),
            ],
            price_cents: calculatePrice(model),
          }],
        }),
      });

      if (response.ok) {
        registered++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
    }
  }

  return { registered, failed };
}

/**
 * Calculate price based on model popularity/size
 */
function calculatePrice(model: HFModel): number {
  // More popular models can charge more
  if (model.downloads > 1000000) return 25;
  if (model.downloads > 100000) return 15;
  if (model.downloads > 10000) return 10;
  return 5;
}

/**
 * HuggingFace tasks we can import
 */
export const HF_IMPORTABLE_TASKS = [
  "text-generation",
  "text2text-generation", 
  "summarization",
  "translation",
  "question-answering",
  "conversational",
  "text-classification",
  "sentiment-analysis",
  "image-classification",
  "object-detection",
  "image-to-text",
  "text-to-image",
  "automatic-speech-recognition",
  "text-to-speech",
  "feature-extraction",
  "sentence-similarity",
  "zero-shot-classification",
];
