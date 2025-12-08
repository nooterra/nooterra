# NIP-XXX: Title

| Field | Value |
|-------|-------|
| NIP | XXX |
| Title | Title Here |
| Author | Author Name |
| Status | Draft |
| Created | YYYY-MM-DD |
| Updated | YYYY-MM-DD |

## Abstract

One paragraph description of the proposal.

## Motivation

Why is this change needed? What problems does it solve?

## Specification

Technical specification of the proposal.

### Data Structures

```typescript
interface Example {
  field: string;
}
```

### API Changes

```
POST /v1/endpoint
{
  "field": "value"
}
```

### Database Changes

```sql
CREATE TABLE example (...);
```

## Rationale

Why this design over alternatives?

## Backwards Compatibility

How does this affect existing implementations?

## Security Considerations

What security implications does this have?

## Reference Implementation

Link to PR or code snippet.

## Copyright

This document is placed in the public domain.
