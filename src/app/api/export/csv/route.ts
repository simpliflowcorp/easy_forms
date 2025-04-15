import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Response from "@/models/responseModel"; // Add this line

export async function GET(request: NextRequest) {
  const json2csv = require("json2csv");
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

    if (!form) {
      return NextResponse.json({ message: "Form not found" }, { status: 404 });
    }

    // Get all responses
    const responses = await Response.find({ form_id: form._id })
      .lean()
      .select("data -_id");

    if (responses.length === 0) {
      return NextResponse.json(
        { error: "No responses found" },
        { status: 404 }
      );
    }

    // Extract all possible keys
    const allKeys = Array.from(
      new Set(responses.flatMap((r) => Object.keys(r.data)))
    );

    // Create CSV data
    const csvData = responses.map((response) => {
      return allKeys.reduce((acc: any, key) => {
        acc[key] = Array.isArray(response.data[key])
          ? response.data[key].join(", ")
          : response.data[key] ?? "";
        return acc;
      }, {});
    });

    // Generate CSV
    const parser = new json2csv.Parser({ fields: allKeys });
    const csv = parser.parse(csvData);

    // Create response
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${form.name}_responses.csv"`,
      },
    });
  } catch (error) {
    console.error("Form creation error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
