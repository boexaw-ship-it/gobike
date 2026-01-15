import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uo/exec";

// --- ၀။ Alarm Sound Setup ---
const alarmSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
const soundBtn = document.createElement('button');
soundBtn.innerHTML = "🔔 အသံဖွင့်ရန်";
soundBtn.style = "position:fixed; bottom:25px; right:20px; z-index:2000; padding:10px 18px; background:#ffcc00; color:#000; border:2px solid #1a1a1a; border-radius:50px; font-weight:bold; cursor:pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.3);";
document.body.appendChild(soundBtn);

soundBtn.onclick = () => {
    alarmSound.play().then(() => { soundBtn.style.display = 'none'; }).catch(e => console.log("Sound enabled"));
};

// --- ၁။ Auth & Profile Logic ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await getRiderData(); 
        startTracking(); 
    } else {
        window.location.href = "../index.html";
    }
});

window.handleLogout = async () => {
    const result = await Swal.fire({
        title: 'ထွက်မှာ သေချာပါသလား?',
        text: "Rider အကောင့်မှ ထွက်ခွာပါမည်။",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ffcc00',
        cancelButtonColor: '#444',
        confirmButtonText: 'ထွက်မည်',
        cancelButtonText: 'မထွက်တော့ပါ',
        background: '#1a1a1a',
        color: '#fff'
    });
    if (result.isConfirmed) {
        try { await signOut(auth); } catch (error) { console.error(error); }
    }
};

async function getRiderData() {
    if (!auth.currentUser) return "Rider";
    try {
        const riderSnap = await getDoc(doc(db, "riders", auth.currentUser.uid));
        const nameDisplay = document.getElementById('display-name');
        if (riderSnap.exists()) {
            const data = riderSnap.data();
            if (nameDisplay) nameDisplay.innerText = data.name;
            return data.name;
        }
        return "Rider";
    } catch (err) { return "Rider"; }
}

// --- ၂။ Helper: Create Detailed Telegram Message ---
const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
    const pAddr = order.pickup?.address || "မသိရပါ";
    const dAddr = order.dropoff?.address || "မသိရပါ";

    let msg = `${title}\n`;
    if (statusText) msg += `📊 Status: <b>${statusText}</b>\n`;
    msg += `--------------------------\n` +
           `📝 ပစ္စည်း: <b>${order.item}</b>\n` +
           `⚖️ အလေးချိန်: <b>${order.weight || "0"} kg</b>\n` +
           `💰 ပစ္စည်းတန်ဖိုး: <b>${order.itemValue || "0"} KS</b>\n` +
           `💵 ပို့ခ: <b>${order.deliveryFee?.toLocaleString()} KS</b>\n` +
           `💳 Payment: <b>${order.paymentMethod || "CASH"}</b>\n` +
           `📞 ဖုန်း: <b>${order.phone}</b>\n` +
           `👤 Customer: <b>${order.customerName || "အမည်မသိသူ"}</b>\n` +
           `--------------------------\n` +
           `📍 ယူရန်: <b>${pAddr}</b>\n` +
           `🏁 ပို့ရန်: <b>${dAddr}</b>\n` +
           `--------------------------\n` +
           `🚴 Rider: <b>${currentRiderName}</b>`;
    return msg;
};

// --- ၃။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = {}; 

// --- ၄။ Live Location Tracking ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
            try {
                const riderName = await getRiderName(); 
                await setDoc(doc(db, "active_riders", auth.currentUser.uid), {
                    name: riderName, lat: pos.coords.latitude, lng: pos.coords.longitude, lastSeen: serverTimestamp()
                }, { merge: true });
            } catch (err) { console.error(err); }
        }
    }, null, { enableHighAccuracy: true });
}

// --- ၅။ Order Tracking Logic ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // အော်ဒါသစ်များကို စောင့်ကြည့်ခြင်း
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "in", ["accepted", "on_the_way", "arrived"])));
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

                // HTML Design နှင့် ကိုက်ညီအောင် ရေးသားထားသော Card
                const card = document.createElement('div');
                card.className = 'order-card';
                card.innerHTML = `
                    <div class="order-header">
                        <div class="item-info">📦 <b>${order.item}</b></div>
                        <div class="fee-tag">${order.deliveryFee?.toLocaleString()} KS</div>
                    </div>
                    <div class="address-box pickup-box">
                        <div class="icon-box">📍</div>
                        <div class="addr-text">
                            <span class="addr-label">ယူရန် (Pickup)</span>
                            <span class="addr-detail">${order.pickup?.address || "မသိရပါ"}</span>
                        </div>
                    </div>
                    <div class="address-box dropoff-box">
                        <div class="icon-box">🏁</div>
                        <div class="addr-text">
                            <span class="addr-label">ပို့ရန် (Drop-off)</span>
                            <span class="addr-detail">${order.dropoff?.address || "မသိရပါ"}</span>
                        </div>
                    </div>
                    <div style="font-size:0.8rem; margin:15px 0; color:#aaa; display:flex; gap:10px;">
                        <span>👤 ${order.customerName || "User"}</span> | <span>⚖️ ${order.weight || "0"}kg</span> | <span>📞 ${order.phone}</span>
                    </div>
                    <div class="btn-group">
                        <button class="action-btn btn-accept" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">
                            <i>⚡</i> ချက်ချင်းယူမည်
                        </button>
                        <button class="action-btn btn-later" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'tomorrow')">
                            <i>⏳</i> မနက်ဖြန်မှ
                        </button>
                    </div>`;
                container.appendChild(card);
            });
            if (!snap.empty && !isFull) alarmSound.play().catch(e => {});
        }
    });

    // လက်ခံထားသော အော်ဒါများကို စောင့်ကြည့်ခြင်း
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        if(list) list.innerHTML = "";
        let hasActive = false;

        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            const id = orderDoc.id;

            if (["accepted", "on_the_way", "arrived"].includes(data.status)) {
                hasActive = true;
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way", btnColor = "var(--info)";
                if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိပါပြီ", nextStatus = "arrived", btnColor = "var(--info)"; }
                if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီးပြီ", nextStatus = "completed", btnColor = "var(--success)"; }

                const div = document.createElement('div');
                div.className = 'active-order-card';
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                        <b style="color:var(--primary);"># ${data.status.toUpperCase()}</b>
                        <span style="color:var(--danger); font-size:0.75rem; font-weight:bold; cursor:pointer;" onclick="cancelByRider('${id}')">❌ ငြင်းပယ်မည်</span>
                    </div>
                    <div class="address-box pickup-box">
                        <div class="addr-text">
                            <span class="addr-label">ယူရန်</span>
                            <span class="addr-detail">${data.pickup?.address || "မသိရပါ"}</span>
                        </div>
                    </div>
                    <div class="address-box dropoff-box">
                        <div class="addr-text">
                            <span class="addr-label">ပို့ရန်</span>
                            <span class="addr-detail">${data.dropoff?.address || "မသိရပါ"}</span>
                        </div>
                    </div>
                    <div class="btn-group" style="grid-template-columns: 1fr;">
                         <button class="action-btn" style="background:var(--primary); color:#000; margin-bottom:8px;" onclick="window.location.href='tel:${data.phone}'">📞 ဖုန်းခေါ်ဆိုရန်</button>
                         <button class="action-btn" style="background:${btnColor}; color:#fff;" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
                    </div>`;
                list.appendChild(div);
            }
        });
        if(!hasActive && list) list.innerHTML = "<div class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိသေးပါ</div>";
    });
}

// --- ၆။ Rider Functions ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
        const riderName = await getRiderName();

        if(time === 'tomorrow') {
            await updateDoc(docRef, { status: "pending_confirmation", pickupSchedule: "tomorrow", tempRiderId: auth.currentUser.uid, tempRiderName: riderName });
            await notifyTelegram(createOrderMessage("⏳ <b>Rider Scheduled!</b>", order, riderName, "မနက်ဖြန်မှလာယူပါမည်"));
            Swal.fire({ title: 'အောင်မြင်သည်!', text: 'မနက်ဖြန်မှ လာယူမည်ဖြစ်ကြောင်း အသိပေးလိုက်ပါပြီ။', icon: 'success', background: '#1a1a1a', color: '#fff' });
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
        const riderName = await getRiderName();
        await updateDoc(docRef, { status: status });
        const statusText = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        await notifyTelegram(createOrderMessage("🚀 <b>Status Update!</b>", order, riderName, statusText));
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    const result = await Swal.fire({ title: 'ပို့ဆောင်မှု ပြီးဆုံးပြီလား?', icon: 'question', showCancelButton: true, confirmButtonColor: '#2ed573', confirmButtonText: 'ပြီးပါပြီ', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try {
            const docRef = doc(db, "orders", id);
            const order = (await getDoc(docRef)).data();
            const riderName = await getRiderName();
            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, status: "COMPLETED" }) });
            await notifyTelegram(createOrderMessage("💰 <b>Order Completed!</b>", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ"));
            Swal.fire({ title: 'အောင်မြင်ပါသည်!', icon: 'success', background: '#1a1a1a', color: '#fff' });
        } catch (err) { console.error(err); }
    }
};

window.cancelByRider = async (id) => {
    const result = await Swal.fire({ title: 'သေချာပါသလား?', text: 'အော်ဒါကို ငြင်းပယ်ပါမည်။', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ffcc00', confirmButtonText: 'ငြင်းပယ်မည်', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try {
            const docRef = doc(db, "orders", id);
            const order = (await getDoc(docRef)).data();
            const riderName = await getRiderName();
            await updateDoc(docRef, { status: "pending", riderId: null, riderName: null, lastRejectedRiderId: auth.currentUser.uid });
            await notifyTelegram(createOrderMessage("❌ <b>Rider Rejected Order!</b>", order, riderName, "Rider က အော်ဒါကို ငြင်းပယ်လိုက်ပါပြီ"));
        } catch (err) { console.error(err); }
    }
};

async function getRiderName() {
    if (!auth.currentUser) return "Rider";
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

