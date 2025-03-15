import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import mongoose, { PipelineStage } from "mongoose";

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    // Authentication check
    const token = request.cookies.get("token")?.value;
    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const tokenData: any = jwt.verify(token, process.env.TOKEN_SECRET!);
    const currentUser = await User.findById(tokenData._id);
    if (!currentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Date calculation for last 3 days
    const dateKeys = Array.from({ length: 3 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().split("T")[0];
    }).reverse();

    const pipeline: PipelineStage[] = [
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
            { $unwind: "$analytics.dailyResponses" },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$analytics.dailyResponses.date",
                  },
                },
                responses: { $sum: "$analytics.dailyResponses.count" },
              },
            },
            { $sort: { _id: 1 } },
          ],
          tempVisits: [
            { $unwind: "$analytics.dailyVisits" },
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
          ],
          responsesByForm: [
            { $sort: { "analytics.totalResponses": -1 } },
            { $limit: 5 },
            { $project: { name: 1, responses: "$analytics.totalResponses" } },
          ],
          visitedForms: [
            { $unwind: "$analytics.dailyVisits" },
            { $sort: { "analytics.dailyVisits.count": -1 } },
            { $limit: 5 },
            { $project: { date: "$analytics.dailyVisits.date", visits: 1 } },
          ],
        },
      },
      // Post-processing only - no aggregation operators here
      {
        $project: {
          activeForms: 1,
          totalForms: 1,
          totalResponses: 1,
          totalVisitors: 1,
          activityData: 1,
          tempVisits: 1, // Add this line
          responsesByForm: 1,
          visitedForms: 1,
        },
      },
    ];

    const [aggregationResult] = await Form.aggregate(pipeline);

    // Safely extract nested values
    const activeFormsCount = aggregationResult?.activeForms?.[0]?.count || 0;
    const totalFormsCount = aggregationResult?.totalForms?.[0]?.count || 0;
    const totalResponses = aggregationResult?.totalResponses?.[0]?.total || 0;
    const totalVisitors = aggregationResult?.totalVisitors?.[0]?.total || 0;

    // Process activity data
    const activityData = dateKeys.map((date) => {
      const responseEntry = aggregationResult?.activityData?.find(
        (d: any) => d._id === date
      );
      const visitEntry = aggregationResult?.tempVisits?.find(
        (v: any) => v._id === date
      );

      return {
        timeStamp: new Date(date).getTime().toString(),
        visited: visitEntry?.visits || 0, // Now properly accesses visits
        responded: responseEntry?.responses || 0,
      };
    });

    // Process visited forms
    const visitedForms =
      aggregationResult?.visitedForms?.map((form: any) => ({
        name: new Date(form.date).toISOString().split("T")[0],
        value: form.visits || 0,
      })) || [];

    // Process responses by form
    const responsesByForm =
      aggregationResult?.responsesByForm?.map((form: any) => ({
        name: form.name,
        value: form.responses || 0,
      })) || [];

    console.log(activityData);

    // Construct final response
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
          label: "Most Visited Forms",
          type: "pie",
          data: visitedForms,
          index: "name",
        },
        {
          label: "Top Responded Forms",
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

    return NextResponse.json(
      { success: true, data: formattedData },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
