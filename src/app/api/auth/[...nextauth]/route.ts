import NextAuth from "next-auth/next";
import GoogleProvider from "next-auth/providers/google";
import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import bcryptjs from "bcryptjs";

import type { Session } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
  }
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account", // This prevents showing the consent screen repeatedly
          access_type: "offline",
          response_type: "code",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.file",
          ].join(" "),
        },
      },
    }),
  ],

  // callbacks: {
  //   async signIn({ user, account, profile, email, credentials }: any) {
  //     const crtUser = await User.findOne({ email: user.email });

  //     if (!crtUser) {
  //       //hash password
  //       const salt = await bcryptjs.genSalt(10);
  //       const hashedPassword = await bcryptjs.hash(user.id, salt);

  //       const newUser = new User({
  //         username: user.name,
  //         email: user.email,
  //         password: hashedPassword,
  //         isVerified: true,
  //       });

  //       const savedUser = await newUser.save();
  //       const tokenData = {
  //         _id: savedUser._id,
  //         username: savedUser.username,
  //         email: savedUser.email,
  //       };
  //       const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!);
  //       cookies().set("token", token, {
  //         expires: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day,
  //       });
  //     } else {
  //       const tokenData = {
  //         _id: crtUser._id,
  //         username: crtUser.username,
  //         email: crtUser.email,
  //       };
  //       const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!);
  //       cookies().set("token", token, {
  //         expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days,
  //       });
  //     }

  //     return true;
  //   },
  // },

  callbacks: {
    async signIn({ user, account }) {
      console.log({ user, account });

      const crtUser = await User.findOne({ email: user.email });

      if (!crtUser) {
        const salt = await bcryptjs.genSalt(10);
        const hashedPassword = await bcryptjs.hash(user.id, salt);

        const newUser = new User({
          username: user.name,
          email: user.email,
          password: hashedPassword,
          isVerified: true,
          isGoogleAuth: true,
          GoogleSheetAccessToken: account?.access_token,
        });

        const savedUser = await newUser.save();
        const tokenData = {
          _id: savedUser._id,
          username: savedUser.username,
          email: savedUser.email,
        };
        const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!);
        cookies().set("token", token, {
          expires: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        });
      } else {
        // If user already exists, update the Google access token

        if (crtUser.isGoogleAuth) {
          crtUser.GoogleSheetAccessToken = account?.access_token;
          await crtUser.save();
        }

        const tokenData = {
          _id: crtUser._id,
          username: crtUser.username,
          email: crtUser.email,
        };
        const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET!);
        cookies().set("token", token, {
          expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        });
      }

      return true;
    },

    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },
});
connectDB();

export { handler as GET, handler as POST };
