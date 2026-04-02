/**
 * Core types — shared across all layers of the world runtime.
 *
 * Import from here:
 *   import { WorldEvent, WorldObject, Money, createTraceId } from '#core/index.js';
 */

// Trace propagation
export {
  createTraceId,
  createId,
  createTraceContext,
  type TraceContext,
  type TraceSource,
} from './trace.js';

// Money
export {
  MoneySchema,
  money,
  moneyFromDollars,
  toDollars,
  addMoney,
  subtractMoney,
  isPositive,
  isZeroOrNegative,
  formatMoney,
  type Money,
} from './money.js';

// Events
export {
  EVENT_DOMAINS,
  EVENT_TYPES,
  eventDomain,
  ObjectRefSchema,
  ProvenanceSchema,
  WorldEventSchema,
  type EventDomain,
  type EventType,
  type ObjectRef,
  type Provenance,
  type WorldEvent,
} from './events.js';

// Objects
export {
  OBJECT_TYPES,
  RELATIONSHIP_TYPES,
  ACTION_CLASSES,
  WorldObjectSchema,
  RelationshipSchema,
  PartyStateSchema,
  PartyEstimatedSchema,
  InvoiceStateSchema,
  InvoiceEstimatedSchema,
  PaymentStateSchema,
  ObligationStateSchema,
  ObligationEstimatedSchema,
  ConversationStateSchema,
  ConversationEstimatedSchema,
  TaskStateSchema,
  type ObjectType,
  type RelationType,
  type ActionClass,
  type WorldObject,
  type Relationship,
  type PartyState,
  type PartyEstimated,
  type InvoiceState,
  type InvoiceEstimated,
  type PaymentState,
  type ObligationState,
  type ObligationEstimated,
  type ConversationState,
  type ConversationEstimated,
  type TaskState,
} from './objects.js';
