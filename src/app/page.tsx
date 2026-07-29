import React from "react";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata = {
  title: "Easy form - Build Forms & Automate Workflows",
  description:
    "Easy form allows you to create custom forms and automatically sync form submissions directly to Google Sheets and external tools.",
};

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#0d0f12", color: "#f3f4f6", fontFamily: "sans-serif" }}>
      {/* Header Navigation */}
      <header style={{ padding: "1.5rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1f2937" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#3b82f6" }}>
          Easy form
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Link href="/auth/signin" style={{ color: "#9ca3af", textDecoration: "none", padding: "0.5rem 1rem", borderRadius: "0.375rem" }}>
            Sign In
          </Link>
          <Link href="/auth/signup" style={{ background: "#3b82f6", color: "#ffffff", padding: "0.5rem 1.25rem", borderRadius: "0.375rem", textDecoration: "none", fontWeight: 500 }}>
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main style={{ flex: 1, maxWidth: "1200px", margin: "0 auto", padding: "4rem 2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "3rem", fontWeight: 800, marginBottom: "1.5rem", background: "linear-gradient(to right, #60a5fa, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Build Forms & Sync Data Effortlessly
        </h1>
        <p style={{ fontSize: "1.25rem", color: "#9ca3af", maxWidth: "800px", margin: "0 auto 2.5rem auto", lineHeight: 1.6 }}>
          Easy form is a powerful online form builder designed to help individuals and teams capture leads, collect feedback, and manage data efficiently. With seamless Google integration, your form responses are automatically synchronized directly into your Google Sheets in real-time.
        </p>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginBottom: "4rem" }}>
          <Link href="/auth/signup" style={{ background: "#3b82f6", color: "#ffffff", padding: "0.875rem 2rem", borderRadius: "0.5rem", textDecoration: "none", fontSize: "1.125rem", fontWeight: 600 }}>
            Start Building Free
          </Link>
          <Link href="/auth/signin" style={{ border: "1px solid #374151", color: "#e5e7eb", padding: "0.875rem 2rem", borderRadius: "0.5rem", textDecoration: "none", fontSize: "1.125rem" }}>
            Sign In to Dashboard
          </Link>
        </div>

        {/* Purpose / Features Explanation for Google Verification */}
        <section style={{ textAlign: "left", background: "#111827", padding: "2.5rem", borderRadius: "1rem", border: "1px solid #1f2937", marginTop: "2rem" }}>
          <h2 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "1rem", color: "#ffffff" }}>
            Why Easy form Requests Google Account Access
          </h2>
          <p style={{ color: "#9ca3af", lineHeight: 1.6, marginBottom: "1.5rem" }}>
            When you sign in with Google or connect your Google Sheets integration, Easy form requests access to read and update spreadsheets that you explicitly designate. Here is how we use your data:
          </p>
          <ul style={{ color: "#d1d5db", lineHeight: 1.8, paddingLeft: "1.5rem" }}>
            <li><strong>Automated Export to Google Sheets:</strong> Automatically create and append form responses to spreadsheets in your Google Drive.</li>
            <li><strong>Data Privacy & Security:</strong> We only access spreadsheets created or selected by you for Easy form integrations. Your personal files remain untouched.</li>
            <li><strong>Seamless Authentication:</strong> Sign in quickly and securely using your existing Google account without needing to remember extra passwords.</li>
          </ul>
        </section>
      </main>

      {/* Footer with Legal Links */}
      <footer style={{ padding: "2rem", borderTop: "1px solid #1f2937", background: "#0b0f17", textAlign: "center", color: "#6b7280", fontSize: "0.875rem" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: "2rem", marginBottom: "1rem" }}>
          <Link href="/privacy" style={{ color: "#9ca3af", textDecoration: "none" }}>
            Privacy Policy
          </Link>
          <Link href="/terms" style={{ color: "#9ca3af", textDecoration: "none" }}>
            Terms of Service
          </Link>
        </div>
        <p>© {new Date().getFullYear()} Easy form. All rights reserved.</p>
      </footer>
    </div>
  );
}
