import { connectDB } from "@/dbConfig/dbConfig";
import { NextResponse, NextRequest } from "next/server";
import Form from "@/models/formModel";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    // Extract form ID from referer
    const referer = request.headers.get("referer");
    const form_id = referer?.split("/")[4]; // Verify this index matches your URL structure

    if (!form_id) {
      return NextResponse.json({ error: "Invalid form URL" }, { status: 400 });
    }

    // Check for existing cookie
    const cookieName = `form_${form_id}_visited`;
    const hasVisited = request.cookies.has(cookieName);

    let form;
    if (!hasVisited) {
      // Atomic update for visits
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0); // Normalize to UTC midnight

      form = await Form.findOneAndUpdate(
        { formId: form_id },
        {
          $inc: { "analytics.totalVisits": 1 },
          $set: {
            "analytics.dailyVisits": {
              $concatArrays: [
                {
                  $filter: {
                    input: "$analytics.dailyVisits",
                    cond: { $ne: ["$$this.date", today] },
                  },
                },
                [
                  {
                    $mergeObjects: [
                      {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: "$analytics.dailyVisits",
                              cond: { $eq: ["$$this.date", today] },
                            },
                          },
                          0,
                        ],
                      },
                      {
                        date: today,
                        count: {
                          $add: [
                            {
                              $ifNull: [
                                {
                                  $arrayElemAt: [
                                    "$analytics.dailyVisits.count",
                                    0,
                                  ],
                                },
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                      },
                    ],
                  },
                ],
              ],
            },
          },
        },
        { new: true } // Return updated document
      );

      if (!form) {
        return NextResponse.json(
          { message: "Form not found" },
          { status: 404 }
        );
      }
    } else {
      form = await Form.findOne({ formId: form_id });
    }

    const response = NextResponse.json(
      { success: true, data: form },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );

    // Set cookie only if new visit
    if (!hasVisited && form) {
      response.cookies.set({
        name: cookieName,
        value: "true",
        expires: form.expiry,
        path: `/form/${form_id}`,
        sameSite: "Lax",
        secure: process.env.NODE_ENV === "production",
      });
    }

    return response;
  } catch (error) {
    console.error("Form fetch error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
