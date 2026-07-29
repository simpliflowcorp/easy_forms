import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { sendMail } from "@/helper/mailer";
import { generateVerificationCode } from "@/helper/generateVerificationCode";
import { getAuthUser } from "@/helper/getAuthUser";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const reqBody = await request.json();

    const { new_email } = reqBody;

    // check email exists
    const newEmail = await User.findOne({ email: new_email });
    if (newEmail)
      return NextResponse.json(
        { message: "email_already_exists" },
        { status: 400 }
      );

    const CurrentUser = await getAuthUser(request);

    if (!CurrentUser) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // verify code
    const verifyCode = generateVerificationCode();

    const updatedUser = await User.updateOne(
      { _id: CurrentUser._id },
      {
        $set: {
          secondaryEmail: new_email,
          secondaryEmailVerifyCode: verifyCode,
          secondaryVerifyCodeExpiry: new Date(Date.now() + 60 * 60 * 24 * 1000),
        },
      }
    );

    await sendMail(
      CurrentUser.email,
      CurrentUser.username,
      "changeEmail",
      verifyCode
    );

    const response = NextResponse.json(
      {
        message: "verification_code_sent_to_your_email",
        success: true,
      },
      { status: 200 }
    );
    return response;
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
