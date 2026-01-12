import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const ordersContainer = document.getElementById('available-orders');

// --- ၂။ Rider ရဲ့ Live Location ကို Firebase သို့ ပို့ခြင်း ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (position) => {
        if (auth.currentUser) {
            const { latitude, longitude } = position.coords;
            const riderId = auth.currentUser.uid;

            await setDoc(doc(db, "active_riders", riderId), {
                name: auth.currentUser.email,
                lat: latitude,
                lng: longitude,
                status: "online",
                lastSeen: new Date()
            }, { merge: true });
        }
    }, (error) => console.error("GPS Error:", error), { 
        enableHighAccuracy: true 
    });
}

// --- ၃။ Listen to Pending Orders (စာသားလိပ်စာ နှင့် Map Link များ ထည့်သွင်းထားသည်) ---
const q = query(collection(db, "orders"), where("status", "==", "pending"));

onSnapshot(q, (snapshot) => {
    ordersContainer.innerHTML = ""; 
    
    if (snapshot.empty) {
        ordersContainer.innerHTML = `<p style="text-align: center; color: #888;">လောလောဆယ် Order မရှိသေးပါ</p>`;
    }

    snapshot.forEach((orderDoc) => {
        const order = orderDoc.data();
        const orderId = orderDoc.id;

        // Google Map Link များ ဖန်တီးခြင်း
        const pickupLink = `https://www.google.com/maps/search/?api=1&query=${order.pickup.lat},${order.pickup.lng}`;
        const dropoffLink = `https://www.google.com/maps/search/?api=1&query=${order.dropoff.lat},${order.dropoff.lng}`;

        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="status-tag">NEW ORDER</div>
            <div class="order-info"><b>📦 ပစ္စည်း:</b> ${order.item}</div>
            <div class="order-info"><b>📞 ဖုန်း:</b> ${order.phone}</div>
            
            <hr style="border: 0.5px solid #444; margin: 10px 0;">
            
            <div class="order-info">
                <b>📍 ယူရန်လိပ်စာ:</b><br>
                <span style="color: #ffcc00;">${order.pickup.address || "လိပ်စာ ရှာမတွေ့ပါ"}</span>
                <br><a href="${pickupLink}" target="_blank" style="color: #00ccff; font-size: 0.8rem;">[မြေပုံတွင်ကြည့်ရန်]</a>
            </div>

            <div class="order-info" style="margin-top: 10px;">
                <b>🏁 ပို့ရန်လိပ်စာ:</b><br>
                <span style="color: #ffcc00;">${order.dropoff.address || "လိပ်စာ ရှာမတွေ့ပါ"}</span>
                <br><a href="${dropoffLink}" target="_blank" style="color: #00ccff; font-size: 0.8rem;">[မြေပုံတွင်ကြည့်ရန်]</a>
            </div>

            <button class="btn-accept" 
                data-id="${orderId}" 
                data-item="${order.item}" 
                data-paddr="${order.pickup.address}" 
                data-daddr="${order.dropoff.address}">
                လက်ခံမည် (Accept)
            </button>
        `;
        
        ordersContainer.appendChild(card);

        // မြေပုံပေါ်မှာ ပစ္စည်းယူရမယ့်နေရာကို Marker ပြမယ်
        L.marker([order.pickup.lat, order.pickup.lng]).addTo(map)
            .bindPopup(`ယူရန်: ${order.item}`);
    });
});

// --- ၄။ Accept Order Logic ---
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-accept')) {
        const orderId = e.target.getAttribute('data-id');
        const itemName = e.target.getAttribute('data-item');
        const pAddr = e.target.getAttribute('data-paddr');
        const dAddr = e.target.getAttribute('data-daddr');
        
        try {
            const orderRef = doc(db, "orders", orderId);
            
            await updateDoc(orderRef, {
                status: "accepted",
                riderId: auth.currentUser.uid,
                riderName: auth.currentUser.email,
                acceptedAt: new Date()
            });
            
            // Telegram ကို Notification ပို့မယ် (လိပ်စာအပြည့်အစုံပါဝင်သည်)
            const msg = `✅ <b>Order လက်ခံလိုက်ပါပြီ!</b>\n\n` +
                        `📦 <b>ပစ္စည်း:</b> ${itemName}\n` +
                        `🚴 <b>Rider:</b> ${auth.currentUser.email}\n\n` +
                        `📍 <b>ယူရန်:</b> ${pAddr}\n` +
                        `🏁 <b>ပို့ရန်:</b> ${dAddr}\n` +
                        `⏰ <b>အချိန်:</b> ${new Date().toLocaleTimeString()}`;
            
            await notifyTelegram(msg);
            
            alert("Order ကို လက်ခံလိုက်ပါပြီ။ Customer ဆီသို့ သွားရောက်ပေးပါ!");
        } catch (error) {
            console.error(error);
            alert("Error: Order လက်ခံ၍မရပါ - " + error.message);
        }
    }
});
