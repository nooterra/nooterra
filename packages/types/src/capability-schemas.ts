/**
 * Capability Schema System
 * 
 * Defines input/output contracts for capabilities.
 * Enables type-safe composition of agents in workflows.
 */

import { z } from "zod";
import { SemanticType } from "./semantic-types.js";

// =============================================================================
// CAPABILITY SCHEMA DEFINITIONS
// =============================================================================

/**
 * A field in a capability schema
 */
export interface SchemaField {
  /** Field name */
  name: string;
  
  /** Description of the field */
  description: string;
  
  /** Semantic type reference (e.g., "@noot/geo:Location") */
  semanticType?: string;
  
  /** JSON Schema for this field */
  jsonSchema: Record<string, unknown>;
  
  /** Is this field required? */
  required: boolean;
  
  /** Default value if not provided */
  defaultValue?: unknown;
}

/**
 * Complete capability schema (input and output)
 */
export interface CapabilitySchema {
  /** Capability ID (e.g., "cap.weather.forecast.v1") */
  capabilityId: string;
  
  /** Version of this schema */
  version: string;
  
  /** Human-readable description */
  description: string;
  
  /** Input schema - what the capability expects */
  input: {
    fields: SchemaField[];
    jsonSchema: Record<string, unknown>;
  };
  
  /** Output schema - what the capability produces */
  output: {
    fields: SchemaField[];
    jsonSchema: Record<string, unknown>;
  };
  
  /** Example input/output pairs */
  examples: Array<{
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  }>;
  
  /** Tags for discovery */
  tags: string[];
}

/**
 * Zod schema for validating CapabilitySchema
 */
export const CapabilitySchemaValidator = z.object({
  capabilityId: z.string().regex(/^cap\.[a-z]+(\.[a-z_]+)*\.v\d+$/),
  version: z.string(),
  description: z.string(),
  input: z.object({
    fields: z.array(z.object({
      name: z.string(),
      description: z.string(),
      semanticType: z.string().optional(),
      jsonSchema: z.record(z.string(), z.unknown()),
      required: z.boolean(),
      defaultValue: z.unknown().optional(),
    })),
    jsonSchema: z.record(z.string(), z.unknown()),
  }),
  output: z.object({
    fields: z.array(z.object({
      name: z.string(),
      description: z.string(),
      semanticType: z.string().optional(),
      jsonSchema: z.record(z.string(), z.unknown()),
      required: z.boolean(),
      defaultValue: z.unknown().optional(),
    })),
    jsonSchema: z.record(z.string(), z.unknown()),
  }),
  examples: z.array(z.object({
    input: z.record(z.string(), z.unknown()),
    output: z.record(z.string(), z.unknown()),
  })),
  tags: z.array(z.string()),
});

// =============================================================================
// BUILT-IN CAPABILITY SCHEMAS
// =============================================================================

export const BUILTIN_CAPABILITY_SCHEMAS: CapabilitySchema[] = [
  // -------------------------------------------------------------------------
  // PLANNING CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.plan.workflow.v1",
    version: "1.0.0",
    description: "Decomposes a natural language task into a workflow DAG",
    input: {
      fields: [
        {
          name: "task",
          description: "Natural language description of the task to accomplish",
          semanticType: "@noot/text:Plain",
          jsonSchema: { type: "string" },
          required: true,
        },
        {
          name: "constraints",
          description: "Optional constraints (budget, time, required capabilities)",
          jsonSchema: {
            type: "object",
            properties: {
              maxBudgetCents: { type: "integer" },
              maxDurationMs: { type: "integer" },
              requiredCapabilities: { type: "array", items: { type: "string" } },
              excludedAgents: { type: "array", items: { type: "string" } },
            },
          },
          required: false,
        },
        {
          name: "context",
          description: "Additional context for planning",
          jsonSchema: { type: "object" },
          required: false,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          task: { type: "string" },
          constraints: { type: "object" },
          context: { type: "object" },
        },
        required: ["task"],
      },
    },
    output: {
      fields: [
        {
          name: "dag",
          description: "The workflow DAG",
          jsonSchema: {
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
                  required: ["name", "capability"],
                },
              },
            },
            required: ["nodes"],
          },
          required: true,
        },
        {
          name: "reasoning",
          description: "Explanation of the planning decisions",
          semanticType: "@noot/text:Plain",
          jsonSchema: { type: "string" },
          required: false,
        },
        {
          name: "estimatedCost",
          description: "Estimated cost in cents",
          jsonSchema: { type: "integer" },
          required: false,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          dag: { type: "object" },
          reasoning: { type: "string" },
          estimatedCost: { type: "integer" },
        },
        required: ["dag"],
      },
    },
    examples: [
      {
        input: { task: "Find the weather in San Francisco and summarize it" },
        output: {
          dag: {
            nodes: [
              { name: "geocode", capability: "cap.geo.geocode.v1", dependsOn: [], payload: { query: "San Francisco" } },
              { name: "weather", capability: "cap.weather.forecast.v1", dependsOn: ["geocode"] },
              { name: "summarize", capability: "cap.text.summarize.v1", dependsOn: ["weather"] },
            ],
          },
          reasoning: "Need to geocode the city first, then fetch weather, then summarize",
          estimatedCost: 15,
        },
      },
    ],
    tags: ["planning", "workflow", "orchestration", "dag"],
  },
  
  // -------------------------------------------------------------------------
  // LLM CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.llm.generate.v1",
    version: "1.0.0",
    description: "Generate text completion from a prompt",
    input: {
      fields: [
        {
          name: "prompt",
          description: "The prompt to complete",
          semanticType: "@noot/llm:Prompt",
          jsonSchema: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  text: { type: "string" },
                  systemPrompt: { type: "string" },
                  temperature: { type: "number" },
                  maxTokens: { type: "integer" },
                },
                required: ["text"],
              },
            ],
          },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          prompt: {},
        },
        required: ["prompt"],
      },
    },
    output: {
      fields: [
        {
          name: "completion",
          description: "The generated text",
          semanticType: "@noot/llm:Completion",
          jsonSchema: {
            type: "object",
            properties: {
              text: { type: "string" },
              tokensUsed: { type: "integer" },
              finishReason: { type: "string" },
            },
            required: ["text"],
          },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          completion: { type: "object" },
        },
        required: ["completion"],
      },
    },
    examples: [
      {
        input: { prompt: "Explain photosynthesis in one sentence" },
        output: {
          completion: {
            text: "Photosynthesis is the process by which plants convert sunlight, water, and carbon dioxide into glucose and oxygen.",
            tokensUsed: 25,
            finishReason: "stop",
          },
        },
      },
    ],
    tags: ["llm", "text-generation", "ai", "completion"],
  },
  
  {
    capabilityId: "cap.llm.chat.v1",
    version: "1.0.0",
    description: "Chat completion with message history",
    input: {
      fields: [
        {
          name: "messages",
          description: "Chat message history",
          semanticType: "@noot/llm:ChatHistory",
          jsonSchema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { enum: ["system", "user", "assistant"] },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
          },
          required: true,
        },
        {
          name: "temperature",
          description: "Sampling temperature (0-2)",
          jsonSchema: { type: "number", minimum: 0, maximum: 2 },
          required: false,
          defaultValue: 0.7,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          messages: { type: "array" },
          temperature: { type: "number" },
        },
        required: ["messages"],
      },
    },
    output: {
      fields: [
        {
          name: "message",
          description: "The assistant's response",
          semanticType: "@noot/llm:ChatMessage",
          jsonSchema: {
            type: "object",
            properties: {
              role: { const: "assistant" },
              content: { type: "string" },
            },
            required: ["role", "content"],
          },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          message: { type: "object" },
        },
        required: ["message"],
      },
    },
    examples: [
      {
        input: {
          messages: [
            { role: "user", content: "What's the capital of France?" },
          ],
        },
        output: {
          message: { role: "assistant", content: "The capital of France is Paris." },
        },
      },
    ],
    tags: ["llm", "chat", "conversation", "ai"],
  },
  
  // -------------------------------------------------------------------------
  // TEXT CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.text.summarize.v1",
    version: "1.0.0",
    description: "Summarize text content",
    input: {
      fields: [
        {
          name: "text",
          description: "The text to summarize",
          semanticType: "@noot/text:Plain",
          jsonSchema: { type: "string" },
          required: true,
        },
        {
          name: "maxLength",
          description: "Maximum summary length in words",
          jsonSchema: { type: "integer", minimum: 10 },
          required: false,
          defaultValue: 100,
        },
        {
          name: "style",
          description: "Summary style",
          jsonSchema: { enum: ["bullet", "paragraph", "executive"] },
          required: false,
          defaultValue: "paragraph",
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          maxLength: { type: "integer" },
          style: { type: "string" },
        },
        required: ["text"],
      },
    },
    output: {
      fields: [
        {
          name: "summary",
          description: "The summarized text",
          semanticType: "@noot/text:Plain",
          jsonSchema: { type: "string" },
          required: true,
        },
        {
          name: "keyPoints",
          description: "Key points extracted",
          jsonSchema: { type: "array", items: { type: "string" } },
          required: false,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          keyPoints: { type: "array" },
        },
        required: ["summary"],
      },
    },
    examples: [
      {
        input: { text: "Long article about climate change...", maxLength: 50 },
        output: {
          summary: "Climate change is causing global temperatures to rise...",
          keyPoints: ["Rising temperatures", "Sea level increase", "Extreme weather"],
        },
      },
    ],
    tags: ["text", "summarization", "nlp"],
  },
  
  // -------------------------------------------------------------------------
  // GEO CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.geo.geocode.v1",
    version: "1.0.0",
    description: "Convert an address or place name to coordinates",
    input: {
      fields: [
        {
          name: "query",
          description: "Address or place name to geocode",
          jsonSchema: { type: "string" },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    output: {
      fields: [
        {
          name: "location",
          description: "The geocoded location",
          semanticType: "@noot/geo:Location",
          jsonSchema: {
            type: "object",
            properties: {
              latitude: { type: "number" },
              longitude: { type: "number" },
            },
            required: ["latitude", "longitude"],
          },
          required: true,
        },
        {
          name: "formattedAddress",
          description: "The formatted address",
          jsonSchema: { type: "string" },
          required: false,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          location: { type: "object" },
          formattedAddress: { type: "string" },
        },
        required: ["location"],
      },
    },
    examples: [
      {
        input: { query: "San Francisco, CA" },
        output: {
          location: { latitude: 37.7749, longitude: -122.4194 },
          formattedAddress: "San Francisco, CA, USA",
        },
      },
    ],
    tags: ["geo", "geocoding", "location", "address"],
  },
  
  // -------------------------------------------------------------------------
  // WEATHER CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.weather.forecast.v1",
    version: "1.0.0",
    description: "Get weather forecast for a location",
    input: {
      fields: [
        {
          name: "location",
          description: "Location to get weather for",
          semanticType: "@noot/geo:Location",
          jsonSchema: {
            type: "object",
            properties: {
              latitude: { type: "number" },
              longitude: { type: "number" },
            },
            required: ["latitude", "longitude"],
          },
          required: true,
        },
        {
          name: "days",
          description: "Number of days to forecast",
          jsonSchema: { type: "integer", minimum: 1, maximum: 14 },
          required: false,
          defaultValue: 7,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          location: { type: "object" },
          days: { type: "integer" },
        },
        required: ["location"],
      },
    },
    output: {
      fields: [
        {
          name: "forecasts",
          description: "Daily forecasts",
          jsonSchema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string", format: "date" },
                temperature: {
                  type: "object",
                  properties: {
                    high: { type: "number" },
                    low: { type: "number" },
                    unit: { enum: ["C", "F"] },
                  },
                },
                conditions: { type: "string" },
                precipitation: { type: "number" },
              },
            },
          },
          required: true,
        },
        {
          name: "location",
          description: "Location name",
          jsonSchema: { type: "string" },
          required: false,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          forecasts: { type: "array" },
          location: { type: "string" },
        },
        required: ["forecasts"],
      },
    },
    examples: [
      {
        input: { location: { latitude: 37.7749, longitude: -122.4194 }, days: 3 },
        output: {
          location: "San Francisco, CA",
          forecasts: [
            { date: "2024-12-03", temperature: { high: 15, low: 8, unit: "C" }, conditions: "Partly cloudy", precipitation: 10 },
            { date: "2024-12-04", temperature: { high: 14, low: 7, unit: "C" }, conditions: "Sunny", precipitation: 0 },
            { date: "2024-12-05", temperature: { high: 13, low: 6, unit: "C" }, conditions: "Rain", precipitation: 80 },
          ],
        },
      },
    ],
    tags: ["weather", "forecast", "meteorology"],
  },
  
  // -------------------------------------------------------------------------
  // WEB CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.web.search.v1",
    version: "1.0.0",
    description: "Search the web for information",
    input: {
      fields: [
        {
          name: "query",
          description: "Search query",
          jsonSchema: { type: "string" },
          required: true,
        },
        {
          name: "limit",
          description: "Maximum number of results",
          jsonSchema: { type: "integer", minimum: 1, maximum: 50 },
          required: false,
          defaultValue: 10,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["query"],
      },
    },
    output: {
      fields: [
        {
          name: "results",
          description: "Search results",
          semanticType: "@noot/web:SearchResults",
          jsonSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              results: { type: "array" },
              totalResults: { type: "integer" },
            },
          },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          results: { type: "object" },
        },
        required: ["results"],
      },
    },
    examples: [
      {
        input: { query: "nooterra agent protocol", limit: 5 },
        output: {
          results: {
            query: "nooterra agent protocol",
            results: [
              { title: "Nooterra Protocol", url: "https://nooterra.ai", snippet: "Agent coordination protocol..." },
            ],
            totalResults: 1,
          },
        },
      },
    ],
    tags: ["web", "search", "information-retrieval"],
  },
  
  {
    capabilityId: "cap.web.scrape.v1",
    version: "1.0.0",
    description: "Scrape content from a web page",
    input: {
      fields: [
        {
          name: "url",
          description: "URL to scrape",
          semanticType: "@noot/web:URL",
          jsonSchema: { type: "string", format: "uri" },
          required: true,
        },
        {
          name: "extractors",
          description: "What to extract (text, links, images, etc.)",
          jsonSchema: { type: "array", items: { enum: ["text", "links", "images", "metadata", "html"] } },
          required: false,
          defaultValue: ["text"],
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          extractors: { type: "array" },
        },
        required: ["url"],
      },
    },
    output: {
      fields: [
        {
          name: "page",
          description: "Scraped page content",
          semanticType: "@noot/web:ScrapedPage",
          jsonSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
              title: { type: "string" },
              text: { type: "string" },
              links: { type: "array" },
              html: { type: "string" },
              metadata: { type: "object" },
            },
          },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          page: { type: "object" },
        },
        required: ["page"],
      },
    },
    examples: [
      {
        input: { url: "https://example.com", extractors: ["text", "links"] },
        output: {
          page: {
            url: "https://example.com",
            title: "Example Domain",
            text: "This domain is for use in illustrative examples...",
            links: ["https://www.iana.org/domains/example"],
          },
        },
      },
    ],
    tags: ["web", "scraping", "extraction"],
  },
  
  // -------------------------------------------------------------------------
  // VERIFICATION CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.verify.generic.v1",
    version: "1.0.0",
    description: "Verify the output of another agent",
    input: {
      fields: [
        {
          name: "originalInput",
          description: "The input that was given to the original agent",
          jsonSchema: { type: "object" },
          required: true,
        },
        {
          name: "originalOutput",
          description: "The output from the original agent",
          jsonSchema: { type: "object" },
          required: true,
        },
        {
          name: "capability",
          description: "The capability that was invoked",
          jsonSchema: { type: "string" },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          originalInput: { type: "object" },
          originalOutput: { type: "object" },
          capability: { type: "string" },
        },
        required: ["originalInput", "originalOutput", "capability"],
      },
    },
    output: {
      fields: [
        {
          name: "verified",
          description: "Whether the output is verified",
          jsonSchema: { type: "boolean" },
          required: true,
        },
        {
          name: "confidence",
          description: "Confidence score (0-1)",
          jsonSchema: { type: "number", minimum: 0, maximum: 1 },
          required: true,
        },
        {
          name: "issues",
          description: "Any issues found",
          jsonSchema: { type: "array", items: { type: "string" } },
          required: false,
        },
        {
          name: "reasoning",
          description: "Explanation of verification result",
          jsonSchema: { type: "string" },
          required: false,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          verified: { type: "boolean" },
          confidence: { type: "number" },
          issues: { type: "array" },
          reasoning: { type: "string" },
        },
        required: ["verified", "confidence"],
      },
    },
    examples: [
      {
        input: {
          originalInput: { query: "2 + 2" },
          originalOutput: { answer: 4 },
          capability: "cap.math.calculate.v1",
        },
        output: {
          verified: true,
          confidence: 1.0,
          reasoning: "Mathematical calculation verified correct",
        },
      },
    ],
    tags: ["verification", "validation", "trust"],
  },
  
  // -------------------------------------------------------------------------
  // ADAPTER CAPABILITIES
  // -------------------------------------------------------------------------
  {
    capabilityId: "cap.adapt.transform.v1",
    version: "1.0.0",
    description: "Transform data between semantic types",
    input: {
      fields: [
        {
          name: "data",
          description: "The data to transform",
          jsonSchema: {},
          required: true,
        },
        {
          name: "fromType",
          description: "Source semantic type",
          jsonSchema: { type: "string" },
          required: true,
        },
        {
          name: "toType",
          description: "Target semantic type",
          jsonSchema: { type: "string" },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          data: {},
          fromType: { type: "string" },
          toType: { type: "string" },
        },
        required: ["data", "fromType", "toType"],
      },
    },
    output: {
      fields: [
        {
          name: "data",
          description: "The transformed data",
          jsonSchema: {},
          required: true,
        },
        {
          name: "lossless",
          description: "Whether the conversion was lossless",
          jsonSchema: { type: "boolean" },
          required: true,
        },
      ],
      jsonSchema: {
        type: "object",
        properties: {
          data: {},
          lossless: { type: "boolean" },
        },
        required: ["data", "lossless"],
      },
    },
    examples: [
      {
        input: {
          data: { value: 100, unit: "F" },
          fromType: "@noot/units:Temperature",
          toType: "@noot/units:Temperature",
        },
        output: {
          data: { value: 37.78, unit: "C" },
          lossless: true,
        },
      },
    ],
    tags: ["adapter", "transform", "conversion"],
  },
];

/**
 * Get capability schema by ID
 */
export function getCapabilitySchema(capabilityId: string): CapabilitySchema | undefined {
  return BUILTIN_CAPABILITY_SCHEMAS.find(s => s.capabilityId === capabilityId);
}

/**
 * Get all capability schemas for a domain
 */
export function getCapabilitySchemasByDomain(domain: string): CapabilitySchema[] {
  const prefix = `cap.${domain}.`;
  return BUILTIN_CAPABILITY_SCHEMAS.filter(s => s.capabilityId.startsWith(prefix));
}

/**
 * Get all capability domains
 */
export function getAllCapabilityDomains(): string[] {
  const domains = new Set<string>();
  BUILTIN_CAPABILITY_SCHEMAS.forEach(s => {
    const parts = s.capabilityId.split(".");
    if (parts.length >= 2 && parts[1]) {
      domains.add(parts[1]);
    }
  });
  return [...domains];
}
