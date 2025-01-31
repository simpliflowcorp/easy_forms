import { connectDB } from "@/dbConfig/dbConfig"; // Import your database connection function
import { NextResponse, NextRequest } from "next/server";
import mongoose from "mongoose";
import Test from "@/models/testModel";

export async function GET(request: NextRequest) {
  try {
    await connectDB(); // Ensure the database connection is established

    const db = mongoose.connection.name;

    console.log("Database Name:", db);

    return NextResponse.json({ message: "success" }, { status: 200 });
  } catch (error: any) {
    console.error("Error occurred:", error); // Log the error for debugging
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { test } = reqBody;

    const testData = new Test({
      test,
    });
    const savedTest = await testData.save();
    const response = NextResponse.json(
      {
        message: "user_created",
        success: true,
      },
      { status: 200 }
    );
    return response;
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

connectDB();
