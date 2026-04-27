import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { FhirClientInstance } from "../fhir-client";
import { fhirR4 } from "@smile-cdr/fhirts";
import { addDays, formatISO } from "date-fns";

/**
 * GenerateCarePlan
 *
 * Takes a structured set of findings (from DetectLabTrends and/or
 * CheckDrugInteractions) and produces a deterministic 14/30/90-day
 * post-discharge care plan with explicit follow-up labs, medication review
 * actions, and patient education topics.
 *
 * The agent calls the other two tools first, then passes their findings here
 * as a normalized input. Output is a structured plan that the agent can
 * present to the care team without further LLM creativity (reduces drift
 * and hallucination risk on actionable medical recommendations).
 */

const SeveritySchema = z.enum(["CONTRAINDICATED", "MAJOR", "MODERATE", "MINOR"]);

const LabFindingSchema = z.object({
  labName: z.string().describe("Lab name (e.g. 'Hemoglobin A1c', 'Creatinine')."),
  direction: z
    .enum(["up", "down"])
    .describe("Direction of trend: 'up' or 'down'."),
  delta: z.number().describe("Absolute delta from baseline."),
  unit: z.string().describe("Unit (e.g. '%', 'mg/dL')."),
});

const DrugInteractionFindingSchema = z.object({
  drugA: z.string().describe("First medication name."),
  drugB: z.string().describe("Second medication name."),
  severity: SeveritySchema.describe("Interaction severity."),
  risk: z.string().describe("One-sentence risk statement."),
});

interface PriorityAction {
  priority: "URGENT" | "HIGH" | "ROUTINE";
  category:
    | "MEDICATION_REVIEW"
    | "FOLLOW_UP_LAB"
    | "PROVIDER_VISIT"
    | "PATIENT_EDUCATION"
    | "MONITORING";
  action: string;
  timeline: string;
  driver: string;
}

const FOLLOW_UP_LAB_BY_TREND: Record<string, { lab: string; days: number }> = {
  "Hemoglobin A1c": { lab: "Repeat A1C + fasting glucose", days: 30 },
  Creatinine: { lab: "Repeat BMP (creatinine, BUN, electrolytes)", days: 7 },
  "eGFR (CKD-EPI 2021)": { lab: "Repeat BMP + urine albumin/creatinine ratio", days: 14 },
  Hemoglobin: { lab: "CBC + iron studies + reticulocyte count", days: 7 },
  Potassium: { lab: "Repeat BMP", days: 3 },
  TSH: { lab: "Repeat TSH + free T4", days: 30 },
  BNP: { lab: "Repeat BNP + echocardiogram if not recent", days: 7 },
};

const PATIENT_EDUCATION_BY_DDI_PATTERN: Array<{
  match: (severity: string, risk: string) => boolean;
  topic: string;
}> = [
  {
    match: (_, risk) => /bleed/i.test(risk),
    topic: "Recognize signs of bleeding: black/tarry stools, blood in urine, easy bruising, prolonged bleeding from cuts",
  },
  {
    match: (_, risk) => /serotonin/i.test(risk),
    topic: "Recognize serotonin syndrome: agitation, fever, tremor, sweating, rapid heart rate — seek emergency care",
  },
  {
    match: (_, risk) => /hyperkalemia|potassium/i.test(risk),
    topic: "Avoid high-potassium foods (bananas, oranges, potatoes); recognize muscle weakness or palpitations as urgent symptoms",
  },
  {
    match: (_, risk) => /rhabdo|myopathy|muscle/i.test(risk),
    topic: "Stop statin and call provider if you experience unexplained muscle pain, weakness, or dark urine",
  },
  {
    match: (_, risk) => /digoxin tox/i.test(risk),
    topic: "Watch for digoxin toxicity: nausea, visual disturbances (yellow halos), confusion, slow heart rate",
  },
  {
    match: (_, risk) => /respiratory depress|cns/i.test(risk),
    topic: "Patient (and family) trained on naloxone use; avoid alcohol; report excessive sleepiness",
  },
  {
    match: (_, risk) => /lithium tox/i.test(risk),
    topic: "Stay well-hydrated; report tremor, confusion, or vomiting immediately; avoid OTC NSAIDs",
  },
];

class GenerateCarePlanTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GenerateCarePlan",
      {
        description:
          "Generates a structured post-discharge care plan from findings produced by DetectLabTrends and CheckDrugInteractions. Returns prioritized actions with explicit timelines (URGENT/HIGH/ROUTINE) covering medication review, follow-up labs with target dates, provider visits, monitoring, and patient education topics matched to the specific risks. Used as the final synthesis step after the other two surveillance tools have run.",
        inputSchema: {
          patientId: z
            .string()
            .describe(
              "The id of the patient. Optional if patient context already exists.",
            )
            .optional(),
          labFindings: z
            .array(LabFindingSchema)
            .describe(
              "List of significant lab trends from DetectLabTrends. Pass empty array if no lab trends.",
            )
            .default([]),
          drugInteractions: z
            .array(DrugInteractionFindingSchema)
            .describe(
              "List of high-priority drug interactions from CheckDrugInteractions. Pass empty array if none.",
            )
            .default([]),
          dischargeContext: z
            .string()
            .describe(
              "Optional one-line context about the discharge (e.g. 'CHF exacerbation', 'CABG postop day 5').",
            )
            .optional(),
        },
      },
      async ({
        patientId,
        labFindings,
        drugInteractions,
        dischargeContext,
      }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
          );
        }

        let patientName = `Patient ${patientId}`;
        try {
          const patient = await FhirClientInstance.read<fhirR4.Patient>(
            req,
            `Patient/${patientId}`,
          );
          if (patient?.name?.[0]) {
            const given = patient.name[0].given?.[0] ?? "";
            const family = patient.name[0].family ?? "";
            patientName = `${given} ${family}`.trim() || patientName;
          }
        } catch {
          /* non-fatal — keep generic patient name */
        }

        const actions: PriorityAction[] = [];
        const today = new Date();
        const isoDate = (d: Date) =>
          formatISO(d, { representation: "date" });

        // ── Drug interactions → MEDICATION_REVIEW + PATIENT_EDUCATION ──
        for (const ddi of drugInteractions ?? []) {
          const isContraindicated = ddi.severity === "CONTRAINDICATED";
          actions.push({
            priority: isContraindicated ? "URGENT" : "HIGH",
            category: "MEDICATION_REVIEW",
            action: `Reconcile ${ddi.drugA} and ${ddi.drugB} (severity: ${ddi.severity}). Discontinue or substitute one agent per provider judgment.`,
            timeline: isContraindicated
              ? "Immediately (today)"
              : `Within ${isContraindicated ? "24" : "72"} hours`,
            driver: `Drug interaction: ${ddi.risk}`,
          });

          for (const eduRule of PATIENT_EDUCATION_BY_DDI_PATTERN) {
            if (eduRule.match(ddi.severity, ddi.risk)) {
              actions.push({
                priority: isContraindicated ? "URGENT" : "HIGH",
                category: "PATIENT_EDUCATION",
                action: eduRule.topic,
                timeline: "Before discharge / at next visit",
                driver: `Drug interaction: ${ddi.drugA} + ${ddi.drugB}`,
              });
              break;
            }
          }
        }

        // ── Lab trends → FOLLOW_UP_LAB + MONITORING ──
        for (const lab of labFindings ?? []) {
          const followUp = FOLLOW_UP_LAB_BY_TREND[lab.labName];
          if (followUp) {
            const targetDate = addDays(today, followUp.days);
            actions.push({
              priority: "HIGH",
              category: "FOLLOW_UP_LAB",
              action: `${followUp.lab}`,
              timeline: `By ${isoDate(targetDate)} (${followUp.days} days)`,
              driver: `${lab.labName} ${lab.direction === "up" ? "↑" : "↓"} ${lab.delta} ${lab.unit} from baseline`,
            });
          } else {
            actions.push({
              priority: "ROUTINE",
              category: "MONITORING",
              action: `Continue monitoring ${lab.labName}`,
              timeline: "At next routine visit",
              driver: `${lab.labName} ${lab.direction === "up" ? "↑" : "↓"} ${lab.delta} ${lab.unit}`,
            });
          }
        }

        // ── Provider visit recommendation if any URGENT or 2+ HIGH ──
        const hasUrgent = actions.some((a) => a.priority === "URGENT");
        const highCount = actions.filter((a) => a.priority === "HIGH").length;
        if (hasUrgent) {
          actions.unshift({
            priority: "URGENT",
            category: "PROVIDER_VISIT",
            action: "Same-day call with primary provider OR emergency department referral if patient is symptomatic.",
            timeline: "Today",
            driver: "Contraindicated medication combination detected",
          });
        } else if (highCount >= 2) {
          actions.push({
            priority: "HIGH",
            category: "PROVIDER_VISIT",
            action: "Schedule post-discharge clinic visit for medication reconciliation and lab review.",
            timeline: "Within 7 days",
            driver: `${highCount} high-priority issues require coordinated review`,
          });
        } else if (actions.length > 0) {
          actions.push({
            priority: "ROUTINE",
            category: "PROVIDER_VISIT",
            action: "Standard post-discharge follow-up visit.",
            timeline: "Within 14 days",
            driver: "Routine post-discharge care",
          });
        }

        // ── Render output ──
        const lines: string[] = [];
        lines.push(`Post-Discharge Care Plan — ${patientName}`);
        lines.push(
          `Generated: ${isoDate(today)}${dischargeContext ? ` · Context: ${dischargeContext}` : ""}`,
        );
        lines.push("");

        if (actions.length === 0) {
          lines.push(
            "No actionable findings provided. Standard post-discharge follow-up applies (visit within 14 days, routine labs as appropriate).",
          );
          return McpUtilities.createTextResponse(lines.join("\n"));
        }

        const order: PriorityAction["priority"][] = ["URGENT", "HIGH", "ROUTINE"];
        for (const priority of order) {
          const group = actions.filter((a) => a.priority === priority);
          if (group.length === 0) continue;
          lines.push(`── ${priority} (${group.length}) ──`);
          for (const a of group) {
            lines.push(`• [${a.category}] ${a.action}`);
            lines.push(`    Timeline: ${a.timeline}`);
            lines.push(`    Driver:   ${a.driver}`);
          }
          lines.push("");
        }

        const summary: string[] = [];
        const urgent = actions.filter((a) => a.priority === "URGENT").length;
        const high = actions.filter((a) => a.priority === "HIGH").length;
        const routine = actions.filter((a) => a.priority === "ROUTINE").length;
        summary.push(`Summary: ${urgent} urgent, ${high} high, ${routine} routine action(s).`);
        if (urgent > 0) {
          summary.push(
            "⚠ At least one URGENT action requires same-day attention.",
          );
        }
        lines.push(...summary);

        return McpUtilities.createTextResponse(lines.join("\n").trim());
      },
    );
  }
}

export const GenerateCarePlanToolInstance = new GenerateCarePlanTool();
