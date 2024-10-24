import connect from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
  try {
    // Get token from url payload
    const reqBody = await request.json();
    const { verifyToken, newPassword, confirmPassword } = reqBody;

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { message: "passwords_do_not_match" },
        { status: 400 }
      );
    }

    //Check user exists
    const userData = await User.findOne({ forgotPasswordToken: verifyToken });

    if (!userData) {
      return NextResponse.json({ message: "invalid_link" }, { status: 400 });
    }

    // check valid token
    const isValidToken = verifyToken === userData.forgotPasswordToken; // true or false;

    if (!isValidToken || new Date(userData.forgotPasswordExpiry) < new Date()) {
      return NextResponse.json({ message: "link_expired" }, { status: 400 });
    }

    const salt = await bcryptjs.genSalt(10);
    const hashedPassword = await bcryptjs.hash(newPassword, salt);
    // update user
    const updatedUser = await User.updateOne(
      { _id: userData._id },
      {
        $set: {
          password: hashedPassword,
          forgotPasswordToken: null,
          forgotPasswordExpiry: null,
        },
      }
    );

    let data = {
      username: userData?.username,
      email: userData?.email,
      isAdmin: userData?.isAdmin,
      isVerified: true,
    };

    let response = NextResponse.json(
      { message: "password_changed_sucessfully" },
      { status: 200 }
    );
    return response;
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

connect();
