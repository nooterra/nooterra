/**
 * Constitutional AI Framework
 * 
 * Embedded ethics and value alignment for agents.
 * Layer 7 of the 12-layer protocol stack.
 * 
 * Features:
 * - Constitution definition (principles and rules)
 * - Action evaluation against constitution
 * - Policy enforcement
 * - Value alignment verification
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// ============================================================================
// Schemas
// ============================================================================

const ConstitutionPrincipleSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    priority: z.number().min(1).max(10).default(5),
    category: z.enum(["safety", "ethics", "privacy", "fairness", "transparency", "other"]),
    examples: z.array(z.object({
        action: z.string(),
        allowed: z.boolean(),
        reason: z.string(),
    })).optional(),
});

const ConstitutionSchema = z.object({
    name: z.string(),
    version: z.string().default("1.0"),
    principles: z.array(ConstitutionPrincipleSchema),
    globalRules: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
});

const ActionEvaluationRequestSchema = z.object({
    action: z.object({
        type: z.string(),
        target: z.string().optional(),
        parameters: z.record(z.unknown()).optional(),
        context: z.record(z.unknown()).optional(),
    }),
    agentDid: z.string().optional(),
    constitutionId: z.string().optional(),
});

// Guards type  
interface RouteGuards {
    rateLimitGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    apiGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

// ============================================================================
// Default Constitution
// ============================================================================

const DEFAULT_CONSTITUTION: z.infer<typeof ConstitutionSchema> = {
    name: "Nooterra Core Constitution",
    version: "1.0",
    principles: [
        {
            id: "no_harm",
            name: "No Harm",
            description: "Never take actions that could cause physical, psychological, or financial harm to humans",
            priority: 10,
            category: "safety",
            examples: [
                { action: "Delete user's important files", allowed: false, reason: "Could cause data loss" },
                { action: "Summarize a document", allowed: true, reason: "Harmless information task" },
            ],
        },
        {
            id: "honest_transparent",
            name: "Honesty and Transparency",
            description: "Always be truthful, never deceive users or other agents",
            priority: 9,
            category: "ethics",
            examples: [
                { action: "Claim to be human", allowed: false, reason: "Deception about identity" },
                { action: "Explain reasoning steps", allowed: true, reason: "Promotes transparency" },
            ],
        },
        {
            id: "respect_privacy",
            name: "Respect Privacy",
            description: "Protect user data and never share private information without consent",
            priority: 9,
            category: "privacy",
            examples: [
                { action: "Share user email with third party", allowed: false, reason: "Privacy violation" },
                { action: "Store encrypted credentials", allowed: true, reason: "Secure handling" },
            ],
        },
        {
            id: "respect_autonomy",
            name: "Respect Human Autonomy",
            description: "Always defer to human judgment for consequential decisions",
            priority: 8,
            category: "ethics",
            examples: [
                { action: "Execute financial transaction without approval", allowed: false, reason: "Needs human approval" },
                { action: "Request approval before transferring funds", allowed: true, reason: "Respects autonomy" },
            ],
        },
        {
            id: "fair_unbiased",
            name: "Fairness and Non-Discrimination",
            description: "Treat all users fairly, avoid bias in decisions",
            priority: 8,
            category: "fairness",
        },
        {
            id: "minimal_footprint",
            name: "Minimal Footprint",
            description: "Use only necessary resources, avoid wasteful actions",
            priority: 6,
            category: "other",
        },
        {
            id: "reversibility",
            name: "Prefer Reversible Actions",
            description: "When possible, choose actions that can be undone",
            priority: 7,
            category: "safety",
        },
        {
            id: "explain_actions",
            name: "Explainability",
            description: "Be able to explain reasoning and actions when asked",
            priority: 7,
            category: "transparency",
        },
    ],
    globalRules: [
        "Never execute shell commands without explicit approval",
        "Never modify system files without approval",
        "Never access external APIs without disclosure",
        "Always log consequential actions",
        "Escalate uncertain decisions to humans",
    ],
};

// ============================================================================
// Forbidden Action Patterns
// ============================================================================

const FORBIDDEN_PATTERNS = [
    { pattern: /rm\s+-rf/i, reason: "Dangerous file deletion", severity: "critical" },
    { pattern: /drop\s+table/i, reason: "Database destruction", severity: "critical" },
    { pattern: /format\s+[a-z]:/i, reason: "Disk formatting", severity: "critical" },
    { pattern: /password|secret|api.?key/i, reason: "Credential exposure risk", severity: "high" },
    { pattern: /sudo|chmod\s+777/i, reason: "Privilege escalation", severity: "high" },
    { pattern: /wget|curl.*\|.*sh/i, reason: "Remote code execution", severity: "critical" },
    { pattern: /eval\(/i, reason: "Dynamic code execution", severity: "high" },
    { pattern: /\.env|credentials/i, reason: "Secrets access", severity: "medium" },
];

// ============================================================================
// Route Registration
// ============================================================================

export async function registerConstitutionalRoutes(
    app: FastifyInstance,
    guards: RouteGuards
): Promise<void> {
    const { rateLimitGuard, apiGuard } = guards;

    // Ensure tables exist
    await ensureConstitutionalTables();

    // -------------------------------------------------------------------------
    // GET /v1/constitution - Get the default constitution
    // -------------------------------------------------------------------------
    app.get(
        "/v1/constitution",
        { preHandler: [rateLimitGuard] },
        async (request, reply) => {
            const { id } = request.query as { id?: string };

            if (id) {
                const result = await pool.query(
                    `SELECT * FROM constitutions WHERE id = $1`,
                    [id]
                );
                if (!result.rowCount) {
                    return reply.status(404).send({ error: "constitution_not_found" });
                }
                return reply.send(result.rows[0].definition);
            }

            return reply.send(DEFAULT_CONSTITUTION);
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/constitution - Create custom constitution
    // -------------------------------------------------------------------------
    app.post(
        "/v1/constitution",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const parsed = ConstitutionSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const constitution = parsed.data;
            const createdBy = (request as any).auth?.payerDid || "anonymous";

            const result = await pool.query(
                `INSERT INTO constitutions (name, version, definition, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
                [constitution.name, constitution.version, JSON.stringify(constitution), createdBy]
            );

            app.log.info({ constitutionId: result.rows[0].id, name: constitution.name }, "[constitutional] Created");

            return reply.status(201).send({
                ok: true,
                constitutionId: result.rows[0].id,
                name: constitution.name,
                principleCount: constitution.principles.length,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/constitution/evaluate - Evaluate action against constitution
    // -------------------------------------------------------------------------
    app.post(
        "/v1/constitution/evaluate",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const parsed = ActionEvaluationRequestSchema.safeParse(request.body);

            if (!parsed.success) {
                return reply.status(400).send({ error: parsed.error.flatten() });
            }

            const { action, agentDid, constitutionId } = parsed.data;

            // Get constitution
            let constitution = DEFAULT_CONSTITUTION;
            if (constitutionId) {
                const result = await pool.query(
                    `SELECT definition FROM constitutions WHERE id = $1`,
                    [constitutionId]
                );
                if (result.rowCount) {
                    constitution = result.rows[0].definition;
                }
            }

            // Evaluate action
            const evaluation = await evaluateAction(action, constitution);

            // Log evaluation
            await pool.query(
                `INSERT INTO constitutional_evaluations (agent_did, action, result, violations, constitution_id)
         VALUES ($1, $2, $3, $4, $5)`,
                [
                    agentDid,
                    JSON.stringify(action),
                    evaluation.allowed ? "allowed" : "blocked",
                    JSON.stringify(evaluation.violations),
                    constitutionId,
                ]
            );

            if (!evaluation.allowed) {
                app.log.warn({
                    agentDid,
                    action: action.type,
                    violations: evaluation.violations.length,
                }, "[constitutional] Action blocked");
            }

            return reply.send(evaluation);
        }
    );

    // -------------------------------------------------------------------------
    // GET /v1/constitution/evaluations - Get evaluation history
    // -------------------------------------------------------------------------
    app.get(
        "/v1/constitution/evaluations",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { agentDid, result, limit = 50 } = request.query as {
                agentDid?: string;
                result?: string;
                limit?: number;
            };

            let sql = `SELECT * FROM constitutional_evaluations WHERE 1=1`;
            const params: (string | number)[] = [];
            let idx = 1;

            if (agentDid) {
                sql += ` AND agent_did = $${idx++}`;
                params.push(agentDid);
            }
            if (result) {
                sql += ` AND result = $${idx++}`;
                params.push(result);
            }

            sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
            params.push(Math.min(100, limit));

            const queryResult = await pool.query(sql, params);

            return reply.send({
                evaluations: queryResult.rows.map(row => ({
                    id: row.id,
                    agentDid: row.agent_did,
                    action: row.action,
                    result: row.result,
                    violations: row.violations,
                    createdAt: row.created_at,
                })),
                count: queryResult.rowCount,
            });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/agents/:did/constitution - Assign constitution to agent
    // -------------------------------------------------------------------------
    app.post(
        "/v1/agents/:did/constitution",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { did } = request.params as { did: string };
            const { constitutionId } = request.body as { constitutionId?: string };

            await pool.query(
                `UPDATE agents SET constitution_id = $1 WHERE did = $2`,
                [constitutionId, did]
            );

            app.log.info({ did, constitutionId }, "[constitutional] Agent constitution assigned");

            return reply.send({ ok: true, did, constitutionId });
        }
    );

    // -------------------------------------------------------------------------
    // POST /v1/constitution/validate-request - Pre-flight validation for workflows
    // -------------------------------------------------------------------------
    app.post(
        "/v1/constitution/validate-request",
        { preHandler: [rateLimitGuard, apiGuard] },
        async (request, reply) => {
            const { nodes, agentDid } = request.body as {
                nodes: Record<string, { capability: string; payload?: unknown }>;
                agentDid?: string;
            };

            const validationResults: Array<{
                nodeId: string;
                capability: string;
                allowed: boolean;
                violations: string[];
            }> = [];

            for (const [nodeId, node] of Object.entries(nodes)) {
                const evaluation = await evaluateAction(
                    {
                        type: node.capability,
                        parameters: node.payload as Record<string, unknown>,
                    },
                    DEFAULT_CONSTITUTION
                );

                validationResults.push({
                    nodeId,
                    capability: node.capability,
                    allowed: evaluation.allowed,
                    violations: evaluation.violations.map(v => v.principle),
                });
            }

            const allAllowed = validationResults.every(r => r.allowed);

            return reply.send({
                valid: allAllowed,
                results: validationResults,
                blockedNodes: validationResults.filter(r => !r.allowed).map(r => r.nodeId),
            });
        }
    );

    app.log.info("[constitutional] Routes registered");
}

// ============================================================================
// Evaluation Logic
// ============================================================================

interface EvaluationResult {
    allowed: boolean;
    confidence: number;
    violations: Array<{
        principle: string;
        reason: string;
        severity: "low" | "medium" | "high" | "critical";
    }>;
    warnings: string[];
    recommendations: string[];
}

async function evaluateAction(
    action: { type: string; target?: string; parameters?: Record<string, unknown>; context?: Record<string, unknown> },
    constitution: z.infer<typeof ConstitutionSchema>
): Promise<EvaluationResult> {
    const violations: EvaluationResult["violations"] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Serialize action for pattern matching
    const actionString = JSON.stringify(action).toLowerCase();

    // Check forbidden patterns
    for (const { pattern, reason, severity } of FORBIDDEN_PATTERNS) {
        if (pattern.test(actionString)) {
            violations.push({
                principle: "forbidden_pattern",
                reason,
                severity: severity as "critical" | "high",
            });
        }
    }

    // Check against principles
    for (const principle of constitution.principles) {
        const violation = checkPrincipleViolation(action, principle);
        if (violation) {
            violations.push({
                principle: principle.id,
                reason: violation.reason,
                severity: mapPriorityToSeverity(principle.priority),
            });
        }
    }

    // Check global rules
    for (const rule of constitution.globalRules || []) {
        const ruleViolation = checkGlobalRule(action, rule);
        if (ruleViolation) {
            warnings.push(ruleViolation);
        }
    }

    // Generate recommendations
    if (action.type.includes("delete") || action.type.includes("remove")) {
        recommendations.push("Consider using soft-delete or archiving instead");
    }
    if (action.type.includes("execute") || action.type.includes("run")) {
        recommendations.push("Ensure action is sandboxed and reversible");
    }

    // Calculate confidence
    const confidence = violations.length === 0 ? 0.95 : 0.1;

    return {
        allowed: violations.length === 0,
        confidence,
        violations,
        warnings,
        recommendations,
    };
}

function checkPrincipleViolation(
    action: { type: string; target?: string; parameters?: Record<string, unknown> },
    principle: z.infer<typeof ConstitutionPrincipleSchema>
): { reason: string } | null {
    const actionType = action.type.toLowerCase();
    const target = action.target?.toLowerCase() || "";

    switch (principle.id) {
        case "no_harm":
            if (actionType.includes("delete") || actionType.includes("destroy") || actionType.includes("kill")) {
                return { reason: "Action may cause harm or data loss" };
            }
            break;

        case "respect_privacy":
            if (actionType.includes("share") || actionType.includes("export")) {
                if (target.includes("user") || target.includes("personal") || target.includes("private")) {
                    return { reason: "May expose private information" };
                }
            }
            break;

        case "respect_autonomy":
            if (actionType.includes("financial") || actionType.includes("payment") || actionType.includes("transfer")) {
                if (!action.parameters?.hasApproval) {
                    return { reason: "Financial action requires human approval" };
                }
            }
            break;

        case "reversibility":
            if (actionType.includes("permanent") || actionType.includes("irreversible")) {
                return { reason: "Prefer reversible actions" };
            }
            break;
    }

    return null;
}

function checkGlobalRule(
    action: { type: string; parameters?: Record<string, unknown> },
    rule: string
): string | null {
    const ruleKeywords = rule.toLowerCase();
    const actionType = action.type.toLowerCase();

    if (ruleKeywords.includes("shell") && actionType.includes("shell")) {
        return "Shell command execution flagged by global rule";
    }
    if (ruleKeywords.includes("system files") && actionType.includes("system")) {
        return "System file modification flagged by global rule";
    }

    return null;
}

function mapPriorityToSeverity(priority: number): "low" | "medium" | "high" | "critical" {
    if (priority >= 9) return "critical";
    if (priority >= 7) return "high";
    if (priority >= 5) return "medium";
    return "low";
}

// ============================================================================
// Exported Utility for Integration
// ============================================================================

/**
 * Quick check if an action is allowed - for use by other routes
 */
export async function isActionAllowed(
    action: { type: string; target?: string; parameters?: Record<string, unknown> }
): Promise<{ allowed: boolean; reason?: string }> {
    const evaluation = await evaluateAction(action, DEFAULT_CONSTITUTION);
    return {
        allowed: evaluation.allowed,
        reason: evaluation.violations[0]?.reason,
    };
}

// ============================================================================
// Table Setup
// ============================================================================

async function ensureConstitutionalTables(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS constitutions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      definition JSONB NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS constitutional_evaluations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_did TEXT,
      action JSONB NOT NULL,
      result TEXT NOT NULL,
      violations JSONB DEFAULT '[]',
      constitution_id UUID REFERENCES constitutions(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS const_eval_agent_idx ON constitutional_evaluations(agent_did);
    CREATE INDEX IF NOT EXISTS const_eval_result_idx ON constitutional_evaluations(result);
    
    -- Add constitution_id to agents if not exists
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'agents' AND column_name = 'constitution_id'
      ) THEN
        ALTER TABLE agents ADD COLUMN constitution_id UUID REFERENCES constitutions(id);
      END IF;
    END $$;
  `);
}
