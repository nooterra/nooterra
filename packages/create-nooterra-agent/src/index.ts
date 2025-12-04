#!/usr/bin/env node
/**
 * create-nooterra-agent
 * 
 * The easiest way to start building AI agents that earn money.
 * 
 * Usage:
 *   npx create-nooterra-agent
 *   npx create-nooterra-agent my-agent
 *   npx create-nooterra-agent my-agent --template python
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BANNER = `
${chalk.cyan('╔═══════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}                                                               ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.bold.white('🚀 create-nooterra-agent')}                                    ${chalk.cyan('║')}
${chalk.cyan('║')}                                                               ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.gray('Build AI agents that earn money on the Nooterra network')}     ${chalk.cyan('║')}
${chalk.cyan('║')}                                                               ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════════════╝')}
`;

const program = new Command();

program
  .name('create-nooterra-agent')
  .description('Create a new Nooterra AI agent project')
  .version('0.1.0')
  .argument('[name]', 'Agent project name')
  .option('-t, --template <template>', 'Template: python, node, docker, rust')
  .option('-y, --yes', 'Skip prompts and use defaults')
  .action(async (name, options) => {
    console.log(BANNER);
    
    let answers: any = {};
    
    if (options.yes && name) {
      // Use defaults
      answers = {
        name,
        template: options.template || 'python',
        description: 'An AI agent on Nooterra',
        capability: 'cap.custom.v1',
        price: 10,
      };
    } else {
      // Interactive mode
      answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Agent name:',
          default: name || 'my-agent',
          validate: (input: string) => /^[a-z0-9-]+$/.test(input) || 'Use lowercase letters, numbers, and hyphens only',
        },
        {
          type: 'list',
          name: 'template',
          message: 'Choose your stack:',
          default: options.template,
          choices: [
            { name: '🐍 Python (FastAPI) - Recommended', value: 'python' },
            { name: '🟢 Node.js (Fastify)', value: 'node' },
            { name: '🐳 Docker (Any language)', value: 'docker' },
            { name: '🦀 Rust (Axum)', value: 'rust' },
          ],
        },
        {
          type: 'input',
          name: 'description',
          message: 'What does your agent do?',
          default: 'An AI agent on Nooterra',
        },
        {
          type: 'input',
          name: 'capability',
          message: 'Capability ID (e.g., cap.my.feature.v1):',
          default: 'cap.custom.v1',
        },
        {
          type: 'number',
          name: 'price',
          message: 'Price per call (NCR cents, 100 = $1.00):',
          default: 10,
        },
      ]);
    }

    const spinner = ora('Creating your agent project...').start();
    
    try {
      const projectDir = path.join(process.cwd(), answers.name);
      await fs.mkdir(projectDir, { recursive: true });

      // Generate based on template
      if (answers.template === 'python') {
        await generatePythonProject(projectDir, answers);
      } else if (answers.template === 'node') {
        await generateNodeProject(projectDir, answers);
      } else if (answers.template === 'docker') {
        await generateDockerProject(projectDir, answers);
      } else if (answers.template === 'rust') {
        await generateRustProject(projectDir, answers);
      }

      // Generate common files
      await generateCommonFiles(projectDir, answers);

      spinner.succeed(chalk.green('Agent project created successfully!'));
      
      console.log(chalk.cyan('\n📁 Created files:'));
      const files = await fs.readdir(projectDir);
      for (const file of files) {
        console.log(chalk.gray(`   ${file}`));
      }
      
      console.log(chalk.cyan('\n🚀 Get started:\n'));
      console.log(chalk.white(`   cd ${answers.name}`));
      
      if (answers.template === 'python') {
        console.log(chalk.white('   pip install -r requirements.txt'));
        console.log(chalk.white('   python main.py'));
      } else if (answers.template === 'node') {
        console.log(chalk.white('   npm install'));
        console.log(chalk.white('   npm run dev'));
      } else if (answers.template === 'rust') {
        console.log(chalk.white('   cargo run'));
      } else {
        console.log(chalk.white('   docker build -t my-agent .'));
        console.log(chalk.white('   docker run -p 8080:8080 my-agent'));
      }
      
      console.log(chalk.cyan('\n📖 Deploy to Nooterra:\n'));
      console.log(chalk.white('   npx @nooterra/cli deploy'));
      
      console.log(chalk.cyan('\n📚 Documentation:\n'));
      console.log(chalk.gray('   https://docs.nooterra.ai/guides/build-agent'));
      
      console.log(chalk.green('\n✨ Happy building! Your agent will be earning in no time.\n'));
      
    } catch (err: any) {
      spinner.fail(chalk.red('Failed to create project'));
      console.error(err.message);
      process.exit(1);
    }
  });

// ============ PYTHON TEMPLATE ============
async function generatePythonProject(dir: string, config: any) {
  // requirements.txt
  await fs.writeFile(path.join(dir, 'requirements.txt'), `# Nooterra Agent Requirements
fastapi>=0.109.0
uvicorn>=0.27.0
pydantic>=2.0.0
httpx>=0.26.0
python-dotenv>=1.0.0

# Optional: Nooterra SDK for hiring other agents
# nooterra>=0.2.0
`);

  // main.py
  const handlerName = config.capability.split('.').slice(-2, -1)[0] || 'main';
  await fs.writeFile(path.join(dir, 'main.py'), `"""
${config.name} - Nooterra AI Agent

${config.description}

Capability: ${config.capability}
Price: ${config.price} NCR per call (~$${(config.price / 100).toFixed(2)})

Endpoints:
  POST /nooterra/node  - Main capability endpoint (called by coordinator)
  GET  /health         - Health check
  GET  /acard          - Agent capability card (ACARD)
"""

import os
import hmac
import hashlib
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="${config.name}",
    description="${config.description}",
    version="1.0.0"
)

# Configuration
PORT = int(os.getenv("PORT", 8080))
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
AGENT_DID = os.getenv("AGENT_DID", "did:noot:${config.name}")


# ============ Request/Response Models ============

class NodeRequest(BaseModel):
    """Request from Nooterra coordinator."""
    workflowId: str
    nodeId: str
    capabilityId: str
    inputs: Dict[str, Any]
    eventId: str
    timestamp: str


class NodeResponse(BaseModel):
    """Response to Nooterra coordinator."""
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metrics: Optional[Dict[str, Any]] = None


# ============ Security ============

def verify_signature(payload: bytes, signature: str) -> bool:
    """Verify HMAC-SHA256 signature from Nooterra coordinator."""
    if not WEBHOOK_SECRET:
        return True  # Skip in development
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


# ============ Main Endpoint ============

@app.post("/nooterra/node", response_model=NodeResponse)
async def handle_node(request: Request):
    """
    Main endpoint called by the Nooterra coordinator.
    
    This is where your agent receives work and returns results.
    """
    body = await request.body()
    signature = request.headers.get("x-nooterra-signature", "")
    
    if not verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    req = NodeRequest.model_validate_json(body)
    
    # Route to capability handler
    if req.capabilityId == "${config.capability}":
        return await handle_${handlerName}(req)
    
    return NodeResponse(error=f"Unknown capability: {req.capabilityId}")


async def handle_${handlerName}(req: NodeRequest) -> NodeResponse:
    """
    ${config.description}
    
    This is where you implement your agent's logic.
    
    Args:
        req: The request from Nooterra coordinator
            - req.inputs: The input data for your capability
            - req.workflowId: The workflow this task belongs to
            - req.nodeId: The specific node in the workflow
    
    Returns:
        NodeResponse with your result or error
    """
    try:
        # Get inputs
        # Common input patterns:
        #   req.inputs.get("text")    - Text input
        #   req.inputs.get("url")     - URL to process
        #   req.inputs.get("prompt")  - LLM prompt
        #   req.inputs.get("parents") - Results from parent nodes
        
        input_data = req.inputs
        
        # ======================================
        # TODO: Implement your agent logic here
        # ======================================
        
        # Example: Echo the input
        result = {
            "message": f"Hello from ${config.name}!",
            "received": input_data,
            "capability": "${config.capability}",
        }
        
        # Return success
        return NodeResponse(
            result=result,
            metrics={
                "tokens_used": 0,
                "latency_ms": 100,
            }
        )
        
    except Exception as e:
        # Return error (agent still gets paid for attempting)
        return NodeResponse(error=str(e))


# ============ Utility Endpoints ============

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "agent": "${config.name}"}


@app.get("/acard")
async def acard():
    """
    Agent Capability Card (ACARD).
    
    This describes your agent's capabilities to the network.
    """
    return {
        "did": AGENT_DID,
        "name": "${config.name}",
        "description": "${config.description}",
        "version": "1.0.0",
        "capabilities": [
            {
                "id": "${config.capability}",
                "description": "${config.description}",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "Input text"},
                        # Add your input schema here
                    }
                },
                "outputSchema": {
                    "type": "object",
                    "properties": {
                        "result": {"type": "object", "description": "Result data"}
                    }
                },
                "price_cents": ${config.price}
            }
        ]
    }


# ============ Run Server ============

if __name__ == "__main__":
    import uvicorn
    print(f"\\n🚀 Starting ${config.name} on port {PORT}...")
    print(f"📋 Capability: ${config.capability}")
    print(f"💰 Price: ${config.price} NCR per call\\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
`);

  // .env.example
  await fs.writeFile(path.join(dir, '.env.example'), `# Nooterra Agent Configuration

# Port to run on
PORT=8080

# Agent DID (get from nooterra deploy)
AGENT_DID=did:noot:${config.name}

# Webhook secret (get from nooterra deploy)
WEBHOOK_SECRET=

# Optional: For hiring other agents
# NOOTERRA_API_KEY=
# COORD_URL=https://coord.nooterra.ai
# REGISTRY_URL=https://api.nooterra.ai
`);

  // Dockerfile
  await fs.writeFile(path.join(dir, 'Dockerfile'), `FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s \\
  CMD curl -f http://localhost:8080/health || exit 1

# Run
CMD ["python", "main.py"]
`);

  // .gitignore
  await fs.writeFile(path.join(dir, '.gitignore'), `# Python
__pycache__/
*.py[cod]
*$py.class
.Python
venv/
.env

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
`);
}

// ============ NODE TEMPLATE ============
async function generateNodeProject(dir: string, config: any) {
  // package.json
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: config.name,
    version: "1.0.0",
    description: config.description,
    type: "module",
    scripts: {
      start: "node server.js",
      dev: "node --watch server.js"
    },
    dependencies: {
      fastify: "^4.26.0",
      dotenv: "^16.4.0"
    }
  }, null, 2));

  const handlerName = config.capability.split('.').slice(-2, -1)[0] || 'main';
  
  // server.js
  await fs.writeFile(path.join(dir, 'server.js'), `/**
 * ${config.name} - Nooterra AI Agent
 * 
 * ${config.description}
 * 
 * Capability: ${config.capability}
 * Price: ${config.price} NCR per call (~$${(config.price / 100).toFixed(2)})
 */

import Fastify from 'fastify';
import crypto from 'crypto';
import 'dotenv/config';

const app = Fastify({ logger: true });

// Configuration
const PORT = process.env.PORT || 8080;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const AGENT_DID = process.env.AGENT_DID || 'did:noot:${config.name}';

// Verify webhook signature
function verifySignature(payload, signature) {
  if (!WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Main Nooterra endpoint
app.post('/nooterra/node', async (request, reply) => {
  const signature = request.headers['x-nooterra-signature'] || '';
  const body = JSON.stringify(request.body);
  
  if (!verifySignature(body, signature)) {
    return reply.status(401).send({ error: 'Invalid signature' });
  }
  
  const req = request.body;
  
  // Route to capability handler
  if (req.capabilityId === '${config.capability}') {
    return handle${handlerName.charAt(0).toUpperCase() + handlerName.slice(1)}(req);
  }
  
  return { error: \`Unknown capability: \${req.capabilityId}\` };
});

// Capability handler
async function handle${handlerName.charAt(0).toUpperCase() + handlerName.slice(1)}(req) {
  /**
   * ${config.description}
   * 
   * This is where you implement your agent's logic.
   */
  try {
    const inputs = req.inputs;
    
    // ======================================
    // TODO: Implement your agent logic here
    // ======================================
    
    const result = {
      message: 'Hello from ${config.name}!',
      received: inputs,
      capability: '${config.capability}',
    };
    
    return {
      result,
      metrics: { tokens_used: 0, latency_ms: 100 }
    };
    
  } catch (error) {
    return { error: error.message };
  }
}

// Health check
app.get('/health', async () => ({ status: 'healthy', agent: '${config.name}' }));

// ACARD
app.get('/acard', async () => ({
  did: AGENT_DID,
  name: '${config.name}',
  description: '${config.description}',
  capabilities: [{
    id: '${config.capability}',
    description: '${config.description}',
    price_cents: ${config.price}
  }]
}));

// Start server
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(\`\\n🚀 ${config.name} running at \${address}\`);
  console.log(\`📋 Capability: ${config.capability}\`);
  console.log(\`💰 Price: ${config.price} NCR per call\\n\`);
});
`);

  // .env.example
  await fs.writeFile(path.join(dir, '.env.example'), `PORT=8080
AGENT_DID=did:noot:${config.name}
WEBHOOK_SECRET=
`);

  // Dockerfile
  await fs.writeFile(path.join(dir, 'Dockerfile'), `FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
HEALTHCHECK --interval=30s CMD curl -f http://localhost:8080/health || exit 1
CMD ["node", "server.js"]
`);

  // .gitignore
  await fs.writeFile(path.join(dir, '.gitignore'), `node_modules/
.env
.DS_Store
`);
}

// ============ DOCKER TEMPLATE ============
async function generateDockerProject(dir: string, config: any) {
  // Generic Dockerfile
  await fs.writeFile(path.join(dir, 'Dockerfile'), `# ${config.name} - Nooterra Agent
# 
# This is a template Dockerfile. Customize it for your language/framework.

FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s \\
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["python", "main.py"]
`);

  // Generate Python files as base
  await generatePythonProject(dir, config);
  
  // docker-compose.yml
  await fs.writeFile(path.join(dir, 'docker-compose.yml'), `version: '3.8'

services:
  agent:
    build: .
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - WEBHOOK_SECRET=\${WEBHOOK_SECRET}
      - AGENT_DID=did:noot:${config.name}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 3s
      retries: 3
`);
}

// ============ RUST TEMPLATE ============
async function generateRustProject(dir: string, config: any) {
  // Cargo.toml
  await fs.writeFile(path.join(dir, 'Cargo.toml'), `[package]
name = "${config.name.replace(/-/g, '_')}"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
hmac = "0.12"
sha2 = "0.10"
hex = "0.4"
tower-http = { version = "0.5", features = ["trace"] }
tracing = "0.1"
tracing-subscriber = "0.3"
`);

  // src/main.rs
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src', 'main.rs'), `//! ${config.name} - Nooterra AI Agent
//!
//! ${config.description}
//!
//! Capability: ${config.capability}
//! Price: ${config.price} NCR per call

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::{collections::HashMap, env, sync::Arc};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
struct AppState {
    webhook_secret: String,
    agent_did: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeRequest {
    workflow_id: String,
    node_id: String,
    capability_id: String,
    inputs: HashMap<String, serde_json::Value>,
    event_id: String,
    timestamp: String,
}

#[derive(Serialize)]
struct NodeResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metrics: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    agent: String,
}

fn verify_signature(secret: &str, payload: &[u8], signature: &str) -> bool {
    if secret.is_empty() {
        return true;
    }
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(payload);
    let expected = hex::encode(mac.finalize().into_bytes());
    expected == signature
}

async fn handle_node(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> Result<Json<NodeResponse>, StatusCode> {
    let signature = headers
        .get("x-nooterra-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !verify_signature(&state.webhook_secret, body.as_bytes(), signature) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let req: NodeRequest = serde_json::from_str(&body).map_err(|_| StatusCode::BAD_REQUEST)?;

    if req.capability_id == "${config.capability}" {
        // TODO: Implement your agent logic here
        let result = serde_json::json!({
            "message": "Hello from ${config.name}!",
            "received": req.inputs,
        });

        Ok(Json(NodeResponse {
            result: Some(result),
            error: None,
            metrics: Some(HashMap::from([
                ("tokens_used".to_string(), serde_json::json!(0)),
                ("latency_ms".to_string(), serde_json::json!(100)),
            ])),
        }))
    } else {
        Ok(Json(NodeResponse {
            result: None,
            error: Some(format!("Unknown capability: {}", req.capability_id)),
            metrics: None,
        }))
    }
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        agent: state.agent_did.clone(),
    })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::init();

    let state = Arc::new(AppState {
        webhook_secret: env::var("WEBHOOK_SECRET").unwrap_or_default(),
        agent_did: env::var("AGENT_DID").unwrap_or("did:noot:${config.name}".to_string()),
    });

    let app = Router::new()
        .route("/nooterra/node", post(handle_node))
        .route("/health", get(health))
        .with_state(state);

    let port = env::var("PORT").unwrap_or("8080".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    println!("\\n🚀 ${config.name} running on {}", addr);
    println!("📋 Capability: ${config.capability}");
    println!("💰 Price: ${config.price} NCR per call\\n");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
`);

  // Dockerfile
  await fs.writeFile(path.join(dir, 'Dockerfile'), `FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/${config.name.replace(/-/g, '_')} /usr/local/bin/agent
EXPOSE 8080
CMD ["agent"]
`);

  // .gitignore
  await fs.writeFile(path.join(dir, '.gitignore'), `target/
.env
`);

  // .env.example
  await fs.writeFile(path.join(dir, '.env.example'), `PORT=8080
AGENT_DID=did:noot:${config.name}
WEBHOOK_SECRET=
`);
}

// ============ COMMON FILES ============
async function generateCommonFiles(dir: string, config: any) {
  // nooterra.json
  await fs.writeFile(path.join(dir, 'nooterra.json'), JSON.stringify({
    name: config.name,
    description: config.description,
    version: "1.0.0",
    capabilities: [
      {
        id: config.capability,
        description: config.description,
        price: config.price,
        tags: ["custom"]
      }
    ]
  }, null, 2));

  // README.md
  await fs.writeFile(path.join(dir, 'README.md'), `# ${config.name}

${config.description}

## Quick Start

\`\`\`bash
# Install dependencies
${config.template === 'python' ? 'pip install -r requirements.txt' : 
  config.template === 'node' ? 'npm install' : 
  config.template === 'rust' ? 'cargo build' : 'docker build -t ' + config.name + ' .'}

# Run locally
${config.template === 'python' ? 'python main.py' : 
  config.template === 'node' ? 'npm run dev' : 
  config.template === 'rust' ? 'cargo run' : 'docker run -p 8080:8080 ' + config.name}

# Test the agent
curl http://localhost:8080/health
curl -X POST http://localhost:8080/nooterra/node \\
  -H "Content-Type: application/json" \\
  -d '{"workflowId":"test","nodeId":"n1","capabilityId":"${config.capability}","inputs":{"text":"hello"},"eventId":"e1","timestamp":"2024-01-01T00:00:00Z"}'
\`\`\`

## Deploy to Nooterra

\`\`\`bash
# Install CLI
npm install -g @nooterra/cli

# Connect wallet
nooterra wallet connect

# Deploy
nooterra deploy
\`\`\`

## Capability

| Property | Value |
|----------|-------|
| ID | \`${config.capability}\` |
| Price | ${config.price} NCR (~$${(config.price / 100).toFixed(2)}) |
| Description | ${config.description} |

## Configuration

| Variable | Description |
|----------|-------------|
| \`PORT\` | Port to run on (default: 8080) |
| \`WEBHOOK_SECRET\` | Secret for verifying requests |
| \`AGENT_DID\` | Your agent's DID |

## Documentation

- [Build Your First Agent](https://docs.nooterra.ai/guides/build-agent)
- [Deploy to Production](https://docs.nooterra.ai/guides/deploy)
- [API Reference](https://docs.nooterra.ai/sdk/api)
`);
}

program.parse();
