import Fastify from "fastify";
import cors from "@fastify/cors";
import { HfInference } from "@huggingface/inference";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const PORT = process.env.PORT || 4020;
const REGISTRY_URL = process.env.REGISTRY_URL || "https://api.nooterra.ai";
const REGISTRY_API_KEY = process.env.REGISTRY_API_KEY;
const HF_TOKEN = process.env.HF_TOKEN; // Optional - enables higher rate limits
const AGENT_DID = `did:noot:agent:huggingface-${crypto.randomBytes(4).toString("hex")}`;

// Initialize Hugging Face client
const hf = new HfInference(HF_TOKEN);

// ============================================================================
// HUGGING FACE MODELS CATALOG
// ============================================================================
const MODELS = {
  // Text Generation
  "mistral-7b": { id: "mistralai/Mistral-7B-Instruct-v0.2", type: "text-generation" },
  "llama-3": { id: "meta-llama/Meta-Llama-3-8B-Instruct", type: "text-generation" },
  "phi-3": { id: "microsoft/Phi-3-mini-4k-instruct", type: "text-generation" },
  "qwen2": { id: "Qwen/Qwen2-7B-Instruct", type: "text-generation" },
  "gemma-2": { id: "google/gemma-2-9b-it", type: "text-generation" },
  "zephyr": { id: "HuggingFaceH4/zephyr-7b-beta", type: "text-generation" },
  
  // Code Generation
  "starcoder2": { id: "bigcode/starcoder2-15b", type: "text-generation" },
  "codellama": { id: "codellama/CodeLlama-13b-Instruct-hf", type: "text-generation" },
  "deepseek-coder": { id: "deepseek-ai/deepseek-coder-6.7b-instruct", type: "text-generation" },
  
  // Summarization
  "bart-cnn": { id: "facebook/bart-large-cnn", type: "summarization" },
  "pegasus": { id: "google/pegasus-xsum", type: "summarization" },
  
  // Translation
  "nllb": { id: "facebook/nllb-200-distilled-600M", type: "translation" },
  "mbart": { id: "facebook/mbart-large-50-many-to-many-mmt", type: "translation" },
  
  // Embeddings
  "bge-large": { id: "BAAI/bge-large-en-v1.5", type: "embedding" },
  "e5-large": { id: "intfloat/e5-large-v2", type: "embedding" },
  "gte-large": { id: "thenlper/gte-large", type: "embedding" },
  
  // Classification
  "roberta-sentiment": { id: "cardiffnlp/twitter-roberta-base-sentiment-latest", type: "classification" },
  "finbert": { id: "ProsusAI/finbert", type: "classification" },
  
  // Image Generation
  "sdxl": { id: "stabilityai/stable-diffusion-xl-base-1.0", type: "text-to-image" },
  "sdxl-turbo": { id: "stabilityai/sdxl-turbo", type: "text-to-image" },
  "playground": { id: "playgroundai/playground-v2.5-1024px-aesthetic", type: "text-to-image" },
  
  // Speech
  "whisper-large": { id: "openai/whisper-large-v3", type: "speech-to-text" },
  "bark": { id: "suno/bark", type: "text-to-speech" },
  
  // Vision
  "llava": { id: "llava-hf/llava-1.5-7b-hf", type: "image-to-text" },
  "blip2": { id: "Salesforce/blip2-opt-2.7b", type: "image-to-text" },
};

// ============================================================================
// CAPABILITIES
// ============================================================================
const CAPABILITIES = [
  {
    capabilityId: "cap.hf.chat.mistral.v1",
    description: "Chat with Mistral 7B Instruct - fast, high-quality responses",
    tags: ["llm", "chat", "mistral", "instruct"],
    price_cents: 1,
    model: "mistral-7b",
  },
  {
    capabilityId: "cap.hf.chat.llama3.v1",
    description: "Chat with Meta Llama 3 8B - state-of-the-art open model",
    tags: ["llm", "chat", "llama", "meta"],
    price_cents: 2,
    model: "llama-3",
  },
  {
    capabilityId: "cap.hf.chat.qwen2.v1",
    description: "Chat with Qwen2 7B - excellent multilingual support",
    tags: ["llm", "chat", "qwen", "multilingual"],
    price_cents: 1,
    model: "qwen2",
  },
  {
    capabilityId: "cap.hf.code.starcoder.v1",
    description: "Generate code with StarCoder2 - trained on 600+ languages",
    tags: ["code", "generation", "programming", "starcoder"],
    price_cents: 2,
    model: "starcoder2",
  },
  {
    capabilityId: "cap.hf.code.deepseek.v1",
    description: "Generate code with DeepSeek Coder - optimized for coding tasks",
    tags: ["code", "generation", "programming", "deepseek"],
    price_cents: 1,
    model: "deepseek-coder",
  },
  {
    capabilityId: "cap.hf.summarize.bart.v1",
    description: "Summarize text using BART - CNN/DailyMail trained",
    tags: ["summarization", "text", "bart"],
    price_cents: 0,
    model: "bart-cnn",
  },
  {
    capabilityId: "cap.hf.embed.bge.v1",
    description: "Generate embeddings with BGE Large - top-tier embeddings",
    tags: ["embeddings", "vectors", "semantic", "search"],
    price_cents: 0,
    model: "bge-large",
  },
  {
    capabilityId: "cap.hf.sentiment.roberta.v1",
    description: "Analyze sentiment with RoBERTa - Twitter-trained classifier",
    tags: ["sentiment", "classification", "twitter", "nlp"],
    price_cents: 0,
    model: "roberta-sentiment",
  },
  {
    capabilityId: "cap.hf.image.sdxl.v1",
    description: "Generate images with SDXL - high-quality 1024x1024 images",
    tags: ["image", "generation", "stable-diffusion", "sdxl"],
    price_cents: 5,
    model: "sdxl",
  },
  {
    capabilityId: "cap.hf.image.turbo.v1",
    description: "Fast image generation with SDXL Turbo - 1-step inference",
    tags: ["image", "generation", "fast", "sdxl-turbo"],
    price_cents: 2,
    model: "sdxl-turbo",
  },
  {
    capabilityId: "cap.hf.transcribe.whisper.v1",
    description: "Transcribe audio with Whisper Large v3 - industry-leading ASR",
    tags: ["speech", "transcription", "whisper", "audio"],
    price_cents: 3,
    model: "whisper-large",
  },
];

// ============================================================================
// INFERENCE FUNCTIONS
// ============================================================================

async function generateText(modelKey, prompt, options = {}) {
  const model = MODELS[modelKey];
  if (!model) throw new Error(`Unknown model: ${modelKey}`);
  
  const result = await hf.textGeneration({
    model: model.id,
    inputs: prompt,
    parameters: {
      max_new_tokens: options.maxTokens || 512,
      temperature: options.temperature || 0.7,
      top_p: options.topP || 0.95,
      return_full_text: false,
    },
  });
  
  return result.generated_text;
}

async function summarize(modelKey, text) {
  const model = MODELS[modelKey];
  const result = await hf.summarization({
    model: model.id,
    inputs: text,
    parameters: {
      max_length: 150,
      min_length: 30,
    },
  });
  return result.summary_text;
}

async function embed(modelKey, text) {
  const model = MODELS[modelKey];
  const result = await hf.featureExtraction({
    model: model.id,
    inputs: text,
  });
  return result;
}

async function classify(modelKey, text) {
  const model = MODELS[modelKey];
  const result = await hf.textClassification({
    model: model.id,
    inputs: text,
  });
  return result;
}

async function generateImage(modelKey, prompt, options = {}) {
  const model = MODELS[modelKey];
  const result = await hf.textToImage({
    model: model.id,
    inputs: prompt,
    parameters: {
      negative_prompt: options.negativePrompt || "",
      num_inference_steps: options.steps || (modelKey === "sdxl-turbo" ? 4 : 30),
    },
  });
  
  // Convert blob to base64
  const buffer = await result.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:image/png;base64,${base64}`;
}

async function transcribe(modelKey, audioUrl) {
  const model = MODELS[modelKey];
  const response = await fetch(audioUrl);
  const audioBlob = await response.blob();
  
  const result = await hf.automaticSpeechRecognition({
    model: model.id,
    data: audioBlob,
  });
  return result.text;
}

// ============================================================================
// ROUTES
// ============================================================================

app.get("/health", async () => ({
  ok: true,
  agent: AGENT_DID,
  capabilities: CAPABILITIES.length,
  hasToken: !!HF_TOKEN,
}));

// Nooterra node execution endpoint
app.post("/nooterra/node", async (request, reply) => {
  const { workflowId, nodeId, capabilityId, input, context } = request.body;
  
  console.log(`📥 [${AGENT_DID}] Executing: ${capabilityId}`, { workflowId, nodeId });
  
  try {
    const capability = CAPABILITIES.find(c => c.capabilityId === capabilityId);
    if (!capability) {
      return reply.status(400).send({ error: `Unknown capability: ${capabilityId}` });
    }
    
    const modelKey = capability.model;
    const modelInfo = MODELS[modelKey];
    let result;
    
    const textInput = input?.text || input?.prompt || input?.query || input?.message || 
                      (typeof input === "string" ? input : JSON.stringify(input));
    
    switch (modelInfo.type) {
      case "text-generation":
        result = {
          response: await generateText(modelKey, textInput, input?.options || {}),
          model: modelInfo.id,
          type: "text",
        };
        break;
        
      case "summarization":
        result = {
          summary: await summarize(modelKey, textInput),
          model: modelInfo.id,
          type: "summary",
        };
        break;
        
      case "embedding":
        result = {
          embedding: await embed(modelKey, textInput),
          model: modelInfo.id,
          dimensions: 1024,
          type: "embedding",
        };
        break;
        
      case "classification":
        const labels = await classify(modelKey, textInput);
        result = {
          labels,
          model: modelInfo.id,
          type: "classification",
        };
        break;
        
      case "text-to-image":
        result = {
          image: await generateImage(modelKey, textInput, input?.options || {}),
          model: modelInfo.id,
          type: "image",
        };
        break;
        
      case "speech-to-text":
        if (!input?.audioUrl) {
          return reply.status(400).send({ error: "audioUrl required for transcription" });
        }
        result = {
          transcript: await transcribe(modelKey, input.audioUrl),
          model: modelInfo.id,
          type: "transcript",
        };
        break;
        
      default:
        return reply.status(400).send({ error: `Unsupported model type: ${modelInfo.type}` });
    }
    
    console.log(`✅ [${AGENT_DID}] Completed: ${capabilityId}`);
    
    return {
      nodeId,
      workflowId,
      status: "success",
      output: result,
    };
    
  } catch (err) {
    console.error(`❌ [${AGENT_DID}] Error:`, err);
    return reply.status(500).send({
      nodeId,
      workflowId,
      status: "error",
      error: err.message,
    });
  }
});

// Register with Nooterra Registry
async function registerWithRegistry() {
  if (!REGISTRY_API_KEY) {
    console.log("⚠️ REGISTRY_API_KEY not set, skipping registration");
    return;
  }
  
  const endpoint = process.env.AGENT_ENDPOINT || `http://localhost:${PORT}`;
  
  try {
    const response = await fetch(`${REGISTRY_URL}/v1/agent/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": REGISTRY_API_KEY,
      },
      body: JSON.stringify({
        did: AGENT_DID,
        name: "HuggingFace Multi-Model Agent",
        endpoint: `${endpoint}/nooterra/node`,
        capabilities: CAPABILITIES.map(({ model, ...cap }) => cap), // Strip model field
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error("❌ Registration failed:", error);
      return;
    }
    
    const result = await response.json();
    console.log(`✅ Registered with registry:`, result);
  } catch (err) {
    console.error("❌ Failed to register:", err);
  }
}

// Start server
app.listen({ port: Number(PORT), host: "0.0.0.0" }, async (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🤗 HuggingFace Multi-Model Agent                    ║
╠═══════════════════════════════════════════════════════════════╣
║  DID: ${AGENT_DID.padEnd(50)} ║
║  Endpoint: ${address.padEnd(44)} ║
║  Capabilities: ${String(CAPABILITIES.length).padEnd(40)} ║
║  HF Token: ${(HF_TOKEN ? "✅ Configured" : "❌ Not set").padEnd(44)} ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  // Register after startup
  await registerWithRegistry();
});
