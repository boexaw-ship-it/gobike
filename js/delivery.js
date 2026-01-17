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
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
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

    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(async (pos) => {
            const name = await getRiderName();
            await setDoc(doc(db, "active_riders", myUid), {
                name, lat: pos.coords.latitude, lng: pos.coords.longitude, lastSeen: serverTimestamp()
            }, { merge: true });
        }, null, { enableHighAccuracy: true });
    }

    // (A) Available Orders - ဖုန်းနံပါတ် လုံးဝမပြပါ
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const container = document.getElementById('available-orders');
        if(!container) return;
        
        container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (d.lastRejectedRiderId === myUid || d.tempRiderId === myUid || d.pickupSchedule === "tomorrow") return;
            
            const pFull = d.pickup ? `${d.pickup.township}၊ ${d.pickup.address}` : (d.pickupAddress || "-");
            const dFull = d.dropoff ? `${d.dropoff.township}၊ ${d.dropoff.address}` : (d.dropoffAddress || "-");

            const card = document.createElement('div');
            card.className = 'order-card';
            card.style = "background:#1a1a1a; border:1px solid #333; padding:15px; border-radius:12px; margin-bottom:15px; color:#fff;";
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <b style="font-size:1.1rem; color:#ffcc00;">📦 ${d.item} (${d.weight || 0}kg)</b>
                    <b style="color:#00ff00;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                </div>
                <div style="font-size:0.85rem; color:#aaa; margin:10px 0; line-height:1.5;">
                    <div><b style="color:#ff4444;">📍 Pickup:</b> ${pFull}</div>
                    <div><b style="color:#2ed573;">🏁 Dropoff:</b> ${dFull}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <button style="flex:2; background:#ffcc00; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;" onclick="handleAccept('${orderDoc.id}', 'now')">လက်ခံမည်</button>
                    <button style="flex:1; background:#333; color:#fff; border:none; padding:12px; border-radius:8px; cursor:pointer;" onclick="handleAccept('${orderDoc.id}', 'tomorrow')">မနက်ဖြန်</button>
                </div>`;
            container.appendChild(card);
        });
        if (!snap.empty && isSoundAllowed) alarmSound.play().catch(e => {});
    });

    // (B) Active Tasks List - ဖုန်းခေါ်ဆိုရန် နှင့် အချက်အလက်စုံလင်စွာပြသခြင်း
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        const activeCountDisplay = document.getElementById('active-count');
        let activeCount = 0;
        if(!list) return;
        list.innerHTML = "";
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (["accepted", "on_the_way", "arrived"].includes(d.status) && d.pickupSchedule !== "tomorrow") {
                activeCount++;
                const id = orderDoc.id;
                const pFull = d.pickup ? `${d.pickup.township}၊ ${d.pickup.address}` : (d.pickupAddress || "-");
                const dFull = d.dropoff ? `${d.dropoff.township}၊ ${d.dropoff.address}` : (d.dropoffAddress || "-");
                
                const div = document.createElement('div');
                div.className = 'order-card';
                div.style = "background:#1a1a1a; padding:15px; margin-bottom:12px; border-radius:10px; border-left:5px solid #ffcc00;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <b style="color:#fff;">📦 ${d.item}</b>
                        <a href="tel:${d.phone}" style="text-decoration:none; background:#2ed573; color:white; padding:6px 12px; border-radius:6px; font-size:0.85rem; font-weight:bold;">📞 Call</a>
                    </div>
                    <div style="font-size:0.85rem; color:#ccc; margin-bottom:12px; line-height:1.4;">
                        <div><b style="color:#ff4444;">📍 ယူရန်:</b> ${pFull}</div>
                        <div><b style="color:#2ed573;">🏁 ပို့ရန်:</b> ${dFull}</div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button style="flex:3; padding:12px; background:#ffcc00; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" onclick="window.location.href='rider-track.html?id=${id}'">မြေပုံကြည့်ရန်</button>
                        <button style="flex:1; background:#333; color:#ff4444; border:1px solid #ff4444; border-radius:8px; cursor:pointer;" onclick="rejectActiveOrder('${id}')">Reject</button>
                    </div>`;
                list.appendChild(div);
            }
        });
        if(activeCountDisplay) activeCountDisplay.innerText = `${activeCount} / 7`;
        if(activeCount === 0) list.innerHTML = "<div class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိပါ</div>";
    });

    // (C) Tomorrow Section - အချက်အလက် အပြည့်အစုံပြသခြင်း
    onSnapshot(query(collection(db, "orders"), where("pickupSchedule", "==", "tomorrow")), (snap) => {
        const tomList = document.getElementById('tomorrow-orders-list');
        if(!tomList) return;
        tomList.innerHTML = "";
        let tomCount = 0;
        snap.forEach(docSnap => {
            const d = docSnap.data();
            const id = docSnap.id;
            if (d.riderDismissedTomorrow === myUid) return;
            if (d.tempRiderId === myUid || d.riderId === myUid) {
                tomCount++;
                const isConfirmed = d.status === "accepted";
                const pFull = d.pickup ? `${d.pickup.township}၊ ${d.pickup.address}` : (d.pickupAddress || "-");
                const dFull = d.dropoff ? `${d.dropoff.township}၊ ${d.dropoff.address}` : (d.dropoffAddress || "-");
                
                const div = document.createElement('div');
                div.className = 'order-card';
                div.style = `border-left: 5px solid ${isConfirmed ? '#2ed573' : '#3498db'}; background:#1a1a1a; padding:15px; margin-bottom:12px; border-radius:12px; color:#fff;`;
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <b style="color:#ffcc00;">📦 ${d.item} (မနက်ဖြန်)</b>
                        <button onclick="dismissTomorrowOrder('${id}')" style="background:none; border:none; color:#ff4444; cursor:pointer; font-size:1.2rem;">&times;</button>
                    </div>
                    <div style="font-size:0.85rem; margin-bottom:10px; background:#222; padding:10px; border-radius:8px; line-height:1.6;">
                        <div style="color:#00ff00;"><b>💵 ပို့ခ:</b> ${(d.deliveryFee || 0).toLocaleString()} KS</div>
                        <div style="color:#00e5ff;"><b>💰 တန်ဖိုး:</b> ${(d.itemValue || 0).toLocaleString()} KS</div>
                        <div style="color:#fff;"><b>📞 ဖုန်း:</b> <a href="tel:${d.phone}" style="color:#ffcc00; text-decoration:none;">${d.phone}</a></div>
                        <hr style="border:0.1px solid #333; margin:8px 0;">
                        <div style="color:#ff4444;"><b>📍 Pickup:</b> ${pFull}</div>
                        <div style="color:#2ed573;"><b>🏁 Dropoff:</b> ${dFull}</div>
                    </div>
                    <button onclick="startTomorrowOrder('${id}')" 
                        style="width:100%; padding:12px; background:${isConfirmed ? '#2ed573' : '#333'}; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer;"
                        ${!isConfirmed ? 'disabled' : ''}>
                        ${isConfirmed ? '🚀 ယနေ့အတွက် စတင်မည်' : 'အတည်ပြုချက်စောင့်ဆိုင်းဆဲ'}
                    </button>`;
                tomList.appendChild(div);
            }
        });
        if(tomCount === 0) tomList.innerHTML = "<div class='empty-msg'>မနက်ဖြန်အတွက် မရှိသေးပါ</div>";
    });

    // (D) History Section
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "==", "completed")), (snap) => {
        const historyList = document.getElementById('history-orders-list');
        const earningsDisplay = document.getElementById('total-earnings');
        let totalEarnings = 0;
        if(!historyList) return;
        historyList.innerHTML = snap.empty ? "<div class='empty-msg'>မှတ်တမ်းမရှိသေးပါ</div>" : "";
        snap.forEach(docSnap => {
            const h = docSnap.data();
            const id = docSnap.id;
            totalEarnings += (h.deliveryFee || 0);
            const div = document.createElement('div');
            div.className = 'history-card';
            div.style = "background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:10px; border-bottom:1px solid #333;";
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <b style="color:#fff;">✅ ${h.item}</b><br>
                        <small style="color:#666;">${h.completedAt?.toDate().toLocaleString() || ''}</small>
                    </div>
                    <div style="text-align:right;">
                        <b style="color:#00ff00;">+${(h.deliveryFee || 0).toLocaleString()} KS</b><br>
                        <div style="margin-top:5px;">
                            <button onclick="viewHistoryDetails('${id}')" style="background:#333; color:#fff; border:none; padding:4px 10px; border-radius:4px; font-size:0.75rem; cursor:pointer;">View</button>
                            <button onclick="deleteHistory('${id}')" style="background:#444; color:#ff4444; border:none; padding:4px 10px; border-radius:4px; font-size:0.75rem; cursor:pointer;">Delete</button>
                        </div>
                    </div>
                </div>`;
            historyList.appendChild(div);
        });
        if(earningsDisplay) earningsDisplay.innerText = `${totalEarnings.toLocaleString()} KS`;
    });
}

// --- Action Functions ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
        const riderName = await getRiderName();

        if(time === 'tomorrow') {
            await updateDoc(docRef, { 
                status: "pending_confirmation", 
                tempRiderId: auth.currentUser.uid, 
                tempRiderName: riderName, 
                pickupSchedule: "tomorrow",
                riderDismissedTomorrow: null 
            });
            await notifyTelegram(createOrderMessage("⏳ Tomorrow Scheduled", order, riderName, "မနက်ဖြန်အတွက် ကြိုယူထားသည်"));
            Swal.fire('အောင်မြင်ပါသည်', 'မနက်ဖြန်အတွက် Customer အတည်ပြုချက် စောင့်ပါမည်', 'success');
        } else {
            await updateDoc(docRef, { 
                status: "accepted", 
                riderId: auth.currentUser.uid, 
                riderName: riderName, 
                acceptedAt: serverTimestamp(), 
                tempRiderId: null, 
                pickupSchedule: "now" 
            });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName, status: "Accepted" }) });
            await notifyTelegram(createOrderMessage("✅ Order Accepted", order, riderName, "Rider လက်ခံလိုက်ပါပြီ"));
        }
    } catch (err) { console.error(err); }
};

window.rejectActiveOrder = async (id) => {
    const res = await Swal.fire({ title: 'Reject လုပ်မှာလား?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ff4444', confirmButtonText: 'ပယ်ဖျက်မည်' });
    if (res.isConfirmed) {
        await updateDoc(doc(db, "orders", id), { status: "pending", riderId: null, lastRejectedRiderId: auth.currentUser.uid });
        Swal.fire('ပယ်ဖျက်ပြီးပါပြီ', '', 'success');
    }
};

window.startTomorrowOrder = async (id) => {
    const docRef = doc(db, "orders", id);
    const order = (await getDoc(docRef)).data();
    const riderName = await getRiderName();
    await updateDoc(docRef, { status: "accepted", pickupSchedule: "now", acceptedAt: serverTimestamp() });
    await notifyTelegram(createOrderMessage("🚀 Started Tomorrow Order", order, riderName, "မနက်ဖြန်အော်ဒါကို ယနေ့အတွက် စတင်လိုက်ပါပြီ"));
};

window.dismissTomorrowOrder = async (id) => {
    await updateDoc(doc(db, "orders", id), { riderDismissedTomorrow: auth.currentUser.uid, tempRiderId: null });
};

window.deleteHistory = async (id) => {
    const res = await Swal.fire({ title: 'မှတ်တမ်းဖျက်မလား?', icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) { await deleteDoc(doc(db, "orders", id)); }
};

window.viewHistoryDetails = async (id) => {
    const snap = await getDoc(doc(db, "orders", id));
    if (!snap.exists()) return;
    const d = snap.data();
    const p = d.pickup ? `${d.pickup.township}၊ ${d.pickup.address}` : (d.pickupAddress || "-");
    const drop = d.dropoff ? `${d.dropoff.township}၊ ${d.dropoff.address}` : (d.dropoffAddress || "-");

    Swal.fire({
        title: 'Order Details',
        html: `<div style="text-align:left; font-size:0.9rem;">
            <b>📦 ပစ္စည်း:</b> ${d.item}<br>
            <b>📞 Customer:</b> <a href="tel:${d.phone}">${d.phone}</a><br>
            <b>💵 ပို့ခ:</b> ${(d.deliveryFee || 0).toLocaleString()} KS<br>
            <b>💰 တန်ဖိုး:</b> ${(d.itemValue || 0).toLocaleString()} KS<br><br>
            <b style="color:#ff4444;">📍 Pickup:</b><br>${p}<br><br>
            <b style="color:#2ed573;">🏁 Drop:</b><br>${drop}
        </div>`,
        confirmButtonText: 'ပိတ်မည်',
        background: '#1a1a1a', color: '#fff'
    });
};

async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
    const p = order.pickup ? `${order.pickup.township}၊ ${order.pickup.address}` : (order.pickupAddress || "-");
    const d = order.dropoff ? `${order.dropoff.township}၊ ${order.dropoff.address}` : (order.dropoffAddress || "-");
    return `${title}\n📊 Status: ${statusText}\n--------------------------\n📝 ပစ္စည်း: ${order.item}\n📞 ဖုန်း: ${order.phone}\n💵 ပို့ခ: ${(order.deliveryFee || 0).toLocaleString()} KS\n📍 ယူရန်: ${p}\n🏁 ပို့ရန်: ${d}\n--------------------------\n🚴 Rider: ${currentRiderName}`;
};

window.handleLogout = async () => { await signOut(auth); };
