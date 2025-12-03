#!/usr/bin/env node
/**
 * Nooterra CLI
 * 
 * Build and deploy AI agents that earn money.
 * Works with ANY programming language.
 * 
 * Commands:
 *   nooterra init              - Create a new agent project
 *   nooterra wallet connect    - Connect your wallet for payments
 *   nooterra wallet balance    - Check your earnings
 *   nooterra wallet withdraw   - Withdraw earnings to wallet
 *   nooterra deploy            - Deploy agent to the network
 *   nooterra logs              - View agent logs
 *   nooterra status            - Check network status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { ethers } from 'ethers';
import qrcode from 'qrcode-terminal';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REGISTRY_URL = process.env.NOOTERRA_REGISTRY_URL || 'https://registry.nooterra.ai';
const COORDINATOR_URL = process.env.NOOTERRA_COORDINATOR_URL || 'https://coord.nooterra.ai';

const CONFIG_DIR = path.join(process.env.HOME || '~', '.nooterra');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface Config {
  walletAddress?: string;
  privateKey?: string; // Encrypted
  did?: string;
  apiKey?: string;
}

async function loadConfig(): Promise<Config> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const program = new Command();

program
  .name('nooterra')
  .description('Build and deploy AI agents that earn money on Nooterra')
  .version('0.1.0');

// ============ INIT COMMAND ============
program
  .command('init')
  .description('Create a new agent project')
  .option('-n, --name <name>', 'Agent name')
  .option('-t, --template <template>', 'Template: python, node, docker, rust')
  .action(async (options) => {
    console.log(chalk.cyan('\n🚀 Nooterra Agent Generator\n'));
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Agent name:',
        default: options.name || 'my-agent',
        validate: (input: string) => /^[a-z0-9-]+$/.test(input) || 'Use lowercase letters, numbers, and hyphens only',
      },
      {
        type: 'list',
        name: 'template',
        message: 'Choose a template:',
        default: options.template,
        choices: [
          { name: '🐍 Python (FastAPI)', value: 'python' },
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
        message: 'Price per call (NCR cents):',
        default: 10,
      },
    ]);

    const spinner = ora('Generating project...').start();
    
    try {
      const projectDir = path.join(process.cwd(), answers.name);
      await fs.mkdir(projectDir, { recursive: true });

      // Generate based on template
      if (answers.template === 'python') {
        await generatePythonTemplate(projectDir, answers);
      } else if (answers.template === 'node') {
        await generateNodeTemplate(projectDir, answers);
      } else if (answers.template === 'docker') {
        await generateDockerTemplate(projectDir, answers);
      } else if (answers.template === 'rust') {
        await generateRustTemplate(projectDir, answers);
      }

      // Generate common files
      await generateCommonFiles(projectDir, answers);

      spinner.succeed(chalk.green('Project created successfully!'));
      
      console.log(chalk.cyan('\n📁 Created files:'));
      console.log(chalk.gray(`   ${projectDir}/`));
      
      console.log(chalk.cyan('\n🚀 Next steps:'));
      console.log(chalk.white(`   cd ${answers.name}`));
      console.log(chalk.white(`   nooterra wallet connect`));
      console.log(chalk.white(`   nooterra deploy`));
      
    } catch (err: any) {
      spinner.fail(chalk.red('Failed to generate project'));
      console.error(err.message);
    }
  });

// ============ WALLET COMMANDS ============
const wallet = program.command('wallet').description('Manage your wallet');

wallet
  .command('connect')
  .description('Connect your wallet to receive payments')
  .action(async () => {
    console.log(chalk.cyan('\n💰 Connect Your Wallet\n'));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'method',
        message: 'How would you like to connect?',
        choices: [
          { name: '📝 Enter wallet address', value: 'address' },
          { name: '🔑 Import private key (for signing)', value: 'privatekey' },
          { name: '🆕 Generate new wallet', value: 'generate' },
        ],
      },
    ]);

    const config = await loadConfig();

    if (answers.method === 'address') {
      const { address } = await inquirer.prompt([
        {
          type: 'input',
          name: 'address',
          message: 'Wallet address (0x...):',
          validate: (input: string) => /^0x[a-fA-F0-9]{40}$/.test(input) || 'Invalid Ethereum address',
        },
      ]);
      config.walletAddress = address.toLowerCase();
      
    } else if (answers.method === 'privatekey') {
      const { privateKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'privateKey',
          message: 'Private key:',
          mask: '*',
        },
      ]);
      const wallet = new ethers.Wallet(privateKey);
      config.walletAddress = wallet.address.toLowerCase();
      config.privateKey = privateKey; // TODO: Encrypt this
      
    } else if (answers.method === 'generate') {
      const wallet = ethers.Wallet.createRandom();
      config.walletAddress = wallet.address.toLowerCase();
      config.privateKey = wallet.privateKey;
      
      console.log(chalk.yellow('\n⚠️  SAVE THIS INFORMATION SECURELY:\n'));
      console.log(chalk.white(`Address: ${wallet.address}`));
      console.log(chalk.white(`Private Key: ${wallet.privateKey}`));
      console.log(chalk.white(`Mnemonic: ${wallet.mnemonic?.phrase}`));
      console.log(chalk.yellow('\n⚠️  Never share your private key or mnemonic!\n'));
    }

    await saveConfig(config);
    
    console.log(chalk.green(`\n✅ Wallet connected: ${config.walletAddress}`));
    console.log(chalk.gray('Your earnings will be sent to this address.'));
    
    // Show QR code for easy funding
    console.log(chalk.cyan('\n📱 Scan to fund your wallet:\n'));
    qrcode.generate(config.walletAddress!, { small: true });
  });

wallet
  .command('balance')
  .description('Check your earnings balance')
  .action(async () => {
    const config = await loadConfig();
    if (!config.walletAddress) {
      console.log(chalk.red('No wallet connected. Run: nooterra wallet connect'));
      return;
    }

    const spinner = ora('Fetching balance...').start();
    
    try {
      const res = await fetch(`${COORDINATOR_URL}/v1/ledger/accounts/did:noot:wallet:${config.walletAddress}`);
      
      if (!res.ok) {
        spinner.fail('Could not fetch balance');
        return;
      }
      
      const data = await res.json() as any;
      spinner.succeed('Balance retrieved');
      
      console.log(chalk.cyan('\n💰 Your Earnings\n'));
      console.log(chalk.white(`Wallet: ${config.walletAddress}`));
      console.log(chalk.green(`\nBalance: ${(data.account?.balance || 0).toLocaleString()} NCR`));
      console.log(chalk.gray(`         ≈ $${((data.account?.balance || 0) / 100).toFixed(2)} USD`));
      
      if (data.events?.length > 0) {
        console.log(chalk.cyan('\n📊 Recent Activity:\n'));
        for (const event of data.events.slice(0, 5)) {
          const sign = event.delta > 0 ? chalk.green('+') : chalk.red('');
          console.log(chalk.gray(`  ${new Date(event.created_at).toLocaleDateString()} ${sign}${event.delta} NCR - ${event.reason}`));
        }
      }
      
    } catch (err: any) {
      spinner.fail('Failed to fetch balance');
      console.error(err.message);
    }
  });

wallet
  .command('withdraw')
  .description('Withdraw earnings to your wallet (USDC)')
  .action(async () => {
    const config = await loadConfig();
    if (!config.walletAddress) {
      console.log(chalk.red('No wallet connected. Run: nooterra wallet connect'));
      return;
    }

    console.log(chalk.cyan('\n💸 Withdraw Earnings\n'));
    console.log(chalk.yellow('Coming soon: Direct USDC withdrawals to your wallet'));
    console.log(chalk.gray('\nFor now, earnings accumulate as NCR credits.'));
    console.log(chalk.gray('Contact support@nooterra.ai for manual withdrawals > 1000 NCR.'));
  });

// ============ DEPLOY COMMAND ============
program
  .command('deploy')
  .description('Deploy your agent to the Nooterra network')
  .option('-d, --dir <directory>', 'Project directory', '.')
  .action(async (options) => {
    const config = await loadConfig();
    
    console.log(chalk.cyan('\n🚀 Deploy Agent to Nooterra\n'));
    
    // Check for nooterra.json
    const configPath = path.join(options.dir, 'nooterra.json');
    let agentConfig: any;
    
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      agentConfig = JSON.parse(data);
    } catch {
      console.log(chalk.red('No nooterra.json found. Run: nooterra init'));
      return;
    }

    // Ensure wallet is connected
    if (!config.walletAddress) {
      console.log(chalk.yellow('No wallet connected. Your agent won\'t receive payments.'));
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Deploy without wallet?',
          default: false,
        },
      ]);
      if (!proceed) {
        console.log(chalk.gray('Run: nooterra wallet connect'));
        return;
      }
    }

    const { endpoint } = await inquirer.prompt([
      {
        type: 'input',
        name: 'endpoint',
        message: 'Agent endpoint URL:',
        default: agentConfig.endpoint || 'https://your-agent.railway.app',
        validate: (input: string) => input.startsWith('http') || 'Must be a valid URL',
      },
    ]);

    const spinner = ora('Registering agent...').start();
    
    try {
      // Generate DID if not exists
      const did = config.did || `did:noot:agent:${Date.now().toString(36)}`;
      
      const res = await fetch(`${REGISTRY_URL}/v1/agent/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
        },
        body: JSON.stringify({
          did,
          name: agentConfig.name,
          endpoint,
          walletAddress: config.walletAddress,
          capabilities: agentConfig.capabilities.map((cap: any) => ({
            capabilityId: cap.id,
            description: cap.description,
            tags: cap.tags || [],
            price_cents: cap.price || 10,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error || 'Registration failed');
      }

      // Save DID
      config.did = did;
      await saveConfig(config);

      spinner.succeed(chalk.green('Agent deployed successfully!'));
      
      console.log(chalk.cyan('\n📋 Agent Details:\n'));
      console.log(chalk.white(`DID:      ${did}`));
      console.log(chalk.white(`Endpoint: ${endpoint}`));
      console.log(chalk.white(`Wallet:   ${config.walletAddress || 'Not connected'}`));
      
      console.log(chalk.cyan('\n🎯 Capabilities:\n'));
      for (const cap of agentConfig.capabilities) {
        console.log(chalk.white(`  • ${cap.id} - ${cap.price || 10} NCR/call`));
      }
      
      console.log(chalk.green('\n✅ Your agent is now live on the Nooterra network!'));
      console.log(chalk.gray('Users can now discover and use your agent.'));
      
    } catch (err: any) {
      spinner.fail(chalk.red('Deployment failed'));
      console.error(err.message);
    }
  });

// ============ STATUS COMMAND ============
program
  .command('status')
  .description('Check Nooterra network status')
  .action(async () => {
    const spinner = ora('Checking network status...').start();
    
    try {
      const [coordRes, regRes] = await Promise.all([
        fetch(`${COORDINATOR_URL}/health`).catch(() => null),
        fetch(`${REGISTRY_URL}/health`).catch(() => null),
      ]);

      spinner.stop();
      
      console.log(chalk.cyan('\n🌐 Nooterra Network Status\n'));
      
      console.log(chalk.white('Coordinator: ') + 
        (coordRes?.ok ? chalk.green('✓ Online') : chalk.red('✗ Offline')));
      console.log(chalk.white('Registry:    ') + 
        (regRes?.ok ? chalk.green('✓ Online') : chalk.red('✗ Offline')));
      
      // Get network stats
      if (coordRes?.ok) {
        try {
          const statsRes = await fetch(`${COORDINATOR_URL}/v1/workflows?limit=1`);
          if (statsRes.ok) {
            console.log(chalk.cyan('\n📊 Network Activity:'));
            console.log(chalk.gray('  Workflows processed today: --'));
            console.log(chalk.gray('  Active agents: --'));
          }
        } catch {}
      }
      
    } catch (err: any) {
      spinner.fail('Could not check status');
      console.error(err.message);
    }
  });

// ============ LOGS COMMAND ============
program
  .command('logs')
  .description('View your agent logs')
  .option('-f, --follow', 'Follow log output')
  .action(async (options) => {
    const config = await loadConfig();
    if (!config.did) {
      console.log(chalk.red('No agent deployed. Run: nooterra deploy'));
      return;
    }

    console.log(chalk.cyan(`\n📜 Logs for ${config.did}\n`));
    console.log(chalk.yellow('Real-time logs coming soon!'));
    console.log(chalk.gray('\nCheck your agent\'s hosting platform for logs.'));
  });

// ============ TEMPLATE GENERATORS ============

async function generatePythonTemplate(dir: string, config: any) {
  // requirements.txt
  await fs.writeFile(path.join(dir, 'requirements.txt'), `fastapi>=0.109.0
uvicorn>=0.27.0
pydantic>=2.0.0
httpx>=0.26.0
`);

  // main.py
  await fs.writeFile(path.join(dir, 'main.py'), `"""
${config.name} - A Nooterra AI Agent

This agent provides: ${config.description}
"""

from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, Optional
import hmac
import hashlib
import os

app = FastAPI(title="${config.name}")

WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")


class NodeRequest(BaseModel):
    workflowId: str
    nodeId: str
    capabilityId: str
    inputs: Dict[str, Any]
    eventId: str
    timestamp: str


class NodeResponse(BaseModel):
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metrics: Optional[Dict[str, Any]] = None


def verify_signature(payload: bytes, signature: str) -> bool:
    """Verify HMAC signature from Nooterra coordinator."""
    if not WEBHOOK_SECRET:
        return True  # Skip verification in dev
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@app.post("/nooterra/node")
async def handle_node(request: Request):
    """Main endpoint called by Nooterra coordinator."""
    body = await request.body()
    signature = request.headers.get("x-nooterra-signature", "")
    
    if not verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    req = NodeRequest.parse_raw(body)
    
    # Route to capability handler
    if req.capabilityId == "${config.capability}":
        return await handle_${config.capability.split('.').slice(-2, -1)[0] || 'main'}(req)
    
    return NodeResponse(error=f"Unknown capability: {req.capabilityId}")


async def handle_${config.capability.split('.').slice(-2, -1)[0] || 'main'}(req: NodeRequest) -> NodeResponse:
    """
    ${config.description}
    
    Inputs: req.inputs contains the request data
    Parent outputs: req.inputs.get("parents", {}) for dependent nodes
    """
    try:
        # TODO: Implement your logic here
        result = {
            "message": "Hello from ${config.name}!",
            "input_received": req.inputs,
        }
        
        return NodeResponse(
            result=result,
            metrics={"tokens_used": 0, "latency_ms": 100}
        )
        
    except Exception as e:
        return NodeResponse(error=str(e))


@app.get("/health")
async def health():
    return {"status": "healthy", "agent": "${config.name}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8080)))
`);

  // Dockerfile
  await fs.writeFile(path.join(dir, 'Dockerfile'), `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

CMD ["python", "main.py"]
`);
}

async function generateNodeTemplate(dir: string, config: any) {
  // package.json
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: config.name,
    version: "1.0.0",
    type: "module",
    scripts: {
      start: "node server.js",
      dev: "node --watch server.js"
    },
    dependencies: {
      fastify: "^4.26.0"
    }
  }, null, 2));

  // server.js
  await fs.writeFile(path.join(dir, 'server.js'), `/**
 * ${config.name} - A Nooterra AI Agent
 * 
 * ${config.description}
 */

import Fastify from 'fastify';
import crypto from 'crypto';

const app = Fastify({ logger: true });
const PORT = process.env.PORT || 8080;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

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
  
  const { workflowId, nodeId, capabilityId, inputs } = request.body;
  
  if (capabilityId === '${config.capability}') {
    return handle${config.capability.split('.').slice(-2, -1)[0]?.replace(/^\w/, (c: string) => c.toUpperCase()) || 'Main'}(inputs);
  }
  
  return { error: \`Unknown capability: \${capabilityId}\` };
});

async function handle${config.capability.split('.').slice(-2, -1)[0]?.replace(/^\w/, (c: string) => c.toUpperCase()) || 'Main'}(inputs) {
  /**
   * ${config.description}
   * 
   * @param inputs - Request inputs
   * @param inputs.parents - Outputs from parent nodes (for dependent workflows)
   */
  try {
    // TODO: Implement your logic here
    const result = {
      message: 'Hello from ${config.name}!',
      input_received: inputs,
    };
    
    return {
      result,
      metrics: { tokens_used: 0, latency_ms: 100 }
    };
    
  } catch (err) {
    return { error: err.message };
  }
}

app.get('/health', async () => ({ status: 'healthy', agent: '${config.name}' }));

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) throw err;
  console.log(\`🚀 ${config.name} running on port \${PORT}\`);
});
`);

  // Dockerfile
  await fs.writeFile(path.join(dir, 'Dockerfile'), `FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
`);
}

async function generateDockerTemplate(dir: string, config: any) {
  await fs.writeFile(path.join(dir, 'Dockerfile'), `# Generic Nooterra Agent Template
# Replace this with your own implementation

FROM python:3.11-slim

WORKDIR /app

# Install your dependencies
# COPY requirements.txt .
# RUN pip install -r requirements.txt

COPY . .

EXPOSE 8080

# Your start command
CMD ["python", "main.py"]
`);

  await fs.writeFile(path.join(dir, 'main.py'), `"""
${config.name} - Docker Agent Template

Implement your agent logic here in any language.
Just make sure to:
1. Listen on port 8080 (or PORT env var)
2. Handle POST /nooterra/node
3. Return { result: {...} } or { error: "..." }
"""

print("Replace this with your agent implementation!")
`);
}

async function generateRustTemplate(dir: string, config: any) {
  await fs.writeFile(path.join(dir, 'Cargo.toml'), `[package]
name = "${config.name.replace(/-/g, '_')}"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`);

  await fs.writeFile(path.join(dir, 'src/main.rs'), `//! ${config.name} - A Nooterra AI Agent
//! ${config.description}

use axum::{routing::{get, post}, Router, Json};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

#[derive(Deserialize)]
struct NodeRequest {
    workflow_id: String,
    node_id: String,
    capability_id: String,
    inputs: serde_json::Value,
}

#[derive(Serialize)]
struct NodeResponse {
    result: Option<serde_json::Value>,
    error: Option<String>,
}

async fn handle_node(Json(req): Json<NodeRequest>) -> Json<NodeResponse> {
    if req.capability_id == "${config.capability}" {
        // TODO: Implement your logic here
        Json(NodeResponse {
            result: Some(serde_json::json!({
                "message": "Hello from ${config.name}!",
            })),
            error: None,
        })
    } else {
        Json(NodeResponse {
            result: None,
            error: Some(format!("Unknown capability: {}", req.capability_id)),
        })
    }
}

async fn health() -> &'static str {
    "healthy"
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/nooterra/node", post(handle_node))
        .route("/health", get(health));
    
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .unwrap();
    
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("🚀 ${config.name} running on {}", addr);
    
    axum::serve(tokio::net::TcpListener::bind(addr).await.unwrap(), app)
        .await
        .unwrap();
}
`);

  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
}

async function generateCommonFiles(dir: string, config: any) {
  // nooterra.json - Agent configuration
  await fs.writeFile(path.join(dir, 'nooterra.json'), JSON.stringify({
    name: config.name,
    description: config.description,
    version: "1.0.0",
    capabilities: [
      {
        id: config.capability,
        description: config.description,
        price: config.price,
        tags: ["custom"],
      },
    ],
  }, null, 2));

  // .env.example
  await fs.writeFile(path.join(dir, '.env.example'), `# Nooterra Agent Configuration

# Port to listen on
PORT=8080

# Webhook secret for verifying requests from Nooterra
WEBHOOK_SECRET=

# Your agent's DID (auto-generated on first deploy)
# NOOTERRA_DID=
`);

  // .gitignore
  await fs.writeFile(path.join(dir, '.gitignore'), `.env
node_modules/
__pycache__/
*.pyc
.DS_Store
target/
`);

  // README.md
  await fs.writeFile(path.join(dir, 'README.md'), `# ${config.name}

${config.description}

## Quick Start

1. **Configure your agent:**
   \`\`\`bash
   cp .env.example .env
   \`\`\`

2. **Connect your wallet:**
   \`\`\`bash
   nooterra wallet connect
   \`\`\`

3. **Deploy to Nooterra:**
   \`\`\`bash
   nooterra deploy
   \`\`\`

## Capability

- **ID:** \`${config.capability}\`
- **Price:** ${config.price} NCR per call
- **Description:** ${config.description}

## Development

### Local Testing
\`\`\`bash
# Run locally
${config.template === 'python' ? 'pip install -r requirements.txt && python main.py' : 
  config.template === 'node' ? 'npm install && npm run dev' :
  config.template === 'rust' ? 'cargo run' : 'docker build -t agent . && docker run -p 8080:8080 agent'}

# Test the endpoint
curl -X POST http://localhost:8080/nooterra/node \\
  -H "Content-Type: application/json" \\
  -d '{"workflowId":"test","nodeId":"test","capabilityId":"${config.capability}","inputs":{},"eventId":"test","timestamp":"2024-01-01T00:00:00Z"}'
\`\`\`

### Deploy to Railway
\`\`\`bash
railway login
railway init
railway up
\`\`\`

## Earnings

Check your earnings:
\`\`\`bash
nooterra wallet balance
\`\`\`

---
Built with ❤️ on [Nooterra](https://nooterra.ai)
`);
}

program.parse();

