/**
 * Compatibility Checker
 * 
 * Validates that agents in a workflow DAG can exchange data.
 * Identifies schema mismatches and suggests adapters.
 */

import { 
  CapabilitySchema, 
  getCapabilitySchema,
  BUILTIN_CAPABILITY_SCHEMAS 
} from "./capability-schemas.js";
import { 
  SemanticType, 
  getSemanticType, 
  ALL_SEMANTIC_TYPES 
} from "./semantic-types.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * A node in a workflow DAG
 */
export interface DAGNode {
  name: string;
  capability: string;
  dependsOn: string[];
  payload?: Record<string, unknown>;
}

/**
 * A workflow DAG
 */
export interface WorkflowDAG {
  nodes: DAGNode[];
}

/**
 * Result of checking compatibility between two nodes
 */
export interface ConnectionCompatibility {
  /** Source node name */
  from: string;
  /** Target node name */
  to: string;
  /** Source output field */
  sourceField: string;
  /** Target input field */
  targetField: string;
  /** Is this connection compatible? */
  compatible: boolean;
  /** Confidence (0-1) */
  confidence: number;
  /** If not compatible, what adapter could fix it? */
  suggestedAdapter?: {
    capability: string;
    fromType: string;
    toType: string;
  };
  /** Issues found */
  issues: string[];
}

/**
 * Result of validating an entire DAG
 */
export interface DAGValidationResult {
  /** Is the DAG valid? */
  valid: boolean;
  /** All connection checks */
  connections: ConnectionCompatibility[];
  /** Nodes with missing capabilities */
  missingCapabilities: string[];
  /** Suggested adapters to insert */
  suggestedAdapters: SuggestedAdapter[];
  /** General errors */
  errors: string[];
  /** Warnings (non-fatal) */
  warnings: string[];
}

/**
 * Suggested adapter insertion
 */
export interface SuggestedAdapter {
  /** Insert after this node */
  afterNode: string;
  /** Before this node */
  beforeNode: string;
  /** Adapter capability */
  capability: string;
  /** From type */
  fromType: string;
  /** To type */
  toType: string;
}

// =============================================================================
// COMPATIBILITY CHECKING
// =============================================================================

/**
 * Check if two JSON schemas are compatible
 */
function schemasCompatible(
  sourceSchema: Record<string, unknown>,
  targetSchema: Record<string, unknown>
): { compatible: boolean; confidence: number; issues: string[] } {
  const issues: string[] = [];
  
  // Empty schemas are compatible with anything
  if (!sourceSchema || Object.keys(sourceSchema).length === 0) {
    return { compatible: true, confidence: 0.5, issues: ["Source schema is empty"] };
  }
  if (!targetSchema || Object.keys(targetSchema).length === 0) {
    return { compatible: true, confidence: 0.5, issues: ["Target schema is empty"] };
  }
  
  const sourceType = sourceSchema.type as string;
  const targetType = targetSchema.type as string;
  
  // Type mismatch
  if (sourceType && targetType && sourceType !== targetType) {
    // Some types are coercible
    if (sourceType === "integer" && targetType === "number") {
      return { compatible: true, confidence: 1.0, issues: [] };
    }
    if (sourceType === "number" && targetType === "integer") {
      issues.push("Number may need to be truncated to integer");
      return { compatible: true, confidence: 0.8, issues };
    }
    issues.push(`Type mismatch: source is ${sourceType}, target expects ${targetType}`);
    return { compatible: false, confidence: 0, issues };
  }
  
  // Object comparison
  if (sourceType === "object" && targetType === "object") {
    const sourceProps = (sourceSchema.properties || {}) as Record<string, unknown>;
    const targetProps = (targetSchema.properties || {}) as Record<string, unknown>;
    const targetRequired = (targetSchema.required || []) as string[];
    
    // Check that all required target fields exist in source
    for (const reqField of targetRequired) {
      if (!(reqField in sourceProps)) {
        // Check if there's a similar field name
        const similar = Object.keys(sourceProps).find(
          k => k.toLowerCase() === reqField.toLowerCase()
        );
        if (similar) {
          issues.push(`Field name mismatch: source has '${similar}', target expects '${reqField}'`);
        } else {
          issues.push(`Missing required field: '${reqField}'`);
          return { compatible: false, confidence: 0, issues };
        }
      }
    }
    
    return { compatible: true, confidence: issues.length > 0 ? 0.7 : 1.0, issues };
  }
  
  // Array comparison
  if (sourceType === "array" && targetType === "array") {
    const sourceItems = sourceSchema.items as Record<string, unknown> | undefined;
    const targetItems = targetSchema.items as Record<string, unknown> | undefined;
    
    if (sourceItems && targetItems) {
      return schemasCompatible(sourceItems, targetItems);
    }
    return { compatible: true, confidence: 0.8, issues: [] };
  }
  
  // Primitive types match
  return { compatible: true, confidence: 1.0, issues: [] };
}

/**
 * Check if a semantic type can be converted to another
 */
function canConvertType(fromType: string, toType: string): boolean {
  if (fromType === toType) return true;
  
  const sourceType = getSemanticType(fromType);
  if (!sourceType) return false;
  
  return sourceType.converters.some(c => c.toType === toType);
}

/**
 * Get converter info between types
 */
function getConverter(fromType: string, toType: string): { 
  exists: boolean; 
  lossless: boolean; 
  requiresService: boolean;
  converterFn?: string;
} {
  if (fromType === toType) {
    return { exists: true, lossless: true, requiresService: false };
  }
  
  const sourceType = getSemanticType(fromType);
  if (!sourceType) {
    return { exists: false, lossless: false, requiresService: false };
  }
  
  const converter = sourceType.converters.find(c => c.toType === toType);
  if (converter) {
    return { 
      exists: true, 
      lossless: converter.lossless, 
      requiresService: converter.requiresService,
      converterFn: converter.converterFn,
    };
  }
  
  return { exists: false, lossless: false, requiresService: false };
}

/**
 * Check compatibility between two capability schemas
 */
export function checkCapabilityCompatibility(
  sourceCapability: string,
  targetCapability: string,
  sourceField?: string,
  targetField?: string
): ConnectionCompatibility {
  const sourceSchema = getCapabilitySchema(sourceCapability);
  const targetSchema = getCapabilitySchema(targetCapability);
  
  const result: ConnectionCompatibility = {
    from: sourceCapability,
    to: targetCapability,
    sourceField: sourceField || "*",
    targetField: targetField || "*",
    compatible: false,
    confidence: 0,
    issues: [],
  };
  
  if (!sourceSchema) {
    result.issues.push(`Unknown source capability: ${sourceCapability}`);
    return result;
  }
  
  if (!targetSchema) {
    result.issues.push(`Unknown target capability: ${targetCapability}`);
    return result;
  }
  
  // If specific fields specified, check those
  if (sourceField && targetField) {
    const srcField = sourceSchema.output.fields.find(f => f.name === sourceField);
    const tgtField = targetSchema.input.fields.find(f => f.name === targetField);
    
    if (!srcField) {
      result.issues.push(`Source capability has no output field '${sourceField}'`);
      return result;
    }
    if (!tgtField) {
      result.issues.push(`Target capability has no input field '${targetField}'`);
      return result;
    }
    
    // Check semantic type compatibility
    if (srcField.semanticType && tgtField.semanticType) {
      if (srcField.semanticType === tgtField.semanticType) {
        result.compatible = true;
        result.confidence = 1.0;
        return result;
      }
      
      const converter = getConverter(srcField.semanticType, tgtField.semanticType);
      if (converter.exists) {
        result.compatible = true;
        result.confidence = converter.lossless ? 0.95 : 0.8;
        result.suggestedAdapter = {
          capability: "cap.adapt.transform.v1",
          fromType: srcField.semanticType,
          toType: tgtField.semanticType,
        };
        if (!converter.lossless) {
          result.issues.push("Conversion may lose precision");
        }
        return result;
      }
      
      result.issues.push(
        `Semantic type mismatch: ${srcField.semanticType} → ${tgtField.semanticType}`
      );
    }
    
    // Fall back to JSON schema comparison
    const schemaCheck = schemasCompatible(srcField.jsonSchema, tgtField.jsonSchema);
    result.compatible = schemaCheck.compatible;
    result.confidence = schemaCheck.confidence;
    result.issues.push(...schemaCheck.issues);
    return result;
  }
  
  // Check overall output → input compatibility
  const schemaCheck = schemasCompatible(
    sourceSchema.output.jsonSchema,
    targetSchema.input.jsonSchema
  );
  
  result.compatible = schemaCheck.compatible;
  result.confidence = schemaCheck.confidence;
  result.issues.push(...schemaCheck.issues);
  
  return result;
}

/**
 * Validate a complete workflow DAG
 */
export function validateDAG(dag: WorkflowDAG): DAGValidationResult {
  const result: DAGValidationResult = {
    valid: true,
    connections: [],
    missingCapabilities: [],
    suggestedAdapters: [],
    errors: [],
    warnings: [],
  };
  
  const nodeMap = new Map<string, DAGNode>();
  
  // Build node map
  for (const node of dag.nodes) {
    if (nodeMap.has(node.name)) {
      result.errors.push(`Duplicate node name: ${node.name}`);
      result.valid = false;
    }
    nodeMap.set(node.name, node);
  }
  
  // Check for cycles (simple DFS)
  const visited = new Set<string>();
  const visiting = new Set<string>();
  
  function hasCycle(nodeName: string): boolean {
    if (visiting.has(nodeName)) return true;
    if (visited.has(nodeName)) return false;
    
    visiting.add(nodeName);
    const node = nodeMap.get(nodeName);
    if (node) {
      for (const dep of node.dependsOn) {
        if (hasCycle(dep)) return true;
      }
    }
    visiting.delete(nodeName);
    visited.add(nodeName);
    return false;
  }
  
  for (const node of dag.nodes) {
    if (hasCycle(node.name)) {
      result.errors.push(`Cycle detected involving node: ${node.name}`);
      result.valid = false;
      break;
    }
  }
  
  // Check each node
  for (const node of dag.nodes) {
    // Check capability exists
    const schema = getCapabilitySchema(node.capability);
    if (!schema) {
      result.missingCapabilities.push(node.capability);
      result.warnings.push(`Unknown capability: ${node.capability} (may be custom)`);
    }
    
    // Check dependencies exist
    for (const dep of node.dependsOn) {
      if (!nodeMap.has(dep)) {
        result.errors.push(`Node '${node.name}' depends on unknown node '${dep}'`);
        result.valid = false;
        continue;
      }
      
      // Check compatibility between dependency and this node
      const depNode = nodeMap.get(dep)!;
      const compat = checkCapabilityCompatibility(depNode.capability, node.capability);
      
      result.connections.push({
        ...compat,
        from: dep,
        to: node.name,
      });
      
      if (!compat.compatible) {
        if (compat.suggestedAdapter) {
          result.suggestedAdapters.push({
            afterNode: dep,
            beforeNode: node.name,
            capability: compat.suggestedAdapter.capability,
            fromType: compat.suggestedAdapter.fromType,
            toType: compat.suggestedAdapter.toType,
          });
          result.warnings.push(
            `Adapter needed between '${dep}' and '${node.name}': ${compat.issues.join(", ")}`
          );
        } else {
          result.errors.push(
            `Incompatible connection from '${dep}' to '${node.name}': ${compat.issues.join(", ")}`
          );
          result.valid = false;
        }
      }
    }
  }
  
  return result;
}

/**
 * Find agents that can satisfy a capability
 */
export function findCompatibleCapabilities(
  requiredCapability: string,
  availableCapabilities: string[]
): Array<{ capability: string; confidence: number }> {
  const required = getCapabilitySchema(requiredCapability);
  if (!required) {
    return [];
  }
  
  const matches: Array<{ capability: string; confidence: number }> = [];
  
  for (const cap of availableCapabilities) {
    if (cap === requiredCapability) {
      matches.push({ capability: cap, confidence: 1.0 });
      continue;
    }
    
    const available = getCapabilitySchema(cap);
    if (!available) continue;
    
    // Check if output schemas are compatible
    const compat = schemasCompatible(available.output.jsonSchema, required.output.jsonSchema);
    if (compat.compatible && compat.confidence > 0.5) {
      matches.push({ capability: cap, confidence: compat.confidence * 0.9 });
    }
  }
  
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Auto-insert adapters into a DAG to fix compatibility issues
 */
export function autoInsertAdapters(dag: WorkflowDAG): WorkflowDAG {
  const validation = validateDAG(dag);
  
  if (validation.suggestedAdapters.length === 0) {
    return dag;
  }
  
  const newNodes = [...dag.nodes];
  let adapterCount = 0;
  
  for (const adapter of validation.suggestedAdapters) {
    adapterCount++;
    const adapterName = `_adapter_${adapterCount}`;
    
    // Find the target node and update its dependencies
    const targetIdx = newNodes.findIndex(n => n.name === adapter.beforeNode);
    if (targetIdx === -1) continue;
    
    const targetNode = newNodes[targetIdx];
    if (!targetNode) continue;
    
    // Insert adapter node
    const adapterNode: DAGNode = {
      name: adapterName,
      capability: adapter.capability,
      dependsOn: [adapter.afterNode],
      payload: {
        fromType: adapter.fromType,
        toType: adapter.toType,
      },
    };
    
    // Update target to depend on adapter instead of original
    newNodes[targetIdx] = {
      name: targetNode.name,
      capability: targetNode.capability,
      dependsOn: targetNode.dependsOn.map(d => d === adapter.afterNode ? adapterName : d),
      payload: targetNode.payload,
    };
    
    // Insert adapter before target
    newNodes.splice(targetIdx, 0, adapterNode);
  }
  
  return { nodes: newNodes };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  getCapabilitySchema,
  getSemanticType,
  ALL_SEMANTIC_TYPES,
  BUILTIN_CAPABILITY_SCHEMAS,
};
