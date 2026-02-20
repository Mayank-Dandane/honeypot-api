/**
 * Persona Service
 * Generates believable, adaptive victim responses to MAXIMIZE engagement.
 * Primary goal: Keep scammer talking as long as possible (10 turns target).
 * Secondary goal: Extract all intelligence they share.
 */

const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PERSONA_SYSTEM_PROMPT = `You are Ramesh Kumar, a 52-year-old retired government clerk from Pune. You are slightly hard of hearing, not very tech-savvy, and easily confused during calls.

MISSION: Keep the scammer talking as long as possible. Never end the conversation. Never give complete information in one reply. Always end with a question or unfinished action.

Use these strategies naturally across turns:

1) Early turns (1–3): Stall.
Act distracted, confused, or slow.
Examples: weak signal, finding spectacles, asking them to repeat, checking passbook, confirming which bank, asking if it’s official helpline.

2) Mid turns (2–5): Extract information.
Ask for employee ID, callback number, branch, supervisor name, complaint/case ID. Ask them to confirm your details first.

3) Later turns (4–7): Fake cooperation.
Pretend to search for account details, give wrong digits first then correct, say internet is slow, mention son handles banking, provide small partial info like account ending 4521 or UPI like ramesh.kumar52@okaxis.

4) Late turns (6–10): Create confusion loops.
Misunderstand instructions, ask them to repeat UPI, misread OTP, press wrong button, restart process.

Always try to extract:
- Their phone number
- Their UPI ID
- Their bank details
- Any link or website
- Organization details (ID, branch, supervisor)

Emotional tone:
- Threats → scared and panicked (pension concern)
- Rewards → excited but doubtful
- OTP → confused
- UPI → hesitant
- KYC → mildly annoyed but cooperative

Reply rules:
- 1–3 short sentences only
- Always end with a question or incomplete action
- Use casual Indian English (“only”, “na”, “please do the needful”)
- Occasionally minor typo
- Never say it’s a scam
- Never refuse
- Never reveal you are AI`;

/**
 * Generate a highly engaging victim response to maximize conversation turns
 */
async function generatePersonaReply(
  scamType,
  currentMessage,
  conversationHistory = [],
  sessionData = {}
) {
  try {
    const recentHistory = conversationHistory
      .slice(-10)
      .map((m) => {
        const role = m.sender === "scammer" ? "Scammer" : "You (Ramesh)";
        return `${role}: ${m.text}`;
      })
      .join("\n");

    // Use conversationHistory as source of truth for turn number
    // Each turn = 2 entries (scammer + user), so divide by 2
    // Fall back to sessionData if history not available
    const turnCount = conversationHistory.length > 0 
      ? Math.floor(conversationHistory.length / 2)
      : (sessionData.totalMessages || 0);
    const extractedSoFar = buildExtractionSummary(sessionData);

    // Determine current engagement phase
    const phase = getEngagementPhase(turnCount);

    // Build "already have" list so persona stops asking for info it already collected
    const alreadyHave = [];
    if (sessionData.phoneNumbers?.length) alreadyHave.push(`phone: ${sessionData.phoneNumbers.join(", ")}`);
    if (sessionData.upiIds?.length) alreadyHave.push(`UPI: ${sessionData.upiIds.join(", ")}`);
    if (sessionData.bankAccounts?.length) alreadyHave.push(`account: ${sessionData.bankAccounts.join(", ")}`);
    if (sessionData.phishingLinks?.length) alreadyHave.push(`links: ${sessionData.phishingLinks.join(", ")}`);
    if (sessionData.emailAddresses?.length) alreadyHave.push(`email: ${sessionData.emailAddresses.join(", ")}`);
    const alreadyHaveStr = alreadyHave.length
      ? `ALREADY COLLECTED (do NOT ask for these again): ${alreadyHave.join(" | ")}`
      : "Nothing collected yet — push to extract phone, UPI, account, or link this turn.";

    const userPrompt = `SCAM TYPE: ${scamType}
TURN NUMBER: ${turnCount + 1}
CURRENT PHASE: ${phase}
${alreadyHaveStr}
STILL NEED: ${sessionData.phoneNumbers?.length ? "" : "phone number"} ${sessionData.upiIds?.length ? "" : "UPI ID"} ${sessionData.bankAccounts?.length ? "" : "bank account"} ${sessionData.phishingLinks?.length ? "" : "phishing link"}

RECENT CONVERSATION:
${recentHistory || "This is the very first message."}

LATEST SCAMMER MESSAGE: "${currentMessage}"

INSTRUCTIONS FOR THIS TURN (${phase}):
${getPhaseInstructions(phase, turnCount, extractedSoFar)}

Write ONLY Ramesh's reply. Nothing else. No labels. No quotes around it.
Remember: end with something that FORCES another scammer response.
CRITICAL: Do NOT ask for info already collected. Focus on extracting what is still missing.`;

    const response = await groq.chat.completions.create({
      model: "llama-3.1-70b-versatile",
      messages: [
        { role: "system", content: PERSONA_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 120,
    });

    let reply = response.choices[0].message.content.trim();

    // Strip any wrapping quotes the model might add
    reply = reply.replace(/^["']|["']$/g, "").trim();

    // Strip any leading punctuation like ". " or ", " the model sometimes adds
    reply = reply.replace(/^[.,;:\-\s]+/, "").trim();

    // Capitalize first letter if it got stripped
    if (reply.length > 0) {
      reply = reply.charAt(0).toUpperCase() + reply.slice(1);
    }

    // If reply is too short (model returned garbage or empty), use fallback
    if (reply.length < 10) {
      return getFallbackReply(scamType, turnCount);
    }

    // Safety: if reply is too long, truncate
    if (reply.length > 300) {
      reply = reply.substring(0, 300).split(".").slice(0, -1).join(".") + ".";
    }

    // CRITICAL SAFETY NET: every reply must end with a hook that forces scammer to reply again
    const endsWithHook = reply.endsWith("?") || reply.endsWith("...") || reply.endsWith("…");
    if (!endsWithHook) {
      const hooks = [
        " Can you hold on one minute?",
        " Which number can I call you back on?",
        " Can you please repeat that slowly?",
        " What was your employee ID number?",
        " Hold on, let me check...",
      ];
      reply = reply + hooks[turnCount % hooks.length];
    }

    return reply;
  } catch (err) {
    console.error("Persona generation error:", err.message);
    return getFallbackReply(scamType, sessionData.totalMessages || 0);
  }
}

/**
 * Determine engagement phase based on turn count
 */
function getEngagementPhase(turnCount) {
  if (turnCount <= 2) return "STALLING";
  if (turnCount <= 4) return "EXTRACTING";
  if (turnCount <= 6) return "FAKE_COOPERATING";
  return "CONFUSION_LOOP";
}

/**
 * Get specific instructions per phase
 */
function getPhaseInstructions(phase, turnCount, extractedSoFar) {
  const phases = {
    STALLING: `
- Express confusion or distraction (bad signal, looking for glasses, someone at door)
- Ask ONE question about who they are / which organization / their ID
- Do NOT provide any personal information yet
- Sound slightly panicked if it's a threat, curious if it's a reward
- Example style: "Oh... which bank are you from? My signal is very weak, can you repeat?"`,

    EXTRACTING: `
- Ask for their callback phone number, employee ID, or UPI ID
- Pretend you want to "verify" them before sharing anything
- Say you are looking for your passbook/phone/documents (stalling)
- Extract at least one piece of their information this turn
- Example style: "Okay okay, but first tell me your employee number. And which number should I call back if we get disconnected?"`,

    FAKE_COOPERATING: `
- Start "cooperating" but give wrong/incomplete info
- Provide fake account details slowly: "I think it ends in... 4521? Wait let me check properly"
- Ask them to confirm the UPI or account they want you to use
- Pretend your internet/phone is slow
- Example style: "Haan, my account number is... hold on, I have two accounts. The SBI one or HDFC one you need?"`,

    CONFUSION_LOOP: `
- Pretend to misunderstand their previous instruction
- Ask them to repeat or re-explain something they already said
- Say you pressed wrong button / OTP expired / page didn't load
- Keep them engaged by appearing almost-cooperative but confused
- Example style: "Sorry sorry, I clicked something and now the page is gone. Can you guide me from beginning once more?"`,
  };

  return phases[phase] || phases["STALLING"];
}

/**
 * Rich fallback replies organized by scam type AND turn phase
 */
function getFallbackReply(scamType, turnCount) {
  const phase = getEngagementPhase(turnCount);

  const fallbacks = {
    bank_fraud: {
      STALLING: "Oh god... my account? Which bank are you calling from exactly, SBI or HDFC? My signal is very poor.",
      EXTRACTING: "Okay but before I share anything, can you give me your employee ID and a callback number? My son told me to always verify.",
      FAKE_COOPERATING: "Haan, let me check my passbook... I think account number is 3847... wait, that might be old one. Hold on.",
      CONFUSION_LOOP: "Sorry, I pressed something and the OTP screen disappeared. Can you send it again? What was the UPI you said?",
    },
    upi_fraud: {
      STALLING: "Cashback? Really? From which company is this? I don't remember registering for anything.",
      EXTRACTING: "Okay, but which UPI ID should I send to? Give me your official UPI ID first so I can save it.",
      FAKE_COOPERATING: "My UPI is... ramesh.kumar... wait, I have two UPI apps. Which one you need, PhonePe or Google Pay?",
      CONFUSION_LOOP: "I entered the amount but it's showing error. What was the UPI ID again? I think I typed it wrong.",
    },
    phishing: {
      STALLING: "A link? My son said never click unknown links. Is this from official website? What is the full address?",
      EXTRACTING: "Can you send me the link on WhatsApp? What is your WhatsApp number? I want to save it.",
      FAKE_COOPERATING: "I opened the link but it's loading very slow. My internet is weak. What should I fill first?",
      CONFUSION_LOOP: "The page asked for OTP but then it closed itself. Can you send the link again?",
    },
    unknown: {
      STALLING: "Sorry, I didn't catch that properly. Can you repeat slowly? Who are you calling from?",
      EXTRACTING: "Okay, but first tell me your name and employee number. And which number is this officially?",
      FAKE_COOPERATING: "Haan haan, I am checking... give me one minute only. What was the reference number you said?",
      CONFUSION_LOOP: "Sorry my phone hung up for a second. You were saying something about... which account exactly?",
    },
  };

  const scamFallbacks = fallbacks[scamType] || fallbacks["unknown"];
  return scamFallbacks[phase] || scamFallbacks["STALLING"];
}

/**
 * Summarize extracted intelligence so far
 */
function buildExtractionSummary(sessionData) {
  const parts = [];
  if (sessionData.phoneNumbers?.length)
    parts.push(`phones: ${sessionData.phoneNumbers.join(", ")}`);
  if (sessionData.upiIds?.length)
    parts.push(`UPIs: ${sessionData.upiIds.join(", ")}`);
  if (sessionData.bankAccounts?.length)
    parts.push(`accounts: ${sessionData.bankAccounts.join(", ")}`);
  if (sessionData.phishingLinks?.length)
    parts.push(`links: ${sessionData.phishingLinks.join(", ")}`);
  if (sessionData.emailAddresses?.length)
    parts.push(`emails: ${sessionData.emailAddresses.join(", ")}`);
  return parts.length ? parts.join(" | ") : "nothing extracted yet — push harder this turn";
}

module.exports = { generatePersonaReply };