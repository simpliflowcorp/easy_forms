import connect from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendMail } from "@/helper/mailer";
import { getServerSession } from "next-auth";
import { verify } from "crypto";
import { generateVerificationCode } from "@/helper/generateVerificationCode";

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { verify_code } = reqBody;

    // Find the user
    const session = await getServerSession(); // Ensure authOptions is configured

    // Get session and cookies

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Find the user
    const userEmail = await User.findOne({ email: session?.user?.email });
    const CurrentUser = await User.findOne({ email: userEmail?.email });

    if (!CurrentUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // verify code

    const isValidCode = verify_code === CurrentUser.secondaryEmailVerifyCode; // true or false;
    if (!isValidCode) {
      return NextResponse.json({ message: "invalid_code" }, { status: 400 });
    } else {
      if (new Date(CurrentUser.secondaryVerifyCodeExpiry) < new Date()) {
        return NextResponse.json({ message: "code_expired" }, { status: 400 });
      } else {
        const updatedUser = await User.updateOne(
          { _id: CurrentUser._id },
          {
            $set: {
              email: CurrentUser.secondaryEmail,
              secondaryEmail: "",
              secondaryEmailVerifyCode: "",
              secondaryVerifyCodeExpiry: 0,
            },
          }
        );
      }
    }

    // token data
    const tokenData = {
      _id: CurrentUser._id,
      username: CurrentUser.username,
      email: CurrentUser.secondaryEmail,
    };

    //hash password
    const salt = await bcryptjs.genSalt(10);
    const verifyToken = await bcryptjs.hash(CurrentUser.secondaryEmail, salt);
    // create token
    const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!);

    await sendMail(
      CurrentUser.secondaryEmail,
      CurrentUser.username,
      verifyToken,
      "verifyEmail"
    );

    const response = NextResponse.json(
      {
        message: "email_changed",
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

connect();
