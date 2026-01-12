import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 13); 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

// Rider ပြသမည့် ဆိုင်ကယ် Icon သတ်မှတ်ချက်
const bikeIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/71/71422.png',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

let pickupCoords = null;
let dropoffCoords = null;
let pickupMarker, dropoffMarker;
const riderMarkers = {}; // Active ဖြစ်နေသော Rider Marker များသိမ်းရန်

// --- ၂။ Active ဖြစ်နေသော Rider များကို မြေပုံပေါ်တွင် Live ပြခြင်း ---
onSnapshot(collection(db, "active_riders"), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const id = change.doc.id;

        // Rider က Online ဖြစ်နေမှ ပြမည်
        if (data.lat && data.lng) {
            if (riderMarkers[id]) {
                // ရှိပြီးသား Rider ဆိုလျှင် နေရာရွှေ့မည်
                riderMarkers[id].setLatLng([data.lat, data.lng]);
            } else {
                // Rider အသစ်ဆိုလျှင် Icon အသစ်ထည့်မည်
                riderMarkers[id] = L.marker([data.lat, data.lng], { icon: bikeIcon })
                    .addTo(map)
                    .bindPopup(`Rider: ${data.name || "Active Rider"}`);
            }
        }
    });
});

// --- ၃။ Map ပေါ်နှိပ်ရင် တည်နေရာယူခြင်း (အရင်အတိုင်း) ---
map.on('click', function(e) {
    const { lat, lng } = e.latlng;

    if (!pickupCoords) {
        pickupCoords = { lat, lng };
        pickupMarker = L.marker([lat, lng], { draggable: false }).addTo(map)
            .bindPopup("ပစ္စည်းယူရမည့်နေရာ").openPopup();
        document.getElementById('pickup-text').innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } else if (!dropoffCoords) {
        dropoffCoords = { lat, lng };
        dropoffMarker = L.marker([lat, lng], { draggable: false }).addTo(map)
            .bindPopup("ပစ္စည်းပို့ရမည့်နေရာ").openPopup();
        document.getElementById('dropoff-text').innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } else {
        if (pickupMarker) map.removeLayer(pickupMarker);
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        pickupCoords = null;
        dropoffCoords = null;
        document.getElementById('pickup-text').innerText = "မြေပုံပေါ်တွင် ရွေးပါ...";
        document.getElementById('dropoff-text').innerText = "မြေပုံပေါ်တွင် ရွေးပါ...";
    }
});

// --- ၄။ Order Submission (အရင်အတိုင်း + Telegram) ---
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

        // Firestore ထဲသိမ်းမည်
        await addDoc(collection(db, "orders"), orderData);

        // Telegram သို့ အကြောင်းကြားမည်
        const msg = `📦 <b>Order အသစ်တက်လာပါပြီ!</b>\n\n` +
                    `🔹 ပစ္စည်း: ${item}\n` +
                    `📞 ဖုန်း: ${phone}\n` +
                    `📍 Pickup: https://www.google.com/maps?q=${pickupCoords.lat},${pickupCoords.lng}\n` +
                    `🏁 Drop-off: https://www.google.com/maps?q=${dropoffCoords.lat},${dropoffCoords.lng}`;
        
        await notifyTelegram(msg);

        alert("Order တင်ခြင်း အောင်မြင်ပါသည်။");
        location.reload(); 

    } catch (error) {
        alert("Error: " + error.message);
    }
});
