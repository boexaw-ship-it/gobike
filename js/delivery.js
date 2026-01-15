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

// --- ၁။ Auth & Profile & Logout Logic ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("Rider Logged In:", user.uid);
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
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout Error:", error);
            Swal.fire({ title: 'Error!', text: 'Logout လုပ်၍ မရပါ။', icon: 'error', background: '#1a1a1a', color: '#fff' });
        }
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
        } else {
            if (nameDisplay) nameDisplay.innerText = "Rider (No Name)";
            return "Rider";
        }
    } catch (err) {
        console.error("Error fetching rider data:", err);
        return "Rider";
    }
}

// --- ၂။ Helper: Create Detailed Telegram Message ---
const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
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
           `🚴 Rider: <b>${currentRiderName}</b>\n` +
           `📍 ယူရန်: ${order.pickup?.address || order.pickupAddress || "မသိရပါ"}\n` +
           `🏁 ပို့ရန်: ${order.dropoff?.address || order.dropoffAddress || "မသိရပါ"}`;
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
                    name: riderName,
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude, 
                    lastSeen: serverTimestamp()
                }, { merge: true });
            } catch (err) { console.error(err); }
        }
    }, (err) => console.error(err), { enableHighAccuracy: true });
}

// --- ၅။ Order စောင့်ကြည့်ခြင်း ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // (က) Available Orders (အော်ဒါသစ်များ)
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

                const pAddr = order.pickup?.address || order.pickupAddress || "မသိရပါ";
                const dAddr = order.dropoff?.address || order.dropoffAddress || "မသိရပါ";

                const card = document.createElement('div');
                card.className = 'order-card';
                card.innerHTML = `
                    <div class="item-info">
                        <b class="item-name">📦 ${order.item}</b>
                        <span class="price">${order.deliveryFee?.toLocaleString()} KS</span>
                    </div>
                    <div class="address-section" style="margin: 10px 0; padding: 10px; background: #222; border-radius: 8px; font-size: 0.9rem;">
                        <div style="margin-bottom: 5px;"><b style="color:var(--primary);">📍 ယူရန်:</b> <span style="color:#fff;">${pAddr}</span></div>
                        <div><b style="color:#ff4444;">🏁 ပို့ရန်:</b> <span style="color:#fff;">${dAddr}</span></div>
                    </div>
                    <div class="order-details">
                        <b>👤 CUSTOMER:</b> ${order.customerName || "အမည်မသိသူ"}<br>
                        <b>⚖️ အလေးချိန်:</b> ${order.weight || "0"} kg | <b>💰 တန်ဖိုး:</b> ${order.itemValue || order.itemPrice || "0"} KS<br>
                        <b>💳 PAYMENT:</b> <span style="color:#00ff00;">${order.paymentMethod || "CASH"}</span><br>
                        <b>📞 ဖုန်း:</b> <span style="color:#00ff00;">${order.phone}</span>
                    </div>
                    <div class="btn-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                        <button class="btn btn-complete" style="background:var(--primary); color:#000;" onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                        <button class="btn btn-arrive" style="background:#444; color:white;" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                    </div>`;
                container.appendChild(card);
            });
            if (!snap.empty && !isFull) alarmSound.play().catch(e => {});
        }
    });

    // (ခ) My Active Orders (မိမိလက်ခံထားသော အော်ဒါများ)
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
                    <button class="btn-dismiss" onclick="dismissOrder('${id}')">ဖယ်ထုတ်မည်</button>
                `;
                rejectedSection.appendChild(rejCard);
                return;
            }

            if (["accepted", "on_the_way", "arrived"].includes(data.status)) {
                hasActive = true;
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way", icon = "📦";
                if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived", icon = "🚴"; }
                if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး (Complete)", nextStatus = "completed", icon = "🏁"; }

                const pAddr = data.pickup?.address || data.pickupAddress || "မသိရပါ";
                const dAddr = data.dropoff?.address || data.dropoffAddress || "မသိရပါ";

                const div = document.createElement('div');
                div.className = 'active-order-card';
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <b>${icon} ${data.status.toUpperCase()}</b>
                        <span style="color:#ff4444; font-size:0.8rem; cursor:pointer;" onclick="cancelByRider('${id}')">✖ မယူတော့ပါ</span>
                    </div>
                    <div class="order-details" style="margin: 8px 0;">
                        <b>📦 ${data.item}</b><br>
                        📍 <b>ယူရန်:</b> ${pAddr}<br>
                        🏁 <b>ပို့ရန်:</b> ${dAddr}<br>
                        📞 <b>ဖုန်း:</b> <a href="tel:${data.phone}" style="color:var(--primary);">${data.phone}</a> | 💰 <b>ပို့ခ:</b> ${data.deliveryFee} KS
                    </div>
                    <button class="btn-status" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
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
            await notifyTelegram(createOrderMessage("⏳ <b>Rider Scheduled!</b>", order, riderName, "မနက်ဖြန်မှလာယူပါမည်"));
            
            Swal.fire({
                title: 'အောင်မြင်သည်!',
                text: 'မနက်ဖြန်မှ လာယူမည့်အကြောင်း Customer ဆီ ပို့လိုက်ပါပြီ။',
                icon: 'success',
                confirmButtonColor: '#ffcc00',
                background: '#1a1a1a',
                color: '#fff'
            });
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
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
        const riderName = await getRiderName();

        await updateDoc(docRef, { status: status });
        const statusText = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        await notifyTelegram(createOrderMessage("🚀 <b>Status Update!</b>", order, riderName, statusText));
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    const result = await Swal.fire({
        title: 'ပို့ဆောင်မှု ပြီးဆုံးပြီလား?',
        text: "ဤအော်ဒါကို အောင်မြင်စွာ ပို့ဆောင်ပြီးကြောင်း အတည်ပြုပါမည်။",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#2ed573',
        cancelButtonColor: '#444',
        confirmButtonText: 'ဟုတ်ကဲ့၊ ပြီးပါပြီ',
        background: '#1a1a1a',
        color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            const docRef = doc(db, "orders", id);
            const orderSnap = await getDoc(docRef);
            const order = orderSnap.data();
            const riderName = await getRiderName();

            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, status: "COMPLETED" }) });
            await notifyTelegram(createOrderMessage("💰 <b>Order Completed!</b>", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ"));
            
            await Swal.fire({
                title: 'အောင်မြင်ပါသည်!',
                text: 'လူကြီးမင်း၏ ပါဆယ်ပို့ဆောင်မှု အောင်မြင်ပြီးဆုံးပါပြီ။',
                icon: 'success',
                confirmButtonColor: '#ffcc00',
                background: '#1a1a1a',
                color: '#fff'
            });
        } catch (err) { console.error(err); }
    }
};

window.cancelByRider = async (id) => {
    const result = await Swal.fire({
        title: 'သေချာပါသလား?',
        text: "ဤအော်ဒါကို ငြင်းပယ်ပါမည်။ Customer ထံသို့ 'Rejected' ပြပေးမည်ဖြစ်ပါသည်။",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ffcc00',
        cancelButtonColor: '#ff4444',
        confirmButtonText: 'ငြင်းပယ်မည်',
        cancelButtonText: 'မလုပ်တော့ပါ',
        background: '#1a1a1a',
        color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            const docRef = doc(db, "orders", id);
            const orderSnap = await getDoc(docRef);
            const order = orderSnap.data();
            const riderName = await getRiderName();

            await updateDoc(docRef, {
                status: "rider_rejected", 
                riderId: null, 
                riderName: null, 
                pickupSchedule: null,
                lastRejectedRiderId: auth.currentUser.uid 
            });
            await notifyTelegram(createOrderMessage("❌ <b>Rider Rejected Order!</b>", order, riderName, "Rider က အော်ဒါကို ငြင်းပယ်လိုက်ပါပြီ"));
            
            Swal.fire({ title: 'ငြင်းပယ်ပြီးပါပြီ', icon: 'info', background: '#1a1a1a', color: '#fff' });
        } catch (err) { console.error(err); }
    }
};

async function getRiderName() {
    if (!auth.currentUser) return "Rider";
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

window.dismissOrder = async (id) => {
    try { await updateDoc(doc(db, "orders", id), { riderId: "dismissed" }); } 
    catch (err) { console.error(err); }
};

