# InvoiceClaim.v1

This claim is stored at `invoice/invoice_claim.json` within Invoice bundles.

The verifier recomputes totals deterministically from:

- `metering/metering_report.json`
- `pricing/pricing_matrix.json`

and requires `totalCents` (and, if present, `lineItems[]`) to match.

