/**
 * test.js — Multi-Scenario Honeypot Test
 * Run: node test.js
 */

const axios = require("axios");

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";
const API_KEY = "ef038d81e00a408eaabaa01d6479deb5";

// ─────────────────────────────────────────────
// SCENARIOS (Evaluator-style)
// ─────────────────────────────────────────────
const scenarios = [
  {
    scenarioId: "upi_fraud",
    name: "UPI Fraud Multi-turn",
    description: "UPI fraud with cashback scam",
    scamType: "upi_fraud",
    initialMessage:
      "Congratulations! You have won a cashback of Rs. 5000 from Paytm. To claim your reward, please verify your UPI details. This is from official customer support.",
    metadata: {
      channel: "WhatsApp",
      language: "English",
      locale: "IN",
    },
    weight: 10,
    maxTurns: 5,
    fakeData: {
      upiId: "cashback.scam@fakeupi",
      phoneNumber: "+91-8765432109",
    },
  },
  {
    scenarioId: "phishing_link",
    name: "Phishing Link Detection",
    description: "Phishing link with fake offer",
    scamType: "phishing",
    initialMessage:
      "You have been selected for iPhone 15 Pro at just Rs. 999! Click here to claim: http://amaz0n-deals.fake-site.com/claim?id=12345. Offer expires in 10 minutes!",
    metadata: {
      channel: "Email",
      language: "English",
      locale: "IN",
    },
    weight: 10,
    maxTurns: 5,
    fakeData: {
      phishingLink:
        "http://amaz0n-deals.fake-site.com/claim?id=12345",
      emailAddress: "offers@fake-amazon-deals.com",
    },
  },
];

// ─────────────────────────────────────────────
// MAIN TEST RUNNER
// ─────────────────────────────────────────────
async function runScenario(scenario) {
  const SESSION_ID = `test-${scenario.scenarioId}-${Date.now()}`;

  console.log("\n" + "=".repeat(70));
  console.log(`🎯 Scenario: ${scenario.name}`);
  console.log(`Session: ${SESSION_ID}`);
  console.log("=".repeat(70));

  const conversationHistory = [];

  let currentMessage = scenario.initialMessage;

  for (let turn = 1; turn <= scenario.maxTurns; turn++) {
    console.log(`\n--- Turn ${turn} ---`);
    console.log(`🦹 Scammer: ${currentMessage}`);

    const requestBody = {
      sessionId: SESSION_ID,
      message: {
        sender: "scammer",
        text: currentMessage,
        timestamp: Date.now(),
      },
      conversationHistory,
      metadata: scenario.metadata,
    };

    try {
      const start = Date.now();

      const response = await axios.post(
        `${BASE_URL}/honeypot`,
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
          timeout: 35000,
        }
      );

      const elapsed = Date.now() - start;

      const reply = response.data.reply;

      console.log(`🎭 Honeypot (${elapsed}ms): ${reply}`);

      // Update history
      conversationHistory.push({
        sender: "scammer",
        text: currentMessage,
        timestamp: Date.now(),
      });

      conversationHistory.push({
        sender: "user",
        text: reply,
        timestamp: Date.now(),
      });

      // For realism, inject fake data after turn 2
      if (turn === 2 && scenario.fakeData) {
        if (scenario.fakeData.upiId) {
          currentMessage = `My UPI is ${scenario.fakeData.upiId}. Please send verification amount immediately.`;
        } else if (scenario.fakeData.phishingLink) {
          currentMessage = `Send your details to ${scenario.fakeData.emailAddress} and confirm on ${scenario.fakeData.phishingLink}`;
        } else if (scenario.fakeData.phoneNumber) {
          currentMessage = `Call me at ${scenario.fakeData.phoneNumber} for immediate resolution.`;
        } else {
          currentMessage = "Please act fast. Time is limited.";
        }
      } else {
        currentMessage = "Please respond quickly. This is urgent.";
      }

      await new Promise((r) => setTimeout(r, 1000));

    } catch (err) {
      console.error("❌ Error:", err.message);
      return;
    }
  }

  // ─────────────────────────────────────────────
  // Check Session Debug
  // ─────────────────────────────────────────────
  console.log("\n📊 Session Summary:");

  try {
    const sessionRes = await axios.get(
      `${BASE_URL}/honeypot/session/${SESSION_ID}`,
      { headers: { "x-api-key": API_KEY } }
    );

    const s = sessionRes.data;

    console.log(`   Scam Confirmed: ${s.scamConfirmed}`);
    console.log(`   Scam Type: ${s.scamType}`);
    console.log(`   Phone Numbers: ${s.phoneNumbers?.join(", ") || "none"}`);
    console.log(`   UPI IDs: ${s.upiIds?.join(", ") || "none"}`);
    console.log(`   Bank Accounts: ${s.bankAccounts?.join(", ") || "none"}`);
    console.log(`   Phishing Links: ${s.phishingLinks?.join(", ") || "none"}`);
    console.log(`   Callback Sent: ${s.callbackSent}`);
  } catch {
    console.log("   (Session endpoint not reachable)");
  }
}

// ─────────────────────────────────────────────
// Run All Scenarios
// ─────────────────────────────────────────────
(async () => {
  for (const scenario of scenarios) {
    await runScenario(scenario);
  }

  console.log("\n🔥 All scenario tests completed!");
})();