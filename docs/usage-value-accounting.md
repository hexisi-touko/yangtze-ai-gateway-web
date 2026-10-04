# Internal Usage and Reference Value

Entry: Admin -> Member usage analytics -> Usage and value.

This is an independent reporting ledger for nonprofit internal use. It does not
change member quotas, payment settings, relay charges, or API access.

## Accounting Basis

- Token counts, reference service value, and actual expenses are separate measures.
- Reference value is not revenue, savings, profit, employee performance, or proof
  of useful work. A reference price describes a chosen comparable service.
- Input/output and cache prices are entered in CNY per million tokens. Record the
  source, pricing date, and any exchange-rate conversion in the source field.
- Price versions are immutable. Channel-specific prices take priority over generic
  channel 0 prices; the latest effective version at the log timestamp is selected.
- Blank cache prices are unknown; explicit zero means a documented free price.
- Input is normalized into non-overlapping ordinary input, cache read, cache write
  (including separate 1-hour writes), and output before valuation. Displayed total
  input includes cache: do not add the displayed cache counts to it again.
- Legacy records with ambiguous cache semantics, malformed usage, explicitly
  estimated usage, missing prices, or special media/tool/per-call billing are
  pending, not silently priced at zero. Tiered pricing is not automated.
- Records are consumption ledger entries, not deduplicated successful requests.
  Errors/refunds are not counted again as token consumption. Historical logs may
  not distinguish retries or identify whether usage came from the upstream.
- Base tokens retain the original prompt + completion fields for reconciliation;
  this is not necessarily complete cache-inclusive usage. Normalization coverage
  and pricing coverage are shown separately.

## Official Price Sync

The **Sync official OpenAI prices** action reads the public document at
`https://developers.openai.com/api/docs/pricing` and stores an immutable price
snapshot. The former `platform.openai.com/docs/pricing` address is kept as a
fallback. The page is read-only; syncing never changes relay ratios, member
quotas, or procurement records. USD values are converted to CNY with the rate
entered in the dialog.

If the server cannot reach the public document directly, set
`OPENAI_OFFICIAL_PRICE_PROXY` (for example,
`http://127.0.0.1:7890` for a local Clash/CC Switch proxy). Standard
`HTTP_PROXY`/`HTTPS_PROXY` environment variables are also honored. A failed
refresh never deletes the previous snapshot, and the UI reports whether the
failure was network, HTTP, parsing, or database related. `OPENAI_OFFICIAL_PRICE_URL`
is available only for an operator-controlled mirror or future official URL.

## Costs and Reports

Enter actual upstream, server, analysis-service, or other expenses from receipts.
Entries are recognized in full on the selected date; there is no automatic monthly
allocation. No entries means unknown/unregistered cost, not zero cost. Incorrect
entries can be voided with soft deletion.

Archive reports preserve a JSON snapshot of prices, cost records and valuation.
Later price/cost changes affect live reports but not archives. Old reports without
a value snapshot remain without one. AI analysis does not automatically receive
this ledger, and API use is not assigned to the last client project by inference.

Queries are limited to 31 days and 50,000 source logs. Price/cost collections are
bounded to 5,000 entries; over-limit queries fail explicitly rather than return
partial totals. Larger deployments need server-side aggregation before expansion.

Database migrations create `usage_reference_prices`, `usage_costs`, and add
`value_snapshot` to member usage reports. Back up the database before deployment.
Only administrator-authenticated endpoints under `/api/member-usage/value` may
read or change the ledger. This version does not seed prices or expenses.

## References

- https://openrouter.ai/docs/faq
- https://openrouter.ai/docs/guides/guides/usage-accounting
- Local relay metadata: `service/text_quota.go`
- Local expression billing semantics: `pkg/billingexpr/expr.md`

Borrowed practices: model-specific rates, separate token categories, versioned
prices and reconciliation. Commercial credit/recharge mechanisms are not enabled
by this feature. New API internal quota units are neither tokens nor CNY.
