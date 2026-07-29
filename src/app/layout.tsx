import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "../scss/main.scss";
import LanguageWrapper from "@/wrappers/LanguageWrapper";
import SessionWrapper from "@/wrappers/SessionWrapper";
import FaviconWrapper from "@/wrappers/FaviconWrapper";
import { Toaster } from "react-hot-toast";
import SidebarMain from "@/components/sidebar/SidebarMain";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Easy form",
  description: "Create forms and automate data sync with Google Sheets.",
  icons: {
    icon: ["/favicon.ico"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SessionWrapper>
      <html lang="en">
        <meta name="google-site-verification" content="alWKjLjuepob7qcj5wbnE4rYhS21sfcX0HeMhVeJW8E" />
        <LanguageWrapper>
          {/* <FaviconWrapper> */}
          <body className={inter.className}>
            <Toaster />
            <div className="body-wrapper theme-dark">
              <div className="body">{children}</div>
            </div>
          </body>
          {/* </FaviconWrapper> */}
        </LanguageWrapper>
      </html>
    </SessionWrapper>
  );
}
