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
    // ၅ စက္ကန့်တစ်ခါ ဒါမှမဟုတ် တည်နေရာပြောင်းတိုင်း Auto Update လုပ်မယ်
    navigator.geolocation.watchPosition(async (position) => {
        if (auth.currentUser) {
            const { latitude, longitude } = position.coords;
            const riderId = auth.currentUser.uid;

            // 'active_riders' collection ထဲမှာ Rider ရဲ့ လက်ရှိနေရာကို သိမ်းမယ်
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

// --- ၃။ Listen to Pending Orders (အရင်အတိုင်း) ---
const q = query(collection(db, "orders"), where("status", "==", "pending"));

onSnapshot(q, (snapshot) => {
    ordersContainer.innerHTML = ""; 
    
    if (snapshot.empty) {
        ordersContainer.innerHTML = `<p style="text-align: center; color: #888;">လောလောဆယ် Order မရှိသေးပါ</p>`;
    }

    snapshot.forEach((orderDoc) => {
        const order = orderDoc.data();
        const orderId = orderDoc.id;

        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="status-tag">NEW ORDER</div>
            <div class="order-info"><b>ပစ္စည်း:</b> ${order.item}</div>
            <div class="order-info"><b>ဖုန်း:</b> ${order.phone}</div>
            <div class="order-info"><b>ယူရန်:</b> ${order.pickup.lat.toFixed(4)}, ${order.pickup.lng.toFixed(4)}</div>
            <div class="order-info"><b>ပို့ရန်:</b> ${order.dropoff.lat.toFixed(4)}, ${order.dropoff.lng.toFixed(4)}</div>
            <button class="btn-accept" data-id="${orderId}" data-item="${order.item}">လက်ခံမည် (Accept)</button>
        `;
        
        ordersContainer.appendChild(card);

        // မြေပုံပေါ်မှာ ပစ္စည်းယူရမယ့်နေရာကို Marker ပြမယ်
        L.marker([order.pickup.lat, order.pickup.lng]).addTo(map)
            .bindPopup(`ပစ္စည်းယူရန်: ${order.item}`);
    });
});

// --- ၄။ Accept Order Logic (Telegram Notification ပါဝင်သည်) ---
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-accept')) {
        const orderId = e.target.getAttribute('data-id');
        const itemName = e.target.getAttribute('data-item');
        
        try {
            const orderRef = doc(db, "orders", orderId);
            
            // Firebase မှာ Status ပြောင်းမယ်
            await updateDoc(orderRef, {
                status: "accepted",
                riderId: auth.currentUser.uid,
                riderName: auth.currentUser.email,
                acceptedAt: new Date()
            });
            
            // Telegram ကို Notification ပို့မယ်
            const msg = `✅ <b>Order လက်ခံလိုက်ပါပြီ!</b>\n\n` +
                        `📦 ပစ္စည်း: ${itemName}\n` +
                        `🚴 Rider: ${auth.currentUser.email}\n` +
                        `⏰ အချိန်: ${new Date().toLocaleTimeString()}`;
            
            await notifyTelegram(msg);
            
            alert("Order ကို လက်ခံလိုက်ပါပြီ။ Customer ဆီသို့ သွားရောက်ပေးပါ!");
        } catch (error) {
            console.error(error);
            alert("Error: Order လက်ခံ၍မရပါ - " + error.message);
        }
    }
});
