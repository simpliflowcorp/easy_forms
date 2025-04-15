import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    // Extract form ID from referer
    const referer = request.headers.get("referer");
    const form_id = referer?.split("/")[4]; // Ensure index matches your URL structure

    if (!form_id) {
      return NextResponse.json({ error: "Invalid form URL" }, { status: 400 });
    }

    // Check if the user has already visited
    const cookieName = `form_${form_id}`;
    const cookieStore = cookies();
    const hasVisited = cookieStore.get(cookieName);

    // Fetch the form
    let form = await Form.findOne({ formId: form_id });
    if (!form) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }

    if (!hasVisited) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      await Form.findOneAndUpdate(
        { formId: form_id },
        [
          {
            $set: {
              "analytics.totalVisits": { $add: ["$analytics.totalVisits", 1] },
              "analytics.dailyVisits": {
                $cond: [
                  { $in: [today, "$analytics.dailyVisits.date"] },
                  {
                    $map: {
                      input: "$analytics.dailyVisits",
                      in: {
                        $cond: [
                          { $eq: ["$$this.date", today] },
                          { date: today, count: { $add: ["$$this.count", 1] } },
                          "$$this",
                        ],
                      },
                    },
                  },
                  {
                    $concatArrays: [
                      "$analytics.dailyVisits",
                      [{ date: today, count: 1 }],
                    ],
                  },
                ],
              },
            },
          },
        ],
        { new: true }
      );
    }

    // Set visit cookie for 24 hours
    const response = NextResponse.json(
      { success: true, data: form },
      { status: 200 }
    );

    response.cookies.set(cookieName, "true", {
      httpOnly: true,
      expires: new Date(Date.now() + 60 * 60 * 24 * 1000),
    });

    return response;
  } catch (error) {
    console.error("Form fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
