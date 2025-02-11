import { NextRequest, NextResponse } from "next/server";
import Response from "@/models/responseModel";
import Form from "@/models/formModel";
// import UniqueValue from "@/models/uniqueValueModel";
import { z } from "zod";
import mongoose from "mongoose";
import { connectDB } from "@/dbConfig/dbConfig";
import UniqueValueModel from "@/models/UniqueValue.model";

const schema = z.object({
  form_id: z.any(),
  data: z.record(z.any()),
  user_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await connectDB();

    // Validate request body
    const body = await request.json();
    const validation = schema.safeParse(body);

    if (!validation.success) {
      await session.abortTransaction();
      return NextResponse.json(
        { error: validation.error.errors },
        { status: 400 }
      );
    }

    // Verify form exists and is active
    const form = await Form.findOne({ formId: body.form_id }).session(session);
    if (!form) {
      await session.abortTransaction();
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (form.status === 0 || form.status === 2) {
      await session.abortTransaction();
      return NextResponse.json({ error: "Form not active" }, { status: 403 });
    }

    // Check unique field constraints
    const uniqueElements = form.elements.filter((el: any) => el.unique);
    const uniqueChecks = uniqueElements.map(async (el: any) => {
      const value = body.data[el.elementId];
      if (typeof value === "undefined") return;

      const exists = await UniqueValueModel.exists({
        formId: form._id,
        elementId: el.elementId,
        value: value.toString(),
      }).session(session);

      if (exists) {
        throw new Error(`The value '${value}' for ${el.label} already exists`);
      }
    });

    await Promise.all(uniqueChecks);

    // Normalize data for analytics
    const normalizedData = new Map<string, any>();
    for (const [key, value] of Object.entries(body.data)) {
      normalizedData.set(key, normalizeValue(value));
    }

    // Create response document
    const [response] = await Response.create(
      [
        {
          form_id: form._id,
          data: body.data,
          normalized_data: Object.fromEntries(normalizedData),
          metadata: {
            ip_address: request.headers.get("x-forwarded-for"),
            user_agent: request.headers.get("user-agent"),
          },
        },
      ],
      { session }
    );

    // Store unique values
    const uniqueValues = uniqueElements
      .filter((el: any) => typeof body.data[el.elementId] !== "undefined")
      .map((el: any) => ({
        formId: form._id,
        elementId: el.elementId,
        value: body.data[el.elementId].toString(),
      }));

    if (uniqueValues.length > 0) {
      await UniqueValueModel.insertMany(uniqueValues, { session });
    }

    await session.commitTransaction();
    return NextResponse.json(
      { success: true, response_id: response._id },
      { status: 201 }
    );
  } catch (error: any) {
    await session.abortTransaction();
    console.error("[RESPONSE_SUBMISSION_ERROR]", error);

    if (error.message.includes("already exists")) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 } // Conflict status code
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    session.endSession();
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
