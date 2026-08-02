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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid preset ID" }, { status: 400 });
    }

    const preset = await AgentPreset.findOneAndDelete({ _id: id, userId });
    if (!preset) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[presets DELETE] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}