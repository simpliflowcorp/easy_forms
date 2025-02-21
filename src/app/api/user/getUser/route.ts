import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    //Check user exists
    let token = cookies().get("token");

    console.log(token);

    if (!token) {
      return NextResponse.json({ message: "No token found" }, { status: 404 });
    }

    let user: any = jwt.verify(token?.value!, process.env.TOKEN_SECRET!);

    const userData = await User.findOne({ email: user.email });

    let data = {
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

connectDB();
