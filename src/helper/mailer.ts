import nodemailer from "nodemailer";
import bcryptjs from "bcryptjs";

import fs from "fs";
import path from "path";

export const sendMail = async (
  email: string,
  username: string,
  verifyToken: string,
  type: string
) => {
  try {
    const emailTemplatePath = path.join(
      process.cwd(),
      "src/emailTemplates/" + type + ".html"
    );
    let htmlTemplate = fs.readFileSync(emailTemplatePath, "utf8");
    htmlTemplate = htmlTemplate.replace("{{username}}", username);
    if (type !== "changeEmail") {
      const verificationLink = `${process.env.DOMAIN}/auth/${
        type === "verifyEmail" ? "verify" : "resetPassword"
      }?token=${verifyToken}`;

      htmlTemplate = htmlTemplate.replace("{{pageLink}}", verificationLink);
    } else {
      htmlTemplate = htmlTemplate.replace("{{verify_code}}", verifyToken);
    }

    var transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: process.env.NODEMAILER_AUTH_USER,
        pass: process.env.NODEMAILER_AUTH_PASS,
      },
    });

    const mailOptions = {
      from: "hi@demomailtrap.com",
      to: email,
      subject:
        type === "verifyEmail"
          ? "Verification email"
          : type === "changeEmail"
          ? "Change Email"
          : "Reset Password",
      html: htmlTemplate,
    };

    const mailResponse = await transporter.sendMail(mailOptions);
    return mailResponse;
  } catch (error: any) {
    throw new Error(error.message);
  }
  // Looking to send emails in production? Check out our Email API/SMTP product!
};
