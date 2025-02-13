import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import Response from "@/models/responseModel";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export async function POST(request: NextRequest) {
  try {
    // // Authentication check start

    // Get session and cookies
    const cookies = request.cookies as any;
    const token = cookies.get("token");

    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const tokenData: any = jwt.verify(token?.value!, process.env.TOKEN_SECRET!);

    // Find the user
    const CurrentUser = await User.findOne({ _id: tokenData._id });

    if (!CurrentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    await connectDB();

    // getting current date
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Get forms id

    let form_id = request.headers.get("referer")?.split("/")[4];

    let form = await Form.findOne({ formId: form_id });

    console.log(form._id);

    if (!form) {
      return NextResponse.json({ message: "Form not found" }, { status: 404 });
    }

    let { sortBy, sortOrder, pageNum, rowCount } = await request.json();

    if (sortBy === "") sortBy = "submitted_at";

    if (!sortBy || !sortOrder || !pageNum || !rowCount) {
      return NextResponse.json({ message: "Invalid request" }, { status: 400 });
    }

    const totalResponses = await Response.countDocuments({ form_id: form._id });

    console.log(totalResponses);

    console.log({ pageNum, rowCount });

    const skip = (pageNum - 1) * rowCount;

    console.log(skip);

    const responses = await Response.find({ form_id: form._id })
      .sort({ [`data.${sortBy}`]: sortOrder === "asc" ? 1 : -1 })
      .skip(skip) // Skip previous pages
      .limit(rowCount) // Limit to 'limit' number of documents
      .lean();

    return NextResponse.json(
      { success: true, data: { responses, totalResponses } },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store", // Prevent caching of sensitive data
        },
      }
    );
  } catch (error) {
    console.error("Form creation error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
