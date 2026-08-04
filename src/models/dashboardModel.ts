import mongoose from "mongoose";
import { connectDB } from "@/dbConfig/dbConfig";
import Form from "./formModel";
import Response from "./responseModel";
import CustomView from "./customViewModel";

export interface DashboardStats {
  activeForms: number;
  totalForms: number;
  totalResponses: number;
  totalVisitors: number;
  totalViews: number;
  cards: Array<{ label: string; count: number }>;
  recentActivity: Array<{ date: string; visits: number; responses: number }>;
  topForms: Array<{ formId: string; name: string; responseCount: number; visitCount: number }>;
}

export interface FormListStat {
  formId: string;
  id: string;
  name: string;
  status: number;
  responseCount: number;
  visitCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FormListStats {
  totalForms: number;
  activeForms: number;
  forms: FormListStat[];
}

/**
 * Helper to convert a string userId to a valid Mongoose ObjectId match condition.
 */
function getUserMatchCondition(userId: string): any {
  if (mongoose.Types.ObjectId.isValid(userId)) {
    const objId = new mongoose.Types.ObjectId(userId);
    return { $in: [objId, userId] };
  }
  return userId;
}

/**
 * getDashboardStats(userId)
 * Pure MongoDB aggregation pipeline collecting dashboard metrics for a user across Form, Response, and CustomView.
 */
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  await connectDB();

  const userMatch = getUserMatchCondition(userId);
  const userObjId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : null;

  // Pipeline on Form model
  const pipeline: mongoose.PipelineStage[] = [
    { $match: { user: userMatch } },
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
            $group: {
              _id: null,
              total: { $sum: "$analytics.totalVisits" },
            },
          },
        ],
        topForms: [
          { $sort: { "analytics.totalResponses": -1 } },
          { $limit: 5 },
          {
            $project: {
              formId: "$formId",
              name: "$name",
              responseCount: { $ifNull: ["$analytics.totalResponses", 0] },
              visitCount: { $ifNull: ["$analytics.totalVisits", 0] },
            },
          },
        ],
      },
    },
  ];

  const [aggResult] = await Form.aggregate(pipeline);

  const activeForms = aggResult?.activeForms?.[0]?.count || 0;
  const totalForms = aggResult?.totalForms?.[0]?.count || 0;
  const totalResponses = aggResult?.totalResponses?.[0]?.total || 0;
  const totalVisitors = aggResult?.totalVisitors?.[0]?.total || 0;

  // Count total custom views owned by user
  const totalViews = userObjId
    ? await CustomView.countDocuments({ user: userObjId })
    : 0;

  // Top forms
  const topForms =
    aggResult?.topForms?.map((f: any) => ({
      formId: f.formId || String(f._id),
      name: f.name || "Untitled Form",
      responseCount: f.responseCount || 0,
      visitCount: f.visitCount || 0,
    })) || [];

  const cards = [
    { label: "Active Forms", count: activeForms },
    { label: "Total Forms", count: totalForms },
    { label: "Total Responses", count: totalResponses },
    { label: "Total Visitors", count: totalVisitors },
    { label: "Total Saved Views", count: totalViews },
  ];

  return {
    activeForms,
    totalForms,
    totalResponses,
    totalVisitors,
    totalViews,
    cards,
    recentActivity: [],
    topForms,
  };
}

/**
 * getFormListStats(userId)
 * Pure MongoDB aggregation pipeline collecting per-form statistics for all forms owned by a user.
 */
export async function getFormListStats(userId: string): Promise<FormListStats> {
  await connectDB();

  const userMatch = getUserMatchCondition(userId);

  const forms = await Form.find({ user: userMatch })
    .select("formId name status analytics createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();

  const formStats: FormListStat[] = forms.map((f: any) => ({
    formId: f.formId || String(f._id),
    id: String(f._id),
    name: f.name || "Untitled Form",
    status: f.status ?? 0,
    responseCount: f.analytics?.totalResponses ?? 0,
    visitCount: f.analytics?.totalVisits ?? 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));

  const activeForms = formStats.filter((f) => f.status === 1).length;

  return {
    totalForms: formStats.length,
    activeForms,
    forms: formStats,
  };
}
