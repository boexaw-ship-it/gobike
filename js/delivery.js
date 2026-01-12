import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const ordersContainer = document.getElementById('available-orders');

// --- ၂။ Rider ရဲ့ Live Location ကို Tracking လုပ်ခြင်း ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (position) => {
        if (auth.currentUser) {
            const { latitude, longitude } = position.coords;
            const riderId = auth.currentUser.uid;

            await setDoc(doc(db, "active_riders", riderId), {
                email: auth.currentUser.email,
                lat: latitude,
                lng: longitude,
                lastSeen: serverTimestamp()
            }, { merge: true });
        }
    }, (error) => console.error("GPS Error:", error), { enableHighAccuracy: true });
}

// --- ၃။ Pending Orders ကို စောင့်ကြည့်ခြင်း ---
const q = query(collection(db, "orders"), where("status", "==", "pending"));

onSnapshot(q, (snapshot) => {
    ordersContainer.innerHTML = ""; 
    if (snapshot.empty) {
        ordersContainer.innerHTML = `<p style="text-align: center; color: #888;">လောလောဆယ် Order မရှိသေးပါ</p>`;
    }

    snapshot.forEach((orderDoc) => {
        const order = orderDoc.data();
        const orderId = orderDoc.id;

        // Google Map Links
        const pickupLink = `https://www.google.com/maps?q=${order.pickup.lat},${order.pickup.lng}`;
        const dropoffLink = `https://www.google.com/maps?q=${order.dropoff.lat},${order.dropoff.lng}`;

        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="status-tag">NEW ORDER</div>
            <div class="order-info"><b>📦 ပစ္စည်း:</b> ${order.item}</div>
            <div class="order-info"><b>⚖️ အလေးချိန်:</b> ${order.weight || '-'} | <b>💰 တန်ဖိုး:</b> ${order.itemValue || '0'} KS</div>
            <div class="order-info"><b>💳 Payment:</b> ${order.paymentMethod}</div>
            <div class="order-info" style="color: #ffcc00; font-size: 1.1rem;"><b>💵 ပို့ခ: ${order.deliveryFee} KS</b></div>
            <hr style="border: 0.5px solid #444; margin: 10px 0;">
            <div class="order-info"><b>📍 ယူရန်:</b> ${order.pickup.address} <br><a href="${pickupLink}" target="_blank" style="color: #00ccff;">[Map]</a></div>
            <div class="order-info"><b>🏁 ပို့ရန်:</b> ${order.dropoff.address} <br><a href="${dropoffLink}" target="_blank" style="color: #00ccff;">[Map]</a></div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px;">
                <button class="btn-accept" style="background: #ffcc00; color: #000;" onclick="handleAccept('${orderId}', 'now')">ချက်ချင်းယူမည်</button>
                <button class="btn-accept" style="background: #444; color: #fff;" onclick="handleAccept('${orderId}', 'tomorrow')">မနက်ဖြန်မှယူမည်</button>
            </div>
        `;
        ordersContainer.appendChild(card);
    });
});

// --- ၄။ Accept Order Logic ---
window.handleAccept = async (orderId, timeOption) => {
    if (!auth.currentUser) return alert("Login အရင်ဝင်ပါ");
    const timeText = timeOption === 'now' ? "ချက်ချင်း" : "မနက်ဖြန်";
    
    if (!confirm(`ဤအော်ဒါကို (${timeText}) လာယူမည်ဟု အတည်ပြုပါသလား?`)) return;

    try {
        const orderRef = doc(db, "orders", orderId);
        await updateDoc(orderRef, {
            status: "accepted",
            riderId: auth.currentUser.uid,
            riderName: auth.currentUser.email,
            pickupSchedule: timeOption,
            acceptedAt: serverTimestamp()
        });

        const msg = `✅ <b>Order Accepted!</b>\n🚴 Rider: ${auth.currentUser.email}\n⏰ အချိန်: ${timeText}`;
        await notifyTelegram(msg);
        
        // UI ကို Active Delivery အဖြစ်ပြောင်းလဲခြင်း
        showActiveDeliveryUI(orderId);
    } catch (error) { alert("Error: " + error.message); }
};

function showActiveDeliveryUI(orderId) {
    ordersContainer.innerHTML = `
        <div class="order-card" style="border-left: 5px solid #2ed573;">
            <h3 style="color: #2ed573;">ပို့ဆောင်နေဆဲ...</h3>
            <p>ပစ္စည်းရောက်ရှိပါက အောက်ပါခလုတ်ကို နှိပ်ပါ။</p>
            <button class="btn-accept" style="background: #2ed573; color: white;" onclick="completeOrder('${orderId}')">ပို့ဆောင်မှု ပြီးမြောက်ပြီ (Complete)</button>
        </div>
    `;
}

window.completeOrder = async (orderId) => {
    if (confirm("ပစ္စည်းပို့ဆောင်ခနှင့် ပစ္စည်းဖိုး လက်ခံရရှိပြီးပြီလား?")) {
        await updateDoc(doc(db, "orders", orderId), { status: "completed", completedAt: serverTimestamp() });
        alert("ပို့ဆောင်မှု အောင်မြင်ပါသည်။");
        location.reload();
    }
};

