const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/easy_forms').then(async () => {
  const User = mongoose.model('users', new mongoose.Schema({}, { strict: false }));
  const Ticket = mongoose.model('AgentTicket', new mongoose.Schema({}, { strict: false }));
  const tickets = await Ticket.find().sort({ createdAt: -1 }).limit(1).lean();
  console.log(JSON.stringify(tickets[0], null, 2));
  process.exit();
});
