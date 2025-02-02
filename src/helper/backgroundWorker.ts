// src/workers/form-expiration.ts
import mongoose from "mongoose";
import Form from "../models/formModel";
import User from "../models/userModel";
// import sendEmail from "@/lib/email";
import { connectDB, disconnectDB } from "../dbConfig/dbConfig";
import cron from "node-cron";
import { sendMail } from "./mailer";

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

      console.log(forms);

      if (forms.length === 0) break;

      for (const form of forms) {
        try {
          // 4. Get user email separately
          const user = await User.findById(form.user)
            .select("email username")
            .lean();

          if (!user) continue;

          // 5. Send email

          if (!Array.isArray(user)) {
            console.log(user);

            await sendMail(
              user.email,
              user.username,
              "formExpiry",
              form.formId,
              { form_name: form.name }
            );
          }

          // console.log(`Notified user ${user.email} about form ${form._id}`);

          // 6. Update form status
          await Form.updateOne({ _id: form._id }, { $set: { status: 2 } });
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
  console.log("Running expiration check...");
  checkAndNotifyExpirations();
});

// Initial run
checkAndNotifyExpirations();
