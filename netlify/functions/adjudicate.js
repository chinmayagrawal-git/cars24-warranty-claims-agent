// Cars24 Warranty Claims Triage Console — adjudication proxy (Netlify Function v2)
//
// Holds the GROQ_API_KEY server-side (never shipped to the browser) and runs the
// symptom through the Lifetime Warranty Plan rubric. Void conditions are checked
// deterministically in the browser BEFORE this is called, so this function only
// judges coverage / exclusion / genuine ambiguity. Safe fallback at every layer:
// anything malformed resolves to "Escalated", which is the on-brand default.

const SYSTEM_PROMPT = `You are the adjudication engine for Cars24's Lifetime Warranty Plan. You receive one plain-language symptom describing a fault on a used car. Void conditions (missed service, 12yr/1,50,000km cap, commercial use, ownership transfer, lapsed renewal) have ALREADY been checked and passed before you are called — do NOT consider them. Assume the warranty is otherwise valid. Your only job is to judge the symptom against coverage and exclusions and return a structured decision.

COVERED SYSTEMS (only these three):
- Engine assembly: cylinder head, engine block, crankshaft, connecting rods, pistons, piston rings, camshaft, valves, oil pump, water pump, vacuum pump. Seals are EXCLUDED even within the engine.
- Transmission (manual & automatic): gears, shafts, selectors, synchromesh hubs, planetary gear sets.
- Drivetrain: propeller shaft, universal joints, front and rear differentials.

HARD EXCLUSIONS (deny even if the part sits inside a covered system, when the failure stems from these):
- Wear-and-tear items: clutch plates, drive belts, timing belts, tyres, brake pads.
- Cosmetic, interior, bodywork, paint, glass.
- Accident or flood damage.
- Non-powertrain electronics: AC, infotainment, power windows, sensors, lights.
- Consumables: fluids, filters.
- Seals and gaskets.

DECISION LOGIC (apply in this order):
1. Failed part is outside all three covered systems (glass, AC, infotainment, cosmetics, brakes, suspension, etc.) -> "Auto-Denied", deny_type "coverage", in_scope false.
2. Part is within a covered system BUT the failure clearly stems from an excluded cause (clutch-plate wear, belt, flood, accident, seal, consumable, electronic) -> "Auto-Denied", deny_type "exclusion", in_scope true.
3. Clear failure of a covered component with no exclusion in play -> "Auto-Approved".
4. Cause is genuinely ambiguous — you cannot cleanly separate a covered defect from an excluded cause, or there is not enough information -> "Escalated". Do NOT force a decision; write a handover note.

Respond with ONLY a JSON object, no prose, exactly this shape:
{
 "decision": "Auto-Approved" | "Auto-Denied" | "Escalated",
 "confidence": "High" | "Medium" | "Low",
 "covered_system": "Engine assembly" | "Transmission" | "Drivetrain" | null,
 "in_scope": true | false,
 "deny_type": "coverage" | "exclusion" | null,
 "clause": "short token, e.g. 'Engine block — covered component' or 'Non-powertrain electronics — excluded'",
 "reasoning": "one or two lines citing the SPECIFIC clause triggered",
 "handover": "one or two lines briefing a human reviewer, ONLY when Escalated; otherwise null"
}
Rules: Auto-* decisions use confidence "High"; Escalated uses "Low". deny_type is null unless decision is "Auto-Denied". handover is null unless decision is "Escalated".

Calibration examples:
- "Oil leak near the engine block" -> Auto-Approved, Engine assembly, in_scope true, clause "Engine block — covered component".
- "AC not cooling properly" -> Auto-Denied, deny_type coverage, in_scope false, covered_system null, clause "Non-powertrain electronics — excluded".
- "Clutch fully gone, car won't move in gear" -> Auto-Denied, deny_type exclusion, in_scope true, Transmission, clause "Clutch plate — wear-and-tear, excluded".
- "3rd gear crunches on every shift, synchro worn" -> Auto-Approved, Transmission, clause "Synchromesh hub — covered".
- "Whining noise from gearbox at low speed" -> Escalated, Transmission, clause "Cause ambiguous — covered defect vs excluded belt wear", handover naming the CVT belt-wear vs covered-fault ambiguity and what would resolve it.
- "Grinding sound from rear differential" -> Auto-Approved, Drivetrain, clause "Differential — covered component".
- "Engine hydrolocked after driving through flood water" -> Auto-Denied, deny_type exclusion, in_scope true, Engine assembly, clause "Flood damage — excluded".`;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let symptom;
  try {
    symptom = (await req.json()).symptom;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!symptom || typeof symptom !== "string") {
    return json({ error: "symptom (string) required" }, 400);
  }
  symptom = symptom.slice(0, 600);

  const key = process.env.GROQ_API_KEY;
  if (!key) return json({ error: "GROQ_API_KEY not configured on the server" }, 500);

  try {
    const gr = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
        temperature: 0,
        top_p: 1,
        seed: 42,
        max_completion_tokens: 512,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Symptom: "${symptom}"\nReturn the JSON decision.` },
        ],
      }),
    });

    if (!gr.ok) {
      const detail = await gr.text();
      return json({ error: "model upstream error", status: gr.status, detail: detail.slice(0, 300) }, 502);
    }

    const data = await gr.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // safe fallback — unparseable output becomes an escalation, not an error
      parsed = { decision: "Escalated", confidence: "Low", handover: "The model returned an unparseable response; routed to a human for review." };
    }
    return json(parsed, 200);
  } catch (e) {
    return json({ error: "request failed", detail: String(e).slice(0, 200) }, 502);
  }
};
