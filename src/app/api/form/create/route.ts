import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";

import { getServerSession } from "next-auth";
import Form from "@/models/formModel";
import User from "@/models/userModel";

import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import Hashids from "hashids";
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

    // Parse and validate request body
    const body = await request.json();

    // Required fields validation
    if (
      !body.name ||
      !body.expiry ||
      !body.elements ||
      body.elements.length === 0
    ) {
      return NextResponse.json(
        { success: false, error: "missing_required_fields" },
        { status: 400 }
      );
    }

    // Create form document
    const hashids = new Hashids("salt", 6);
    const formId = hashids.encode(new Date().getTime());

    const newForm = await Form.create({
      user: CurrentUser.id,
      name: body.name,
      description: body.description || "",
      expiry: new Date(body.expiry),
      elements: body.elements.map((element: any) => ({
        elementId: element.elementId,
        type: element.type,
        label: element.label,
        required: element.required || false,
        unique: element.unique || false,
        options: element.options || [],
        position: element.position,
        column: element.column,
      })),
      formId: formId,
      status: body.status || 0,
      metadataSettings: {
        ip: body.metadataSettings?.ip || false,
        userAgent: body.metadataSettings?.userAgent || false,
      },
      analytics: {
        totalResponses: 0,
        totalVisits: 0,
        dailyVisits: [],
        dailyResponses: [],
      },
    });

    // update user's form list
    const updatedUser = await User.updateOne(
      { _id: CurrentUser._id },
      {
        $push: {
          forms: {
            form_id: new mongoose.Types.ObjectId(newForm._id), // Ensure it's an ObjectId
            form_name: newForm.name,
          },
        },
      }
    );

    return NextResponse.json(
      { success: true, data: newForm, message: "successfully_created_form" },
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
