import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၀။ Alarm Sound Setup ---
const alarmSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
let isSoundAllowed = false;
const soundBtn = document.createElement('button');
soundBtn.innerHTML = "🔔 အသံဖွင့်ရန်";
soundBtn.style = "position:fixed; bottom:85px; right:20px; z-index:3000; padding:10px 18px; background:#ffcc00; color:#000; border:2px solid #1a1a1a; border-radius:50px; font-weight:bold; cursor:pointer;";
document.body.appendChild(soundBtn);
soundBtn.onclick = () => { isSoundAllowed = true; alarmSound.play().then(() => { soundBtn.style.display = 'none'; }).catch(e => {}); };

// --- ၁။ Map Fix ---
let map;
function initMap() {
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.style.height = "250px"; 
        map = L.map('map').setView([16.8661, 96.1951], 12); 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);
    }
}

// --- ၂။ Auth & Profile ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        initMap();
        await getRiderData(); 
        startTracking(); 
    } else {
        window.location.href = "../index.html";
    }
});

async function getRiderData() {
    if (!auth.currentUser) return;
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    if (snap.exists()) {
        const data = snap.data();
        document.getElementById('display-name').innerText = data.name;
        document.getElementById('display-role').innerText = data.role || "Rider";
    }
}

// --- ၃။ Main Logic ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // (A) Live Location Update
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(async (pos) => {
            const name = await getRiderName();
            await setDoc(doc(db, "active_riders", myUid), {
                name, lat: pos.coords.latitude, lng: pos.coords.longitude, lastSeen: serverTimestamp()
            }, { merge: true });
        }, null, { enableHighAccuracy: true });
    }

    // (B) Available Orders - 🎯 ဒီမှာ ပြင်ဆင်ထားပါတယ်
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const container = document.getElementById('available-orders');
        if(!container) return;

        container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (d.lastRejectedRiderId === myUid || d.tempRiderId === myUid || d.pickupSchedule === "tomorrow") return;
            const id = orderDoc.id;
            const card = document.createElement('div');
            card.className = 'order-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <b style="font-size:1.1rem; color:#fff;">📦 ${d.item} (${d.weight || 0}kg)</b>
                    <div style="text-align:right;">
                        <b style="color:#ffcc00; font-size:1.1rem; display:block;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                    </div>
                </div>
                <div style="font-size:0.85rem; color:#aaa; margin:10px 0;">
                    📍 <b>ယူရန်:</b> ${d.pickup?.address || d.pickupAddress}<br>
                    🏁 <b>ပို့ရန်:</b> ${d.dropoff?.address || d.dropoffAddress}
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn-accept" style="flex:2; background:#ffcc00; border:none; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer;" onclick="handleDirectAccept('${id}')">လက်ခံမည် (History သို့တန်းပို့မည်)</button>
                    <button class="btn-accept" style="flex:1; background:#333; color:#fff; border:none; padding:10px; border-radius:5px; cursor:pointer;" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်</button>
                </div>`;
            container.appendChild(card);
        });
        if (!snap.empty && isSoundAllowed) alarmSound.play().catch(e => {});
    });

    // (C) Active Tasks - မနက်ဖြန်အော်ဒါကို ယနေ့အဖြစ်ပြောင်းမှသာ ဒီထဲပေါ်မည်
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        if(!list) return;
        list.innerHTML = "";
        let count = 0;
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (["accepted", "on_the_way", "arrived"].includes(d.status) && d.pickupSchedule !== "tomorrow") {
                count++;
                const id = orderDoc.id;
                const div = document.createElement('div');
                div.className = 'order-card';
                div.style = "border-left: 5px solid #ffcc00; background:#1a1a1a; padding:15px; margin-bottom:12px; border-radius:10px;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <b style="color:#fff;">📦 ${d.item}</b>
                        <span style="color:#ff4444; cursor:pointer; font-weight:bold;" onclick="cancelByRider('${id}')">✖ Cancel</span>
                    </div>
                    <button style="width:100%; margin-top:10px; padding:12px; background:#ffcc00; border:none; border-radius:5px; font-weight:bold; cursor:pointer;" onclick="completeOrder('${id}')">✅ ပစ္စည်းအပ်နှံပြီး (History သို့ပို့မည်)</button>`;
                list.appendChild(div);
            }
        });
        if(count === 0) list.innerHTML = "<div class='empty-msg'>လက်ရှိလုပ်ဆောင်နေသော အော်ဒါမရှိပါ</div>";
    });

    // (D) Tomorrow Section - အရင်အတိုင်းမပျက်ပါ
    onSnapshot(query(collection(db, "orders"), where("pickupSchedule", "==", "tomorrow")), (snap) => {
        const tomList = document.getElementById('tomorrow-orders-list');
        if(!tomList) return;
        tomList.innerHTML = "";
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.tempRiderId === myUid || d.riderId === myUid) {
                if (d.riderDismissedTomorrow === myUid) return;
                const id = docSnap.id;
                const isConfirmed = d.status === "accepted";
                const div = document.createElement('div');
                div.className = 'order-card';
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:#3498db; font-weight:bold; font-size:0.85rem;">📅 TOMORROW</span>
                        <button onclick="dismissTomorrowOrder('${id}')" style="background:#444; color:#fff; border:none; padding:3px 8px; border-radius:4px; cursor:pointer;">✖</button>
                    </div>
                    <div style="margin:10px 0; color:#eee;">📦 ${d.item} | 💰 ${d.deliveryFee.toLocaleString()} KS</div>
                    <button onclick="startTomorrowOrder('${id}')" style="width:100%; padding:12px; background:#2ed573; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" ${!isConfirmed ? 'disabled' : ''}>
                        ${isConfirmed ? '🚀 ယနေ့အတွက် စတင်မည်' : 'Customer အတည်ပြုရန်စောင့်ပါ'}
                    </button>`;
                tomList.appendChild(div);
            }
        });
    });

    // (E) History Section - "လက်ခံသည်" နှိပ်သမျှ အကုန်ဒီထဲတန်းရောက်မည်
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "==", "completed")), (snap) => {
        const historyList = document.getElementById('history-orders-list');
        if(!historyList) return;
        historyList.innerHTML = snap.empty ? "<div class='empty-msg'>မှတ်တမ်းမရှိသေးပါ</div>" : "";
        snap.forEach(docSnap => {
            const h = docSnap.data();
            const div = document.createElement('div');
            div.className = 'history-card';
            div.style = "background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:10px; position:relative; border-left:4px solid #00ff00;";
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <span style="color:#fff; font-weight:bold;">✅ ${h.item}</span>
                    <span style="color:#00ff00; font-weight:bold;">+${h.deliveryFee?.toLocaleString()} KS</span>
                </div>
                <small style="color:#666;">📅 ${h.completedAt?.toDate().toLocaleString() || 'ခုနက'}</small>
                <div style="margin-top:8px; display:flex; gap:15px;">
                    <button onclick="deleteOrderPermanently('${docSnap.id}')" style="background:none; border:none; color:#ff4444; font-size:0.75rem; cursor:pointer;">✖ အပြီးဖျက်မည်</button>
                    <button onclick="dismissHistory('${docSnap.id}')" style="background:none; border:none; color:#666; font-size:0.75rem; cursor:pointer;">🚫 ဖယ်ထုတ်ရုံ</button>
                </div>`;
            historyList.appendChild(div);
        });
    });
}

// --- Action Functions ---

// 🎯 အဓိကပြင်ဆင်ချက်: လက်ခံတာနဲ့ History ထဲတန်းပို့တဲ့ Function
window.handleDirectAccept = async (id) => {
    const result = await Swal.fire({ title: 'လက်ခံမှာလား?', text: "လက်ခံပြီးပါက History ထဲသို့ တန်းရောက်သွားပါမည်။", icon: 'question', showCancelButton: true, confirmButtonText: 'ဟုတ်ကဲ့', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try {
            const riderName = await getRiderName();
            const docRef = doc(db, "orders", id);
            const orderSnap = await getDoc(docRef);
            const orderData = orderSnap.data();

            await updateDoc(docRef, { 
                status: "completed", 
                riderId: auth.currentUser.uid, 
                riderName: riderName, 
                completedAt: serverTimestamp(),
                pickupSchedule: "now" 
            });

            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName, status: "COMPLETED" }) });
            await notifyTelegram(createOrderMessage("💰 Order Direct Accepted", orderData, riderName, "Rider လက်ခံပြီး History ထဲသို့ တန်းထည့်သွင်းလိုက်ပါပြီ"));
        } catch (err) { console.error(err); }
    }
};

window.deleteOrderPermanently = async (id) => {
    const result = await Swal.fire({ title: 'အပြီးဖျက်မှာလား?', text: "Database ထဲမှပါ အပြီးအပိုင် ပျက်သွားပါမည်။", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ff4444', confirmButtonText: 'ဖျက်မည်', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try { await deleteDoc(doc(db, "orders", id)); } catch (err) { console.error(err); }
    }
};

window.handleAccept = async (id, time) => {
    try {
        const riderName = await getRiderName();
        if(time === 'tomorrow') {
            await updateDoc(doc(db, "orders", id), { status: "pending_confirmation", tempRiderId: auth.currentUser.uid, tempRiderName: riderName, pickupSchedule: "tomorrow", riderDismissedTomorrow: null });
        }
    } catch (err) { console.error(err); }
};

window.startTomorrowOrder = async (id) => {
    await updateDoc(doc(db, "orders", id), { status: "accepted", pickupSchedule: "now", acceptedAt: serverTimestamp() });
};

window.completeOrder = async (id) => {
    await updateDoc(doc(db, "orders", id), { status: "completed", completedAt: serverTimestamp() });
};

window.cancelByRider = async (id) => {
    await updateDoc(doc(db, "orders", id), { status: "rider_rejected", riderId: null, lastRejectedRiderId: auth.currentUser.uid });
};

window.dismissHistory = async (id) => {
    await updateDoc(doc(db, "orders", id), { riderId: "dismissed_" + auth.currentUser.uid });
};

window.dismissTomorrowOrder = async (id) => {
    await updateDoc(doc(db, "orders", id), { riderDismissedTomorrow: auth.currentUser.uid });
};

async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
    return `${title}\n📊 Status: <b>${statusText}</b>\n--------------------------\n📝 ပစ္စည်း: <b>${order.item}</b>\n💵 ပို့ခ: <b>${(order.deliveryFee || 0).toLocaleString()} KS</b>\n🚴 Rider: <b>${currentRiderName}</b>`;
};

window.handleLogout = async () => { try { await signOut(auth); } catch (e) { console.error(e); } };
