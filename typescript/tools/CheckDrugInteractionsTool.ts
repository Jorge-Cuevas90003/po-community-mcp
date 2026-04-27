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
  | "doacs"
  | "antiplatelet"
  | "nsaids"
  | "sulfonamides"
  | "macrolides"
  | "quinolones"
  | "ace_inhibitors"
  | "arbs"
  | "raas_blockers"
  | "potassium_sparing_diuretics"
  | "potassium_supplements"
  | "thiazide_diuretics"
  | "loop_diuretics"
  | "ssris"
  | "snris"
  | "maois"
  | "tramadol"
  | "triptans"
  | "lithium"
  | "digoxin"
  | "amiodarone"
  | "p_gp_inhibitors"
  | "statins_cyp3a4_sensitive"
  | "strong_cyp3a4_inhibitors"
  | "azole_antifungals"
  | "methotrexate"
  | "trimethoprim"
  | "phenytoin"
  | "aliskiren"
  | "pimozide"
  | "benzodiazepines"
  | "opioids"
  | "nitrates"
  | "pde5_inhibitors";

const DRUG_CLASS_MEMBERS: Record<DrugClass, string[]> = {
  warfarin: ["warfarin", "coumadin", "jantoven"],
  doacs: [
    "apixaban", "rivaroxaban", "dabigatran", "edoxaban",
    "eliquis", "xarelto", "pradaxa", "savaysa",
  ],
  antiplatelet: [
    "clopidogrel", "prasugrel", "ticagrelor", "ticlopidine",
    "plavix", "effient", "brilinta",
  ],
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
  arbs: [
    "losartan", "valsartan", "olmesartan", "candesartan", "irbesartan",
    "telmisartan", "azilsartan",
  ],
  raas_blockers: [
    "lisinopril", "enalapril", "ramipril", "benazepril", "captopril",
    "losartan", "valsartan", "olmesartan", "candesartan", "irbesartan",
    "telmisartan", "azilsartan",
  ],
  potassium_sparing_diuretics: [
    "spironolactone", "eplerenone", "amiloride", "triamterene", "aldactone",
  ],
  potassium_supplements: [
    "potassium chloride", "potassium gluconate", "potassium bicarbonate",
    "k-dur", "klor-con", "micro-k", "potassium",
  ],
  thiazide_diuretics: [
    "hydrochlorothiazide", "chlorthalidone", "metolazone", "indapamide", "hctz",
  ],
  loop_diuretics: [
    "furosemide", "bumetanide", "torsemide", "ethacrynic acid", "lasix",
  ],
  ssris: [
    "fluoxetine", "sertraline", "paroxetine", "citalopram", "escitalopram",
    "fluvoxamine", "prozac", "zoloft", "paxil", "celexa", "lexapro",
  ],
  snris: [
    "venlafaxine", "duloxetine", "desvenlafaxine", "milnacipran",
    "effexor", "cymbalta", "pristiq",
  ],
  maois: [
    "selegiline", "phenelzine", "tranylcypromine", "isocarboxazid",
    "rasagiline", "nardil", "parnate", "marplan", "emsam",
  ],
  tramadol: ["tramadol", "ultram", "ultracet"],
  triptans: [
    "sumatriptan", "rizatriptan", "zolmitriptan", "almotriptan",
    "naratriptan", "frovatriptan", "eletriptan",
    "imitrex", "maxalt", "zomig", "axert", "amerge", "frova", "relpax",
  ],
  lithium: ["lithium", "lithobid", "eskalith"],
  digoxin: ["digoxin", "lanoxin", "digitek"],
  amiodarone: ["amiodarone", "cordarone", "pacerone"],
  p_gp_inhibitors: [
    "amiodarone", "verapamil", "dronedarone", "ranolazine",
    "quinidine", "cyclosporine",
  ],
  statins_cyp3a4_sensitive: [
    "simvastatin", "lovastatin", "atorvastatin", "zocor", "mevacor", "lipitor",
  ],
  strong_cyp3a4_inhibitors: [
    "clarithromycin", "ketoconazole", "itraconazole", "ritonavir",
    "nefazodone", "voriconazole", "posaconazole", "indinavir", "saquinavir",
    "nelfinavir", "telithromycin",
  ],
  azole_antifungals: [
    "ketoconazole", "itraconazole", "voriconazole", "posaconazole",
    "fluconazole", "isavuconazole",
  ],
  methotrexate: ["methotrexate", "trexall", "rheumatrex", "otrexup"],
  trimethoprim: [
    "trimethoprim", "trimethoprim-sulfamethoxazole", "bactrim", "septra",
  ],
  phenytoin: ["phenytoin", "dilantin", "phenytek"],
  aliskiren: ["aliskiren", "tekturna"],
  pimozide: ["pimozide", "orap"],
  benzodiazepines: [
    "alprazolam", "diazepam", "lorazepam", "clonazepam", "midazolam",
    "triazolam", "temazepam", "oxazepam", "chlordiazepoxide",
    "xanax", "valium", "ativan", "klonopin", "versed", "halcion", "restoril",
  ],
  opioids: [
    "morphine", "oxycodone", "hydrocodone", "fentanyl", "methadone",
    "hydromorphone", "oxymorphone", "codeine", "buprenorphine",
    "percocet", "vicodin", "norco", "dilaudid", "duragesic", "oxycontin",
  ],
  nitrates: [
    "nitroglycerin", "isosorbide mononitrate", "isosorbide dinitrate",
    "imdur", "nitrostat", "nitro-bid",
  ],
  pde5_inhibitors: [
    "sildenafil", "tadalafil", "vardenafil", "avanafil",
    "viagra", "cialis", "levitra", "stendra", "revatio", "adcirca",
  ],
};

interface InteractionRule {
  classA: DrugClass;
  classB: DrugClass;
  severity: "CONTRAINDICATED" | "MAJOR";
  risk: string;
  recommendation: string;
}

const ONC_HIGH_PRIORITY_INTERACTIONS: InteractionRule[] = [
  // ───────────── Anticoagulant interactions ─────────────
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
    classA: "warfarin",
    classB: "amiodarone",
    severity: "MAJOR",
    risk: "Amiodarone potently inhibits warfarin metabolism — INR can double within 1-3 weeks.",
    recommendation: "Reduce warfarin dose by ~30-50% empirically. Monitor INR weekly until stable.",
  },
  {
    classA: "warfarin",
    classB: "phenytoin",
    severity: "MAJOR",
    risk: "Bidirectional CYP interaction — INR may rise then fall unpredictably; phenytoin levels also affected.",
    recommendation: "Monitor INR and phenytoin levels frequently. Consider alternative anticoagulant.",
  },
  {
    classA: "warfarin",
    classB: "azole_antifungals",
    severity: "MAJOR",
    risk: "Azoles inhibit CYP2C9/3A4 — markedly increased warfarin effect and bleeding risk.",
    recommendation: "Reduce warfarin dose 30-50%. Monitor INR within 3 days.",
  },
  {
    classA: "doacs",
    classB: "nsaids",
    severity: "MAJOR",
    risk: "Additive bleeding risk with apixaban/rivaroxaban/dabigatran/edoxaban + NSAIDs.",
    recommendation: "Avoid combination. Use acetaminophen for analgesia. Watch for GI bleeding.",
  },
  {
    classA: "doacs",
    classB: "antiplatelet",
    severity: "MAJOR",
    risk: "DOAC + dual antiplatelet markedly raises major bleeding risk.",
    recommendation: "Use only when clearly indicated (e.g. acute coronary syndrome). Reassess regularly.",
  },

  // ───────────── Hyperkalemia / renal interactions ─────────────
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
    classA: "raas_blockers",
    classB: "aliskiren",
    severity: "MAJOR",
    risk: "Hyperkalemia, hypotension, renal impairment (esp. in diabetes or CKD).",
    recommendation: "Contraindicated in diabetic patients. Avoid combination.",
  },
  {
    classA: "raas_blockers",
    classB: "nsaids",
    severity: "MAJOR",
    risk: "Reduced renal perfusion — can precipitate acute kidney injury (the 'double whammy').",
    recommendation: "Avoid in CKD, dehydration, or elderly. Monitor creatinine within 1 week if combined.",
  },

  // ───────────── Lithium toxicity triad ─────────────
  {
    classA: "lithium",
    classB: "nsaids",
    severity: "MAJOR",
    risk: "NSAIDs reduce renal lithium clearance — toxic levels can develop within days.",
    recommendation: "Avoid. If short-course unavoidable, check lithium level at day 5-7.",
  },
  {
    classA: "lithium",
    classB: "ace_inhibitors",
    severity: "MAJOR",
    risk: "ACE inhibitors reduce renal lithium clearance — toxicity risk.",
    recommendation: "Monitor lithium level within 1 week of initiation. Reduce dose if rising.",
  },
  {
    classA: "lithium",
    classB: "thiazide_diuretics",
    severity: "MAJOR",
    risk: "Thiazides reduce lithium clearance up to 50% — toxicity risk.",
    recommendation: "Avoid combination. If essential, reduce lithium dose ~50% and monitor closely.",
  },

  // ───────────── Digoxin toxicity ─────────────
  {
    classA: "digoxin",
    classB: "macrolides",
    severity: "MAJOR",
    risk: "Macrolides increase digoxin levels (P-gp inhibition), risk of digoxin toxicity.",
    recommendation: "Check digoxin level. Consider holding or reducing dose.",
  },
  {
    classA: "digoxin",
    classB: "amiodarone",
    severity: "MAJOR",
    risk: "Amiodarone raises digoxin levels by ~70% via P-gp inhibition.",
    recommendation: "Reduce digoxin dose by 50% on initiation. Check level at day 5-7.",
  },
  {
    classA: "digoxin",
    classB: "p_gp_inhibitors",
    severity: "MAJOR",
    risk: "Verapamil/dronedarone/ranolazine raise digoxin levels — toxicity risk.",
    recommendation: "Reduce digoxin dose 25-50%. Monitor level.",
  },
  {
    classA: "digoxin",
    classB: "loop_diuretics",
    severity: "MAJOR",
    risk: "Loop diuretic-induced hypokalemia potentiates digoxin toxicity (arrhythmia risk).",
    recommendation: "Monitor potassium and magnesium. Replace as needed. Consider K-sparing combination.",
  },

  // ───────────── Serotonin syndrome cluster ─────────────
  {
    classA: "ssris",
    classB: "maois",
    severity: "CONTRAINDICATED",
    risk: "Serotonin syndrome (potentially fatal).",
    recommendation: "Absolute contraindication. Allow ≥14-day washout between drugs (5 weeks for fluoxetine).",
  },
  {
    classA: "snris",
    classB: "maois",
    severity: "CONTRAINDICATED",
    risk: "Serotonin syndrome — same mechanism as SSRIs + MAOIs.",
    recommendation: "Absolute contraindication. ≥14-day washout required.",
  },
  {
    classA: "ssris",
    classB: "tramadol",
    severity: "MAJOR",
    risk: "Tramadol has serotonergic activity — increased risk of serotonin syndrome.",
    recommendation: "Avoid if possible. If essential, use lowest tramadol dose, monitor for symptoms.",
  },
  {
    classA: "ssris",
    classB: "triptans",
    severity: "MAJOR",
    risk: "Both increase serotonergic activity — potential for serotonin syndrome with frequent use.",
    recommendation: "Use cautiously. Limit triptan frequency. Educate patient on serotonin syndrome signs.",
  },

  // ───────────── CYP3A4-mediated statin myopathy ─────────────
  {
    classA: "statins_cyp3a4_sensitive",
    classB: "strong_cyp3a4_inhibitors",
    severity: "MAJOR",
    risk: "Markedly elevated statin levels — risk of rhabdomyolysis.",
    recommendation: "Switch to pravastatin/rosuvastatin or hold statin during course of inhibitor.",
  },
  {
    classA: "statins_cyp3a4_sensitive",
    classB: "amiodarone",
    severity: "MAJOR",
    risk: "Amiodarone inhibits statin metabolism — myopathy risk, esp. simvastatin >20mg.",
    recommendation: "Limit simvastatin to 20mg/day; consider switching to pravastatin or rosuvastatin.",
  },

  // ───────────── Methotrexate toxicity ─────────────
  {
    classA: "methotrexate",
    classB: "trimethoprim",
    severity: "MAJOR",
    risk: "Additive folate antagonism — risk of pancytopenia and methotrexate toxicity.",
    recommendation: "Avoid combination. If unavoidable, monitor CBC weekly.",
  },
  {
    classA: "methotrexate",
    classB: "nsaids",
    severity: "MAJOR",
    risk: "NSAIDs reduce methotrexate clearance — toxicity risk (esp. with high-dose MTX).",
    recommendation: "Avoid in oncology MTX dosing. With low-dose RA MTX, monitor renal function and CBC.",
  },

  // ───────────── CNS depression ─────────────
  {
    classA: "benzodiazepines",
    classB: "opioids",
    severity: "MAJOR",
    risk: "Profound respiratory depression and sedation — FDA black box warning.",
    recommendation: "Avoid combination. If essential, lowest doses, naloxone available, monitor closely.",
  },

  // ───────────── Severe cardiovascular ─────────────
  {
    classA: "pde5_inhibitors",
    classB: "nitrates",
    severity: "CONTRAINDICATED",
    risk: "Profound, refractory hypotension — can precipitate MI or death.",
    recommendation: "Absolute contraindication. Wait 24h after sildenafil/vardenafil, 48h after tadalafil.",
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
          "Checks the patient's active medications for high-priority drug-drug interactions across 30 expanded ONC-aligned interaction rules covering anticoagulants (warfarin/DOACs), serotonin syndrome combinations, hyperkalemia risks, digoxin toxicity, statin myopathy, lithium toxicity, CNS depression (benzo+opioid), and PDE5+nitrate contraindication. Returns severity, mechanism, and clinical recommendation for each interaction found.",
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
          `Drug interaction screen — ${meds.length} active medication(s) reviewed against ${ONC_HIGH_PRIORITY_INTERACTIONS.length} high-priority interaction rules.`,
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
            `Note: ${unclassified.length} medication(s) not in the interaction matrix and were not screened: ${unclassified.map((m) => m.raw).join(", ")}.`,
          );
        }

        return McpUtilities.createTextResponse(lines.join("\n").trim());
      },
    );
  }
}

export const CheckDrugInteractionsToolInstance = new CheckDrugInteractionsTool();
