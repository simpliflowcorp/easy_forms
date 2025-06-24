// src\\helper\\backgroundWorker.ts
import mongoose from "mongoose";
import Form from "../models/formModel";
import User from "../models/userModel";
// import sendEmail from "@/lib/email";
import { connectDB, disconnectDB } from "../dbConfig/dbConfig";
import cron from "node-cron";
import { sendMail } from "./mailer";
import Notification from "../models/notificationModel";
// import Notification from "@/models/notificationModel";

// 2. Optimized expiration checker
async function checkAndNotifyExpirations() {
  try {
    // Connect fresh each run
    await connectDB();

    // Get current time once per execution
    const now = new Date();

    // Find forms in batches
    const batchSize = 100;
    let processed = 0;

    do {
      // 3. Lean query with field projection
      const forms = await Form.find({
        expiry: { $lte: now },
        status: 1,
      })
        .select("_id formId name expiry status user")
        .lean()
        .limit(batchSize)
        .skip(processed);

      if (forms.length === 0) break;

      for (const form of forms) {
        try {
          // 4. Get user email separately
          const user = (await User.findById(form.user)
            .select("email username isGoogleAuth googleSheetAccessToken")
            .lean()) as {
            _id: any;
            email: string;
            username: string;
            isGoogleAuth?: boolean;
            googleSheetAccessToken?: string;
          } | null;

          if (!user) continue;

          // 5. Send email

          if (!Array.isArray(user)) {
            await sendMail(
              user.email,
              user.username,
              "formExpiry",
              form.formId,
              { form_name: form.name }
            );
          }

          // if its google sign in user, push data to google sheet
          if (user?.isGoogleAuth && user.googleSheetAccessToken) {
            try {
              // 1. Fetch form responses
              const responses = await mongoose
                .model("Response")
                .find({ form_id: form._id })
                .lean();

              if (responses.length === 0) continue;

              // 2. Extract all keys
              const allKeys = Array.from(
                new Set(responses.flatMap((r: any) => Object.keys(r.data)))
              );

              // 3. Prepare data array (header + rows)
              const values = [
                allKeys, // header
                ...responses.map((r: any) =>
                  allKeys.map((key) =>
                    Array.isArray(r.data[key])
                      ? r.data[key].join(", ")
                      : r.data[key] ?? ""
                  )
                ),
              ];

              // 4. Create new spreadsheet
              const createSheetRes = await fetch(
                "https://sheets.googleapis.com/v4/spreadsheets",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${user.googleSheetAccessToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    properties: {
                      title: `Expired Form: ${form.name}`,
                    },
                  }),
                }
              );

              const newSheet = await createSheetRes.json();
              const spreadsheetId = newSheet.spreadsheetId;

              // 5. Push data to the sheet
              const pushRes = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=RAW`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${user.googleSheetAccessToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ values }),
                }
              );

              const pushResult = await pushRes.json();
              console.log(
                `Data pushed to Google Sheets for form ${form.name}`,
                pushResult
              );
            } catch (sheetError) {
              console.error(
                `Error pushing to Google Sheets for form ${form._id}:`,
                sheetError
              );
            }
          }

          // 6. Update form status
          await Form.updateOne({ _id: form._id }, { $set: { status: 2 } });

          // 7. Log notification
          await Notification.create({
            user: form.user,
            type: "FORM_EXPIRED",
            message: `Form "${form.name}" has expired`,
            relatedForm: form._id,
            triggeredAt: new Date(), // Actual expiration time
            metadata: {
              formId: form.formId,
              expiredAt: form.expiry,
            },
          });
        } catch (error) {
          console.error(`Error processing form ${form._id}:`, error);
        }
      }

      processed += forms.length;
      forms.length = 0; // Help GC
    } while (true);
  } catch (error) {
    console.error("Expiration check failed:", error);
  } finally {
    // Always clean up connections
    await disconnectDB();
  }
}

// 7. Schedule with node-cron (every 5 minutes)
cron.schedule("*/5 * * * *", () => {
  checkAndNotifyExpirations();
});

// Initial run
checkAndNotifyExpirations();
