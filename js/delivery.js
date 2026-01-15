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

    // (B) Available Orders - Limit (7)
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const container = document.getElementById('available-orders');
        if(!container) return;
        const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "in", ["accepted", "on_the_way", "arrived"])));
        const isFull = activeSnap.size >= 7;

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
                        <small style="color:#00ff00;">Value: ${(d.itemValue || 0).toLocaleString()} KS</small>
                    </div>
                </div>
                <div style="font-size:0.85rem; color:#aaa; margin:10px 0;">
                    📍 <b>PICKUP:</b> ${d.pickup?.address || d.pickupAddress}<br>
                    🏁 <b>DROP:</b> ${d.dropoff?.address || d.dropoffAddress}
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn-accept" style="flex:2; background:${isFull ? '#444' : '#ffcc00'}; border:none; padding:10px; border-radius:5px; font-weight:bold; cursor:pointer;" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">${isFull ? 'Limit Full (7)' : 'လက်ခံမည်'}</button>
                    <button class="btn-accept" style="flex:1; background:#333; color:#fff; border:none; padding:10px; border-radius:5px; cursor:pointer;" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်</button>
                </div>`;
            container.appendChild(card);
        });
        if (!snap.empty && isSoundAllowed) alarmSound.play().catch(e => {});
    });

    // (C) Active Tasks - Limit (7)
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
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way";
                if(d.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived"; }
                if(d.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး", nextStatus = "completed"; }

                const div = document.createElement('div');
                div.className = 'order-card';
                div.style = "border-left: 5px solid #ffcc00; background:#1a1a1a; padding:15px; margin-bottom:12px; border-radius:10px;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <span style="color:#ffcc00; font-weight:bold; font-size:0.8rem;">STATUS: ${d.status.toUpperCase()}</span>
                        <span style="color:#ff4444; font-weight:bold; cursor:pointer;" onclick="cancelByRider('${id}')">✖ Cancel</span>
                    </div>
                    <div style="background:#222; padding:12px; border-radius:8px; margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #444; padding-bottom:8px; margin-bottom:8px;">
                             <b style="color:#fff; font-size:1.1rem;">📦 ${d.item}</b>
                             <b style="color:#ffcc00; font-size:1.2rem;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                        </div>
                    </div>
                    <div style="font-size:0.9rem; color:#eee; line-height:1.6; margin-bottom:15px;">
                        👤 <b>Cust:</b> ${d.customerName || "User"}<br>
                        📞 <b>ဖုန်း:</b> <a href="tel:${d.phone}" style="color:#00ff00; font-weight:bold; text-decoration:none;">${d.phone}</a><br>
                        📍 <b>From:</b> ${d.pickup?.address || d.pickupAddress}<br>
                        🏁 <b>To:</b> ${d.dropoff?.address || d.dropoffAddress}
                    </div>
                    <button style="width:100%; padding:15px; background:#ffcc00; color:#000; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" 
                        onclick="${nextStatus==='completed'?`completeOrder('${id}')`:`updateStatus('${id}','${nextStatus}')` }">
                        ${btnText}
                    </button>`;
                list.appendChild(div);
            }
        });
        if(activeCountDisplay) activeCountDisplay.innerText = `${activeCount} / 7`;
        if(activeCount === 0) list.innerHTML = "<div class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိပါ</div>";
    });

    // (D) Tomorrow Section - Manual Delete Functionality Added
    onSnapshot(query(collection(db, "orders"), where("pickupSchedule", "==", "tomorrow")), (snap) => {
        const tomList = document.getElementById('tomorrow-orders-list');
        if(!tomList) return;
        tomList.innerHTML = "";
        let tomCount = 0;

        snap.forEach(docSnap => {
            const d = docSnap.data();
            const id = docSnap.id;

            // Rider dismiss လုပ်ထားလျှင် မပြပါ
            if (d.riderDismissedTomorrow === myUid) return;

            if (d.tempRiderId === myUid || d.riderId === myUid) {
                tomCount++;
                const isConfirmed = d.status === "accepted";
                const isRejected = d.status === "rider_rejected" || d.status === "pending"; // Customer မှ ပယ်ဖျက်လျှင် pending သို့မဟုတ် rider_rejected ဖြစ်နိုင်သည်

                const div = document.createElement('div');
                div.className = 'order-card';
                // ပယ်ဖျက်ခံရရင် အနီရောင် Border ပြပေးခြင်း
                div.style = `border-left: 5px solid ${isRejected ? '#ff4444' : (isConfirmed ? '#2ed573' : '#3498db')}; background:#1a1a1a; padding:15px; margin-bottom:10px;`;
                
                let statusLabel = isConfirmed ? '✅ TOMORROW CONFIRMED' : '⏳ WAITING CUSTOMER';
                if (isRejected) statusLabel = '❌ ORDER CANCELLED / REJECTED';

                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="color:${isRejected ? '#ff4444' : (isConfirmed ? '#2ed573' : '#3498db')}; font-weight:bold; font-size:0.8rem;">
                            📅 ${statusLabel}
                        </span>
                        ${isRejected ? `<button onclick="dismissTomorrowOrder('${id}')" style="background:#444; color:#ff4444; border:1px solid #ff4444; border-radius:4px; padding:2px 8px; font-size:0.7rem; cursor:pointer; font-weight:bold;">✖ ဖယ်ထုတ်မည်</button>` : ''}
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                         <b style="color:#fff;">📦 ${d.item}</b>
                         <b style="color:#ffcc00;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                    </div>
                    <div style="font-size:0.85rem; color:#aaa; margin-top:8px; background:#222; padding:10px; border-radius:5px;">
                        📍 <b>To:</b> ${d.dropoffAddress || d.dropoff?.address}
                    </div>
                    <button onclick="startTomorrowOrder('${id}')" 
                        style="width:100%; margin-top:10px; padding:12px; background:${isConfirmed ? '#2ed573' : '#333'}; color:white; border:none; border-radius:5px; font-weight:bold; cursor:pointer;"
                        ${!isConfirmed ? 'disabled' : ''}>
                        ${isConfirmed ? '🚀 ယနေ့အတွက် စတင်မည်' : isRejected ? 'အော်ဒါ ပယ်ဖျက်ခံထားရသည်' : 'Customer အတည်ပြုရန်စောင့်ပါ'}
                    </button>`;
                tomList.appendChild(div);
            }
        });
        if(tomCount === 0) tomList.innerHTML = "<div class='empty-msg'>မနက်ဖြန်အတွက် မရှိသေးပါ</div>";
    });

    // (E) History Section
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "==", "completed")), (snap) => {
        const historyList = document.getElementById('history-orders-list');
        const earningsDisplay = document.getElementById('total-earnings');
        let totalEarnings = 0;
        if(!historyList) return;
        historyList.innerHTML = snap.empty ? "<div class='empty-msg'>မှတ်တမ်းမရှိသေးပါ</div>" : "";
        snap.forEach(docSnap => {
            const h = docSnap.data();
            totalEarnings += (h.deliveryFee || 0);
            const div = document.createElement('div');
            div.className = 'history-card';
            div.style = "background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:10px; position:relative;";
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <span style="color:#fff; font-weight:bold;">✅ ${h.item}</span>
                    <span style="color:#00ff00; font-weight:bold;">+${h.deliveryFee?.toLocaleString()} KS</span>
                </div>
                <small style="color:#666;">📅 ${h.completedAt?.toDate().toLocaleString() || ''}</small>
                <button onclick="dismissHistory('${docSnap.id}')" style="position:absolute; bottom:10px; right:10px; background:none; border:none; color:#ff4444; font-size:0.75rem; cursor:pointer;">✖ ဖယ်ထုတ်မည်</button>`;
            historyList.appendChild(div);
        });
        if(earningsDisplay) earningsDisplay.innerText = `${totalEarnings.toLocaleString()} KS`;
    });
}

// --- Action Functions ---

// Tomorrow Reject Order ကို စာရင်းထဲမှ ဖယ်ထုတ်ခြင်း
window.dismissTomorrowOrder = async (id) => {
    try {
        await updateDoc(doc(db, "orders", id), {
            riderDismissedTomorrow: auth.currentUser.uid,
            tempRiderId: null // tempRiderId ကိုပါ ဖျက်လိုက်မှ နောက်တစ်ကြိမ် မပေါ်တော့မှာပါ
        });
    } catch (err) { console.error(err); }
};

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();
        if(time === 'tomorrow') {
            await updateDoc(docRef, { 
                status: "pending_confirmation", 
                tempRiderId: auth.currentUser.uid, 
                tempRiderName: riderName, 
                pickupSchedule: "tomorrow",
                riderDismissedTomorrow: null // ပြန်လက်ခံရင် dismiss flag ကို ဖြုတ်ပေးခြင်း
            });
            await notifyTelegram(createOrderMessage("⏳ Tomorrow Scheduled", order, riderName, "မနက်ဖြန်အတွက် ကြိုယူထားသည်"));
        } else {
            await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp(), tempRiderId: null, pickupSchedule: "now" });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName, status: "Accepted" }) });
            await notifyTelegram(createOrderMessage("✅ Order Accepted", order, riderName, "Rider လက်ခံလိုက်ပါပြီ"));
        }
    } catch (err) { console.error(err); }
};

window.startTomorrowOrder = async (id) => {
    const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", auth.currentUser.uid), where("status", "in", ["accepted", "on_the_way", "arrived"]), where("pickupSchedule", "==", "now")));
    if (activeSnap.size >= 7) { Swal.fire({ title: 'Limit Full!', icon: 'warning', text: 'ယနေ့အတွက် အော်ဒါ ၇ ခု ပြည့်နေပါသည်' }); return; }
    
    const docRef = doc(db, "orders", id);
    const order = (await getDoc(docRef)).data();
    const riderName = await getRiderName();
    
    await updateDoc(docRef, { 
        status: "accepted", 
        pickupSchedule: "now", 
        acceptedAt: serverTimestamp() 
    });
    
    await notifyTelegram(createOrderMessage("🚀 Started Tomorrow Order", order, riderName, "မနက်ဖြန်အတွက် ကြိုယူထားသော အော်ဒါကို ယနေ့အတွက် စတင်လိုက်ပါပြီ"));
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();
        await updateDoc(docRef, { status });
        const text = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        await notifyTelegram(createOrderMessage("🚀 Status Update", order, riderName, text));
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
            await notifyTelegram(createOrderMessage("💰 Order Completed", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ"));
        } catch (err) { console.error(err); }
    }
};

window.cancelByRider = async (id) => {
    const result = await Swal.fire({ title: 'သေချာပါသလား?', text: "အော်ဒါကို ငြင်းပယ်ပါမည်။", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ffcc00', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try { await updateDoc(doc(db, "orders", id), { status: "rider_rejected", riderId: null, riderName: null, lastRejectedRiderId: auth.currentUser.uid, pickupSchedule: null }); } catch (err) { console.error(err); }
    }
};

window.dismissHistory = async (id) => {
    await updateDoc(doc(db, "orders", id), { riderId: "dismissed_" + auth.currentUser.uid });
};

async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
    const pAddr = order.pickup?.address || order.pickupAddress || "မသိရပါ";
    const dAddr = order.dropoff?.address || order.dropoffAddress || "မသိရပါ";
    return `${title}\n📊 Status: <b>${statusText}</b>\n--------------------------\n📝 ပစ္စည်း: <b>${order.item}</b>\n💵 ပို့ခ: <b>${(order.deliveryFee || 0).toLocaleString()} KS</b>\n📍 ယူရန်: ${pAddr}\n🏁 ပို့ရန်: ${dAddr}\n--------------------------\n🚴 Rider: <b>${currentRiderName}</b>`;
};

window.handleLogout = async () => { try { await signOut(auth); } catch (e) { console.error(e); } };
