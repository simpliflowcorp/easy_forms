import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/dbConfig/dbConfig";

export async function GET() {
  try {
    await connectDB();
    
    const readyState = mongoose.connection.readyState;
    const readyStateMap: Record<number, string> = {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    };

    const host = mongoose.connection.host;
    const name = mongoose.connection.name;
    
    let isMaster = false;
    let replicaSet = null;
    let members = [];
    
    try {
      if (mongoose.connection.db) {
        const adminDb = mongoose.connection.db.admin();
        const result = await adminDb.command({ isMaster: 1 });
        isMaster = result.ismaster === true || result.ismaster === 1;
        replicaSet = result.setName || null;
        members = result.hosts || [];
      }
    } catch (e) {
      // isMaster command failed, might not have admin access
    }

    const health = {
      status: readyState === 1 ? "healthy" : "unhealthy",
      readyState: readyStateMap[readyState] || "unknown",
      connected: readyState === 1,
      host,
      database: name,
      isMaster,
      replicaSet,
      members: members.length > 0 ? members : undefined,
      timestamp: new Date().toISOString(),
    };

    const statusCode = health.connected ? 200 : 503;
    return NextResponse.json(health, { status: statusCode });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: "error",
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}