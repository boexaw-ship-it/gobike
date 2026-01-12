import { db, auth } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- Map Initialization ---
// ရန်ကုန်မြို့ကို ဗဟိုပြုထားပါတယ် [Latitude, Longitude]
const map = L.map('map').setView([16.8661, 96.1951], 13); 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let pickupCoords = null;
let dropoffCoords = null;
let pickupMarker, dropoffMarker;

// Map ပေါ်နှိပ်ရင် တည်နေရာယူမယ်
map.on('click', function(e) {
    const { lat, lng } = e.latlng;

    if (!pickupCoords) {
        // Pickup နေရာ အရင်ရွေးမယ်
        pickupCoords = { lat, lng };
        pickupMarker = L.marker([lat, lng], { draggable: false }).addTo(map)
            .bindPopup("ပစ္စည်းယူရမည့်နေရာ").openPopup();
        document.getElementById('pickup-text').innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } else if (!dropoffCoords) {
        // ပြီးရင် Drop-off နေရာရွေးမယ်
        dropoffCoords = { lat, lng };
        dropoffMarker = L.marker([lat, lng], { draggable: false }).addTo(map)
            .bindPopup("ပစ္စည်းပို့ရမည့်နေရာ").openPopup();
        document.getElementById('dropoff-text').innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } else {
        // ပြန်ပြင်ချင်ရင် အကုန်ဖျက်ပြီး ပြန်ရွေးခိုင်းမယ်
        map.removeLayer(pickupMarker);
        map.removeLayer(dropoffMarker);
        pickupCoords = null;
        dropoffCoords = null;
        document.getElementById('pickup-text').innerText = "မြေပုံပေါ်တွင် ရွေးပါ...";
        document.getElementById('dropoff-text').innerText = "မြေပုံပေါ်တွင် ရွေးပါ...";
    }
});

// --- Order Submission ---
document.getElementById('placeOrderBtn').addEventListener('click', async () => {
    const item = document.getElementById('item-detail').value;
    const phone = document.getElementById('receiver-phone').value;

    if (!pickupCoords || !dropoffCoords || !item || !phone) {
        alert("မြေပုံပေါ်တွင် တည်နေရာရွေးပြီး အချက်အလက်စုံအောင်ဖြည့်ပါ");
        return;
    }

    try {
        const orderData = {
            userId: auth.currentUser?.uid || "anonymous",
            pickup: pickupCoords,
            dropoff: dropoffCoords,
            item: item,
            phone: phone,
            status: "pending",
            createdAt: serverTimestamp()
        };

        // 1. Save to Firestore
        await addDoc(collection(db, "orders"), orderData);

        // 2. Notify Telegram
        const msg = `📦 <b>Order အသစ်တက်လာပါပြီ!</b>\n\n` +
                    `🔹 ပစ္စည်း: ${item}\n` +
                    `📞 ဖုန်း: ${phone}\n` +
                    `📍 Pickup: https://www.google.com/maps?q=${pickupCoords.lat},${pickupCoords.lng}\n` +
                    `🏁 Drop-off: https://www.google.com/maps?q=${dropoffCoords.lat},${dropoffCoords.lng}`;
        
        await notifyTelegram(msg);

        alert("Order တင်ခြင်း အောင်မြင်ပါသည်။");
        location.reload(); // Page ပြန် Reset လုပ်မယ်

    } catch (error) {
        alert("Error: " + error.message);
    }
});
