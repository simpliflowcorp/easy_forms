import { runAgentLoop } from "../src/agent/agentLoop";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Form from "../src/models/formModel";
import User from "../src/models/userModel";
import AgentTicketModel from "../src/models/agentTicketModel";
import { agentRedis } from "../src/agent/sandbox/agentRedis";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function runTests() {
  console.log("🚀 Starting Agent Stages E2E Tests...\n");

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  console.log("📦 Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);

  // Setup fake user
  console.log("👤 Creating test user...");
  let testUser = await User.findOne({ email: "agent_test_user@example.com" });
  if (!testUser) {
    testUser = await User.create({
      username: "agent_test_user",
      email: "agent_test_user@example.com",
      password: "password123",
    });
  }
  const userId = String(testUser._id);
  
  console.log("🧹 Clearing old test data...");
  await AgentTicketModel.deleteMany({ userId });
  await Form.deleteMany({ user: userId });

  let currentTicketId = "";

  try {
    // ==========================================
    // STAGE 1: Sandbox & Drafting
    // ==========================================
    console.log("\n🧪 --- STAGE 1: Drafting & Sandbox ---");
    const stage1Prompt = "Create a contact form with exactly two fields: Full Name and Email Address. Make sure both are required.";
    console.log(`Prompt: "${stage1Prompt}"`);
    
    const stage1State = await runAgentLoop(userId, stage1Prompt);
    console.log("✅ Loop finished. Final Persona:", stage1State.activePersona);
    
    if (stage1State.activePersona !== "AWAITING_USER_APPROVAL") {
      console.log("Raw LLM output:\n", stage1State.llmRawOutput);
      throw new Error(`Expected AWAITING_USER_APPROVAL, got ${stage1State.activePersona}. Feedback: ${stage1State.evaluatorFeedback}`);
    }

    currentTicketId = stage1State.ticket.ticketId;
    const finalSandbox = await agentRedis.getState(currentTicketId);
    console.log(`✅ Sandbox forms created: ${Object.keys(finalSandbox?.forms || {}).length}`);
    console.log(`✅ ChangeHistoryReport generated:`, !!stage1State.changeHistoryReport);
    
    if (!stage1State.changeHistoryReport) {
      throw new Error("changeHistoryReport is missing from state!");
    }

    // Verify Mongo persistence
    const dbTicket = await AgentTicketModel.findOne({ ticketId: currentTicketId }).lean();
    if (!dbTicket) throw new Error("Ticket not saved to MongoDB");
    if (!(dbTicket as any).changeHistoryReport) {
      throw new Error("changeHistoryReport not saved to MongoDB Ticket Model");
    }
    console.log("✅ State persisted to MongoDB with History Report.");

    // ==========================================
    // STAGE 2: Merge & History
    // ==========================================
    console.log("\n🧪 --- STAGE 2: Approval & Merge ---");
    console.log(`Approving merge for ticket: ${currentTicketId}`);
    
    const stage2State = await runAgentLoop(userId, "", true, currentTicketId);
    
    console.log("✅ Merge loop finished. Reply:", stage2State.reply);

    // Verify production DB has the form and the history
    const mergedForms = await Form.find({ user: userId }).sort({ createdAt: -1 }).limit(1);
    if (mergedForms.length === 0) {
      throw new Error("No merged forms found in production DB.");
    }
    
    const form = mergedForms[0];
    console.log(`✅ Production form found: ${form.name}`);
    
    if (!form.changeHistory || form.changeHistory.length === 0) {
      throw new Error("Change history array is empty on the merged form!");
    }
    
    const historyEntry = form.changeHistory[0];
    console.log("✅ Change History Entry:");
    console.log(JSON.stringify(historyEntry, null, 2));

    // ==========================================
    // STAGE 3: Analytics (Read-Only)
    // ==========================================
    console.log("\n🧪 --- STAGE 3: Read-Only / Analytics ---");
    const stage3Prompt = "Count how many contact forms I have in my account.";
    console.log(`Prompt: "${stage3Prompt}"`);
    
    const stage3State = await runAgentLoop(userId, stage3Prompt);
    console.log("✅ Loop finished. Final Persona:", stage3State.activePersona);
    console.log("✅ Reply:", stage3State.reply);

    if (stage3State.activePersona === "AWAITING_USER_APPROVAL") {
      throw new Error("Read-only query incorrectly triggered merge approval.");
    }

    console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");

  } catch (err) {
    console.error("\n❌ TEST FAILED:");
    console.error(err);
  } finally {
    console.log("\n🧹 Cleaning up...");
    if (currentTicketId) {
      await AgentTicketModel.deleteOne({ ticketId: currentTicketId });
      await agentRedis.clearState(currentTicketId);
    }
    await Form.deleteMany({ user: userId });
    await mongoose.disconnect();
    process.exit(0);
  }
}

runTests();
