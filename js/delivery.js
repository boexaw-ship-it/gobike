import { db, auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    collection, query, where, onSnapshot, doc, updateDoc, getDocs, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

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

// --- Helper: Create Detailed Telegram Message (ပြန်ထည့်ပေးထားပါတယ်) ---
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
let map;
if (document.getElementById('map')) {
    map = L.map('map').setView([16.8661, 96.1951], 12); 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
}
let markers = {}; 

// --- ၂။ Live Location Tracking & Profile Display ---
async function trackRiderLocation(user) {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(async (pos) => {
            try {
                const riderRef = doc(db, "riders", user.uid);
                const riderSnap = await getDoc(riderRef);
                
                if (riderSnap.exists()) {
                    const data = riderSnap.data();
                    if(document.getElementById('rider-name')) document.getElementById('rider-name').innerText = data.name;
                    if(document.getElementById('rider-rating')) document.getElementById('rider-rating').innerText = `⭐ ${data.rating?.toFixed(1) || "5.0"}`;
                }

                await updateDoc(riderRef, {
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude, 
                    lastSeen: serverTimestamp(),
                    status: "online"
                });
            } catch (err) { console.error(err); }
        }, (err) => console.error(err), { enableHighAccuracy: true });
    }
}

// --- ၃။ Order စောင့်ကြည့်ခြင်း ---
function startTracking() {
    const myUid = auth.currentUser.uid;

    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const activeSnap = await getDocs(query(collection(db, "orders"), 
            where("riderId", "==", myUid),
            where("status", "in", ["accepted", "on_the_way", "arrived"])));
        
        const isFull = activeSnap.size >= 7;
        if(document.getElementById('active-count')) document.getElementById('active-count').innerText = `${activeSnap.size} / 7`;

        const container = document.getElementById('available-orders');
        if(container) {
            container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
            Object.values(markers).forEach(m => map.removeLayer(m));
            markers = {};

            snap.forEach(orderDoc => {
                const order = orderDoc.data();
                const id = orderDoc.id;
                if (order.lastRejectedRiderId === myUid) return; 

                if(order.pickup && map) { 
                    markers[id] = L.marker([order.pickup.lat, order.pickup.lng]).addTo(map).bindPopup(order.item); 
                }

                const card = document.createElement('div');
                card.className = 'order-card';
                card.innerHTML = `
                    <div class="item-info"><b>📦 ${order.item}</b> <span>${order.deliveryFee?.toLocaleString()} KS</span></div>
                    <div class="order-details">
                        ⚖️ ${order.weight || 0}kg | 💰 ${order.itemValue || 0}KS<br>
                        📍 ${order.pickupAddress || "မသိရပါ"}<br>
                        🏁 ${order.dropoffAddress || "မသိရပါ"}
                    </div>
                    <div class="btn-group">
                        <button class="btn-accept-now" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                        <button class="btn-accept-tmr" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                    </div>`;
                container.appendChild(card);
            });
        }
    });

    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        if(!list) return;
        list.innerHTML = "";
        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            const id = orderDoc.id;
            if (["accepted", "on_the_way", "arrived"].includes(data.status)) {
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way";
                if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived"; }
                if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး", nextStatus = "completed"; }

                const div = document.createElement('div');
                div.className = 'active-order-card';
                div.innerHTML = `<b>📦 ${data.item}</b><br>
                    <button class="btn-status" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
                    <button style="color:red; background:none; border:none; margin-top:5px;" onclick="cancelByRider('${id}')">ပြန်လွှတ်မည်</button>`;
                list.appendChild(div);
            }
        });
    });
}

// --- ၄။ Functions ---
async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();

        if(time === 'tomorrow') {
            await updateDoc(docRef, { status: "pending_confirmation", pickupSchedule: "tomorrow", tempRiderId: auth.currentUser.uid, tempRiderName: riderName });
            await notifyTelegram(createOrderMessage("⏳ <b>Scheduled!</b>", order, riderName, "မနက်ဖြန်မှလာယူပါမည်"));
        } else {
            await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp() });
            await notifyTelegram(createOrderMessage("✅ <b>Accepted!</b>", order, riderName, "Rider လက်ခံလိုက်ပါပြီ"));
        }
    } catch (err) { console.error(err); }
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();
        await updateDoc(docRef, { status: status });
        const text = status === "on_the_way" ? "ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "Rider ရောက်ရှိနေပါပြီ";
        await notifyTelegram(createOrderMessage("🚀 <b>Update!</b>", order, riderName, text));
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    if(!confirm("ပို့ဆောင်မှု ပြီးမြောက်ပြီလား?")) return;
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();
        await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });
        await notifyTelegram(createOrderMessage("💰 <b>Completed!</b>", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ"));
    } catch (err) { console.error(err); }
};

window.cancelByRider = async (id) => {
    if(!confirm("ဤအော်ဒါကို ပြန်လွှတ်မည်လား?")) return;
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();
        await updateDoc(docRef, { status: "pending", riderId: null, riderName: null, lastRejectedRiderId: auth.currentUser.uid });
        await notifyTelegram(createOrderMessage("❌ <b>Rejected!</b>", order, riderName, "Rider က အော်ဒါပြန်လွှတ်လိုက်ပါပြီ"));
    } catch (err) { console.error(err); }
};

onAuthStateChanged(auth, (user) => { if(user) { trackRiderLocation(user); startTracking(); } else { window.location.href = "../index.html"; } });
