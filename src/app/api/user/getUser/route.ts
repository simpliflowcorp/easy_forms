export const dynamic = "force-dynamic";
import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { getServerSession } from "next-auth";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    let token = request.cookies.get("token")?.value;
    let email: string | undefined;

    if (token) {
      try {
        let user: any = jwt.verify(token, process.env.TOKEN_SECRET!);
        email = user?.email;
      } catch (err) {}
    }

    if (!email) {
      const session = await getServerSession();
      if (session?.user?.email) {
        email = session.user.email;
      }
    }

    if (!email) {
      return NextResponse.json({ message: "No token found" }, { status: 401 });
    }

    const userData = await User.findOne({ email });
    if (!userData) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    let data = {
      id: userData?._id,
      username: userData?.username,
      email: userData?.email,
      isAdmin: userData?.isAdmin,
      isVerified: userData?.isVerified,
    };

    return NextResponse.json({ message: "success", data }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
