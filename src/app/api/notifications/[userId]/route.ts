import kv from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";
// import kv from "@/lib/redis";

export async function GET(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  const notifications = await kv.lrange(
    `notifications:${params.userId}`,
    0,
    -1
  );
  return NextResponse.json(notifications.map((n) => JSON.parse(n)));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  await kv.del(`notifications:${params.userId}`);
  return NextResponse.json({ success: true });
}
