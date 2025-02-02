import nodemailer from "nodemailer";
import bcryptjs from "bcryptjs";

import fs from "fs";
import path from "path";

export const sendMail = async (
  email: string,
  username: string,
  type: string,
  verifyToken?: string,
  data?: any
) => {
  // create reusable transporter object using the default SMTP transport
  console.log({ email, username, type, verifyToken, data });

  try {
    const emailTemplatePath = path.join(
      process.cwd(),
      "src/emailTemplates/" + type + ".html"
    );

    let htmlTemplate = fs.readFileSync(emailTemplatePath, "utf8");
    htmlTemplate = htmlTemplate.replace("{{username}}", username);

    let subject = "";

    switch (type) {
      case "verifyEmail":
        subject = "Verification email";
        htmlTemplate = htmlTemplate.replace(
          "{{pageLink}}",
          `${process.env.DOMAIN}/auth/verify}?token=${verifyToken}`
        );
        break;

      case "resetPassword":
        subject = "Reset Password";
        htmlTemplate = htmlTemplate.replace(
          "{{verify_code}}",
          `${process.env.DOMAIN}/auth/resetPassword}?token=${verifyToken}`
        );
        break;
      case "changeEmail":
        subject = "Change Email";
        htmlTemplate = htmlTemplate.replace("{{verify_code}}", verifyToken!);
        break;
      case "formExpiry":
        subject = "Form Expiration Notification";
        htmlTemplate = htmlTemplate.replace("{{form_name}}", data.form_name!);
        htmlTemplate = htmlTemplate.replace(
          "{{pageLink}}",
          `${process.env.DOMAIN}/forms/${verifyToken}`!
        );
        break;
      default:
        break;
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
      subject: subject,
      html: htmlTemplate,
    };

    const mailResponse = await transporter.sendMail(mailOptions);
    return mailResponse;
  } catch (error: any) {
    throw new Error(error.message);
  }
  // Looking to send emails in production? Check out our Email API/SMTP product!
};
