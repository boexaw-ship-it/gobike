// telegram.js
function notifyTelegram(order) {
  const BOT_TOKEN = "8338800196:AAGzQ8vzPitosrIslU6XyafXgvGqzPCjdos";
  const CHANNEL_ID = "-100365098007"; // private channel id

  const msg = `New Order Received!\nOrder ID: ${order.id}\nCustomer: ${order.customer}\nDestination: ${order.destination}`;

  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHANNEL_ID, text: msg })
  })
  .then(res => res.json())
  .then(data => console.log("Telegram Response:", data))
  .catch(err => console.error("Telegram Error:", err));
}
