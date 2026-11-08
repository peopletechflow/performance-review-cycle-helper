# Performance Review Cycle Helper | Workday MCP

An independent, task-shaped **Workday MCP** server and Claude skill. Not affiliated with, endorsed by, or certified by Workday, Inc.; Workday is a trademark of Workday, Inc. Live Workday access is not yet verified (see the capability table).

A Claude skill plus a task-shaped MCP server that lets an employee run **their own** performance review cycle: see the cycle and goals, collect evidence from work sources they opted in to, draft a self review or requested peer feedback in their own voice with citations, preview the exact submission, and submit only after confirming.

Status: **v0.1, fixture-tested.** All records in `src/fixtures/data.ts` are invented examples. **Live Workday submission is not supported**: it fails closed pending a tenant-specific performance contract (see docs/ARCHITECTURE.md). Live mode refuses to start.

## Lifecycle
`cycle -> evidence -> draft -> preview -> confirmed submission -> status`. Any edit creates a new draft version and invalidates the previous preview. Submitted drafts are immutable.

## Capabilities

| Capability | Tool(s) | Fixture | Live |
| --- | --- | --- | --- |
| Integration mode table | `list_integrations` | yes | yes (static) |
| My cycle, due dates, template, draft status | `get_my_review_cycle` | yes | blocked: Get_Employee_Reviews scoping not proven |
| My goals | `list_my_goals` | yes | blocked |
| Feedback I was asked to give | `list_my_feedback_requests` | yes | blocked |
| My evidence sources and opt-in state | `list_my_evidence_sources` | yes | blocked: no connectors |
| Evidence from opted-in sources, date window inside the period, own items only, attributed | `collect_evidence` | yes | blocked |
| Voice samples (data only, session scoped) | `set_voice_samples` | yes | yes (local) |
| Drafting context and rules | `get_drafting_context` | yes | n/a |
| Save and edit drafts with evidence citations | `save_draft`, `get_draft` | yes | n/a |
| Exact preview, then confirmed idempotent submission | `preview_submission`, `commit_submission` | yes (records a fixture submission) | **blocked**: no proven worker self-evaluation submit operation |

"Mines your work automatically" here means: within sources the user opted in to, within a date window they choose inside the review period, and only items they authored. No broad chat or mail scanning. Named providers (code host, docs, chat) are fixture adapters only.

Never: automated ratings, rankings or comparisons, employment-outcome recommendations, inferring sensitive traits, reading what others wrote about anyone. The user is the author; the client model (Claude) drafts, the server generates no text.

## Quick start (fixture mode)
```bash
pnpm install
pnpm check
FIXTURE_USER=emp_ava pnpm dev
```
Example users: `emp_ava`, `emp_ben` (submit frozen), `ro_cy` (read only), `emp_zed` (other tenant). For Claude Desktop, `pnpm build` and use `examples/claude_desktop_config.json`; load `skills/performance-review-cycle-helper/SKILL.md`.

## Docs
[ARCHITECTURE](docs/ARCHITECTURE.md), [SECURITY](docs/SECURITY.md), [HANDOVER](HANDOVER.md), [CHANGELOG](CHANGELOG.md), [AGENTS](AGENTS.md).

## Provenance
`src/core/` was adapted from `peopletechflow/workday-mcp-schema` at `4bf10b27b025a48b0882d98ab65983fdba271159` (MIT, same copyright holder): preview tokens (now bound to resource, version and content digest), idempotency (now concurrency safe), audit redaction, deny-wins roles. That repository is unchanged; no secrets or tenant data were copied. Its time-off write support does not imply review-write support.

## CI
A GitHub Actions workflow is ready in `docs/ci-workflow.example.yml` (install, `pnpm check`, build). Move it to `.github/workflows/ci.yml` from an account with the `workflow` permission to enable it.
