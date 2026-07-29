import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { getServerSession } from "next-auth";
import User from "@/models/userModel";
import { connectDB } from "@/dbConfig/dbConfig";

export async function getAuthUser(request: NextRequest) {
  await connectDB();
  const token = request.cookies.get("token")?.value;

  if (token) {
    try {
      const tokenData: any = jwt.verify(token, process.env.TOKEN_SECRET!);
      if (tokenData?._id) {
        const user = await User.findById(tokenData._id);
        if (user) return user;
      }
    } catch (err) {}
  }

  const session = await getServerSession();
  if (session?.user?.email) {
    const user = await User.findOne({ email: session.user.email });
    if (user) return user;
  }

  return null;
}
