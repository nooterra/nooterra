/**
 * AI Content Pipeline Workflow
 * 
 * A multi-step DAG that creates blog content:
 * 1. Generate topic idea (Mistral)
 * 2. Write full content (Llama 3)
 * 3. Summarize for social (BART)
 * 4. Analyze sentiment (RoBERTa)
 * 5. Generate cover image (SDXL)
 * 
 * Run: COORD_URL=https://coord.nooterra.ai node content-pipeline.js
 */

import crypto from "crypto";

const COORD_URL = process.env.COORD_URL || "https://coord.nooterra.ai";
const API_KEY = process.env.COORDINATOR_API_KEY;

// Helper to make API calls
async function api(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY && { "x-api-key": API_KEY }),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  
  const res = await fetch(`${COORD_URL}${path}`, opts);
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error: ${res.status} - ${error}`);
  }
  return res.json();
}

// ============================================================================
// WORKFLOW DAG DEFINITION
// ============================================================================

const contentPipelineDAG = {
  name: "AI Content Pipeline",
  description: "Generate a complete blog post with summary and cover image",
  nodes: [
    {
      id: "topic-generator",
      name: "Topic Generator",
      capabilityId: "cap.hf.chat.mistral.v1",
      input: {
        prompt: `Generate a creative and engaging blog post topic about AI technology. 
                 Just provide the topic title, nothing else. Make it catchy and specific.`,
      },
      dependsOn: [],
    },
    {
      id: "content-writer",
      name: "Content Writer",
      capabilityId: "cap.hf.chat.llama3.v1",
      input: {
        prompt: `Write a detailed, engaging blog post about: {{topic-generator.output.response}}
                 
                 Include:
                 - An attention-grabbing introduction
                 - 3-4 main sections with subheadings
                 - Practical examples or use cases
                 - A compelling conclusion
                 
                 Write in a friendly, professional tone. Target length: 500-800 words.`,
      },
      dependsOn: ["topic-generator"],
    },
    {
      id: "summarizer",
      name: "Social Summary",
      capabilityId: "cap.hf.summarize.bart.v1",
      input: {
        text: "{{content-writer.output.response}}",
      },
      dependsOn: ["content-writer"],
    },
    {
      id: "sentiment-analyzer",
      name: "Sentiment Check",
      capabilityId: "cap.hf.sentiment.roberta.v1",
      input: {
        text: "{{content-writer.output.response}}",
      },
      dependsOn: ["content-writer"],
    },
    {
      id: "image-generator",
      name: "Cover Image",
      capabilityId: "cap.hf.image.turbo.v1",
      input: {
        prompt: `Professional blog cover image for article about: {{topic-generator.output.response}}. 
                 Modern, clean design, abstract tech visualization, vibrant colors, 4k quality`,
        options: {
          negativePrompt: "text, words, letters, watermark, blurry, low quality",
        },
      },
      dependsOn: ["topic-generator"],
    },
  ],
  // Final output combines all node results
  outputMapping: {
    topic: "{{topic-generator.output.response}}",
    content: "{{content-writer.output.response}}",
    summary: "{{summarizer.output.summary}}",
    sentiment: "{{sentiment-analyzer.output.labels}}",
    coverImage: "{{image-generator.output.image}}",
  },
};

// ============================================================================
// WORKFLOW EXECUTION
// ============================================================================

async function createAndRunWorkflow() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🚀 AI Content Pipeline                              ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  try {
    // Step 1: Create the workflow
    console.log("📝 Creating workflow...");
    const workflowId = crypto.randomUUID();
    
    const createResult = await api("/v1/workflows", "POST", {
      id: workflowId,
      intent: "content-pipeline-demo",
      dag: contentPipelineDAG.nodes,
      budget_cents: 50, // Max 50 cents for this workflow
      metadata: {
        name: contentPipelineDAG.name,
        description: contentPipelineDAG.description,
      },
    });
    
    console.log(`✅ Workflow created: ${workflowId}`);
    console.log(`   Status: ${createResult.status || "pending"}`);
    
    // Step 2: Poll for completion
    console.log("\n⏳ Waiting for execution...\n");
    
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max
    
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
      
      const status = await api(`/v1/workflows/${workflowId}`);
      
      // Show progress
      const completedNodes = status.nodes?.filter(n => n.status === "success").length || 0;
      const totalNodes = contentPipelineDAG.nodes.length;
      const progress = Math.round((completedNodes / totalNodes) * 100);
      
      process.stdout.write(`\r   Progress: [${"█".repeat(progress / 5)}${"░".repeat(20 - progress / 5)}] ${progress}% (${completedNodes}/${totalNodes} nodes)`);
      
      if (status.status === "success") {
        console.log("\n\n✅ Workflow completed successfully!\n");
        return status;
      }
      
      if (status.status === "failed") {
        console.log("\n\n❌ Workflow failed:", status.error || "Unknown error");
        return status;
      }
      
      attempts++;
    }
    
    console.log("\n\n⚠️ Timeout waiting for workflow completion");
    return null;
    
  } catch (err) {
    console.error("❌ Error:", err.message);
    throw err;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const result = await createAndRunWorkflow();
  
  if (result?.status === "success") {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("📄 GENERATED CONTENT");
    console.log("═══════════════════════════════════════════════════════════════\n");
    
    // Extract outputs from nodes
    const outputs = {};
    for (const node of result.nodes || []) {
      outputs[node.id] = node.output;
    }
    
    console.log("🏷️  TOPIC:");
    console.log(`   ${outputs["topic-generator"]?.response || "N/A"}\n`);
    
    console.log("📝 SUMMARY (for social media):");
    console.log(`   ${outputs["summarizer"]?.summary || "N/A"}\n`);
    
    console.log("😊 SENTIMENT:");
    console.log(`   ${JSON.stringify(outputs["sentiment-analyzer"]?.labels || "N/A")}\n`);
    
    console.log("📖 FULL CONTENT:");
    console.log("─────────────────────────────────────────────────────────────────");
    console.log(outputs["content-writer"]?.response || "N/A");
    console.log("─────────────────────────────────────────────────────────────────\n");
    
    if (outputs["image-generator"]?.image) {
      console.log("🖼️  COVER IMAGE: Generated (base64 data available)");
    }
    
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("💰 COST BREAKDOWN");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`   Total spent: ${result.spent_cents || 0} cents`);
    console.log(`   Budget remaining: ${(result.budget_cents || 50) - (result.spent_cents || 0)} cents`);
  }
}

main().catch(console.error);
