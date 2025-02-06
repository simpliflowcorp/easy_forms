import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import { isEqual } from "lodash";

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

    // Parse and validate request body
    const body = await request.json();

    let existingForm = await Form.findOne({ _id: body._id });

    let changes = { ...body };

    const actualChanges = Object.fromEntries(
      Object.entries(changes).filter(
        ([key, value]) => !isEqual(value, existingForm[key])
      )
    );
    delete actualChanges["_id"];

    if (Object.keys(actualChanges).length > 0) {
      await Form.updateOne({ _id: body._id }, { $set: actualChanges });
    }

    if (Object.keys(actualChanges).length === 0) {
      return NextResponse.json(
        { success: false, message: "no_actual_changes_detected" },
        { status: 200 }
      );
    }

    // getting forms

    return NextResponse.json(
      { success: true, message: "successfully_updated_form" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Form creation error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
