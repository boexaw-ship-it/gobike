import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uo/exec";

// --- ၀။ Alarm Sound Setup ---
const alarmSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
let isSoundAllowed = false;

const soundBtn = document.createElement('button');
soundBtn.innerHTML = "🔔 အသံဖွင့်ရန်";
soundBtn.style = "position:fixed; bottom:85px; right:20px; z-index:3000; padding:10px 18px; background:#ffcc00; color:#000; border:2px solid #1a1a1a; border-radius:50px; font-weight:bold; cursor:pointer;";
document.body.appendChild(soundBtn);
soundBtn.onclick = () => {
    isSoundAllowed = true;
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
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ffcc00',
        background: '#1a1a1a', color: '#fff'
    });
    if (result.isConfirmed) {
        try { await signOut(auth); } catch (error) { console.error(error); }
    }
};

async function getRiderData() {
    if (!auth.currentUser) return;
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    if (snap.exists()) {
        const data = snap.data();
        document.getElementById('display-name').innerText = data.name;
        document.getElementById('display-role').innerText = data.role || "Rider";
    }
}

// --- ၂။ Telegram Message Helper ---
const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
    const pAddr = order.pickup?.address || order.pickupAddress || "မသိရပါ";
    const dAddr = order.dropoff?.address || order.dropoffAddress || "မသိရပါ";
    return `${title}\n📊 Status: <b>${statusText}</b>\n--------------------------\n📝 ပစ္စည်း: <b>${order.item}</b>\n💵 ပို့ခ: <b>${order.deliveryFee?.toLocaleString()} KS</b>\n👤 Customer: <b>${order.customerName || "အမည်မသိ"}</b>\n📍 ယူရန်: ${pAddr}\n🏁 ပို့ရန်: ${dAddr}\n--------------------------\n🚴 Rider: <b>${currentRiderName}</b>`;
};

// --- ၃။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// --- ၄။ Live Location Tracking ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
            const name = await getRiderName();
            await setDoc(doc(db, "active_riders", auth.currentUser.uid), {
                name, lat: pos.coords.latitude, lng: pos.coords.longitude, lastSeen: serverTimestamp()
            }, { merge: true });
        }
    }, null, { enableHighAccuracy: true });
}

// --- ၅။ Main Tracking Logic ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // (A) Available Orders (အော်ဒါသစ်များ)
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const container = document.getElementById('available-orders');
        if(!container) return;

        const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "in", ["accepted", "on_the_way", "arrived"])));
        const isFull = activeSnap.size >= 3;

        container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
        
        snap.forEach(orderDoc => {
            const order = orderDoc.data();
            if (order.lastRejectedRiderId === myUid || order.tempRiderId === myUid) return;
            const id = orderDoc.id;

            const card = document.createElement('div');
            card.className = 'order-card';
            card.style = "background: #1e1e1e; padding: 15px; border-radius: 12px; margin-bottom: 12px; border: 1px solid #333;";
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b style="font-size:1.1rem; color:#fff;">📦 ${order.item}</b>
                    <b style="color:#ffcc00;">${order.deliveryFee?.toLocaleString()} KS</b>
                </div>
                <div style="font-size:0.85rem; color:#aaa; margin:10px 0; border-top:1px solid #222; padding-top:10px;">
                    📍 <b style="color:#ffcc00;">PICKUP:</b> ${order.pickup?.address || order.pickupAddress}<br>
                    🏁 <b style="color:#3498db;">DROP:</b> ${order.dropoff?.address || order.dropoffAddress}
                </div>
                <div style="display:flex; gap:10px; margin-top:10px;">
                    <button class="btn-accept" style="flex:2; background:${isFull ? '#444' : '#ffcc00'}; color:#000; border:none; padding:12px; border-radius:8px; font-weight:bold;" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">${isFull ? 'Limit Full' : 'ချက်ချင်းယူမည်'}</button>
                    <button class="btn-accept" style="flex:1; background:#333; color:#fff; border:none; padding:12px; border-radius:8px;" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်</button>
                </div>
            `;
            container.appendChild(card);
        });
        if (!snap.empty && isSoundAllowed) alarmSound.play().catch(e => {});
    });

    // (B) Active Orders (လက်ရှိအော်ဒါ - အသေးစိတ်ပါဝင်သည်)
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        const activeCountDisplay = document.getElementById('active-count');
        let activeCount = 0;
        list.innerHTML = "";

        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            if (["accepted", "on_the_way", "arrived"].includes(data.status)) {
                activeCount++;
                const id = orderDoc.id;
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way";
                if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived"; }
                if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး", nextStatus = "completed"; }

                const div = document.createElement('div');
                div.className = 'order-card';
                div.style = "border-left: 5px solid #ffcc00; background: #1a1a1a; padding:15px; margin-bottom:12px; border-radius:10px;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:10px;">
                        <span style="color:#ffcc00; font-size:0.8rem;">STATUS: ${data.status.toUpperCase()}</span>
                        <span style="color:#ff4444; cursor:pointer;" onclick="cancelByRider('${id}')">✖ Cancel</span>
                    </div>
                    <div style="margin-bottom:10px;">
                        <b style="font-size:1.1rem;">📦 ${data.item}</b><br>
                        <span style="color:#00ff00; font-weight:bold;">💵 ပစ္စည်းဖိုး: ${(data.itemValue || data.itemPrice || 0).toLocaleString()} KS</span>
                    </div>
                    <div style="background:#222; padding:10px; border-radius:8px; font-size:0.9rem; margin-bottom:10px;">
                        👤 <b>အမည်:</b> ${data.customerName || "အမည်မသိ"}<br>
                        📞 <b>ဖုန်း:</b> <a href="tel:${data.phone}" style="color:#ffcc00; text-decoration:none;">${data.phone}</a><br>
                        📍 <b>FROM:</b> ${data.pickup?.address || data.pickupAddress}<br>
                        🏁 <b>TO:</b> ${data.dropoff?.address || data.dropoffAddress}
                    </div>
                    <button class="btn-update" style="width:100%; padding:14px; background:#ffcc00; color:#000; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" 
                        onclick="${nextStatus==='completed'?`completeOrder('${id}')`:`updateStatus('${id}','${nextStatus}')` }">
                        ${btnText}
                    </button>
                `;
                list.appendChild(div);
            }
        });
        if(activeCountDisplay) activeCountDisplay.innerText = `${activeCount} / 3`;
        if(activeCount === 0) list.innerHTML = "<div class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိသေးပါ</div>";
    });

    // (C) Tomorrow Section (မနက်ဖြန်အတွက် Customer Details ပါဝင်သည်)
    onSnapshot(query(collection(db, "orders"), where("tempRiderId", "==", myUid)), (snap) => {
        const tomList = document.getElementById('tomorrow-orders-list');
        const tomCountHome = document.getElementById('tomorrow-count-home');
        const tomCountPage = document.getElementById('tomorrow-count');
        
        if(tomList) {
            tomList.innerHTML = snap.empty ? "<div class='empty-msg'>မနက်ဖြန်အတွက် မရှိသေးပါ</div>" : "";
            let count = 0;
            snap.forEach(doc => {
                const d = doc.data();
                if(d.status === "pending_confirmation") {
                    count++;
                    const div = document.createElement('div');
                    div.className = 'order-card';
                    div.style = "border-left: 5px solid #3498db; background: #1a1a1a; padding:15px; margin-bottom:10px; border-radius:10px;";
                    div.innerHTML = `
                        <div style="color:#3498db; font-size:0.75rem; font-weight:bold; margin-bottom:8px;">📅 TOMORROW SCHEDULE</div>
                        <b style="font-size:1rem;">📦 ${d.item}</b> | <span style="color:#ffcc00;">${d.deliveryFee?.toLocaleString()} KS</span>
                        <div style="font-size:0.85rem; color:#aaa; margin-top:8px; border-top:1px solid #222; padding-top:8px;">
                            👤 <b>Cust:</b> ${d.customerName || "အမည်မသိ"} | 📞 ${d.phone}<br>
                            📍 <b>Pickup:</b> ${d.pickupAddress || d.pickup?.address}<br>
                            🏁 <b>Dropoff:</b> ${d.dropoffAddress || d.dropoff?.address}
                        </div>
                    `;
                    tomList.appendChild(div);
                }
            });
            const countStr = `${count} / 7`;
            if(tomCountHome) tomCountHome.innerText = countStr;
            if(tomCountPage) tomCountPage.innerText = countStr;
        }
    });

    // (D) History Section (ပြီးဆုံးသွားသော အော်ဒါများ - Earnings အပြည့်အစုံ)
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "==", "completed")), (snap) => {
        const historyList = document.getElementById('history-orders-list');
        const earningsDisplay = document.getElementById('total-earnings');
        let totalEarnings = 0;
        
        if(historyList) {
            historyList.innerHTML = snap.empty ? "<div class='empty-msg'>မှတ်တမ်းမရှိသေးပါ</div>" : "";
            snap.forEach(doc => {
                const h = doc.data();
                totalEarnings += (h.deliveryFee || 0);
                const div = document.createElement('div');
                div.className = 'history-card';
                div.style = "background: #1a1a1a; padding: 15px; border-radius: 10px; margin-bottom:10px; border:1px solid #333;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:#fff; font-weight:bold;">✅ ${h.item}</span>
                        <span style="color:#00ff00;">+${h.deliveryFee?.toLocaleString()} KS</span>
                    </div>
                    <div style="font-size:0.75rem; color:#666; margin-top:5px;">
                        👤 Customer: ${h.customerName || "N/A"} | 🏁 ${h.dropoffAddress || "N/A"}<br>
                        📅 ${h.completedAt?.toDate().toLocaleString() || 'ရက်စွဲမရှိပါ'}
                    </div>
                `;
                historyList.appendChild(div);
            });
            if(earningsDisplay) earningsDisplay.innerText = `${totalEarnings.toLocaleString()} KS`;
        }
    });
}

// --- ၆။ Action Functions (Status Updates) ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
        const riderName = await getRiderName();

        if(time === 'tomorrow') {
            const tmrSnap = await getDocs(query(collection(db, "orders"), where("tempRiderId", "==", auth.currentUser.uid), where("status", "==", "pending_confirmation")));
            if(tmrSnap.size >= 7) {
                Swal.fire({ title: 'Limit Full!', text: 'မနက်ဖြန်အတွက် ၇ ခုပြည့်နေပါပြီ', icon: 'error', background: '#1a1a1a', color: '#fff' });
                return;
            }
            await updateDoc(docRef, { 
                status: "pending_confirmation", 
                tempRiderId: auth.currentUser.uid, 
                tempRiderName: riderName,
                pickupSchedule: "tomorrow"
            });
            await notifyTelegram(createOrderMessage("⏳ Tomorrow Scheduled", order, riderName, "မနက်ဖြန်အတွက် ချိတ်ဆက်ထားပါသည်"));
            Swal.fire({ title: 'Success!', text: 'မနက်ဖြန်စာရင်းထဲ ထည့်လိုက်ပါပြီ', icon: 'success', timer: 1500, showConfirmButton: false, background: '#1a1a1a', color: '#fff' });
        } else {
            await updateDoc(docRef, { 
                status: "accepted", 
                riderId: auth.currentUser.uid, 
                riderName: riderName, 
                acceptedAt: serverTimestamp(),
                tempRiderId: null 
            });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName, status: "Accepted" }) });
            await notifyTelegram(createOrderMessage("✅ Order Accepted", order, riderName, "Rider လက်ခံလိုက်ပါပြီ"));
        }
    } catch (err) { console.error(err); }
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
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
            const orderSnap = await getDoc(docRef);
            const order = orderSnap.data();
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
        try {
            const docRef = doc(db, "orders", id);
            const orderSnap = await getDoc(docRef);
            const order = orderSnap.data();
            const name = await getRiderName();
            await updateDoc(docRef, { status: "rider_rejected", riderId: null, riderName: null, lastRejectedRiderId: auth.currentUser.uid });
            await notifyTelegram(createOrderMessage("❌ Rider Rejected", order, name, "Rider က ငြင်းပယ်လိုက်ပါပြီ"));
        } catch (err) { console.error(err); }
    }
};

async function getRiderName() {
    if (!auth.currentUser) return "Rider";
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}
