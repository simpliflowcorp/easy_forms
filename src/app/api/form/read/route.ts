import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  try {
    // // Authentication check start
    console.log();

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

    let form_id = request.headers.get("referer")?.split("/").pop();

    let form = await Form.findOne({ formId: form_id });

    if (!form) {
      return NextResponse.json({ message: "Form not found" }, { status: 404 });
    }

    // const forms = await Form.aggregate([
    //   {
    //     $match: {
    //       user: new mongoose.Types.ObjectId(CurrentUser.id),
    //     },
    //   },
    //   {
    //     $project: {
    //       _id: 0,
    //       formId: "$formId",
    //       name: "$name",
    //       status: 1,
    //       expiry: 1,
    //       total_responses: "$analytics.totalResponses",
    //       today_responses: {
    //         $sum: {
    //           $filter: {
    //             input: "$analytics.dailyResponses",
    //             as: "response",
    //             cond: {
    //               $eq: [
    //                 { $dateTrunc: { date: "$$response.date", unit: "day" } },
    //                 { $dateTrunc: { date: today, unit: "day" } },
    //               ],
    //             },
    //           },
    //         },
    //       },
    //     },
    //   },
    //   { $sort: { expiry: -1 } },
    // ]);

    return NextResponse.json(
      { success: true, data: form },
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
