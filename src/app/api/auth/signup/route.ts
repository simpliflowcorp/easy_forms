import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendMail } from "@/helper/mailer";

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { username, email, password } = reqBody;

    // check user exists
    const user = await User.findOne({ email });
    if (user)
      return NextResponse.json(
        { message: "user_already_exists" },
        { status: 400 }
      );

    //hash password
    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(password, salt);
    const verifyToken = await bcryptjs.hash(email, salt);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      verifyToken: verifyToken,
      profile: {
        firstName: username,
      },
      verifyTokenExpiry: new Date(Date.now() + 60 * 60 * 24 * 1000),
    });

    const savedUser = await newUser.save();

    // create cookie token for user

    // token data
    const tokenData = {
      _id: savedUser._id,
      username: savedUser.username,
      email: savedUser.email,
    };

    // create token
    const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!);

    await sendMail(email, username, "verifyEmail", verifyToken);
    const response = NextResponse.json(
      {
        message: "user_created",
        success: true,
      },
      { status: 200 }
    );

    response.cookies.set("token", token, {
      httpOnly: true,
      expires: new Date(Date.now() + 60 * 60 * 24 * 1000),
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

connectDB();
