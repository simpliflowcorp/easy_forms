const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/easy_forms').then(async () => {
  const Ticket = mongoose.model('AgentTicket', new mongoose.Schema({}, { strict: false }));
  const ticket = await Ticket.findOne({ ticketId: "tkt_3b0ab26c-363f-4e15-ab9d-28c4ab3a72b2" }).lean();
  console.log(JSON.stringify(ticket?.executionTrace, null, 2));
  process.exit();
}).catch(console.error);
