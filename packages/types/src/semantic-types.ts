/**
 * Nooterra Semantic Type System
 * 
 * Defines the core semantic types that enable agent interoperability.
 * Types are language-agnostic, JSON-serializable, and versioned.
 * 
 * Type ID format: @noot/<domain>:<TypeName>
 * Examples:
 *   @noot/geo:Location
 *   @noot/temporal:DateTime
 *   @noot/units:Temperature
 */

import { z } from "zod";

// =============================================================================
// TYPE SYSTEM CORE
// =============================================================================

/**
 * Semantic type definition
 */
export interface SemanticType {
  /** Unique type ID: @noot/<domain>:<TypeName> */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description of what this type represents */
  description: string;
  
  /** JSON Schema for validation */
  jsonSchema: Record<string, unknown>;
  
  /** Example values */
  examples: unknown[];
  
  /** Known converters to other types */
  converters: TypeConverter[];
  
  /** Version (semver) */
  version: string;
  
  /** Domain this type belongs to */
  domain: string;
  
  /** Tags for discovery */
  tags: string[];
}

/**
 * Converter between types
 */
export interface TypeConverter {
  /** Target type ID */
  toType: string;
  
  /** Conversion function name (for runtime lookup) */
  converterFn: string;
  
  /** Is this conversion lossless? */
  lossless: boolean;
  
  /** Does this require external service? (e.g., geocoding) */
  requiresService: boolean;
}

/**
 * Type registry entry (for database storage)
 */
export interface TypeRegistryEntry {
  id: string;
  definition: SemanticType;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  status: "draft" | "active" | "deprecated";
  deprecatedBy?: string;
  supersededBy?: string;
}

// =============================================================================
// DOMAIN: GEO (Geographic)
// =============================================================================

export const GeoLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  accuracy: z.number().optional(),
});

export const GeoAddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string(),
  postalCode: z.string().optional(),
  formatted: z.string().optional(),
});

export const GeoBoundingBoxSchema = z.object({
  north: z.number().min(-90).max(90),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  west: z.number().min(-180).max(180),
});

export const GeoTypes: SemanticType[] = [
  {
    id: "@noot/geo:Location",
    name: "Geographic Location",
    description: "A point on Earth specified by latitude and longitude",
    domain: "geo",
    version: "1.0.0",
    tags: ["location", "coordinates", "gps", "position"],
    jsonSchema: {
      type: "object",
      properties: {
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        altitude: { type: "number" },
        accuracy: { type: "number" },
      },
      required: ["latitude", "longitude"],
    },
    examples: [
      { latitude: 37.7749, longitude: -122.4194 },
      { latitude: 51.5074, longitude: -0.1278, altitude: 11 },
    ],
    converters: [
      { toType: "@noot/geo:Address", converterFn: "reverseGeocode", lossless: false, requiresService: true },
      { toType: "@noot/geo:LatLngString", converterFn: "toLatLngString", lossless: true, requiresService: false },
    ],
  },
  {
    id: "@noot/geo:Address",
    name: "Street Address",
    description: "A human-readable street address",
    domain: "geo",
    version: "1.0.0",
    tags: ["address", "location", "street"],
    jsonSchema: {
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        country: { type: "string" },
        postalCode: { type: "string" },
        formatted: { type: "string" },
      },
      required: ["country"],
    },
    examples: [
      { street: "1600 Amphitheatre Parkway", city: "Mountain View", state: "CA", country: "US", postalCode: "94043" },
      { formatted: "10 Downing Street, London, UK", country: "GB" },
    ],
    converters: [
      { toType: "@noot/geo:Location", converterFn: "geocode", lossless: false, requiresService: true },
    ],
  },
  {
    id: "@noot/geo:BoundingBox",
    name: "Geographic Bounding Box",
    description: "A rectangular area on Earth defined by north/south/east/west bounds",
    domain: "geo",
    version: "1.0.0",
    tags: ["bounds", "area", "region", "rectangle"],
    jsonSchema: {
      type: "object",
      properties: {
        north: { type: "number", minimum: -90, maximum: 90 },
        south: { type: "number", minimum: -90, maximum: 90 },
        east: { type: "number", minimum: -180, maximum: 180 },
        west: { type: "number", minimum: -180, maximum: 180 },
      },
      required: ["north", "south", "east", "west"],
    },
    examples: [
      { north: 37.8, south: 37.7, east: -122.3, west: -122.5 },
    ],
    converters: [],
  },
];

// =============================================================================
// DOMAIN: TEMPORAL (Time)
// =============================================================================

export const DateTimeSchema = z.string().datetime();
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const DurationSchema = z.object({
  value: z.number(),
  unit: z.enum(["milliseconds", "seconds", "minutes", "hours", "days", "weeks", "months", "years"]),
});

export const TemporalTypes: SemanticType[] = [
  {
    id: "@noot/temporal:DateTime",
    name: "Date and Time",
    description: "An ISO 8601 datetime string with timezone",
    domain: "temporal",
    version: "1.0.0",
    tags: ["datetime", "timestamp", "time", "date"],
    jsonSchema: {
      type: "string",
      format: "date-time",
    },
    examples: [
      "2024-12-03T10:30:00Z",
      "2024-12-03T10:30:00-08:00",
    ],
    converters: [
      { toType: "@noot/temporal:Date", converterFn: "extractDate", lossless: false, requiresService: false },
      { toType: "@noot/temporal:UnixTimestamp", converterFn: "toUnixTimestamp", lossless: true, requiresService: false },
    ],
  },
  {
    id: "@noot/temporal:Date",
    name: "Date",
    description: "A calendar date (YYYY-MM-DD)",
    domain: "temporal",
    version: "1.0.0",
    tags: ["date", "calendar"],
    jsonSchema: {
      type: "string",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    },
    examples: ["2024-12-03", "2025-01-01"],
    converters: [],
  },
  {
    id: "@noot/temporal:Duration",
    name: "Time Duration",
    description: "A length of time with value and unit",
    domain: "temporal",
    version: "1.0.0",
    tags: ["duration", "interval", "period"],
    jsonSchema: {
      type: "object",
      properties: {
        value: { type: "number" },
        unit: { enum: ["milliseconds", "seconds", "minutes", "hours", "days", "weeks", "months", "years"] },
      },
      required: ["value", "unit"],
    },
    examples: [
      { value: 30, unit: "minutes" },
      { value: 7, unit: "days" },
    ],
    converters: [
      { toType: "@noot/temporal:Milliseconds", converterFn: "toMilliseconds", lossless: false, requiresService: false },
    ],
  },
  {
    id: "@noot/temporal:DateRange",
    name: "Date Range",
    description: "A period between two dates",
    domain: "temporal",
    version: "1.0.0",
    tags: ["range", "period", "interval"],
    jsonSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date-time" },
        end: { type: "string", format: "date-time" },
      },
      required: ["start", "end"],
    },
    examples: [
      { start: "2024-12-01T00:00:00Z", end: "2024-12-31T23:59:59Z" },
    ],
    converters: [],
  },
];

// =============================================================================
// DOMAIN: UNITS (Measurements)
// =============================================================================

export const TemperatureSchema = z.object({
  value: z.number(),
  unit: z.enum(["C", "F", "K"]),
});

export const DistanceSchema = z.object({
  value: z.number(),
  unit: z.enum(["m", "km", "mi", "ft", "in", "cm", "mm"]),
});

export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string().length(3),
});

export const UnitsTypes: SemanticType[] = [
  {
    id: "@noot/units:Temperature",
    name: "Temperature",
    description: "A temperature measurement with unit",
    domain: "units",
    version: "1.0.0",
    tags: ["temperature", "weather", "measurement"],
    jsonSchema: {
      type: "object",
      properties: {
        value: { type: "number" },
        unit: { enum: ["C", "F", "K"] },
      },
      required: ["value", "unit"],
    },
    examples: [
      { value: 20, unit: "C" },
      { value: 68, unit: "F" },
    ],
    converters: [
      { toType: "@noot/units:Temperature", converterFn: "convertTemperature", lossless: true, requiresService: false },
    ],
  },
  {
    id: "@noot/units:Distance",
    name: "Distance",
    description: "A distance or length measurement",
    domain: "units",
    version: "1.0.0",
    tags: ["distance", "length", "measurement"],
    jsonSchema: {
      type: "object",
      properties: {
        value: { type: "number" },
        unit: { enum: ["m", "km", "mi", "ft", "in", "cm", "mm"] },
      },
      required: ["value", "unit"],
    },
    examples: [
      { value: 100, unit: "km" },
      { value: 5.5, unit: "mi" },
    ],
    converters: [
      { toType: "@noot/units:Distance", converterFn: "convertDistance", lossless: true, requiresService: false },
    ],
  },
  {
    id: "@noot/units:Money",
    name: "Monetary Amount",
    description: "An amount of money with currency code (ISO 4217)",
    domain: "units",
    version: "1.0.0",
    tags: ["money", "currency", "price", "payment"],
    jsonSchema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
      },
      required: ["amount", "currency"],
    },
    examples: [
      { amount: 99.99, currency: "USD" },
      { amount: 1000, currency: "EUR" },
    ],
    converters: [
      { toType: "@noot/units:Money", converterFn: "convertCurrency", lossless: false, requiresService: true },
    ],
  },
  {
    id: "@noot/units:Percentage",
    name: "Percentage",
    description: "A percentage value (0-100 or 0-1 normalized)",
    domain: "units",
    version: "1.0.0",
    tags: ["percentage", "ratio", "probability"],
    jsonSchema: {
      type: "object",
      properties: {
        value: { type: "number" },
        normalized: { type: "boolean", default: false },
      },
      required: ["value"],
    },
    examples: [
      { value: 75 },
      { value: 0.75, normalized: true },
    ],
    converters: [],
  },
];

// =============================================================================
// DOMAIN: MEDIA (Files, Images, Audio, Video)
// =============================================================================

export const ImageSchema = z.object({
  url: z.string().url().optional(),
  base64: z.string().optional(),
  mimeType: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  altText: z.string().optional(),
});

export const AudioSchema = z.object({
  url: z.string().url().optional(),
  base64: z.string().optional(),
  mimeType: z.string(),
  durationMs: z.number().optional(),
  sampleRate: z.number().optional(),
});

export const MediaTypes: SemanticType[] = [
  {
    id: "@noot/media:Image",
    name: "Image",
    description: "An image with URL or base64 data",
    domain: "media",
    version: "1.0.0",
    tags: ["image", "picture", "photo", "visual"],
    jsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        base64: { type: "string" },
        mimeType: { type: "string" },
        width: { type: "integer" },
        height: { type: "integer" },
        altText: { type: "string" },
      },
      required: ["mimeType"],
      oneOf: [
        { required: ["url"] },
        { required: ["base64"] },
      ],
    },
    examples: [
      { url: "https://example.com/image.jpg", mimeType: "image/jpeg", width: 1920, height: 1080 },
    ],
    converters: [
      { toType: "@noot/media:Image", converterFn: "convertImageFormat", lossless: false, requiresService: false },
    ],
  },
  {
    id: "@noot/media:Audio",
    name: "Audio",
    description: "An audio clip with URL or base64 data",
    domain: "media",
    version: "1.0.0",
    tags: ["audio", "sound", "speech", "music"],
    jsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        base64: { type: "string" },
        mimeType: { type: "string" },
        durationMs: { type: "integer" },
        sampleRate: { type: "integer" },
      },
      required: ["mimeType"],
    },
    examples: [
      { url: "https://example.com/audio.mp3", mimeType: "audio/mpeg", durationMs: 180000 },
    ],
    converters: [],
  },
  {
    id: "@noot/media:Document",
    name: "Document",
    description: "A document file (PDF, DOCX, TXT, etc.)",
    domain: "media",
    version: "1.0.0",
    tags: ["document", "file", "pdf", "text"],
    jsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        base64: { type: "string" },
        mimeType: { type: "string" },
        filename: { type: "string" },
        sizeBytes: { type: "integer" },
        text: { type: "string" },
      },
      required: ["mimeType"],
    },
    examples: [
      { url: "https://example.com/doc.pdf", mimeType: "application/pdf", filename: "report.pdf" },
    ],
    converters: [],
  },
];

// =============================================================================
// DOMAIN: TEXT (Natural Language)
// =============================================================================

export const TextTypes: SemanticType[] = [
  {
    id: "@noot/text:Plain",
    name: "Plain Text",
    description: "Unformatted text content",
    domain: "text",
    version: "1.0.0",
    tags: ["text", "string", "content"],
    jsonSchema: { type: "string" },
    examples: ["Hello, world!", "This is a paragraph of text."],
    converters: [],
  },
  {
    id: "@noot/text:Markdown",
    name: "Markdown Text",
    description: "Text formatted in Markdown",
    domain: "text",
    version: "1.0.0",
    tags: ["markdown", "formatted", "text"],
    jsonSchema: { type: "string" },
    examples: ["# Heading\n\nParagraph with **bold** text."],
    converters: [
      { toType: "@noot/text:Plain", converterFn: "stripMarkdown", lossless: false, requiresService: false },
      { toType: "@noot/text:HTML", converterFn: "markdownToHtml", lossless: true, requiresService: false },
    ],
  },
  {
    id: "@noot/text:HTML",
    name: "HTML Content",
    description: "HTML formatted content",
    domain: "text",
    version: "1.0.0",
    tags: ["html", "web", "formatted"],
    jsonSchema: { type: "string" },
    examples: ["<h1>Heading</h1><p>Paragraph with <strong>bold</strong> text.</p>"],
    converters: [
      { toType: "@noot/text:Plain", converterFn: "stripHtml", lossless: false, requiresService: false },
    ],
  },
  {
    id: "@noot/text:JSON",
    name: "JSON Data",
    description: "Structured JSON data",
    domain: "text",
    version: "1.0.0",
    tags: ["json", "data", "structured"],
    jsonSchema: {},
    examples: [{ key: "value" }, [1, 2, 3]],
    converters: [],
  },
];

// =============================================================================
// DOMAIN: LLM (Language Model I/O)
// =============================================================================

export const LLMTypes: SemanticType[] = [
  {
    id: "@noot/llm:Prompt",
    name: "LLM Prompt",
    description: "A prompt for a language model",
    domain: "llm",
    version: "1.0.0",
    tags: ["prompt", "llm", "ai", "input"],
    jsonSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        systemPrompt: { type: "string" },
        temperature: { type: "number", minimum: 0, maximum: 2 },
        maxTokens: { type: "integer" },
      },
      required: ["text"],
    },
    examples: [
      { text: "Explain quantum computing in simple terms" },
      { text: "Translate to French", systemPrompt: "You are a translator", temperature: 0.3 },
    ],
    converters: [],
  },
  {
    id: "@noot/llm:Completion",
    name: "LLM Completion",
    description: "A completion response from a language model",
    domain: "llm",
    version: "1.0.0",
    tags: ["completion", "response", "llm", "ai"],
    jsonSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        tokensUsed: { type: "integer" },
        finishReason: { enum: ["stop", "length", "content_filter"] },
        model: { type: "string" },
      },
      required: ["text"],
    },
    examples: [
      { text: "Quantum computing uses quantum bits...", tokensUsed: 150, finishReason: "stop" },
    ],
    converters: [],
  },
  {
    id: "@noot/llm:ChatMessage",
    name: "Chat Message",
    description: "A single message in a chat conversation",
    domain: "llm",
    version: "1.0.0",
    tags: ["chat", "message", "conversation"],
    jsonSchema: {
      type: "object",
      properties: {
        role: { enum: ["system", "user", "assistant", "tool"] },
        content: { type: "string" },
        name: { type: "string" },
      },
      required: ["role", "content"],
    },
    examples: [
      { role: "user", content: "Hello!" },
      { role: "assistant", content: "Hi! How can I help?" },
    ],
    converters: [],
  },
  {
    id: "@noot/llm:ChatHistory",
    name: "Chat History",
    description: "A sequence of chat messages",
    domain: "llm",
    version: "1.0.0",
    tags: ["chat", "history", "conversation"],
    jsonSchema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { enum: ["system", "user", "assistant", "tool"] },
          content: { type: "string" },
        },
        required: ["role", "content"],
      },
    },
    examples: [
      [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "2+2 equals 4." },
      ],
    ],
    converters: [],
  },
  {
    id: "@noot/llm:Embedding",
    name: "Text Embedding",
    description: "A vector embedding of text",
    domain: "llm",
    version: "1.0.0",
    tags: ["embedding", "vector", "semantic"],
    jsonSchema: {
      type: "object",
      properties: {
        vector: { type: "array", items: { type: "number" } },
        model: { type: "string" },
        dimensions: { type: "integer" },
      },
      required: ["vector"],
    },
    examples: [
      { vector: [0.1, -0.2, 0.3], model: "text-embedding-3-small", dimensions: 3 },
    ],
    converters: [],
  },
];

// =============================================================================
// DOMAIN: WEB (URLs, HTTP)
// =============================================================================

export const WebTypes: SemanticType[] = [
  {
    id: "@noot/web:URL",
    name: "URL",
    description: "A web URL",
    domain: "web",
    version: "1.0.0",
    tags: ["url", "link", "web"],
    jsonSchema: { type: "string", format: "uri" },
    examples: ["https://example.com", "https://api.example.com/v1/resource?id=123"],
    converters: [],
  },
  {
    id: "@noot/web:SearchResults",
    name: "Search Results",
    description: "Results from a web search",
    domain: "web",
    version: "1.0.0",
    tags: ["search", "results", "web"],
    jsonSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: "string", format: "uri" },
              snippet: { type: "string" },
            },
          },
        },
        totalResults: { type: "integer" },
      },
      required: ["query", "results"],
    },
    examples: [
      {
        query: "nooterra protocol",
        results: [
          { title: "Nooterra - Agent Coordination", url: "https://nooterra.ai", snippet: "The protocol for..." },
        ],
        totalResults: 1,
      },
    ],
    converters: [],
  },
  {
    id: "@noot/web:ScrapedPage",
    name: "Scraped Web Page",
    description: "Content extracted from a web page",
    domain: "web",
    version: "1.0.0",
    tags: ["scrape", "webpage", "content"],
    jsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        title: { type: "string" },
        text: { type: "string" },
        html: { type: "string" },
        links: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
      },
      required: ["url", "text"],
    },
    examples: [
      { url: "https://example.com", title: "Example", text: "Example content...", links: [] },
    ],
    converters: [],
  },
];

// =============================================================================
// AGGREGATE ALL TYPES
// =============================================================================

export const ALL_SEMANTIC_TYPES: SemanticType[] = [
  ...GeoTypes,
  ...TemporalTypes,
  ...UnitsTypes,
  ...MediaTypes,
  ...TextTypes,
  ...LLMTypes,
  ...WebTypes,
];

/**
 * Get type by ID
 */
export function getSemanticType(id: string): SemanticType | undefined {
  return ALL_SEMANTIC_TYPES.find(t => t.id === id);
}

/**
 * Get all types for a domain
 */
export function getTypesByDomain(domain: string): SemanticType[] {
  return ALL_SEMANTIC_TYPES.filter(t => t.domain === domain);
}

/**
 * Get all domain names
 */
export function getAllDomains(): string[] {
  return [...new Set(ALL_SEMANTIC_TYPES.map(t => t.domain))];
}

/**
 * Validate a value against a semantic type
 */
export function validateAgainstType(value: unknown, typeId: string): { valid: boolean; errors: string[] } {
  const type = getSemanticType(typeId);
  if (!type) {
    return { valid: false, errors: [`Unknown type: ${typeId}`] };
  }
  
  // Use JSON Schema validation
  // In production, use ajv or similar
  // For now, basic validation
  try {
    const schemaType = (type.jsonSchema as any).type;
    if (schemaType === "string" && typeof value !== "string") {
      return { valid: false, errors: [`Expected string, got ${typeof value}`] };
    }
    if (schemaType === "number" && typeof value !== "number") {
      return { valid: false, errors: [`Expected number, got ${typeof value}`] };
    }
    if (schemaType === "object" && (typeof value !== "object" || value === null)) {
      return { valid: false, errors: [`Expected object, got ${typeof value}`] };
    }
    if (schemaType === "array" && !Array.isArray(value)) {
      return { valid: false, errors: [`Expected array, got ${typeof value}`] };
    }
    return { valid: true, errors: [] };
  } catch (err: any) {
    return { valid: false, errors: [err.message] };
  }
}
