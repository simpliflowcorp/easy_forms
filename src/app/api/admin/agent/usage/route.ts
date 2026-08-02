import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import AgentUsageModel from "@/models/agentUsageModel";
import { getAuthUserId } from "@/app/api/agent/execute/route";

export async function GET(req: NextRequest) {
  try {
    await connectDB();

    // Verify admin access - check if user is authenticated
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin (you may want to add an admin field to User model)
    // For now, allow any authenticated user to view their own usage
    // In production, add proper admin check
    const isAdmin = false; // TODO: implement admin check
    const targetUserId = isAdmin ? req.nextUrl.searchParams.get("userId") : userId;

    if (!targetUserId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const period = req.nextUrl.searchParams.get("period") || "day"; // "day" | "week" | "month" | "all"
    let startDate: Date;
    switch (period) {
      case "week": startDate = startOfWeek; break;
      case "month": startDate = startOfMonth; break;
      case "all": startDate = new Date(0); break;
      default: startDate = startOfDay;
    }

    const matchStage: any = { userId: targetUserId };
    if (period !== "all") {
      matchStage.createdAt = { $gte: startDate };
    }

    // Aggregate by model
    const byModel = await AgentUsageModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$model",
          totalTokens: { $sum: "$totalTokens" },
          promptTokens: { $sum: "$promptTokens" },
          completionTokens: { $sum: "$completionTokens" },
          totalCost: { $sum: "$costUsd" },
          callCount: { $sum: 1 },
        },
      },
      { $sort: { totalTokens: -1 } },
    ]);

    // Aggregate by persona
    const byPersona = await AgentUsageModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$persona",
          totalTokens: { $sum: "$totalTokens" },
          totalCost: { $sum: "$costUsd" },
          callCount: { $sum: 1 },
        },
      },
      { $sort: { totalTokens: -1 } },
    ]);

    // Aggregate by date (daily breakdown)
    const byDate = await AgentUsageModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalTokens: { $sum: "$totalTokens" },
          totalCost: { $sum: "$costUsd" },
          callCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Totals
    const totals = await AgentUsageModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: "$totalTokens" },
          promptTokens: { $sum: "$promptTokens" },
          completionTokens: { $sum: "$completionTokens" },
          totalCost: { $sum: "$costUsd" },
          callCount: { $sum: 1 },
        },
      },
    ]);

    const topTickets = await AgentUsageModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$ticketId",
          totalTokens: { $sum: "$totalTokens" },
          totalCost: { $sum: "$costUsd" },
          callCount: { $sum: 1 },
        },
      },
      { $sort: { totalTokens: -1 } },
      { $limit: 10 },
    ]);

    return NextResponse.json({
      period,
      startDate: startDate.toISOString(),
      totals: totals[0] || { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalCost: 0, callCount: 0 },
      byModel,
      byPersona,
      byDate,
      topTickets,
    });
  } catch (error: any) {
    console.error("[admin/agent/usage] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}