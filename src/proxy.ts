import { useSession } from "next-auth/react";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// This function can be marked `async` if using `await` inside
export function proxy(request: NextRequest) {
  let currentPath = request.nextUrl.pathname;
  let token =
    request.cookies.get("token")?.value ||
    request.cookies.get("next-auth.session-token")?.value ||
    request.cookies.get("__Secure-next-auth.session-token")?.value ||
    "";

  let publicPaths = [
    "/",
    "/privacy",
    "/policy",
    "/terms",
    "/auth/signin",
    "/auth/signup",
    "/auth/forgotPassword",
    "/auth/resetPassword",
    /^\/openpath\/.+$/,
  ];

  let openPaths = ["/auth/verify", "/auth/resetPassword"];

  let isOpenPath =
    openPaths.includes(currentPath) || currentPath.startsWith("/openpath/");

  let isPublicPath = publicPaths.includes(currentPath);

  let authPages = [
    "/auth/signin",
    "/auth/signup",
    "/auth/forgotPassword",
    "/auth/resetPassword",
  ];

  if (authPages.includes(currentPath) && token) {
    return NextResponse.redirect(new URL("/dashboard", request.nextUrl));
  }

  if (!isPublicPath && !token && !isOpenPath) {
    return NextResponse.redirect(new URL("/auth/signin", request.url));
  }
}

// See "Matching Paths" below to learn more
// export const config = {
//   matcher:
//     "/((?!api|_next/static|_next/image|favicon.ico|favicon_not.ico|sitemap.xml|robots.txt).*)",
// };
// export const config = {
//   matcher: "/",
// };

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|animation|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
