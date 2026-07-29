import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy - Easy form",
  description: "Privacy Policy for Easy form application.",
};

export default function PrivacyPolicy() {
  return (
    <div style={{ minHeight: "100vh", background: "#0d0f12", color: "#f3f4f6", fontFamily: "sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto", background: "#111827", padding: "2.5rem", borderRadius: "1rem", border: "1px solid #1f2937" }}>
        <Link href="/" style={{ color: "#3b82f6", textDecoration: "none", display: "inline-block", marginBottom: "1.5rem" }}>
          ← Back to Easy form
        </Link>
        <h1 style={{ fontSize: "2.25rem", fontWeight: 700, marginBottom: "1rem" }}>Privacy Policy</h1>
        <p style={{ color: "#9ca3af", marginBottom: "2rem" }}>Last updated: July 29, 2026</p>

        <section style={{ lineHeight: 1.7, color: "#d1d5db" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>1. Introduction</h2>
          <p>
            Welcome to Easy form. We respect your privacy and are committed to protecting your personal data and information you share when using our web application.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>2. Information We Collect</h2>
          <p>
            We collect information you provide directly when creating an account, building forms, or connecting external integrations such as Google Sheets. This includes email addresses, profile information, and form data.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>3. Use of Google User Data</h2>
          <p>
            Easy form requests access to your Google account (including Google Sheets and Drive permissions) strictly to export and sync form responses to spreadsheets designated by you. We do not sell or share your Google user data with third parties.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>4. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to safeguard your personal data against unauthorized access, loss, or alteration.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>5. Contact Us</h2>
          <p>
            If you have any questions regarding this Privacy Policy, please contact us at simpliflowcorp@gmail.com.
          </p>
        </section>
      </div>
    </div>
  );
}
