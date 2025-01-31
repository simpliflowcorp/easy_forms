import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI! + "/easyform");
    const connection = mongoose.connection;

    connection.on("connected", () => {});

    connection.on("error", (error) => {
      console.error("Db connection failed", error);
      process.exit();
    });
  } catch (error) {
    console.error("Db connection failed", error);
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    // 0 = disconnected
    try {
      await mongoose.disconnect();
      console.log("MongoDB disconnected.");
    } catch (error) {
      console.error("Failed to disconnect MongoDB:", error);
    }
  } else {
    console.log("MongoDB is already disconnected.");
  }
}
