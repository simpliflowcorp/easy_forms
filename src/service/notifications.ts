import Notification from "@/models/notificationModel";

class NotificationService {
  private activeClients: any;

  constructor(activeClients: any) {
    this.activeClients = activeClients;
  }

  async sendNotification(userId, message) {
    // 1. Check if user is active
    if (this.activeClients.has(userId)) {
      // Real-time delivery
      this.activeClients.get(userId).forEach((ws) => {
        ws.send(JSON.stringify(message));
      });
    } else {
      // Store for later
      await Notification.create({
        userId,
        type: "new_response",
        content: message,
        delivered: false,
      });
    }
  }

  async checkPendingNotifications(userId) {
    const pending = await Notification.find({
      userId,
      delivered: false,
    });

    pending.forEach((notification) => {
      this.sendNotification(userId, notification.content);
      notification.delivered = true;
      notification.save();
    });
  }
}

export default NotificationService;
