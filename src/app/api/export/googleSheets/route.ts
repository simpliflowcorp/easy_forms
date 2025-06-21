import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Response from "@/models/responseModel"; // Add this line

export async function GET(request: NextRequest) {
  try {
    const accessToken = Session?.accessToken;
    if (!accessToken) return alert("Not authenticated");

    // // Authentication check start

    // Get session and cookies
    const cookies = request.cookies as any;
    const token = cookies.get("token");

    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const tokenData: any = jwt.verify(token?.value!, process.env.TOKEN_SECRET!);

    await connectDB();

    // Find the user
    const CurrentUser = await User.findOne({ _id: tokenData._id });

    if (!CurrentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

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
    const createRes = await fetch(
      "https://sheets.googleapis.com/v4/spreadsheets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            title: "FormBuilder Submission",
          },
        }),
      }
    );

    const newSheet = await createRes.json();
    const spreadsheetId = newSheet.spreadsheetId;

    // 2. Convert CSV to array of arrays

    const { fields, responses } = res.data; // assuming you've fetched or passed the JSON
    const values = [
      fields, // header row
      ...responses.map((resp: any) =>
        fields.map((key: any) => resp[key] || "")
      ),
    ];

    // 3. Write data to the sheet
    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=RAW`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values,
        }),
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
