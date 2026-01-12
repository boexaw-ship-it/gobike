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
let pickupAddr = ""; // လိပ်စာစာသားသိမ်းရန်
let dropoffAddr = ""; // လိပ်စာစာသားသိမ်းရန်
const riderMarkers = {}; 

// --- ၂။ Lat/Long ကို လိပ်စာအဖြစ်ပြောင်းပေးမည့် Function ---
async function fetchAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        // လိပ်စာအရှည်ကြီးမဖြစ်အောင် မြို့နယ်နဲ့ လမ်းလောက်ပဲ ဖြတ်ယူချင်ရင် data.address ကို သုံးနိုင်ပါတယ်
        return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// --- ၃။ Active ဖြစ်နေသော Rider များကို မြေပုံပေါ်တွင် Live ပြခြင်း ---
onSnapshot(collection(db, "active_riders"), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const id = change.doc.id;

        if (data.lat && data.lng) {
            if (riderMarkers[id]) {
                riderMarkers[id].setLatLng([data.lat, data.lng]);
            } else {
                riderMarkers[id] = L.marker([data.lat, data.lng], { icon: bikeIcon })
                    .addTo(map)
                    .bindPopup(`Rider: ${data.name || "Active Rider"}`);
            }
        }
    });
});

// --- ၄။ Map ပေါ်နှိပ်ရင် တည်နေရာယူခြင်း (လိပ်စာစနစ်ပါဝင်သည်) ---
map.on('click', async function(e) {
    const { lat, lng } = e.latlng;

    if (!pickupCoords) {
        pickupCoords = { lat, lng };
        document.getElementById('pickup-text').innerText = "လိပ်စာ ရှာဖွေနေသည်...";
        
        pickupAddr = await fetchAddress(lat, lng); // လိပ်စာယူခြင်း
        
        pickupMarker = L.marker([lat, lng], { draggable: false }).addTo(map)
            .bindPopup(`ယူရန်: ${pickupAddr}`).openPopup();
        document.getElementById('pickup-text').innerText = pickupAddr;
    } 
    else if (!dropoffCoords) {
        dropoffCoords = { lat, lng };
        document.getElementById('dropoff-text').innerText = "လိပ်စာ ရှာဖွေနေသည်...";

        dropoffAddr = await fetchAddress(lat, lng); // လိပ်စာယူခြင်း
        
        dropoffMarker = L.marker([lat, lng], { draggable: false }).addTo(map)
            .bindPopup(`ပို့ရန်: ${dropoffAddr}`).openPopup();
        document.getElementById('dropoff-text').innerText = dropoffAddr;
    } 
    else {
        if (pickupMarker) map.removeLayer(pickupMarker);
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        pickupCoords = null;
        dropoffCoords = null;
        pickupAddr = "";
        dropoffAddr = "";
        document.getElementById('pickup-text').innerText = "မြေပုံပေါ်တွင် ရွေးပါ...";
        document.getElementById('dropoff-text').innerText = "မြေပုံပေါ်တွင် ရွေးပါ...";
    }
});

// --- ၅။ Order Submission (Telegram ကို လိပ်စာစာသားဖြင့် ပို့မည်) ---
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
            pickup: { ...pickupCoords, address: pickupAddr },
            dropoff: { ...dropoffCoords, address: dropoffAddr },
            item: item,
            phone: phone,
            status: "pending",
            createdAt: serverTimestamp()
        };

        await addDoc(collection(db, "orders"), orderData);

        // Telegram သို့ အကြောင်းကြားစာပို့ရာတွင် လိပ်စာစာသားကိုပါ ထည့်သွင်းထားသည်
        const msg = `📦 <b>Order အသစ်တက်လာပါပြီ!</b>\n\n` +
                    `🔹 ပစ္စည်း: ${item}\n` +
                    `📞 ဖုန်း: ${phone}\n` +
                    `📍 ယူရန်: ${pickupAddr}\n` +
                    `🏁 ပို့ရန်: ${dropoffAddr}\n\n` +
                    `🔗 မြေပုံလင့်ခ်:\n` +
                    `Pickup: https://www.google.com/maps?q=${pickupCoords.lat},${pickupCoords.lng}\n` +
                    `Drop-off: https://www.google.com/maps?q=${dropoffCoords.lat},${dropoffCoords.lng}`;
        
        await notifyTelegram(msg);

        alert("Order တင်ခြင်း အောင်မြင်ပါသည်။");
        location.reload(); 

    } catch (error) {
        alert("Error: " + error.message);
    }
});
