import connect from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import { NextResponse, NextRequest } from "next/server";
import bcryptjs from "bcryptjs";
import { getServerSession } from "next-auth/next";

export async function POST(request: NextRequest) {
  try {
    const reqBody = await request.json();
    const { confirm_password, current_password, new_password } = reqBody;

    // Connect to the database
    await connect();

    // Get session and cookies
    const session = await getServerSession(); // Ensure authOptions is configured

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Find the user
    const user = await User.findOne({ email: session?.user?.email });
    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Check current password
    const isPasswordMatch = await bcryptjs.compare(
      current_password,
      user.password
    );
    if (!isPasswordMatch) {
      return NextResponse.json(
        { message: "Current password is incorrect" },
        { status: 400 }
      );
    }

    // Confirm passwords match
    if (new_password !== confirm_password) {
      return NextResponse.json(
        { message: "Passwords do not match" },
        { status: 400 }
      );
    }

    // Hash new password and save it
    const hashedPassword = await bcryptjs.hash(new_password, 10);
    user.password = hashedPassword;
    await user.save();

    // Send response
    return NextResponse.json(
      { message: "Password updated successfully", success: true },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error resetting password:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
