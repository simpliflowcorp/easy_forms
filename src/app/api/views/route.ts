export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import CustomView from "@/models/customViewModel";
import jwt from "jsonwebtoken";
import { getServerSession } from "next-auth";

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  await connectDB();
  let token = req.cookies.get("token")?.value;
  let email: string | undefined;

  if (token) {
    try {
      let decoded: any = jwt.verify(token, process.env.TOKEN_SECRET!);
      if (decoded?._id) return decoded._id.toString();
      email = decoded?.email;
    } catch (err) {}
  }

  if (!email) {
    const session = await getServerSession();
    if (session?.user?.email) {
      email = session.user.email;
    }
  }

  if (email) {
    const u = await User.findOne({ email });
    if (u) return u._id.toString();
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const formId = searchParams.get("formId");

    if (!formId) return NextResponse.json({ error: "formId is required" }, { status: 400 });

    const views = await CustomView.find({ user: userId, formId }).sort({ createdAt: -1 });
    return NextResponse.json({ views });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { formId, name, filters, sortField, sortOrder, visibleColumns } = body;

    if (!formId || !name) {
      return NextResponse.json({ error: "formId and name are required" }, { status: 400 });
    }

    const view = await CustomView.create({
      user: userId,
      formId,
      name,
      filters: filters || [],
      sortField: sortField || "submitted_at",
      sortOrder: sortOrder || "desc",
      visibleColumns: visibleColumns || [],
    });

    return NextResponse.json({ view });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { viewId, name, filters, sortField, sortOrder, visibleColumns } = body;

    if (!viewId) return NextResponse.json({ error: "viewId is required" }, { status: 400 });

    const view = await CustomView.findOne({ _id: viewId, user: userId });
    if (!view) return NextResponse.json({ error: "Custom view not found" }, { status: 404 });

    if (name) view.name = name;
    if (filters) view.filters = filters;
    if (sortField) view.sortField = sortField;
    if (sortOrder) view.sortOrder = sortOrder;
    if (visibleColumns) view.visibleColumns = visibleColumns;

    await view.save();
    return NextResponse.json({ view });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const viewId = searchParams.get("viewId");

    if (!viewId) return NextResponse.json({ error: "viewId is required" }, { status: 400 });

    const result = await CustomView.deleteOne({ _id: viewId, user: userId });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Custom view not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, viewId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
