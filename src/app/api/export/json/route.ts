import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import Response from "@/models/responseModel";

export async function GET(request: NextRequest) {
  try {
    // Authenticate
    const cookies = request.cookies as any;
    const token = cookies.get("token");

    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const tokenData: any = jwt.verify(token.value!, process.env.TOKEN_SECRET!);

    // Connect to DB and find current user
    await connectDB();
    const currentUser = await User.findOne({ _id: tokenData._id });

    if (!currentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Extract form ID from referrer URL
    const form_id = request.headers.get("referer")?.split("/")[4];
    const form = await Form.findOne({ formId: form_id });

    if (!form) {
      return NextResponse.json({ message: "Form not found" }, { status: 404 });
    }

    // Get all responses for this form
    const responses = await Response.find({ form_id: form._id })
      .lean()
      .select("data -_id");

    if (responses.length === 0) {
      return NextResponse.json(
        { message: "No responses found" },
        { status: 404 }
      );
    }

    // Extract all field keys used across all responses
    const allKeys = Array.from(
      new Set(responses.flatMap((r) => Object.keys(r.data)))
    );

    // Normalize response structure (e.g., handle arrays, missing fields)
    const normalizedResponses = responses.map((response) => {
      return allKeys.reduce((acc: any, key) => {
        const value = response.data[key];
        acc[key] = Array.isArray(value) ? value.join(", ") : value ?? "";
        return acc;
      }, {});
    });

    // Return structured JSON
    return NextResponse.json({
      formName: form.name,
      totalResponses: normalizedResponses.length,
      fields: allKeys,
      responses: normalizedResponses,
    });
  } catch (error) {
    console.error("Error exporting form responses as JSON:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
