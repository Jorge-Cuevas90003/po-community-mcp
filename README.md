# CareBridge MCP — Healthcare surveillance over FHIR R4

> A Model Context Protocol server that gives any AI agent three clinical-grade tools for post-discharge care surveillance.
> Built for the **Agents Assemble — Healthcare AI Endgame** hackathon (Devpost, 2026).

This is a fork of [`prompt-opinion/po-community-mcp`](https://github.com/prompt-opinion/po-community-mcp) with three added tools that turn a generic FHIR-aware MCP server into a focused clinical safety net:

| Tool | Purpose |
|---|---|
| **DetectLabTrends** | Catches silent lab deterioration across 7 monitored labs |
| **CheckDrugInteractions** | Screens active medications against 30 ONC High-Priority interaction rules |
| **GenerateCarePlan** | Synthesizes findings into a deterministic, prioritized post-discharge plan |

The implementation is in [`typescript/`](typescript/) — see also `dotnet/` and `python/` for parallel implementations of the upstream template (we did not extend those).

---

## Why these three tools

Post-discharge readmissions are the most expensive, most preventable failure mode in modern healthcare. CMS estimates ~17% of Medicare patients are readmitted within 30 days, and roughly half of those readmissions are linked to two specific failure patterns:

1. **Silent lab deterioration** between discharge and the first follow-up visit (creatinine rising into AKI territory, A1C drifting, hemoglobin dropping)
2. **Dangerous medication combinations** — especially when discharge meds get layered on top of existing home meds without a full reconciliation pass

Most existing AI agents in healthcare focus on summarization and chart QA. CareBridge is different: it turns surveillance into something an agent can **do**, not just describe.

---

## Tools

### `DetectLabTrends`

Reads the patient's `Observation` resources, filters to 7 LOINC-coded labs, and flags any lab whose most recent value crosses a clinically validated threshold compared to the baseline average over a configurable lookback window (default 90 days).

| Lab | LOINC | Threshold | Source |
|---|---|---|---|
| Hemoglobin A1c | `4548-4` | ≥0.5% absolute change | ADA |
| Creatinine | `2160-0` | ≥0.3 mg/dL rise | KDIGO AKI |
| Hemoglobin | `718-7` | ≥1.0 g/dL drop | Standard anemia workup |
| eGFR (CKD-EPI 2021) | `62238-1` | ≥5 mL/min/1.73m² drop | KDIGO CKD progression |
| Potassium | `2823-3` | ≥0.5 mmol/L change | Hyperkalemia in RAAS therapy |
| TSH | `3016-3` | ≥2 mIU/L change | Levothyroxine titration |
| BNP | `30934-4` | ≥100 pg/mL rise | Heart failure decompensation |

Each finding is returned with the rationale alongside the delta — the consumer (an agent or a clinician) sees not just *what changed* but *why it matters*.

**Input schema:**
```json
{
  "patientId": "string (optional — uses FHIR context if omitted)",
  "lookbackDays": "integer (optional — default 90)"
}
```

### `CheckDrugInteractions`

Reads the patient's active `MedicationRequest` resources, classifies each medication into one of 18 drug classes, then cross-checks every pair of meds against 30 high-priority interaction rules.

The rule catalog is aligned with the **ONC High-Priority Drug-Drug Interaction list** (HHS-funded clinical informatics work) and covers:

- **Anticoagulant bleeding risk** — warfarin/DOAC + NSAIDs/antiplatelet/macrolides/quinolones/sulfonamides/azoles/amiodarone/phenytoin
- **Hyperkalemia / nephrotoxicity** — RAAS + potassium / RAAS + NSAID / RAAS + aliskiren
- **Lithium toxicity triad** — lithium + NSAID/ACE/thiazide
- **Digoxin toxicity** — digoxin + macrolides/amiodarone/P-gp inhibitors/loop diuretic-induced hypokalemia
- **Serotonin syndrome cluster** — SSRI/SNRI + MAOI (CONTRAINDICATED), SSRI + tramadol, SSRI + triptans
- **Statin myopathy (CYP3A4)** — sensitive statins + strong inhibitors / + amiodarone
- **Methotrexate toxicity** — MTX + trimethoprim, MTX + NSAIDs
- **CNS depression** — benzodiazepines + opioids (FDA black box warning)
- **PDE5 + nitrate hypotension** — CONTRAINDICATED

Output includes severity (`CONTRAINDICATED` / `MAJOR`), mechanism, and an explicit clinical recommendation per finding.

### `GenerateCarePlan`

Takes the structured outputs of the two surveillance tools and produces a deterministic care plan organized by priority:

| Priority | Trigger | Default timeline |
|---|---|---|
| **URGENT** | Any CONTRAINDICATED interaction | Today / same-day call |
| **HIGH** | MAJOR interactions, abnormal lab trends | 24–72 hours |
| **ROUTINE** | Stable labs, no DDIs | At next routine visit |

For each lab abnormality the plan includes the appropriate repeat panel and a target date (e.g. Creatinine ↑ → repeat BMP within 7 days; A1C ↑ → repeat A1C + fasting glucose within 30 days). For each DDI the plan attaches a pattern-matched patient education topic (bleeding signs, serotonin syndrome warning signs, etc.).

**Why this exists as its own tool:** the actionable parts of the report — "discontinue ibuprofen", "obtain repeat creatinine in 7 days", "watch for dark urine" — should not be generated by an LLM at all. They are deterministic outputs of the findings. Putting this synthesis in a dedicated tool keeps the model's hallucination surface limited to the framing language, not the medical recommendations themselves.

---

## SHARP-on-MCP

The MCP server declares its FHIR scope requirements via the `ai.promptopinion/fhir-context` capability extension, conforming to the [SHARP-on-MCP specification](https://sharponmcp.com/). Declared scopes:

| Scope | Required | Reason |
|---|---|---|
| `patient/Patient.rs` | ✅ | All tools need patient identity |
| `patient/Observation.rs` | ✅ | DetectLabTrends |
| `patient/MedicationRequest.rs` | ✅ | CheckDrugInteractions |
| `patient/MedicationStatement.rs` | – | Compatibility |
| `patient/Condition.rs` | – | Future: condition-aware DDI scoring |
| `offline_access` | – | Allow background re-evaluation |

This lets a host like Prompt Opinion enforce least-privilege FHIR access per agent connection, without a separate consent flow.

---

## Run locally

```bash
cd typescript
npm install
npm run start
# MCP server listening on port 5000
```

`/hello-world` returns `Hello World` for health checks. `/mcp` is the actual MCP endpoint (Streamable HTTP transport).

### Direct curl

```bash
curl -s -X POST http://localhost:5000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-fhir-server-url: https://hapi.fhir.org/baseR4" \
  -H "x-patient-id: 131946644" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"DetectLabTrends","arguments":{}}}'
```

Required headers (forwarded by Prompt Opinion automatically when registered as an MCP server):
- `x-fhir-server-url` — FHIR R4 base URL
- `x-patient-id` — patient identifier within that FHIR server
- `x-fhir-access-token` — Bearer token (optional for public FHIR servers like HAPI)

---

## Deploy

Built for free-tier deployment on Render. Uses Node 20, runs on the `PORT` env var Render injects.

Required env vars:

| Var | Required | Notes |
|---|---|---|
| `PORT` | Auto | Set by Render |
| `ALLOWED_HOSTS` | ✅ for managed platforms | Comma-separated host list. Set this to `<your-app>.onrender.com` so the MCP SDK's DNS rebinding protection lets the host through. |
| `PO_ENV` | Optional | `dev` / `prod` for default Prompt Opinion allowed-hosts. |

---

## Repo structure

```
.
├── typescript/                              ← TypeScript implementation (we extended this one)
│   ├── index.ts                             ← Express + MCP server bootstrap
│   ├── tools/
│   │   ├── DetectLabTrendsTool.ts           ← 7 labs, KDIGO/ADA thresholds
│   │   ├── CheckDrugInteractionsTool.ts     ← 18 drug classes, 30 interaction rules
│   │   ├── GenerateCarePlanTool.ts          ← deterministic care-plan synthesis
│   │   ├── PatientAgeTool.ts                ← upstream template (unchanged)
│   │   ├── PatientIdTool.ts                 ← upstream template (unchanged)
│   │   └── index.ts                         ← tool registry barrel
│   ├── fhir-client.ts                       ← FHIR R4 axios wrapper (unchanged)
│   ├── fhir-utilities.ts                    ← header → context bridge (unchanged)
│   ├── mcp-utilities.ts                     ← MCP response helpers (unchanged)
│   ├── package.json
│   └── Dockerfile
├── dotnet/                                  ← upstream .NET implementation (unchanged)
├── python/                                  ← upstream Python implementation (unchanged)
└── README.md                                ← this file
```

---

## What's next (post-hackathon)

1. **Drugbank cross-reference** for synonym normalization (currently we match on free-text + RxNorm display names).
2. **Severity scoring** that combines DDI severity with patient-specific risk factors (CKD stage, hepatic impairment).
3. **Time-of-day awareness** in care-plan timelines (URGENT actions during business hours route differently than night-time).
4. **MedicationStatement support** in CheckDrugInteractions — many EHRs publish reconciled meds as MedicationStatement, not MedicationRequest.

---

## License

ISC (inherits from upstream `po-community-mcp`).

---

*Built for [Agents Assemble — Healthcare AI Endgame](https://agents-assemble.devpost.com/) by [HarmonyForge Labs](https://app.promptopinion.ai/marketplace).*
