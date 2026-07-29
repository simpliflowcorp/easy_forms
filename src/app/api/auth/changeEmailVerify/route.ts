import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import * as jwt from "jsonwebtoken";
import bcryptjs from "bcryptjs";
import { sendMail } from "@/helper/mailer";
import { getAuthUser } from "@/helper/getAuthUser";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const reqBody = await request.json();
    const { verify_code } = reqBody;

    const CurrentUser = await getAuthUser(request);

    if (!CurrentUser) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
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
    const tokensData = {
      _id: CurrentUser._id,
      username: CurrentUser.username,
      email: CurrentUser.secondaryEmail,
    };

    //hash password
    const salt = await bcryptjs.genSalt(10);
    const verifyToken = await bcryptjs.hash(CurrentUser.secondaryEmail, salt);
    // create token
    const tokens = await jwt.sign(tokensData, process.env.TOKEN_SECRET!);

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

    response.cookies.set("token", tokens, {
      httpOnly: true,
      expires: new Date(Date.now() + 60 * 60 * 24 * 1000),
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
