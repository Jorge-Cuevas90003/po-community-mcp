import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { FhirClientInstance } from "../fhir-client";
import { fhirR4 } from "@smile-cdr/fhirts";

type DrugClass =
  | "warfarin"
  | "nsaids"
  | "sulfonamides"
  | "macrolides"
  | "quinolones"
  | "ace_inhibitors"
  | "potassium_sparing_diuretics"
  | "potassium_supplements"
  | "ssris"
  | "maois"
  | "digoxin"
  | "statins_cyp3a4_sensitive"
  | "strong_cyp3a4_inhibitors"
  | "methotrexate"
  | "trimethoprim"
  | "raas_blockers"
  | "aliskiren"
  | "pimozide";

const DRUG_CLASS_MEMBERS: Record<DrugClass, string[]> = {
  warfarin: ["warfarin", "coumadin", "jantoven"],
  nsaids: [
    "ibuprofen", "naproxen", "aspirin", "diclofenac", "ketorolac",
    "celecoxib", "meloxicam", "indomethacin", "piroxicam", "etodolac",
    "nabumetone", "sulindac", "ketoprofen", "advil", "motrin", "aleve",
  ],
  sulfonamides: [
    "sulfamethoxazole", "trimethoprim-sulfamethoxazole", "bactrim",
    "septra", "sulfadiazine", "sulfasalazine",
  ],
  macrolides: [
    "erythromycin", "clarithromycin", "azithromycin", "biaxin", "zithromax",
  ],
  quinolones: [
    "ciprofloxacin", "levofloxacin", "moxifloxacin", "ofloxacin",
    "cipro", "levaquin", "avelox",
  ],
  ace_inhibitors: [
    "lisinopril", "enalapril", "ramipril", "benazepril", "captopril",
    "fosinopril", "quinapril", "perindopril", "trandolapril", "moexipril",
  ],
  potassium_sparing_diuretics: [
    "spironolactone", "eplerenone", "amiloride", "triamterene", "aldactone",
  ],
  potassium_supplements: [
    "potassium chloride", "potassium gluconate", "potassium bicarbonate",
    "k-dur", "klor-con", "micro-k", "potassium",
  ],
  ssris: [
    "fluoxetine", "sertraline", "paroxetine", "citalopram", "escitalopram",
    "fluvoxamine", "prozac", "zoloft", "paxil", "celexa", "lexapro",
  ],
  maois: [
    "selegiline", "phenelzine", "tranylcypromine", "isocarboxazid",
    "rasagiline", "nardil", "parnate", "marplan", "emsam",
  ],
  digoxin: ["digoxin", "lanoxin", "digitek"],
  statins_cyp3a4_sensitive: [
    "simvastatin", "lovastatin", "atorvastatin", "zocor", "mevacor", "lipitor",
  ],
  strong_cyp3a4_inhibitors: [
    "clarithromycin", "ketoconazole", "itraconazole", "ritonavir",
    "nefazodone", "voriconazole", "posaconazole", "indinavir", "saquinavir",
    "nelfinavir", "telithromycin",
  ],
  methotrexate: ["methotrexate", "trexall", "rheumatrex", "otrexup"],
  trimethoprim: [
    "trimethoprim", "trimethoprim-sulfamethoxazole", "bactrim", "septra",
  ],
  raas_blockers: [
    "lisinopril", "enalapril", "ramipril", "benazepril", "captopril",
    "losartan", "valsartan", "olmesartan", "candesartan", "irbesartan",
    "telmisartan", "azilsartan",
  ],
  aliskiren: ["aliskiren", "tekturna"],
  pimozide: ["pimozide", "orap"],
};

interface InteractionRule {
  classA: DrugClass;
  classB: DrugClass;
  severity: "CONTRAINDICATED" | "MAJOR";
  risk: string;
  recommendation: string;
}

const ONC_HIGH_PRIORITY_INTERACTIONS: InteractionRule[] = [
  {
    classA: "warfarin",
    classB: "nsaids",
    severity: "MAJOR",
    risk: "Increased bleeding risk (additive antiplatelet + anticoagulant effect)",
    recommendation: "Avoid combination. If unavoidable, monitor INR closely and watch for GI bleeding.",
  },
  {
    classA: "warfarin",
    classB: "sulfonamides",
    severity: "MAJOR",
    risk: "Sulfonamides displace warfarin from albumin and inhibit CYP2C9, raising INR.",
    recommendation: "Monitor INR within 3-5 days of initiating. Reduce warfarin dose if needed.",
  },
  {
    classA: "warfarin",
    classB: "macrolides",
    severity: "MAJOR",
    risk: "CYP3A4 inhibition raises warfarin levels, increasing bleeding risk.",
    recommendation: "Choose alternative antibiotic if possible (e.g. doxycycline). Monitor INR.",
  },
  {
    classA: "warfarin",
    classB: "quinolones",
    severity: "MAJOR",
    risk: "Quinolones potentiate warfarin effect, raising INR.",
    recommendation: "Monitor INR within 3-5 days of starting therapy.",
  },
  {
    classA: "ace_inhibitors",
    classB: "potassium_sparing_diuretics",
    severity: "MAJOR",
    risk: "Hyperkalemia risk (both reduce potassium excretion).",
    recommendation: "Check serum potassium before and within 1 week of starting combination.",
  },
  {
    classA: "ace_inhibitors",
    classB: "potassium_supplements",
    severity: "MAJOR",
    risk: "Hyperkalemia, especially in CKD or elderly patients.",
    recommendation: "Avoid unless documented hypokalemia. Monitor K+ closely.",
  },
  {
    classA: "digoxin",
    classB: "macrolides",
    severity: "MAJOR",
    risk: "Macrolides increase digoxin levels (P-glycoprotein inhibition), risk of digoxin toxicity.",
    recommendation: "Check digoxin level. Consider holding or reducing dose.",
  },
  {
    classA: "ssris",
    classB: "maois",
    severity: "CONTRAINDICATED",
    risk: "Serotonin syndrome (potentially fatal).",
    recommendation: "Absolute contraindication. Allow ≥14-day washout between drugs (5 weeks for fluoxetine).",
  },
  {
    classA: "statins_cyp3a4_sensitive",
    classB: "strong_cyp3a4_inhibitors",
    severity: "MAJOR",
    risk: "Markedly elevated statin levels — risk of rhabdomyolysis.",
    recommendation: "Switch to pravastatin/rosuvastatin or hold statin during course of inhibitor.",
  },
  {
    classA: "methotrexate",
    classB: "trimethoprim",
    severity: "MAJOR",
    risk: "Additive folate antagonism — risk of pancytopenia and methotrexate toxicity.",
    recommendation: "Avoid combination. If unavoidable, monitor CBC weekly.",
  },
  {
    classA: "raas_blockers",
    classB: "aliskiren",
    severity: "MAJOR",
    risk: "Hyperkalemia, hypotension, renal impairment (esp. in diabetes or CKD).",
    recommendation: "Contraindicated in diabetic patients. Avoid combination.",
  },
];

interface PatientMedication {
  raw: string;
  normalized: string;
  rxnorm?: string;
  classes: DrugClass[];
  medicationRequestId?: string;
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/[^\w\s\-]/g, "");
}

function classifyDrug(normalizedName: string): DrugClass[] {
  const matched: DrugClass[] = [];
  for (const [className, members] of Object.entries(DRUG_CLASS_MEMBERS)) {
    for (const member of members) {
      if (normalizedName.includes(member)) {
        matched.push(className as DrugClass);
        break;
      }
    }
  }
  return matched;
}

function extractMedicationName(mr: fhirR4.MedicationRequest): {
  name: string;
  rxnorm?: string;
} | null {
  const cc = mr.medicationCodeableConcept;
  if (cc?.text) {
    const rxnormCoding = cc.coding?.find(
      (c) => c.system === "http://www.nlm.nih.gov/research/umls/rxnorm",
    );
    return { name: cc.text, rxnorm: rxnormCoding?.code };
  }
  if (cc?.coding && cc.coding.length > 0) {
    const c = cc.coding[0];
    return { name: c.display ?? c.code ?? "unknown", rxnorm: c.code };
  }
  return null;
}

class CheckDrugInteractionsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "CheckDrugInteractions",
      {
        description:
          "Checks the patient's active medications for ONC High-Priority drug-drug interactions (DDIs). Returns severity, mechanism, and clinical recommendation for each interaction found.",
        inputSchema: {
          patientId: z
            .string()
            .describe(
              "The id of the patient. Optional if patient context already exists.",
            )
            .optional(),
        },
      },
      async ({ patientId }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
          );
        }

        const bundle = await FhirClientInstance.search(
          req,
          "MedicationRequest",
          [`patient=${patientId}`, "status=active", "_count=100"],
        );

        const meds: PatientMedication[] = [];
        for (const entry of bundle?.entry ?? []) {
          const mr = entry.resource as fhirR4.MedicationRequest | undefined;
          if (!mr) continue;
          const extracted = extractMedicationName(mr);
          if (!extracted) continue;
          const normalized = normalizeName(extracted.name);
          meds.push({
            raw: extracted.name,
            normalized,
            rxnorm: extracted.rxnorm,
            classes: classifyDrug(normalized),
            medicationRequestId: mr.id,
          });
        }

        if (meds.length === 0) {
          return McpUtilities.createTextResponse(
            "No active medications found for this patient.",
          );
        }

        const findings: string[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < meds.length; i++) {
          for (let j = i + 1; j < meds.length; j++) {
            const a = meds[i];
            const b = meds[j];
            for (const rule of ONC_HIGH_PRIORITY_INTERACTIONS) {
              const matchAB =
                a.classes.includes(rule.classA) &&
                b.classes.includes(rule.classB);
              const matchBA =
                a.classes.includes(rule.classB) &&
                b.classes.includes(rule.classA);
              if (!matchAB && !matchBA) continue;

              const key = [a.raw, b.raw, rule.classA, rule.classB]
                .sort()
                .join("|");
              if (seen.has(key)) continue;
              seen.add(key);

              findings.push(
                `[${rule.severity}] ${a.raw} + ${b.raw}\n` +
                  `    Risk: ${rule.risk}\n` +
                  `    Recommendation: ${rule.recommendation}`,
              );
            }
          }
        }

        const lines: string[] = [];
        lines.push(
          `Drug interaction screen — ${meds.length} active medication(s) reviewed against ONC High-Priority DDI list.`,
        );
        lines.push("");

        if (findings.length === 0) {
          lines.push("No high-priority interactions detected.");
        } else {
          lines.push(
            `${findings.length} high-priority interaction(s) detected:`,
          );
          lines.push("");
          for (const f of findings) {
            lines.push(f);
            lines.push("");
          }
        }

        const unclassified = meds.filter((m) => m.classes.length === 0);
        if (unclassified.length > 0) {
          lines.push(
            `Note: ${unclassified.length} medication(s) not in the ONC DDI matrix and were not screened: ${unclassified.map((m) => m.raw).join(", ")}.`,
          );
        }

        return McpUtilities.createTextResponse(lines.join("\n").trim());
      },
    );
  }
}

export const CheckDrugInteractionsToolInstance = new CheckDrugInteractionsTool();
