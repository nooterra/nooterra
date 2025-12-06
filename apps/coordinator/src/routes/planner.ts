/**
 * Planner Routes
 * 
 * Natural language → validated DAG transformation
 * Layer 3 & 11 of the 12-layer protocol stack.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// ============================================================================
// Schemas for Structured Output
// ============================================================================

// Zod schema matching the workflow DAG structure
const WorkflowNodeSchema = z.object({
    capabilityId: z.string().min(1),
    dependsOn: z.array(z.string()).default([]),
    payload: z.record(z.unknown()).optional(),
    timeoutMs: z.number().optional(),
    maxRetries: z.number().optional(),
});

const PlannerOutputSchema = z.object({
    intent: z.string(),
    nodes: z.record(WorkflowNodeSchema),
    reasoning: z.string().optional(),
    estimatedCostCents: z.number().optional(),
});

const PlanRequestSchema = z.object({
    intent: z.string().min(1).max(2000),
    description: z.string().max(5000).optional(),
    maxCents: z.number().positive().optional(),
    constraints: z.object({
        maxNodes: z.number().min(1).max(20).optional(),
        requiredCapabilities: z.array(z.string()).optional(),
        excludeCapabilities: z.array(z.string()).optional(),
        preferredAgents: z.array(z.string()).optional(),
    }).optional(),
    publish: z.boolean().default(false),
});

// Guards type  
interface RouteGuards {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerPlannerRoutes(
    app: FastifyInstance,
    guards: RouteGuards
): Promise<void> {
    const { rateLimitGuard, apiGuard } = guards;

    // -------------------------------------------------------------------------
    // POST /v1/plan - Generate workflow from natural language
    // -------------------------------------------------------------------------
    app.post(
        "/v1/plan",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const parsed = PlanRequestSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { intent, description, maxCents, constraints, publish } = parsed.data;
            const payerDid = (request as any).auth?.payerDid || "did:noot:anonymous";

            try {
                // 1. Fetch available capabilities from registry
                const capabilities = await fetchAvailableCapabilities(constraints);

                // 2. Generate DAG with structured output (up to 3 attempts)
                let dag = null;
                let validation = null;
                let attempt = 0;
                const maxAttempts = 3;

                while (attempt < maxAttempts) {
                    attempt++;

                    // Generate plan using LLM
                    dag = await generatePlan({
                        intent,
                        description,
                        maxCents,
                        capabilities,
                        constraints,
                        previousErrors: validation?.errors,
                    });

                    // Validate the generated DAG
                    validation = await validateDAG(dag, capabilities);

                    if (validation.valid) {
                        break;
                    }

                    app.log.warn({ attempt, errors: validation.errors }, "[planner] Validation failed, retrying");
                }

                if (!validation?.valid || !dag) {
                    return reply.status(422).send({
                        error: "plan_validation_failed",
                        message: "Could not generate a valid workflow after multiple attempts",
                        lastErrors: validation?.errors,
                        lastAttempt: dag,
                    });
                }

                // At this point, dag is guaranteed non-null and valid
                const validDag = dag;

                // 3. Optionally publish immediately
                if (publish) {
                    const workflowResult = await publishWorkflow(validDag, payerDid, maxCents);
                    return reply.send({
                        ok: true,
                        published: true,
                        workflowId: workflowResult.workflowId,
                        dag: validDag,
                        validation,
                    });
                }

                return reply.send({
                    ok: true,
                    published: false,
                    dag: validDag,
                    validation,
                    estimatedCost: validDag.estimatedCostCents,
                });

            } catch (err: any) {
                app.log.error({ err }, "[planner] Failed to generate plan");
                return reply.status(500).send({
                    error: "planner_error",
                    message: err?.message || "Failed to generate plan",
                });
            }
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/plan/validate - Validate a DAG without publishing
    // -------------------------------------------------------------------------
    app.post(
        "/v1/plan/validate",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { dag } = request.body as { dag: unknown };

            const parsed = PlannerOutputSchema.safeParse(dag);
            if (!parsed.success) {
                return reply.status(400).send({
                    valid: false,
                    errors: parsed.error.flatten(),
                });
            }

            const capabilities = await fetchAvailableCapabilities();
            const validation = await validateDAG(parsed.data, capabilities);

            return reply.send(validation);
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/plan/capabilities - List available capabilities for planning
    // -------------------------------------------------------------------------
    app.get(
        "/v1/plan/capabilities",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { query, limit = 50 } = request.query as { query?: string; limit?: number };

            const capabilities = await fetchAvailableCapabilities({ query }, Math.min(100, limit));

            return reply.send({
                capabilities,
                count: capabilities.length,
            });
        }
    );

    app.log.info("[planner] Routes registered");
}

// ============================================================================
// Helpers
// ============================================================================

interface Capability {
    id: string;
    description: string;
    priceCents?: number;
    inputSchema?: unknown;
    outputSchema?: unknown;
}

async function fetchAvailableCapabilities(
    constraints?: { query?: string; requiredCapabilities?: string[]; excludeCapabilities?: string[] },
    limit = 100
): Promise<Capability[]> {
    // Query capability registry
    let sql = `
    SELECT DISTINCT c.capability_id as id, c.description, c.price_cents
    FROM agent_capabilities c
    JOIN agents a ON a.did = c.agent_did
    WHERE a.is_active = true AND a.health_status IN ('healthy', 'unknown')
  `;
    const params: (string | number)[] = [];
    let idx = 1;

    if (constraints?.requiredCapabilities?.length) {
        sql += ` AND c.capability_id = ANY($${idx++})`;
        params.push(constraints.requiredCapabilities as any);
    }

    if (constraints?.excludeCapabilities?.length) {
        sql += ` AND c.capability_id != ALL($${idx++})`;
        params.push(constraints.excludeCapabilities as any);
    }

    sql += ` ORDER BY c.capability_id LIMIT $${idx}`;
    params.push(limit);

    try {
        const result = await pool.query(sql, params);
        return result.rows.map(row => ({
            id: row.id,
            description: row.description || "",
            priceCents: row.price_cents ? Number(row.price_cents) : undefined,
        }));
    } catch {
        // If table doesn't exist or query fails, return empty array
        return [];
    }
}

interface GeneratePlanInput {
    intent: string;
    description?: string;
    maxCents?: number;
    capabilities: Capability[];
    constraints?: unknown;
    previousErrors?: string[];
}

async function generatePlan(input: GeneratePlanInput): Promise<z.infer<typeof PlannerOutputSchema>> {
    // Build the prompt for the LLM
    const systemPrompt = buildSystemPrompt(input.capabilities);
    const userPrompt = buildUserPrompt(input);

    // Call planner agent via internal HTTP or use built-in simple heuristic
    // For now, use a rule-based fallback if no LLM is configured
    const llmEndpoint = process.env.PLANNER_LLM_ENDPOINT;

    if (llmEndpoint) {
        return await callExternalPlanner(llmEndpoint, systemPrompt, userPrompt);
    }

    // Fallback: Simple rule-based planner for common patterns
    return simpleRuleBasedPlan(input);
}

function buildSystemPrompt(capabilities: Capability[]): string {
    const capList = capabilities.map(c => `- ${c.id}: ${c.description} (${c.priceCents || 0} cents)`).join("\n");

    return `You are a workflow planner for Nooterra. Given an intent, create a workflow DAG.

Available capabilities:
${capList}

Output JSON only:
{
  "intent": "string",
  "nodes": {
    "node_name": {
      "capabilityId": "cap.something.v1",
      "dependsOn": ["other_node"],
      "payload": {}
    }
  },
  "reasoning": "why this plan",
  "estimatedCostCents": 0
}

Rules:
- Use ONLY the listed capability IDs
- Node names must be unique
- dependsOn creates execution order (DAG must be acyclic)
- Estimate total cost from capability prices`;
}

function buildUserPrompt(input: GeneratePlanInput): string {
    let prompt = `Intent: ${input.intent}`;
    if (input.description) prompt += `\nDescription: ${input.description}`;
    if (input.maxCents) prompt += `\nMax budget: ${input.maxCents} cents`;
    if (input.previousErrors?.length) {
        prompt += `\n\nPrevious attempt had errors:\n${input.previousErrors.join("\n")}\nPlease fix these issues.`;
    }
    return prompt;
}

async function callExternalPlanner(endpoint: string, systemPrompt: string, userPrompt: string): Promise<z.infer<typeof PlannerOutputSchema>> {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
        }),
    });

    if (!response.ok) {
        throw new Error(`Planner LLM returned ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error("Empty response from planner LLM");
    }

    const parsed = JSON.parse(content);
    return PlannerOutputSchema.parse(parsed);
}

function simpleRuleBasedPlan(input: GeneratePlanInput): z.infer<typeof PlannerOutputSchema> {
    const { intent, capabilities } = input;
    const intentLower = intent.toLowerCase();

    const nodes: Record<string, z.infer<typeof WorkflowNodeSchema>> = {};
    let lastNode: string | null = null;

    // Pattern matching for common workflows
    if (intentLower.includes("summarize") || intentLower.includes("summary")) {
        const cap = capabilities.find(c => c.id.includes("summarize") || c.id.includes("summary"));
        if (cap) {
            nodes["summarize"] = { capabilityId: cap.id, dependsOn: [] };
            lastNode = "summarize";
        }
    }

    if (intentLower.includes("translate")) {
        const cap = capabilities.find(c => c.id.includes("translate"));
        if (cap) {
            nodes["translate"] = {
                capabilityId: cap.id,
                dependsOn: lastNode ? [lastNode] : [],
            };
            lastNode = "translate";
        }
    }

    if (intentLower.includes("search") || intentLower.includes("find") || intentLower.includes("lookup")) {
        const cap = capabilities.find(c => c.id.includes("search") || c.id.includes("web"));
        if (cap) {
            nodes["search"] = { capabilityId: cap.id, dependsOn: [] };
            lastNode = "search";
        }
    }

    if (intentLower.includes("generate") || intentLower.includes("write") || intentLower.includes("create")) {
        const cap = capabilities.find(c => c.id.includes("generate") || c.id.includes("llm") || c.id.includes("text"));
        if (cap) {
            nodes["generate"] = {
                capabilityId: cap.id,
                dependsOn: lastNode ? [lastNode] : [],
            };
            lastNode = "generate";
        }
    }

    // Fallback: if no patterns matched, use first available capability
    if (Object.keys(nodes).length === 0 && capabilities.length > 0) {
        nodes["task"] = { capabilityId: capabilities[0].id, dependsOn: [] };
    }

    // Calculate estimated cost
    const estimatedCostCents = Object.values(nodes).reduce((sum, node) => {
        const cap = capabilities.find(c => c.id === node.capabilityId);
        return sum + (cap?.priceCents || 0);
    }, 0);

    return {
        intent,
        nodes,
        reasoning: "Generated using rule-based pattern matching",
        estimatedCostCents,
    };
}

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

async function validateDAG(
    dag: z.infer<typeof PlannerOutputSchema>,
    availableCapabilities: Capability[]
): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const availableIds = new Set(availableCapabilities.map(c => c.id));

    // Check nodes exist
    if (!dag.nodes || Object.keys(dag.nodes).length === 0) {
        errors.push("Workflow must have at least one node");
    }

    // Check capability IDs are valid
    for (const [name, node] of Object.entries(dag.nodes)) {
        if (!availableIds.has(node.capabilityId)) {
            errors.push(`Node "${name}" uses unavailable capability: ${node.capabilityId}`);
        }
    }

    // Check dependencies exist
    const nodeNames = new Set(Object.keys(dag.nodes));
    for (const [name, node] of Object.entries(dag.nodes)) {
        for (const dep of node.dependsOn || []) {
            if (!nodeNames.has(dep)) {
                errors.push(`Node "${name}" depends on non-existent node: ${dep}`);
            }
        }
    }

    // Check for cycles
    if (hasCycle(dag.nodes)) {
        errors.push("Workflow contains a cycle - must be a DAG");
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

function hasCycle(nodes: Record<string, z.infer<typeof WorkflowNodeSchema>>): boolean {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function dfs(name: string): boolean {
        if (visiting.has(name)) return true;
        if (visited.has(name)) return false;

        visiting.add(name);
        const node = nodes[name];
        if (node) {
            for (const dep of node.dependsOn || []) {
                if (dfs(dep)) return true;
            }
        }
        visiting.delete(name);
        visited.add(name);
        return false;
    }

    for (const name of Object.keys(nodes)) {
        if (dfs(name)) return true;
    }
    return false;
}

async function publishWorkflow(
    dag: z.infer<typeof PlannerOutputSchema>,
    payerDid: string,
    maxCents?: number
): Promise<{ workflowId: string }> {
    // Insert workflow into database
    const result = await pool.query(
        `INSERT INTO workflows (name, dag, payer_did, max_budget)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
        [
            dag.intent.substring(0, 100),
            JSON.stringify({ intent: dag.intent, nodes: dag.nodes }),
            payerDid,
            maxCents ? maxCents / 100 : null,
        ]
    );

    return { workflowId: result.rows[0].id };
}
