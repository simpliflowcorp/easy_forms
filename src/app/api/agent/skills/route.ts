import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import { getAuthUserId } from "@/app/api/agent/execute/route";
import {
  listSkills,
  registerSkill,
  validateSkillDefinition,
} from "@/service/agentSkillsService";

/** GET /api/agent/skills — list built-in + user-authored skills. */
export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await listSkills(userId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[skills GET] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** POST /api/agent/skills — register a new user skill. */
export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const skill = body.skill ?? body;
    const validation = validateSkillDefinition(skill);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join("; ") }, { status: 400 });
    }

    const row = await registerSkill(userId, skill);
    return NextResponse.json({ skill: row }, { status: 201 });
  } catch (error: any) {
    console.error("[skills POST] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}