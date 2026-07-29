import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service - Easy form",
  description: "Terms of Service for Easy form application.",
};

export default function TermsOfService() {
  return (
    <div style={{ minHeight: "100vh", background: "#0d0f12", color: "#f3f4f6", fontFamily: "sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto", background: "#111827", padding: "2.5rem", borderRadius: "1rem", border: "1px solid #1f2937" }}>
        <Link href="/" style={{ color: "#3b82f6", textDecoration: "none", display: "inline-block", marginBottom: "1.5rem" }}>
          ← Back to Easy form
        </Link>
        <h1 style={{ fontSize: "2.25rem", fontWeight: 700, marginBottom: "1rem" }}>Terms of Service</h1>
        <p style={{ color: "#9ca3af", marginBottom: "2rem" }}>Last updated: July 29, 2026</p>

        <section style={{ lineHeight: 1.7, color: "#d1d5db" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>1. Acceptance of Terms</h2>
          <p>
            By accessing or using Easy form, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>2. Description of Service</h2>
          <p>
            Easy form provides form creation, data collection, and integration capabilities allowing users to collect responses and connect them with third-party tools like Google Sheets.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>3. User Conduct & Responsibilities</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and for all activities conducted under your account. You agree not to use the service for illegal or unauthorized activities.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>4. Limitation of Liability</h2>
          <p>
            Easy form is provided "as is" without warranty of any kind. We shall not be liable for any indirect, incidental, or consequential damages resulting from your use of the service.
          </p>

          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#ffffff", marginTop: "1.5rem", marginBottom: "0.5rem" }}>5. Contact Information</h2>
          <p>
            For any questions concerning these terms, please reach out to simpliflowcorp@gmail.com.
          </p>
        </section>
      </div>
    </div>
  );
}
