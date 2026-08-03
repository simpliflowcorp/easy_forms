import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import { getServerSession } from "next-auth";
import { agentRedis } from "@/agent/sandbox/agentRedis";
import AgentTicketModel from "@/models/agentTicketModel";
import User from "@/models/userModel";

export async function POST(request: NextRequest) {
  await connectDB();
  
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email;
  const user = await User.findOne({ email }).lean();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = user._id.toString();

  const body = await request.json();
  const { ticketId } = body;

  if (!ticketId) {
    return NextResponse.json({ error: "Missing ticketId" }, { status: 400 });
  }

  // Verify the ticket belongs to the user
  const ticket = await AgentTicketModel.findOne({ ticketId, userId }).lean();
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  // Set the abort flag in Redis
  const abortKey = `agent:abort:${ticketId}`;
  await agentRedis.client.set(abortKey, "true", "EX", 60); // TTL 60s, auto-cleanup

  return NextResponse.json({ success: true });
}