/**
 * Schema Validator Service
 * 
 * Validates agent inputs/outputs against capability schemas at runtime.
 * Enforces contracts between agents in workflows.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { FastifyBaseLogger } from "fastify";
import {
  getCapabilitySchema,
  type CapabilitySchema,
  type DAGNode,
  validateDAG,
  type DAGValidationResult,
} from "@nooterra/types";
import type { Redis } from "ioredis";

// =============================================================================
// TYPES
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  confidence: number;
}

export interface ValidationError {
  field: string;
  message: string;
  expected?: string;
  received?: string;
  path?: string;
}

export interface ValidationOptions {
  /** Fail on first error (faster) */
  failFast?: boolean;
  /** Include warnings for non-critical issues */
  includeWarnings?: boolean;
  /** Coerce types if possible */
  coerceTypes?: boolean;
  /** Strip unknown fields from objects */
  stripUnknown?: boolean;
}

export interface SchemaViolation {
  workflowId: string;
  nodeId: string;
  agentId: string;
  capability: string;
  violationType: "input" | "output";
  errors: ValidationError[];
  timestamp: Date;
}

// =============================================================================
// SCHEMA VALIDATOR SERVICE
// =============================================================================

export class SchemaValidatorService {
  private ajv: Ajv;
  private log: FastifyBaseLogger;
  private redis: Redis | null;
  
  // Cache of compiled validators
  private validatorCache = new Map<string, {
    inputValidator: ReturnType<Ajv["compile"]> | null;
    outputValidator: ReturnType<Ajv["compile"]> | null;
  }>();
  
  constructor(log: FastifyBaseLogger, redis?: Redis) {
    this.log = log;
    this.redis = redis || null;
    
    // Initialize AJV with common formats
    this.ajv = new Ajv({
      allErrors: true,
      coerceTypes: true,
      removeAdditional: false,
      useDefaults: true,
      strict: false,
    });
    addFormats(this.ajv);
    
    // Add custom formats
    this.ajv.addFormat("semantic-type", /^@noot\/[a-z]+:[A-Z][a-zA-Z]+$/);
    this.ajv.addFormat("capability-id", /^cap\.[a-z]+(\.[a-z_]+)*\.v\d+$/);
  }
  
  /**
   * Validate input data against a capability schema
   */
  async validateInput(
    capabilityId: string,
    data: unknown,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const schema = getCapabilitySchema(capabilityId);
    if (!schema) {
      return {
        valid: false,
        errors: [{
          field: "_capability",
          message: `Unknown capability: ${capabilityId}`,
        }],
        warnings: [],
        confidence: 0,
      };
    }
    
    return this.validateAgainstSchema(schema, "input", data, options);
  }
  
  /**
   * Validate output data against a capability schema
   */
  async validateOutput(
    capabilityId: string,
    data: unknown,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const schema = getCapabilitySchema(capabilityId);
    if (!schema) {
      return {
        valid: false,
        errors: [{
          field: "_capability",
          message: `Unknown capability: ${capabilityId}`,
        }],
        warnings: [],
        confidence: 0,
      };
    }
    
    return this.validateAgainstSchema(schema, "output", data, options);
  }
  
  /**
   * Validate a complete workflow DAG before execution
   */
  async validateWorkflow(nodes: DAGNode[]): Promise<DAGValidationResult> {
    return validateDAG({ nodes });
  }
  
  /**
   * Record a schema violation for reputation tracking
   */
  async recordViolation(violation: SchemaViolation): Promise<void> {
    this.log.warn({
      type: "schema_violation",
      ...violation,
    });
    
    if (this.redis) {
      const key = `violations:${violation.agentId}`;
      await this.redis.lpush(key, JSON.stringify({
        ...violation,
        timestamp: violation.timestamp.toISOString(),
      }));
      // Keep last 100 violations per agent
      await this.redis.ltrim(key, 0, 99);
      
      // Increment violation counter for reputation
      await this.redis.hincrby(
        `agent:${violation.agentId}:stats`,
        "schema_violations",
        1
      );
    }
  }
  
  /**
   * Get violation count for an agent
   */
  async getViolationCount(agentId: string): Promise<number> {
    if (!this.redis) return 0;
    
    const count = await this.redis.hget(
      `agent:${agentId}:stats`,
      "schema_violations"
    );
    return parseInt(count || "0", 10);
  }
  
  /**
   * Check if an agent should be penalized for violations
   */
  async shouldPenalize(agentId: string): Promise<{
    penalize: boolean;
    reason?: string;
    violationCount: number;
  }> {
    const count = await this.getViolationCount(agentId);
    
    // Thresholds for penalties
    if (count >= 100) {
      return {
        penalize: true,
        reason: "Critical: 100+ schema violations",
        violationCount: count,
      };
    }
    if (count >= 50) {
      return {
        penalize: true,
        reason: "High: 50+ schema violations",
        violationCount: count,
      };
    }
    if (count >= 10) {
      return {
        penalize: false,
        reason: "Warning: 10+ schema violations",
        violationCount: count,
      };
    }
    
    return {
      penalize: false,
      violationCount: count,
    };
  }
  
  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================
  
  private validateAgainstSchema(
    schema: CapabilitySchema,
    type: "input" | "output",
    data: unknown,
    options: ValidationOptions
  ): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      confidence: 1.0,
    };
    
    // Get or compile validator
    const validator = this.getValidator(schema, type);
    if (!validator) {
      // No schema defined, accept anything
      result.confidence = 0.5;
      if (options.includeWarnings) {
        result.warnings.push(`No ${type} schema defined for ${schema.capabilityId}`);
      }
      return result;
    }
    
    // Validate
    const valid = validator(data);
    
    if (!valid && validator.errors) {
      result.valid = false;
      result.confidence = 0;
      
      for (const err of validator.errors) {
        result.errors.push({
          field: err.instancePath || err.params?.missingProperty as string || "unknown",
          message: err.message || "Validation failed",
          path: err.instancePath,
          expected: err.params?.type as string,
          received: typeof data,
        });
        
        if (options.failFast) break;
      }
    }
    
    // Check for extra fields (warnings, not errors)
    if (options.includeWarnings && typeof data === "object" && data !== null) {
      const schemaFields = type === "input" 
        ? schema.input.fields.map(f => f.name)
        : schema.output.fields.map(f => f.name);
      
      const dataFields = Object.keys(data as Record<string, unknown>);
      const extraFields = dataFields.filter(f => !schemaFields.includes(f));
      
      if (extraFields.length > 0) {
        result.warnings.push(
          `Extra fields in ${type}: ${extraFields.join(", ")}`
        );
        result.confidence = Math.max(0.8, result.confidence);
      }
    }
    
    return result;
  }
  
  private getValidator(
    schema: CapabilitySchema,
    type: "input" | "output"
  ): ReturnType<Ajv["compile"]> | null {
    const cached = this.validatorCache.get(schema.capabilityId);
    if (cached) {
      return type === "input" ? cached.inputValidator : cached.outputValidator;
    }
    
    // Compile validators
    const inputSchema = schema.input.jsonSchema;
    const outputSchema = schema.output.jsonSchema;
    
    let inputValidator: ReturnType<Ajv["compile"]> | null = null;
    let outputValidator: ReturnType<Ajv["compile"]> | null = null;
    
    try {
      if (Object.keys(inputSchema).length > 0) {
        inputValidator = this.ajv.compile(inputSchema);
      }
    } catch (err) {
      this.log.warn({ err, capabilityId: schema.capabilityId }, "Failed to compile input schema");
    }
    
    try {
      if (Object.keys(outputSchema).length > 0) {
        outputValidator = this.ajv.compile(outputSchema);
      }
    } catch (err) {
      this.log.warn({ err, capabilityId: schema.capabilityId }, "Failed to compile output schema");
    }
    
    this.validatorCache.set(schema.capabilityId, {
      inputValidator,
      outputValidator,
    });
    
    return type === "input" ? inputValidator : outputValidator;
  }
  
  /**
   * Clear cached validators (useful if schemas are updated)
   */
  clearCache(): void {
    this.validatorCache.clear();
  }
}

// =============================================================================
// WORKFLOW VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Create middleware that validates workflow inputs before execution
 */
export function createWorkflowValidationMiddleware(validator: SchemaValidatorService) {
  return async function validateWorkflowMiddleware(
    workflowId: string,
    nodes: DAGNode[],
    initialPayload: Record<string, unknown>
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    // Validate DAG structure
    const dagResult = await validator.validateWorkflow(nodes);
    if (!dagResult.valid) {
      errors.push(...dagResult.errors);
    }
    
    // Validate initial payload against first node's input schema
    const entryNodes = nodes.filter(n => n.dependsOn.length === 0);
    for (const node of entryNodes) {
      const inputResult = await validator.validateInput(
        node.capability,
        { ...node.payload, ...initialPayload },
        { includeWarnings: true }
      );
      
      if (!inputResult.valid) {
        errors.push(
          `Node '${node.name}' input validation failed: ${
            inputResult.errors.map(e => e.message).join(", ")
          }`
        );
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  };
}

/**
 * Create middleware that validates agent output after execution
 */
export function createOutputValidationMiddleware(validator: SchemaValidatorService) {
  return async function validateOutputMiddleware(
    workflowId: string,
    nodeId: string,
    agentId: string,
    capability: string,
    output: unknown
  ): Promise<ValidationResult> {
    const result = await validator.validateOutput(capability, output, {
      includeWarnings: true,
    });
    
    if (!result.valid) {
      await validator.recordViolation({
        workflowId,
        nodeId,
        agentId,
        capability,
        violationType: "output",
        errors: result.errors,
        timestamp: new Date(),
      });
    }
    
    return result;
  };
}
