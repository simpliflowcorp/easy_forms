// app/api/responses/route.ts
import { NextRequest, NextResponse } from "next/server";
import Response from "@/models/responseModel";
import Form from "@/models/formModel";
import { z } from "zod";
import mongoose from "mongoose";
import { connectDB } from "@/dbConfig/dbConfig";

const schema = z.object({
  form_id: z.any(),
  data: z.record(z.any()),
  user_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    // Validate request body
    const body = await request.json();
    const validation = schema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.errors },
        { status: 400 }
      );
    }

    console.log(body.form_id);

    // Verify form exists and is active
    let form = await Form.findOne({ formId: body.form_id });
    // const form = await Form.findById(body.form_id);
    console.log(form);

    if (!form || form.status === 0) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (!form || form.status === 2) {
      return NextResponse.json({ error: "Form not active" }, { status: 404 });
    }

    // Normalize data for analytics
    const normalizedData = new Map<string, any>();
    for (const [key, value] of Object.entries(body.data)) {
      normalizedData.set(key, normalizeValue(value));
    }

    // Create response document
    const response = await Response.create({
      form_id: form._id,
      data: body.data,
      normalized_data: Object.fromEntries(normalizedData),
      metadata: {
        ip_address: request.headers.get("x-forwarded-for"),
        user_agent: request.headers.get("user-agent"),
      },
    });

    return NextResponse.json(
      { success: true, response_id: response._id },
      { status: 201 }
    );
  } catch (error) {
    console.error("[RESPONSE_SUBMISSION_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Helper to normalize values for analytics
function normalizeValue(value: any): any {
  // Handle different data types
  if (typeof value === "string") {
    // Try to parse dates
    const date = Date.parse(value);
    if (!isNaN(date)) return { type: "date", value: new Date(date) };

    // Try to parse numbers
    const num = Number(value);
    if (!isNaN(num)) return { type: "number", value: num };

    return { type: "text", value };
  }

  if (typeof value === "number") return { type: "number", value };
  if (value instanceof Date) return { type: "date", value };

  return { type: "other", value };
}
