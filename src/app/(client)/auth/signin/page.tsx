import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { email, password } = reqBody;

    // check user exists
    const user = await User.findOne({ email });
    if (!user)
      return NextResponse.json(
        { message: "User doesn't exists" },
        { status: 400 }
      );

    //check password
    const validPassword = await bcryptjs.compare(password, user.password); // true or false;
    if (!validPassword) {
      return NextResponse.json(
        { message: "invalid_password" },
        { status: 400 }
      );
    }

    // create cookie token for user
    // token data
    const tokenData = {
      _id: user._id,
      username: user.username,
      email: user.email,
    };

    // create token
    const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!);
    const response = NextResponse.json(
      {
        message: "user_logged_in_successfully",
        success: true,
      },
      { status: 200 }
    );

    response.cookies.set("token", token, {
      httpOnly: true,
      expires: new Date(Date.now() + 30 * 60 * 60 * 24 * 1000),
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

connectDB();
