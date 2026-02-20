/**
 * test.js — Full multi-turn test simulation
 * Run: node test.js
 */

const axios = require("axios");

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";
const API_KEY = "ef038d81e00a408eaabaa01d6479deb5";

const SESSION_ID = `test-session-${Date.now()}`;

const scamScenario = [
  "URGENT: Your SBI account has been compromised. Your account will be blocked in 2 hours. Share your OTP immediately to verify your identity.",
  "I am calling from SBI Fraud Prevention Department. My employee ID is SBI-FR-4521. Please confirm your registered mobile number.",
  "Sir, to process the reversal, I need your UPI ID. My UPI is sbifraud.help@ybl. Please send ₹1 as verification.",
  "Sir, your case has been escalated. Call me back at +91-9876543210 for urgent resolution. Time is running out.",
  "Sir, if you don't verify in 5 minutes, your account XXXX1234 with ₹45,000 balance will be permanently frozen by RBI order.",
];

async function runTest() {
  console.log("🍯 Honeypot API — Multi-Turn Test");
  console.log("=".repeat(60));
  console.log(`Session ID: ${SESSION_ID}`);
  console.log(`Target: ${BASE_URL}/honeypot\n`);

  const conversationHistory = [];

  for (let i = 0; i < scamScenario.length; i++) {
    const scamMessage = scamScenario[i];
    const turn = i + 1;

    console.log(`\n--- Turn ${turn} ---`);
    console.log(`🦹 Scammer: ${scamMessage}`);

    const requestBody = {
      sessionId: SESSION_ID,
      message: {
        sender: "scammer",
        text: scamMessage,
        timestamp: Date.now(),
      },
      conversationHistory,
      metadata: {
        channel: "SMS",
        language: "English",
        locale: "IN",
      },
    };

    try {
      const start = Date.now();
      const response = await axios.post(`${BASE_URL}/honeypot`, requestBody, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        timeout: 35000,
      });
      const elapsed = Date.now() - start;

      if (response.status !== 200) {
        console.error(`❌ Bad status: ${response.status}`);
        break;
      }

      const reply =
        response.data.reply ||
        response.data.message ||
        response.data.text;

      if (!reply) {
        console.error("❌ No reply field in response!");
        console.error("Response:", response.data);
        break;
      }

      console.log(`🎭 Honeypot (${elapsed}ms): ${reply}`);

      // Update history
      conversationHistory.push({
        sender: "scammer",
        text: scamMessage,
        timestamp: Date.now(),
      });
      conversationHistory.push({
        sender: "user",
        text: reply,
        timestamp: Date.now(),
      });

      // Small delay between turns
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      if (err.code === "ECONNREFUSED") {
        console.error("❌ Server not running. Start with: npm start");
      } else {
        console.error("❌ Error:", err.message);
      }
      break;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Test complete!");
  console.log(`\n📊 Check session data:`);
  
  try {
    const sessionRes = await axios.get(
      `${BASE_URL}/honeypot/session/${SESSION_ID}`,
      { headers: { "x-api-key": API_KEY } }
    );
    const s = sessionRes.data;
    console.log(`   Messages: ${s.totalMessages}`);
    console.log(`   Scam Confirmed: ${s.scamConfirmed}`);
    console.log(`   Scam Type: ${s.scamType}`);
    console.log(`   Phone Numbers: ${s.phoneNumbers?.join(", ") || "none"}`);
    console.log(`   UPI IDs: ${s.upiIds?.join(", ") || "none"}`);
    console.log(`   Bank Accounts: ${s.bankAccounts?.join(", ") || "none"}`);
    console.log(`   Phishing Links: ${s.phishingLinks?.join(", ") || "none"}`);
    console.log(`   Callback Sent: ${s.callbackSent}`);
  } catch (e) {
    console.log("   (Session debug endpoint not reachable)");
  }

  console.log("\n🔥 Manually trigger final callback:");
  console.log(
    `   curl -X POST ${BASE_URL}/honeypot/finalize/${SESSION_ID} -H "x-api-key: ${API_KEY}"`
  );
}

runTest().catch(console.error);
