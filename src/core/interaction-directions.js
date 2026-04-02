export const INTERACTION_DIRECTION_SCHEMA_VERSION = "InteractionDirectionMatrix.v1";

export const INTERACTION_ENTITY_TYPE = Object.freeze({
  AGENT: "agent",
  HUMAN: "human",
  ROBOT: "robot",
  MACHINE: "machine"
});

export const INTERACTION_ENTITY_TYPES = Object.freeze([
  INTERACTION_ENTITY_TYPE.AGENT,
  INTERACTION_ENTITY_TYPE.HUMAN,
  INTERACTION_ENTITY_TYPE.ROBOT,
  INTERACTION_ENTITY_TYPE.MACHINE
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

const MATRIX = deepFreeze({
  [INTERACTION_ENTITY_TYPE.AGENT]: {
    [INTERACTION_ENTITY_TYPE.AGENT]: true,
    [INTERACTION_ENTITY_TYPE.HUMAN]: true,
    [INTERACTION_ENTITY_TYPE.ROBOT]: true,
    [INTERACTION_ENTITY_TYPE.MACHINE]: true
  },
  [INTERACTION_ENTITY_TYPE.HUMAN]: {
    [INTERACTION_ENTITY_TYPE.AGENT]: true,
    [INTERACTION_ENTITY_TYPE.HUMAN]: true,
    [INTERACTION_ENTITY_TYPE.ROBOT]: true,
    [INTERACTION_ENTITY_TYPE.MACHINE]: true
  },
  [INTERACTION_ENTITY_TYPE.ROBOT]: {
    [INTERACTION_ENTITY_TYPE.AGENT]: true,
    [INTERACTION_ENTITY_TYPE.HUMAN]: true,
    [INTERACTION_ENTITY_TYPE.ROBOT]: true,
    [INTERACTION_ENTITY_TYPE.MACHINE]: true
  },
  [INTERACTION_ENTITY_TYPE.MACHINE]: {
    [INTERACTION_ENTITY_TYPE.AGENT]: true,
    [INTERACTION_ENTITY_TYPE.HUMAN]: true,
    [INTERACTION_ENTITY_TYPE.ROBOT]: true,
    [INTERACTION_ENTITY_TYPE.MACHINE]: true
  }
});

export const INTERACTION_DIRECTION_MATRIX = MATRIX;

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function normalizeEntityType(value, name) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!INTERACTION_ENTITY_TYPES.includes(raw)) {
    throw new TypeError(`${name} must be one of ${INTERACTION_ENTITY_TYPES.join("|")}`);
  }
  return raw;
}

function cloneMatrix() {
  const out = {};
  for (const from of INTERACTION_ENTITY_TYPES) {
    out[from] = {};
    for (const to of INTERACTION_ENTITY_TYPES) out[from][to] = true;
  }
  return out;
}

export function buildInteractionDirectionMatrixV1() {
  return {
    schemaVersion: INTERACTION_DIRECTION_SCHEMA_VERSION,
    entityTypes: [...INTERACTION_ENTITY_TYPES],
    directions: cloneMatrix(),
    directionalCount: INTERACTION_ENTITY_TYPES.length * INTERACTION_ENTITY_TYPES.length
  };
}

export function isInteractionDirectionAllowed(fromType, toType) {
  const from = normalizeEntityType(fromType, "fromType");
  const to = normalizeEntityType(toType, "toType");
  return MATRIX[from][to] === true;
}

export function assertInteractionDirectionAllowed(fromType, toType) {
  const from = normalizeEntityType(fromType, "fromType");
  const to = normalizeEntityType(toType, "toType");
  if (MATRIX[from][to] !== true) {
    throw new TypeError(`interaction direction not allowed: ${from}->${to}`);
  }
  return true;
}

export function normalizeInteractionDirection({
  fromType = null,
  toType = null,
  defaultFromType = INTERACTION_ENTITY_TYPE.AGENT,
  defaultToType = INTERACTION_ENTITY_TYPE.AGENT,
  onInvalid = "throw"
} = {}) {
  const normalizeWithDefault = (value, fallback, valueName) => {
    if (value === null || value === undefined || String(value).trim() === "") {
      return normalizeEntityType(fallback, `default${valueName[0].toUpperCase()}${valueName.slice(1)}`);
    }
    return normalizeEntityType(value, valueName);
  };
  const fallback = {
    fromType: normalizeEntityType(defaultFromType, "defaultFromType"),
    toType: normalizeEntityType(defaultToType, "defaultToType")
  };
  try {
    const normalized = {
      fromType: normalizeWithDefault(fromType, fallback.fromType, "fromType"),
      toType: normalizeWithDefault(toType, fallback.toType, "toType")
    };
    assertInteractionDirectionAllowed(normalized.fromType, normalized.toType);
    return normalized;
  } catch (err) {
    if (onInvalid === "fallback") {
      assertInteractionDirectionAllowed(fallback.fromType, fallback.toType);
      return fallback;
    }
    throw err;
  }
}

export function validateInteractionDirectionMatrixV1(value) {
  assertPlainObject(value, "value");
  if (value.schemaVersion !== INTERACTION_DIRECTION_SCHEMA_VERSION) {
    throw new TypeError(`value.schemaVersion must be ${INTERACTION_DIRECTION_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.entityTypes)) throw new TypeError("value.entityTypes must be an array");
  if (value.entityTypes.length !== INTERACTION_ENTITY_TYPES.length) {
    throw new TypeError(`value.entityTypes must include ${INTERACTION_ENTITY_TYPES.length} entity types`);
  }
  for (let index = 0; index < INTERACTION_ENTITY_TYPES.length; index += 1) {
    if (value.entityTypes[index] !== INTERACTION_ENTITY_TYPES[index]) {
      throw new TypeError(`value.entityTypes[${index}] must be ${INTERACTION_ENTITY_TYPES[index]}`);
    }
  }

  assertPlainObject(value.directions, "value.directions");
  const expectedCount = INTERACTION_ENTITY_TYPES.length * INTERACTION_ENTITY_TYPES.length;
  if (value.directionalCount !== expectedCount) throw new TypeError(`value.directionalCount must be ${expectedCount}`);

  const fromKeys = Object.keys(value.directions).sort();
  const expectedKeys = [...INTERACTION_ENTITY_TYPES].sort();
  if (fromKeys.length !== expectedKeys.length || fromKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError(`value.directions keys must be ${INTERACTION_ENTITY_TYPES.join(", ")}`);
  }

  for (const from of INTERACTION_ENTITY_TYPES) {
    const row = value.directions[from];
    assertPlainObject(row, `value.directions.${from}`);
    const toKeys = Object.keys(row).sort();
    if (toKeys.length !== expectedKeys.length || toKeys.some((key, index) => key !== expectedKeys[index])) {
      throw new TypeError(`value.directions.${from} keys must be ${INTERACTION_ENTITY_TYPES.join(", ")}`);
    }
    for (const to of INTERACTION_ENTITY_TYPES) {
      if (row[to] !== true) throw new TypeError(`value.directions.${from}.${to} must be true`);
    }
  }

  return true;
}
