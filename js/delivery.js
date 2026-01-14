import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; // Note: ensure firebase-firestore.js is used for firestore functions
import { notifyTelegram } from './telegram.js';

// --- (Firebase Firestore imports fix) ---
import { 
    // Re-importing from correct firestore link for safety
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၀။ Alarm Sound Setup ---
const alarmSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
const soundBtn = document.createElement('button');
soundBtn.innerHTML = "🔔 အသံဖွင့်ရန်";
soundBtn.style = "position:fixed; bottom:25px; right:20px; z-index:2000; padding:10px 18px; background:#ffcc00; color:#000; border:2px solid #1a1a1a; border-radius:50px; font-weight:bold; cursor:pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.3);";
document.body.appendChild(soundBtn);

soundBtn.onclick = () => {
    alarmSound.play().then(() => { soundBtn.style.display = 'none'; }).catch(e => console.log("Sound enabled"));
};

// --- Helper: Create Detailed Telegram Message ---
const createOrderMessage = (title, order, riderName, statusText = "") => {
    let msg = `${title}\n`;
    if (statusText) msg += `📊 Status: <b>${statusText}</b>\n`;
    msg += `--------------------------\n` +
           `📝 ပစ္စည်း: <b>${order.item}</b>\n` +
           `⚖️ အလေးချိန်: <b>${order.weight || "0"} kg</b>\n` +
           `💰 ပစ္စည်းတန်ဖိုး: <b>${order.itemValue || order.itemPrice || "0"} KS</b>\n` +
           `💵 ပို့ခ: <b>${order.deliveryFee?.toLocaleString()} KS</b>\n` +
           `💳 Payment: <b>${order.paymentMethod || "CASH"}</b>\n` +
           `📞 ဖုန်း: <b>${order.phone}</b>\n` +
           `👤 Customer: <b>${order.customerName || "အမည်မသိသူ"}</b>\n` +
           `--------------------------\n` +
           `🚴 Rider: <b>${riderName}</b>\n` +
           `📍 ယူရန်: ${order.pickupAddress || order.pickup?.address || "မသိရပါ"}\n` +
           `🏁 ပို့ရန်: ${order.dropoffAddress || order.dropoff?.address || "မသိရပါ"}`;
    return msg;
};

// --- ၁။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = {}; 

// --- ၂။ Live Location Tracking & Rider Name Display ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
            try {
                // ပြင်ဆင်ချက်: "users" အစား "riders" collection ဆီက နာမည်ယူမယ်
                const riderDoc = await getDoc(doc(db, "riders", auth.currentUser.uid));
                const riderData = riderDoc.exists() ? riderDoc.data() : null;
                const riderDisplayName = riderData ? riderData.name : "Rider";

                // HTML မှာ နာမည်ပြဖို့ ID (rider-name) ရှိရင် သွားထည့်မယ်
                const nameDisplay = document.getElementById('rider-name');
                if(nameDisplay) nameDisplay.innerText = riderDisplayName;

                // တည်နေရာကို "riders" collection ထဲမှာပဲ Update လုပ်မယ်
                await updateDoc(doc(db, "riders", auth.currentUser.uid), {
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude, 
                    lastSeen: serverTimestamp(),
                    status: "online"
                });

            } catch (err) { console.error("Location Update Error:", err); }
        }
    }, (err) => console.error(err), { enableHighAccuracy: true });
}

// --- ၃။ Order စောင့်ကြည့်ခြင်း (Core Logic) ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const activeSnap = await getDocs(query(collection(db, "orders"), 
            where("riderId", "==", myUid),
            where("status", "in", ["accepted", "on_the_way", "arrived"])));
        
        const isFull = activeSnap.size >= 7;
        const activeCountEl = document.getElementById('active-count');
        if(activeCountEl) {
            activeCountEl.innerText = `${activeSnap.size} / 7`;
            activeCountEl.style.color = isFull ? "red" : "var(--primary)";
        }

        const container = document.getElementById('available-orders');
        if(container) {
            container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
            Object.values(markers).forEach(m => map.removeLayer(m));
            markers = {};

            snap.forEach(orderDoc => {
                const order = orderDoc.data();
                const id = orderDoc.id;
                if (order.lastRejectedRiderId === myUid) return; 

                if(order.pickup) { markers[id] = L.marker([order.pickup.lat, order.pickup.lng]).addTo(map).bindPopup(order.item); }

                const card = document.createElement('div');
                card.className = 'order-card';
                card.innerHTML = `
                    <div class="item-info">
                        <b class="item-name">📦 ${order.item}</b>
                        <span class="price">${order.deliveryFee?.toLocaleString()} KS</span>
                    </div>
                    <div class="order-details">
                        <b>👤 CUSTOMER:</b> ${order.customerName || "အမည်မသိသူ"}<br>
                        <b>⚖️ အလေးချိန်:</b> ${order.weight || "0"} kg | <b>💰 တန်ဖိုး:</b> ${order.itemValue || order.itemPrice || "0"} KS<br>
                        <b>💳 PAYMENT:</b> <span style="color:#00ff00;">${order.paymentMethod || "ပို့ခကြိုပေး"}</span><br>
                        <b>📞 ဖုန်း:</b> <span style="color:#00ff00;">${order.phone}</span>
                    </div>
                    <div class="btn-group">
                        <button class="btn-accept-now" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                        <button class="btn-accept-tmr" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                    </div>`;
                container.appendChild(card);
            });
        }
    });

    // လက်ရှိအော်ဒါများ
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        const rejectedSection = document.getElementById('rejected-orders-section');
        if(list) list.innerHTML = "";
        if(rejectedSection) rejectedSection.innerHTML = "";
        let hasActive = false;

        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            const id = orderDoc.id;
            if (data.status === "cancelled") {
                const rejCard = document.createElement('div');
                rejCard.className = 'order-card rejected-card';
                rejCard.innerHTML = `
                    <b style="color:#ff4444;">⚠️ Customer မှ အော်ဒါဖျက်လိုက်ပါပြီ</b>
                    <button class="btn-dismiss" onclick="dismissOrder('${id}')">Dashboard မှ ဖယ်ထုတ်မည်</button>`;
                rejectedSection.appendChild(rejCard);
                return;
            }
            if (["accepted", "on_the_way", "arrived"].includes(data.status)) {
                hasActive = true;
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way", icon = "📦";
                if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived", icon = "🚴"; }
                if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး (Complete)", nextStatus = "completed", icon = "🏁"; }
                const div = document.createElement('div');
                div.className = 'active-order-card';
                div.innerHTML = `<b>${icon} ${data.status.toUpperCase()}</b><br>📦 ${data.item}<br>
                    <button class="btn-status" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>`;
                list.appendChild(div);
            }
        });
    });
}

// --- ၄။ Rider Name ကို Database ကနေ ဆွဲထုတ်ခြင်း Helper ---
async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
        const riderName = await getRiderName(); // ပြင်ဆင်ချက်

        if(time === 'tomorrow') {
            await updateDoc(docRef, { status: "pending_confirmation", pickupSchedule: "tomorrow", tempRiderId: auth.currentUser.uid, tempRiderName: riderName });
            await notifyTelegram(createOrderMessage("⏳ <b>Rider Scheduled!</b>", order, riderName, "မနက်ဖြန်မှလာယူပါမည်"));
        } else {
            await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp() });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName: riderName, status: "Accepted" }) });
            await notifyTelegram(createOrderMessage("✅ <b>Order Accepted!</b>", order, riderName, "Rider လက်ခံလိုက်ပါပြီ"));
        }
    } catch (err) { console.error(err); }
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName(); // ပြင်ဆင်ချက်
        await updateDoc(docRef, { status: status });
        const statusText = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        await notifyTelegram(createOrderMessage("🚀 <b>Status Update!</b>", order, riderName, statusText));
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    if(confirm("ပို့ဆောင်မှုပြီးမြောက်ပြီလား?")) {
        try {
            const docRef = doc(db, "orders", id);
            const order = (await getDoc(docRef)).data();
            const riderName = await getRiderName(); // ပြင်ဆင်ချက်
            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });
            await notifyTelegram(createOrderMessage("💰 <b>Order Completed!</b>", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ"));
        } catch (err) { console.error(err); }
    }
};

window.cancelByRider = async (id) => {
    if(!confirm("ဤအော်ဒါကို ပြန်လွှတ်မည်မှာ သေချာပါသလား?")) return;
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName(); // ပြင်ဆင်ချက်
        await updateDoc(docRef, { status: "pending", riderId: null, riderName: null, lastRejectedRiderId: auth.currentUser.uid });
        await notifyTelegram(createOrderMessage("❌ <b>Rider Rejected Order!</b>", order, riderName, "Rider က အော်ဒါပြန်လွှတ်လိုက်ပါပြီ"));
    } catch (err) { console.error(err); }
};

auth.onAuthStateChanged((user) => { if(user) startTracking(); });

