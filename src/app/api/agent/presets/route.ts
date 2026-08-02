import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import { getAuthUserId } from "@/app/api/agent/execute/route";
import mongoose from "mongoose";

const AgentPresetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  label: { type: String, required: true, maxlength: 100 },
  prompt: { type: String, required: true, maxlength: 5000 },
  tags: [{ type: String, maxlength: 50 }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

AgentPresetSchema.index({ userId: 1, createdAt: -1 });

const AgentPreset = mongoose.models?.AgentPreset || mongoose.model("AgentPreset", AgentPresetSchema);

export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const presets = await AgentPreset.find({ userId }).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ presets });
  } catch (error: any) {
    console.error("[presets GET] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { label, prompt, tags = [] } = body;

    if (!label || !prompt) {
      return NextResponse.json({ error: "label and prompt are required" }, { status: 400 });
    }

    const preset = await AgentPreset.create({
      userId,
      label: label.trim(),
      prompt: prompt.trim(),
      tags: tags.map((t: string) => t.trim()).filter(Boolean),
    });

    return NextResponse.json({ preset }, { status: 201 });
  } catch (error: any) {
    console.error("[presets POST] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}