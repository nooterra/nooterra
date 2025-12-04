/**
 * Code Review Pipeline Workflow
 * 
 * A DAG that performs automated code review:
 * 1. Analyze code quality (DeepSeek Coder)
 * 2. Generate documentation (Llama 3)
 * 3. Suggest tests (StarCoder2)
 * 4. Security scan (Mistral)
 * 
 * Run: COORD_URL=https://coord.nooterra.ai node code-review.js "<code>"
 */

import crypto from "crypto";

const COORD_URL = process.env.COORD_URL || "https://coord.nooterra.ai";
const API_KEY = process.env.COORDINATOR_API_KEY;

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

// Sample code to review (or pass via CLI)
const SAMPLE_CODE = `
async function fetchUserData(userId) {
  const response = await fetch('/api/users/' + userId);
  const data = await response.json();
  localStorage.setItem('user', JSON.stringify(data));
  return data;
}

function calculateDiscount(price, code) {
  if (code == 'SUMMER20') {
    return price * 0.8;
  } else if (code == 'VIP50') {
    return price * 0.5;
  }
  return price;
}
`;

function createCodeReviewDAG(code) {
  return {
    name: "Code Review Pipeline",
    description: "Automated code analysis, documentation, and test suggestions",
    nodes: [
      {
        id: "code-quality",
        name: "Code Quality Analysis",
        capabilityId: "cap.hf.code.deepseek.v1",
        input: {
          prompt: `Analyze this code for quality issues, bugs, and improvements:

\`\`\`javascript
${code}
\`\`\`

Provide a structured review covering:
1. Bug risks and potential issues
2. Code style improvements
3. Performance considerations
4. Best practice violations

Be specific and actionable.`,
        },
        dependsOn: [],
      },
      {
        id: "documentation",
        name: "Documentation Generator",
        capabilityId: "cap.hf.chat.llama3.v1",
        input: {
          prompt: `Generate JSDoc documentation for this code:

\`\`\`javascript
${code}
\`\`\`

Include:
- Function descriptions
- @param tags with types
- @returns tags
- @example usage
- @throws if applicable`,
        },
        dependsOn: [],
      },
      {
        id: "test-suggestions",
        name: "Test Generator",
        capabilityId: "cap.hf.code.starcoder.v1",
        input: {
          prompt: `Generate Jest unit tests for this code:

\`\`\`javascript
${code}
\`\`\`

Include tests for:
- Happy path scenarios
- Edge cases
- Error handling
- Mock external dependencies (fetch, localStorage)`,
        },
        dependsOn: [],
      },
      {
        id: "security-scan",
        name: "Security Analysis",
        capabilityId: "cap.hf.chat.mistral.v1",
        input: {
          prompt: `Perform a security audit of this JavaScript code:

\`\`\`javascript
${code}
\`\`\`

Check for:
1. Injection vulnerabilities
2. Insecure data storage
3. Authentication/authorization issues
4. Input validation problems
5. Sensitive data exposure

Rate severity as: LOW, MEDIUM, HIGH, CRITICAL`,
        },
        dependsOn: [],
      },
    ],
  };
}

async function runCodeReview(code) {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🔍 Automated Code Review Pipeline                   ║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  const dag = createCodeReviewDAG(code);
  
  try {
    console.log("📝 Creating code review workflow...");
    const workflowId = crypto.randomUUID();
    
    const createResult = await api("/v1/workflows", "POST", {
      id: workflowId,
      intent: "code-review-demo",
      dag: dag.nodes,
      budget_cents: 20,
      metadata: {
        name: dag.name,
        codeLength: code.length,
      },
    });
    
    console.log(`✅ Workflow created: ${workflowId}`);
    
    // Poll for completion
    console.log("\n⏳ Running analysis (4 parallel agents)...\n");
    
    let attempts = 0;
    while (attempts < 60) {
      await new Promise(r => setTimeout(r, 3000));
      
      const status = await api(`/v1/workflows/${workflowId}`);
      const completed = status.nodes?.filter(n => n.status === "success").length || 0;
      
      process.stdout.write(`\r   Progress: ${completed}/${dag.nodes.length} analyses complete`);
      
      if (status.status === "success") {
        console.log("\n\n✅ Review completed!\n");
        return status;
      }
      
      if (status.status === "failed") {
        console.log("\n\n❌ Review failed:", status.error);
        return status;
      }
      
      attempts++;
    }
    
    console.log("\n\n⚠️ Timeout");
    return null;
    
  } catch (err) {
    console.error("❌ Error:", err.message);
    throw err;
  }
}

async function main() {
  const code = process.argv[2] || SAMPLE_CODE;
  
  console.log("📄 Code to review:");
  console.log("─────────────────────────────────────────────────────────────────");
  console.log(code.trim());
  console.log("─────────────────────────────────────────────────────────────────\n");
  
  const result = await runCodeReview(code);
  
  if (result?.status === "success") {
    const outputs = {};
    for (const node of result.nodes || []) {
      outputs[node.id] = node.output;
    }
    
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("🔍 CODE QUALITY ANALYSIS");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(outputs["code-quality"]?.response || "N/A");
    
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("🔒 SECURITY SCAN");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(outputs["security-scan"]?.response || "N/A");
    
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("📚 GENERATED DOCUMENTATION");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(outputs["documentation"]?.response || "N/A");
    
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("🧪 SUGGESTED TESTS");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(outputs["test-suggestions"]?.response || "N/A");
    
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log(`💰 Total cost: ${result.spent_cents || 0} cents`);
    console.log("═══════════════════════════════════════════════════════════════");
  }
}

main().catch(console.error);
