import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    // Authentication check
    const cookies = request.cookies as any;
    const token = cookies.get("token");
    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const tokenData: any = jwt.verify(token?.value!, process.env.TOKEN_SECRET!);
    const currentUser = await User.findById(tokenData._id);
    if (!currentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Get last 3 days as UTC date keys
    const dateKeys = [...Array(3)]
      .map((_, i) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - i);
        d.setUTCHours(0, 0, 0, 0);
        return d.toISOString().split("T")[0];
      })
      .reverse();

    // Aggregation Query
    const [aggregationResult] = await Form.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(currentUser._id) } },
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
              $unwind: {
                path: "$analytics.dailyVisits",
                preserveNullAndEmptyArrays: true,
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
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$analytics.dailyVisits.date",
                  },
                },
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
    const dataMap = aggregationResult?.activityData?.reduce(
      (acc: any, item: any) => {
        acc[item._id] = item;
        return acc;
      },
      {}
    );

    const activityData = dateKeys.map((date) => ({
      timeStamp: new Date(date).getTime().toString(),
      visited: dataMap?.[date]?.visits || 0,
      responded: dataMap?.[date]?.responses || 0,
    }));

    // Formatting `visitedForms`
    const visitedForms =
      aggregationResult?.visitedForms?.map((form: any) => ({
        name: form._id,
        value: form.visits,
      })) || [];

    // Formatting `responsesByForm`
    const responsesByForm =
      aggregationResult?.responsesByForm?.map((form: any) => ({
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
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Form retrieval error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
