import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendMail } from "@/helper/mailer";

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { email } = reqBody;

    // check user exists
    const user = await User.findOne({ email });
    if (!user)
      return NextResponse.json(
        { message: "this_email_does_not_link_to_any_account" },
        { status: 400 }
      );

    //hash password
    const salt = await bcryptjs.genSalt(10);
    const verifyToken = await bcryptjs.hash(email, salt);

    const updatedUser = await User.updateOne(
      { _id: user._id },
      {
        $set: {
          forgotPasswordToken: verifyToken,
          forgotPasswordExpiry: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        },
      }
    );

    await sendMail(email, user.username, verifyToken, "resetPassword");

    const response = NextResponse.json(
      {
        message: "reset_password_link_sent_to_your_email",
        success: true,
      },
      { status: 200 }
    );

    return response;
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

connectDB();
