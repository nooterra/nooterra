/**
 * Type System API Routes
 * 
 * Endpoints for querying semantic types, capability schemas,
 * and validating data against schemas.
 */

import { FastifyPluginAsync } from "fastify";
import {
  getSemanticType,
  getTypesByDomain,
  getAllDomains,
  validateAgainstType,
  getCapabilitySchema,
  getCapabilitySchemasByDomain,
  getAllCapabilityDomains,
  validateDAG,
  checkCapabilityCompatibility,
  ALL_SEMANTIC_TYPES,
  BUILTIN_CAPABILITY_SCHEMAS,
  type DAGNode,
} from "@nooterra/types";
import { SchemaValidatorService } from "../services/schema-validator.js";

// =============================================================================
// ROUTE SCHEMAS
// =============================================================================

const semanticTypeResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    domain: { type: "string" },
    version: { type: "string" },
    jsonSchema: { type: "object" },
    examples: { type: "array" },
    converters: { type: "array" },
    tags: { type: "array", items: { type: "string" } },
  },
};

const capabilitySchemaResponseSchema = {
  type: "object",
  properties: {
    capabilityId: { type: "string" },
    version: { type: "string" },
    description: { type: "string" },
    input: { type: "object" },
    output: { type: "object" },
    examples: { type: "array" },
    tags: { type: "array", items: { type: "string" } },
  },
};

// =============================================================================
// ROUTES
// =============================================================================

export const typesRoutes: FastifyPluginAsync = async (app) => {
  // Initialize schema validator service
  // Redis is optional - check if it's available as a decorator
  const redis = (app as any).redis as import("ioredis").Redis | undefined;
  const validator = new SchemaValidatorService(app.log, redis);
  
  // ---------------------------------------------------------------------------
  // SEMANTIC TYPES
  // ---------------------------------------------------------------------------
  
  /**
   * List all semantic types
   */
  app.get("/types", {
    schema: {
      description: "List all semantic types in the registry",
      tags: ["types"],
      querystring: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Filter by domain" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            types: { type: "array", items: semanticTypeResponseSchema },
            domains: { type: "array", items: { type: "string" } },
            total: { type: "number" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { domain } = request.query as { domain?: string };
    
    const types = domain ? getTypesByDomain(domain) : ALL_SEMANTIC_TYPES;
    const domains = getAllDomains();
    
    return {
      types,
      domains,
      total: types.length,
    };
  });
  
  /**
   * Get a specific semantic type
   */
  app.get("/types/:typeId", {
    schema: {
      description: "Get details of a semantic type",
      tags: ["types"],
      params: {
        type: "object",
        properties: {
          typeId: { type: "string" },
        },
        required: ["typeId"],
      },
      response: {
        200: semanticTypeResponseSchema,
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { typeId } = request.params as { typeId: string };
    
    // URL decode the type ID (@ becomes %40)
    const decodedId = decodeURIComponent(typeId);
    const type = getSemanticType(decodedId);
    
    if (!type) {
      reply.status(404);
      return { error: `Type not found: ${decodedId}` };
    }
    
    return type;
  });
  
  /**
   * Validate data against a semantic type
   */
  app.post("/types/:typeId/validate", {
    schema: {
      description: "Validate data against a semantic type",
      tags: ["types"],
      params: {
        type: "object",
        properties: {
          typeId: { type: "string" },
        },
        required: ["typeId"],
      },
      body: {
        type: "object",
        properties: {
          value: {},  // Any type
        },
        required: ["value"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            errors: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { typeId } = request.params as { typeId: string };
    const { value } = request.body as { value: unknown };
    
    const decodedId = decodeURIComponent(typeId);
    const result = validateAgainstType(value, decodedId);
    
    return result;
  });
  
  // ---------------------------------------------------------------------------
  // CAPABILITY SCHEMAS
  // ---------------------------------------------------------------------------
  
  /**
   * List all capability schemas
   */
  app.get("/capabilities", {
    schema: {
      description: "List all capability schemas",
      tags: ["capabilities"],
      querystring: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Filter by domain (e.g., 'llm', 'web')" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            capabilities: { type: "array", items: capabilitySchemaResponseSchema },
            domains: { type: "array", items: { type: "string" } },
            total: { type: "number" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { domain } = request.query as { domain?: string };
    
    const capabilities = domain 
      ? getCapabilitySchemasByDomain(domain) 
      : BUILTIN_CAPABILITY_SCHEMAS;
    const domains = getAllCapabilityDomains();
    
    return {
      capabilities,
      domains,
      total: capabilities.length,
    };
  });
  
  /**
   * Get a specific capability schema
   */
  app.get("/capabilities/:capabilityId", {
    schema: {
      description: "Get details of a capability schema",
      tags: ["capabilities"],
      params: {
        type: "object",
        properties: {
          capabilityId: { type: "string" },
        },
        required: ["capabilityId"],
      },
      response: {
        200: capabilitySchemaResponseSchema,
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { capabilityId } = request.params as { capabilityId: string };
    
    const schema = getCapabilitySchema(decodeURIComponent(capabilityId));
    
    if (!schema) {
      reply.status(404);
      return { error: `Capability not found: ${capabilityId}` };
    }
    
    return schema;
  });
  
  /**
   * Validate input data against a capability
   */
  app.post("/capabilities/:capabilityId/validate-input", {
    schema: {
      description: "Validate input data against a capability schema",
      tags: ["capabilities"],
      params: {
        type: "object",
        properties: {
          capabilityId: { type: "string" },
        },
        required: ["capabilityId"],
      },
      body: {
        type: "object",
        additionalProperties: true,
      },
      response: {
        200: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            errors: { type: "array" },
            warnings: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { capabilityId } = request.params as { capabilityId: string };
    
    const result = await validator.validateInput(
      decodeURIComponent(capabilityId),
      request.body,
      { includeWarnings: true }
    );
    
    return result;
  });
  
  /**
   * Validate output data against a capability
   */
  app.post("/capabilities/:capabilityId/validate-output", {
    schema: {
      description: "Validate output data against a capability schema",
      tags: ["capabilities"],
      params: {
        type: "object",
        properties: {
          capabilityId: { type: "string" },
        },
        required: ["capabilityId"],
      },
      body: {
        type: "object",
        additionalProperties: true,
      },
      response: {
        200: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            errors: { type: "array" },
            warnings: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { capabilityId } = request.params as { capabilityId: string };
    
    const result = await validator.validateOutput(
      decodeURIComponent(capabilityId),
      request.body,
      { includeWarnings: true }
    );
    
    return result;
  });
  
  // ---------------------------------------------------------------------------
  // COMPATIBILITY CHECKING
  // ---------------------------------------------------------------------------
  
  /**
   * Check compatibility between two capabilities
   */
  app.post("/compatibility/check", {
    schema: {
      description: "Check if two capabilities are compatible",
      tags: ["compatibility"],
      body: {
        type: "object",
        properties: {
          sourceCapability: { type: "string" },
          targetCapability: { type: "string" },
          sourceField: { type: "string" },
          targetField: { type: "string" },
        },
        required: ["sourceCapability", "targetCapability"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            sourceField: { type: "string" },
            targetField: { type: "string" },
            compatible: { type: "boolean" },
            confidence: { type: "number" },
            suggestedAdapter: { type: "object" },
            issues: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { 
      sourceCapability, 
      targetCapability, 
      sourceField, 
      targetField 
    } = request.body as {
      sourceCapability: string;
      targetCapability: string;
      sourceField?: string;
      targetField?: string;
    };
    
    const result = checkCapabilityCompatibility(
      sourceCapability,
      targetCapability,
      sourceField,
      targetField
    );
    
    return result;
  });
  
  /**
   * Validate a workflow DAG
   */
  app.post("/compatibility/validate-dag", {
    schema: {
      description: "Validate a workflow DAG for compatibility",
      tags: ["compatibility"],
      body: {
        type: "object",
        properties: {
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                capability: { type: "string" },
                dependsOn: { type: "array", items: { type: "string" } },
                payload: { type: "object" },
              },
              required: ["name", "capability", "dependsOn"],
            },
          },
        },
        required: ["nodes"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            valid: { type: "boolean" },
            connections: { type: "array" },
            missingCapabilities: { type: "array", items: { type: "string" } },
            suggestedAdapters: { type: "array" },
            errors: { type: "array", items: { type: "string" } },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { nodes } = request.body as { nodes: DAGNode[] };
    
    const result = validateDAG({ nodes });
    
    return result;
  });
  
  // ---------------------------------------------------------------------------
  // AGENT VIOLATION TRACKING
  // ---------------------------------------------------------------------------
  
  /**
   * Get violation count for an agent
   */
  app.get("/agents/:agentId/violations", {
    schema: {
      description: "Get schema violation count for an agent",
      tags: ["agents"],
      params: {
        type: "object",
        properties: {
          agentId: { type: "string" },
        },
        required: ["agentId"],
      },
      response: {
        200: {
          type: "object",
          properties: {
            agentId: { type: "string" },
            violationCount: { type: "number" },
            penalize: { type: "boolean" },
            reason: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    
    const result = await validator.shouldPenalize(agentId);
    
    return {
      agentId,
      ...result,
    };
  });
};
