import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const availableOrdersContainer = document.getElementById('available-orders');
const activeOrdersList = document.getElementById('active-orders-list');

// မြေပုံပေါ်က Marker တွေကို သိမ်းထားရန်
let markers = {}; 

// --- ၂။ Rider ရဲ့ Live Location Tracking ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (position) => {
        if (auth.currentUser) {
            const { latitude, longitude } = position.coords;
            await setDoc(doc(db, "active_riders", auth.currentUser.uid), {
                email: auth.currentUser.email,
                lat: latitude,
                lng: longitude,
                lastSeen: serverTimestamp()
            }, { merge: true });
        }
    }, (error) => console.error("GPS Error:", error), { enableHighAccuracy: true });
}

// --- ၃။ Available Orders (Pending) ကို စောင့်ကြည့်ခြင်း ---
onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snapshot) => {
    
    // Rider လက်ရှိကိုင်ထားသော အရေအတွက်ကို စစ်ဆေးသည်
    let activeCount = 0;
    if (auth.currentUser) {
        const activeQ = query(collection(db, "orders"), 
                        where("riderId", "==", auth.currentUser.uid),
                        where("status", "in", ["accepted", "on_the_way", "arrived"]));
        const activeSnap = await getDocs(activeQ);
        activeCount = activeSnap.size;
    }
    const isFull = activeCount >= 7;

    availableOrdersContainer.innerHTML = snapshot.empty ? `<p style="text-align:center; color:#888;">လောလောဆယ် Order မရှိသေးပါ</p>` : "";
    
    // မြေပုံပေါ်က Marker အဟောင်းတွေကို အရင်ဖြုတ်သည်
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};

    snapshot.forEach((orderDoc) => {
        const order = orderDoc.data();
        const id = orderDoc.id;
        
        // --- မြေပုံပေါ်မှာ Marker ပြခြင်း ---
        if (order.pickup && order.pickup.lat) {
            const m = L.marker([order.pickup.lat, order.pickup.lng])
                      .addTo(map)
                      .bindPopup(`<b>ပစ္စည်းယူရန်:</b> ${order.item}`);
            markers[id] = m;
        }

        const pickupLink = `https://www.google.com/maps?q=${order.pickup.lat},${order.pickup.lng}`;
        const dropoffLink = `https://www.google.com/maps?q=${order.dropoff.lat},${order.dropoff.lng}`;

        const card = document.createElement('div');
        card.className = 'order-card';
        
        const btnStyle = isFull ? "background:#ccc; cursor:not-allowed; opacity:0.6;" : "";
        const btnAttr = isFull ? "disabled" : "";

        card.innerHTML = `
            <div class="status-tag">NEW ORDER</div>
            <div class="order-info"><b>📦 ပစ္စည်း:</b> ${order.item}</div>
            <div class="order-info"><b>⚖️ အလေးချိန်:</b> ${order.weight || '-'}kg | <b>💰 တန်ဖိုး:</b> ${order.itemValue || '0'} KS</div>
            <div class="order-info" style="color: #ffcc00; font-size: 1.1rem;"><b>💵 ပို့ခ: ${order.deliveryFee} KS</b></div>
            <hr style="border: 0.5px solid #444; margin: 10px 0;">
            <div class="order-info"><b>📍 ယူရန်:</b> ${order.pickup.address} <a href="${pickupLink}" target="_blank" style="color:#00ccff;">[Map]</a></div>
            <div class="order-info"><b>🏁 ပို့ရန်:</b> ${order.dropoff.address} <a href="${dropoffLink}" target="_blank" style="color:#00ccff;">[Map]</a></div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px;">
                <button ${btnAttr} style="${btnStyle}" class="btn-accept" onclick="handleAccept('${id}', 'now')">
                    ${isFull ? 'Limit Full' : 'ချက်ချင်းယူမည်'}
                </button>
                <button ${btnAttr} style="background:#444; color:#fff; ${btnStyle}" class="btn-accept" onclick="handleAccept('${id}', 'tomorrow')">
                    ${isFull ? 'Limit Full' : 'မနက်ဖြန်မှယူမည်'}
                </button>
            </div>
            ${isFull ? '<p style="color:#ff4757; font-size:0.75rem; text-align:center; margin-top:8px;">⚠️ အော်ဒါ ၇ ခုပြည့်နေသဖြင့် ထပ်ယူ၍မရပါ</p>' : ''}
        `;
        availableOrdersContainer.appendChild(card);
    });
});

// --- ၄။ Active Orders List (Rider ကိုင်ထားသော ၇ ခု) ---
if (auth.currentUser) {
    const qActive = query(collection(db, "orders"), 
                    where("riderId", "==", auth.currentUser.uid),
                    where("status", "in", ["accepted", "on_the_way", "arrived"]));

    onSnapshot(qActive, (snapshot) => {
        activeOrdersList.innerHTML = "";
        snapshot.forEach((orderDoc) => {
            const order = orderDoc.data();
            const id = orderDoc.id;

            let statusIcon = "📦", statusText = "Accepted", btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way";
            if (order.status === "on_the_way") { statusIcon = "🚴"; statusText = "On the Way"; btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်"; nextStatus = "arrived"; }
            if (order.status === "arrived") { statusIcon = "✅"; statusText = "Arrived"; btnText = "💰 ပစ္စည်းအပ်နှံပြီး (Complete)"; nextStatus = "completed"; }

            const card = document.createElement('div');
            card.className = 'active-order-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <b>${statusIcon} ${statusText}</b>
                    <small style="color:#888;">#${id.slice(-5)}</small>
                </div>
                <p>📦 ${order.item} | 💵 ${order.deliveryFee} KS</p>
                <button onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}" 
                        style="width:100%; background:#ffcc00; border:none; padding:10px; border-radius:8px; font-weight:bold; margin-top:10px;">
                    ${btnText}
                </button>`;
            activeOrdersList.appendChild(card);
        });
    });
}

// --- ၅။ Logic Functions ---
window.handleAccept = async (orderId, timeOption) => {
    if (!auth.currentUser) return alert("Login အရင်ဝင်ပါ");
    
    const activeQ = query(collection(db, "orders"), where("riderId", "==", auth.currentUser.uid), where("status", "in", ["accepted", "on_the_way", "arrived"]));
    const activeSnap = await getDocs(activeQ);
    if (activeSnap.size >= 7) return alert("အော်ဒါ ၇ ခုပြည့်နေပါပြီ။");

    const orderRef = doc(db, "orders", orderId);
    if (timeOption === 'tomorrow') {
        await updateDoc(orderRef, { 
            status: "pending_confirmation", 
            tempRiderId: auth.currentUser.uid, 
            tempRiderName: auth.currentUser.email, 
            pickupSchedule: "tomorrow" 
        });
        alert("Customer အတည်ပြုချက် စောင့်ဆိုင်းနေပါသည်");
    } else {
        await updateDoc(orderRef, { 
            status: "accepted", 
            riderId: auth.currentUser.uid, 
            riderName: auth.currentUser.email, 
            pickupSchedule: "now", 
            acceptedAt: serverTimestamp() 
        });
        await sendDetailedTelegram(orderId, "Accepted ✅");
    }
};

window.updateStatus = async (orderId, newStatus) => {
    try {
        await updateDoc(doc(db, "orders", orderId), { status: newStatus });
        await sendDetailedTelegram(orderId, newStatus.toUpperCase());
    } catch (e) { console.error(e); }
};

window.completeOrder = async (orderId) => {
    if (confirm("ပို့ဆောင်မှု ပြီးမြောက်ကြောင်း အတည်ပြုပါသလား?")) {
        await updateDoc(doc(db, "orders", orderId), { status: "completed", completedAt: serverTimestamp() });
        await sendDetailedTelegram(orderId, "Completed 💰");
        alert("ပို့ဆောင်မှု ပြီးမြောက်ပါပြီ။");
    }
};

async function sendDetailedTelegram(orderId, statusLabel) {
    const orderSnap = await getDocs(query(collection(db, "orders"), where("__name__", "==", orderId)));
    if (orderSnap.empty) return;
    const order = orderSnap.docs[0].data();
    const msg = `🔔 <b>STATUS UPDATE: ${statusLabel}</b>\n` +
                `📦 Item: ${order.item}\n` +
                `💵 Fee: ${order.deliveryFee} KS\n` +
                `🚴 Rider: ${auth.currentUser.email}\n` +
                `🏁 Destination: ${order.dropoff.address}`;
    await notifyTelegram(msg);
}
