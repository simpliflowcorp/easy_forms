// app/api/cron/check-expired/route.ts
import { NextResponse } from "next/server";
import kv from "@/lib/redis";
// import Form from "@/models/Form";
// import User from "@/models/Uer";
import mongoose from "mongoose";
import User from "@/models/userModel";
import Form from "@/models/formModel";

// 1. Check expired forms with Mongoose
async function checkExpiredForms() {
  await mongoose.connect(process.env.MONGODB_URI!);

  return Form.find({
    expiry: { $lte: new Date() },
    status: "active",
  }).populate("user", "email _id", User);
}

// 2. Real-time notification sender
async function sendRealTimeNotification(userId: string, form: any) {
  await fetch(`${process.env.NEXTAUTH_URL}/api/sse/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
      message: {
        id: Date.now(),
        type: "form-expiry",
        message: `Form "${form.name}" has expired`,
        formId: form._id,
      },
    }),
  });
}

export async function GET() {
  try {
    const expiredForms = await checkExpiredForms();

    for (const form of expiredForms) {
      const userId = form.user._id.toString();
      const isActive = await kv.exists(`active:${userId}`);

      if (isActive) {
        await sendRealTimeNotification(userId, form);
      } else {
        await kv.lpush(
          `notifications:${userId}`,
          JSON.stringify({
            id: Date.now(),
            type: "form-expiry",
            message: `Form "${form.name}" expired`,
            formId: form._id,
            timestamp: new Date().toISOString(),
          })
        );
        await kv.expire(`notifications:${userId}`, 604800); // 7 days
      }
    }

    return NextResponse.json({
      success: true,
      processed: expiredForms.length,
    });
  } catch (error) {
    console.error("Cron job failed:", error);
    return NextResponse.json(
      { error: "Failed to process expired forms" },
      { status: 500 }
    );
  } finally {
    await mongoose.disconnect();
  }
}
