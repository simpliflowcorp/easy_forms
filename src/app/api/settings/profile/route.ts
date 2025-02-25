import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { use } from "react";
import exp from "constants";

export async function GET(request: NextRequest) {
  try {
    // // Authentication check start
    // Get session and cookies
    const cookies = request.cookies as any;
    const token = cookies.get("token");

    await connectDB();

    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const tokenData: any = jwt.verify(token?.value!, process.env.TOKEN_SECRET!);

    // Find the user
    const CurrentUser = await User.findOne({ _id: tokenData._id });

    if (!CurrentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    return NextResponse.json(
      { success: true, data: CurrentUser.profile },
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

export async function POST(request: NextRequest) {
  try {
    // // Authentication check start
    // Get session and cookies
    const cookies = request.cookies as any;
    const token = cookies.get("token");

    await connectDB();

    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const tokenData: any = jwt.verify(token?.value!, process.env.TOKEN_SECRET!);

    // Find the user
    const CurrentUser = await User.findOne({ _id: tokenData._id });

    if (!CurrentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Update the notification settings

    const reqBody = await request.json();
    const profile = reqBody;

    console.log(profile);

    const updatedUser = await User.findByIdAndUpdate(
      tokenData._id,
      { profile },
      { new: true }
    );

    return NextResponse.json(
      { success: true, message: "profile_updated_successfully" },
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
