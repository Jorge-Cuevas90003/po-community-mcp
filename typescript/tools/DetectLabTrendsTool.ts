import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { FhirClientInstance } from "../fhir-client";
import { fhirR4 } from "@smile-cdr/fhirts";
import { subDays, formatISO } from "date-fns";

interface LabConfig {
  loincCode: string;
  displayName: string;
  unit: string;
  threshold: number;
  /** Clinical context — surfaced in the report when a trend is flagged. */
  rationale: string;
}

const LAB_CONFIGS: LabConfig[] = [
  {
    loincCode: "4548-4",
    displayName: "Hemoglobin A1c",
    unit: "%",
    threshold: 0.5,
    rationale: "ADA: ≥0.5% absolute change indicates meaningful glycemic control change.",
  },
  {
    loincCode: "2160-0",
    displayName: "Creatinine",
    unit: "mg/dL",
    threshold: 0.3,
    rationale: "KDIGO AKI: ≥0.3 mg/dL rise within 48h or 1.5× baseline within 7 days defines AKI.",
  },
  {
    loincCode: "718-7",
    displayName: "Hemoglobin",
    unit: "g/dL",
    threshold: 1.0,
    rationale: "≥1 g/dL drop suggests bleeding, hemolysis, or worsening anemia of chronic disease.",
  },
  // ── Expanded panel ──
  {
    loincCode: "62238-1",
    displayName: "eGFR (CKD-EPI 2021)",
    unit: "mL/min/1.73m2",
    threshold: 5,
    rationale: "≥5 mL/min/1.73m² drop sustained over 90 days suggests CKD progression (KDIGO).",
  },
  {
    loincCode: "2823-3",
    displayName: "Potassium",
    unit: "mmol/L",
    threshold: 0.5,
    rationale: "≥0.5 mmol/L change is clinically meaningful; >5.5 hyperkalemia, <3.5 hypokalemia.",
  },
  {
    loincCode: "3016-3",
    displayName: "TSH",
    unit: "mIU/L",
    threshold: 2.0,
    rationale: "≥2 mIU/L change suggests thyroid medication adjustment is needed (esp. levothyroxine titration).",
  },
  {
    loincCode: "30934-4",
    displayName: "BNP",
    unit: "pg/mL",
    threshold: 100,
    rationale: "≥100 pg/mL rise suggests heart failure decompensation; >400 highly suggestive.",
  },
];

interface TrendResult {
  labName: string;
  loincCode: string;
  latestValue: number;
  latestDate: string;
  baselineAverage: number;
  baselineCount: number;
  delta: number;
  direction: "up" | "down";
  threshold: number;
  unit: string;
  rationale: string;
  isSignificant: boolean;
}

class DetectLabTrendsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "DetectLabTrends",
      {
        description:
          "Detects significant trends in 7 clinically important labs for post-discharge surveillance: Hemoglobin A1c (glycemic control), Creatinine + eGFR (kidney function / AKI), Hemoglobin (bleeding/anemia), Potassium (hyperkalemia in RAAS therapy), TSH (thyroid medication titration), and BNP (heart failure decompensation). Each lab has a clinically validated threshold (KDIGO, ADA, etc.) and the report includes the rationale alongside the delta.",
        inputSchema: {
          patientId: z
            .string()
            .describe(
              "The id of the patient. Optional if patient context already exists.",
            )
            .optional(),
          lookbackDays: z
            .number()
            .int()
            .min(1)
            .describe(
              "How many days of history to use for the baseline. Default: 90.",
            )
            .optional(),
        },
      },
      async ({ patientId, lookbackDays }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
          );
        }

        const lookback = lookbackDays ?? 90;
        const sinceDate = formatISO(subDays(new Date(), lookback), {
          representation: "date",
        });

        const trends: TrendResult[] = [];
        const errors: string[] = [];

        for (const lab of LAB_CONFIGS) {
          try {
            const bundle = await FhirClientInstance.search(req, "Observation", [
              `patient=${patientId}`,
              `code=http://loinc.org|${lab.loincCode}`,
              `date=ge${sinceDate}`,
              "_sort=-date",
              "_count=100",
            ]);

            const observations = (bundle?.entry ?? [])
              .map((e) => e.resource as fhirR4.Observation | undefined)
              .filter(
                (o): o is fhirR4.Observation =>
                  !!o &&
                  o.valueQuantity?.value !== undefined &&
                  !!o.effectiveDateTime,
              );

            if (observations.length < 2) {
              continue;
            }

            const latest = observations[0];
            const baseline = observations.slice(1);

            const latestValue = latest.valueQuantity!.value!;
            const latestDate = latest.effectiveDateTime!;
            const baselineAverage =
              baseline.reduce(
                (sum, o) => sum + (o.valueQuantity!.value ?? 0),
                0,
              ) / baseline.length;

            const delta = latestValue - baselineAverage;
            const isSignificant = Math.abs(delta) >= lab.threshold;

            trends.push({
              labName: lab.displayName,
              loincCode: lab.loincCode,
              latestValue,
              latestDate,
              baselineAverage: Math.round(baselineAverage * 100) / 100,
              baselineCount: baseline.length,
              delta: Math.round(delta * 100) / 100,
              direction: delta >= 0 ? "up" : "down",
              threshold: lab.threshold,
              unit: lab.unit,
              rationale: lab.rationale,
              isSignificant,
            });
          } catch (e: unknown) {
            errors.push(`${lab.displayName}: ${(e as Error).message}`);
          }
        }

        const significantTrends = trends.filter((t) => t.isSignificant);

        const lines: string[] = [];
        lines.push(`Lab trend analysis (last ${lookback} days):`);
        lines.push("");

        if (significantTrends.length === 0) {
          lines.push("No significant lab trends detected.");
        } else {
          lines.push(
            `${significantTrends.length} significant trend(s) detected:`,
          );
          for (const t of significantTrends) {
            const arrow = t.direction === "up" ? "↑" : "↓";
            lines.push(
              `  - ${t.labName}: ${arrow} ${t.latestValue} ${t.unit} (latest ${t.latestDate}) vs baseline avg ${t.baselineAverage} ${t.unit} from ${t.baselineCount} prior reading(s). Delta: ${t.delta} ${t.unit} (threshold ${t.threshold} ${t.unit}).`,
            );
            lines.push(`    Rationale: ${t.rationale}`);
          }
        }

        const stableTrends = trends.filter((t) => !t.isSignificant);
        if (stableTrends.length > 0) {
          lines.push("");
          lines.push("Other tracked labs (no significant trend):");
          for (const t of stableTrends) {
            lines.push(
              `  - ${t.labName}: ${t.latestValue} ${t.unit} (Δ ${t.delta} ${t.unit})`,
            );
          }
        }

        if (errors.length > 0) {
          lines.push("");
          lines.push("Errors:");
          for (const err of errors) {
            lines.push(`  - ${err}`);
          }
        }

        return McpUtilities.createTextResponse(lines.join("\n"));
      },
    );
  }
}

export const DetectLabTrendsToolInstance = new DetectLabTrendsTool();
