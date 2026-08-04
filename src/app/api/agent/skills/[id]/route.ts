import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import { getAuthUserId } from "@/app/api/agent/execute/route";
import { updateSkill, deleteSkill } from "@/service/agentSkillsService";

/**
 * PUT /api/agent/skills/[id] — edit a user skill (bumps its version).
 * DELETE /api/agent/skills/[id] — soft-delete a user skill.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await connectDB();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json();
    const row = await updateSkill(userId, decodeURIComponent(id), body.patch ?? body);
    return NextResponse.json({ skill: row });
  } catch (error: any) {
    const status = error?.message?.includes("not found") || error?.message?.includes("read-only") ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await connectDB();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const result = await deleteSkill(userId, decodeURIComponent(id));
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.message?.includes("not found") || error?.message?.includes("read-only") ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}