export const dynamic = "force-dynamic";
import kv from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";
// import kv from "@/lib/redis";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const { userId } = await context.params;
  const notifications = await kv.lrange(
    `notifications:${userId}`,
    0,
    -1
  );
  return NextResponse.json(notifications.map((n) => JSON.parse(n)));
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const { userId } = await context.params;
  await kv.del(`notifications:${userId}`);
  return NextResponse.json({ success: true });
}
