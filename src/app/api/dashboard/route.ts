import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  try {
    // Authentication check
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

    // Calculate `threeDaysAgo`
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setUTCHours(0, 0, 0, 0);

    // Aggregation query
    const [aggregationResult] = await Form.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(CurrentUser._id) } },
      {
        $facet: {
          activeForms: [
            { $match: { status: 1, expiry: { $gt: new Date() } } },
            { $count: "count" },
          ],
          totalForms: [{ $count: "count" }],
          totalResponses: [
            {
              $group: {
                _id: null,
                total: { $sum: "$analytics.totalResponses" },
              },
            },
          ],
          totalVisitors: [
            {
              $group: { _id: null, total: { $sum: "$analytics.totalVisits" } },
            },
          ],
          activityData: [
            {
              $unwind: {
                path: "$analytics.dailyResponses",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $match: {
                "analytics.dailyResponses.date": { $gte: threeDaysAgo },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$analytics.dailyResponses.date",
                  },
                },
                responses: { $sum: "$analytics.dailyResponses.count" },
                visits: { $sum: "$analytics.dailyVisits.count" },
              },
            },
            { $sort: { _id: 1 } },
          ],
          responsesByForm: [
            { $sort: { "analytics.totalResponses": -1 } },
            { $limit: 5 },
            { $project: { name: 1, responses: "$analytics.totalResponses" } },
          ],
          visitedForms: [
            {
              $unwind: {
                path: "$analytics.dailyVisits",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $match: {
                "analytics.dailyVisits.date": { $gte: threeDaysAgo },
              },
            },
            {
              $group: {
                _id: "$_id",
                name: { $first: "$name" },
                visits: { $sum: "$analytics.dailyVisits.count" },
              },
            },
            { $sort: { visits: -1 } },
            { $limit: 5 },
          ],
        },
      },
    ]);

    // Extracting values safely
    const activeFormsCount = aggregationResult?.activeForms?.[0]?.count || 0;
    const totalFormsCount = aggregationResult?.totalForms?.[0]?.count || 0;
    const totalResponses = aggregationResult?.totalResponses?.[0]?.total || 0;
    const totalVisitors = aggregationResult?.totalVisitors?.[0]?.total || 0;

    // Formatting `activityData`
    const activityData =
      aggregationResult?.activityData?.map((item) => ({
        timeStamp: new Date(item._id).getTime().toString(),
        visited: item.visits || 0,
        responded: item.responses || 0,
      })) || [];

    // Formatting `visitedForms`
    const visitedForms =
      aggregationResult?.visitedForms?.map((form) => ({
        name: form.name,
        value: form.visits,
      })) || [];

    // Formatting `responsesByForm`
    const responsesByForm =
      aggregationResult?.responsesByForm?.map((form) => ({
        name: form.name,
        value: form.responses,
      })) || [];

    // Constructing final response
    const formattedData = {
      cards: [
        { label: "Active Forms", count: activeFormsCount },
        { label: "Total Forms", count: totalFormsCount },
        { label: "Total Responses", count: totalResponses },
        { label: "Total Visitors", count: totalVisitors },
      ],
      charts: [
        {
          label: "Activity Last Three Days",
          type: "bar",
          data: activityData,
          index: "timeStamp",
        },
        {
          label: "Visited Forms Last Three Days",
          type: "pie",
          data: visitedForms,
          index: "name",
        },
        {
          label: "Responses Recorded By Forms",
          type: "radar",
          data: responsesByForm,
          index: "name",
        },
      ],
    };

    return NextResponse.json(
      { success: true, data: formattedData },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Form retrieval error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
