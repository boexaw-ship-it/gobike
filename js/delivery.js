import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

// --- ၁။ Auth & Profile ---
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

// --- ၂။ Telegram Message Helper ---
const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
    const pAddr = order.pickup?.address || order.pickupAddress || "မသိရပါ";
    const dAddr = order.dropoff?.address || order.dropoffAddress || "မသိရပါ";
    let msg = `${title}\n`;
    if (statusText) msg += `📊 Status: <b>${statusText}</b>\n`;
    msg += `--------------------------\n` +
           `📝 ပစ္စည်း: <b>${order.item}</b>\n` +
           `⚖️ အလေးချိန်: <b>${order.weight || "0"} kg</b>\n` +
           `💵 ပို့ခ: <b>${order.deliveryFee?.toLocaleString()} KS</b>\n` +
           `📞 ဖုန်း: <b>${order.phone}</b>\n` +
           `📍 ယူရန်: ${pAddr}\n` +
           `🏁 ပို့ရန်: ${dAddr}\n` +
           `--------------------------\n` +
           `🚴 Rider: <b>${currentRiderName}</b>`;
    return msg;
};

// --- ၃။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = {}; 

// --- ၄။ Live Location ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
            try {
                const name = await getRiderName();
                await setDoc(doc(db, "active_riders", auth.currentUser.uid), {
                    name, lat: pos.coords.latitude, lng: pos.coords.longitude, lastSeen: serverTimestamp()
                }, { merge: true });
            } catch (err) { console.error(err); }
        }
    }, null, { enableHighAccuracy: true });
}

// --- ၅။ Main Tracking Logic ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // --- (A) Available Orders (အော်ဒါသစ်များ) ---
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "in", ["accepted", "on_the_way", "arrived"])));
        const isFull = activeSnap.size >= 7;
        
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

                const pAddr = order.pickup?.address || order.pickupAddress || "လိပ်စာမရှိပါ";
                const dAddr = order.dropoff?.address || order.dropoffAddress || "လိပ်စာမရှိပါ";

                const card = document.createElement('div');
                card.className = 'order-card';
                card.innerHTML = `
                    <div class="item-info">
                        <b class="item-name">📦 ${order.item}</b>
                        <span class="price">${order.deliveryFee?.toLocaleString()} KS</span>
                    </div>
                    <div style="background:#1a1a1a; padding:12px; border-radius:10px; margin:12px 0; border:1px solid #333; border-left:4px solid #ffcc00;">
                        <div style="margin-bottom:8px;">
                            <b style="color:#ffcc00; font-size:0.75rem;">📍 PICKUP (ယူရန်)</b><br>
                            <span style="color:#ffffff; font-size:0.95rem; line-height:1.4; display:block; margin-top:2px;">${pAddr}</span>
                        </div>
                        <div>
                            <b style="color:#3498db; font-size:0.75rem;">🏁 DROPOFF (ပို့ရန်)</b><br>
                            <span style="color:#ffffff; font-size:0.95rem; line-height:1.4; display:block; margin-top:2px;">${dAddr}</span>
                        </div>
                    </div>
                    <div class="order-details">
                        <b>👤 CUSTOMER:</b> ${order.customerName || "User"}<br>
                        <b>⚖️ WEIGHT:</b> ${order.weight || "0"} kg | <b>📞 PHONE:</b> ${order.phone}
                    </div>
                    <div class="btn-group" style="display:flex; gap:10px; margin-top:10px;">
                        <button class="btn-accept-now" style="flex:1; padding:12px; background:#ffcc00; border:none; border-radius:8px; font-weight:bold; color:#000;" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                        <button class="btn-accept-tmr" style="flex:1; padding:12px; background:#444; color:#fff; border:none; border-radius:8px;" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                    </div>`;
                container.appendChild(card);
            });
            if (!snap.empty && !isFull) alarmSound.play().catch(e => {});
        }
    });

    // --- (B) Active Orders (လက်ခံထားသော အော်ဒါများ) ---
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
                rejCard.innerHTML = `⚠️ Customer ဖျက်လိုက်ပါပြီ <button onclick="dismissOrder('${id}')">ဖယ်ထုတ်မည်</button>`;
                rejectedSection.appendChild(rejCard);
                return;
            }

            if (["accepted", "on_the_way", "arrived"].includes(data.status)) {
                hasActive = true;
                const pAddr = data.pickup?.address || data.pickupAddress || "မသိရပါ";
                const dAddr = data.dropoff?.address || data.dropoffAddress || "မသိရပါ";
                
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way";
                if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived"; }
                if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး", nextStatus = "completed"; }

                const div = document.createElement('div');
                div.className = 'active-order-card';
                div.style = "border-left: 5px solid #ffcc00; padding:15px; background:#1a1a1a; margin-bottom:12px; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,0.3); color:#fff;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:12px; border-bottom:1px solid #333; padding-bottom:8px;">
                        <span style="color:#ffcc00;">STATUS: ${data.status.toUpperCase()}</span>
                        <span style="color:#ff4444; font-size:0.8rem; cursor:pointer;" onclick="cancelByRider('${id}')">✖ ပယ်ဖျက်</span>
                    </div>
                    <div style="font-size:0.95rem; line-height:1.6;">
                        <b style="font-size:1.1rem; color:#fff;">📦 ${data.item}</b><br>
                        <div style="margin:10px 0; background:#222; padding:10px; border-radius:8px;">
                             <b style="color:#ffcc00; font-size:0.8rem;">📍 FROM:</b> <span style="color:#fff;">${pAddr}</span><br>
                             <b style="color:#3498db; font-size:0.8rem;">🏁 TO:</b> <span style="color:#fff;">${dAddr}</span>
                        </div>
                        📞 <b>CALL:</b> <a href="tel:${data.phone}" style="color:#00ff00; text-decoration:none; font-weight:bold;">${data.phone}</a>
                    </div>
                    <button style="width:100%; margin-top:15px; padding:14px; background:#ffcc00; color:#000; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
                `;
                list.appendChild(div);
            }
        });
        if(!hasActive && list) list.innerHTML = "<div class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိသေးပါ</div>";
    });
}

// --- ၆။ Functions ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
        const riderName = await getRiderName();

        if(time === 'tomorrow') {
            await updateDoc(docRef, { status: "pending_confirmation", pickupSchedule: "tomorrow", tempRiderId: auth.currentUser.uid, tempRiderName: riderName });
            await notifyTelegram(createOrderMessage("⏳ Rider Scheduled!", order, riderName, "မနက်ဖြန်မှလာယူပါမည်"));
            Swal.fire({ title: 'အောင်မြင်သည်!', text: 'Customer ဆီ အကြောင်းကြားလိုက်ပါပြီ။', icon: 'success', background: '#1a1a1a', color: '#fff' });
        } else {
            await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp() });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName, status: "Accepted" }) });
            await notifyTelegram(createOrderMessage("✅ Order Accepted!", order, riderName, "Rider လက်ခံလိုက်ပါပြီ"));
        }
    } catch (err) { console.error(err); }
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();
        await updateDoc(docRef, { status });
        const text = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        await notifyTelegram(createOrderMessage("🚀 Status Update!", order, riderName, text));
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    const result = await Swal.fire({ title: 'ပြီးဆုံးပြီလား?', text: "ပို့ဆောင်ခ ရရှိပြီးပြီလား?", icon: 'question', showCancelButton: true, confirmButtonText: 'ဟုတ်ကဲ့', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try {
            const docRef = doc(db, "orders", id);
            const order = (await getDoc(docRef)).data();
            const riderName = await getRiderName();
            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, status: "COMPLETED" }) });
            await notifyTelegram(createOrderMessage("💰 Order Completed!", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ"));
            Swal.fire({ title: 'အောင်မြင်ပါသည်!', icon: 'success', background: '#1a1a1a', color: '#fff' });
        } catch (err) { console.error(err); }
    }
};

window.cancelByRider = async (id) => {
    const result = await Swal.fire({ title: 'သေချာပါသလား?', text: "အော်ဒါကို ငြင်းပယ်ပါမည်။", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ffcc00', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try {
            const docRef = doc(db, "orders", id);
            const order = (await getDoc(docRef)).data();
            const name = await getRiderName();
            await updateDoc(docRef, { status: "rider_rejected", riderId: null, riderName: null, lastRejectedRiderId: auth.currentUser.uid });
            await notifyTelegram(createOrderMessage("❌ Rider Rejected!", order, name, "Rider က ငြင်းပယ်လိုက်ပါပြီ"));
        } catch (err) { console.error(err); }
    }
};

async function getRiderName() {
    if (!auth.currentUser) return "Rider";
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

window.dismissOrder = async (id) => {
    try { await updateDoc(doc(db, "orders", id), { riderId: "dismissed" }); } catch (err) { console.error(err); }
};
