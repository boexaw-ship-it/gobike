import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp 
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
    alarmSound.play().then(() => { soundBtn.style.display = 'none'; }).catch(e => console.log("Sound play error"));
};

// --- ၁။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = {}; 

// --- ၂။ Live Location Tracking ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
            try {
                const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
                const riderDisplayName = userSnap.exists() ? userSnap.data().name : "Rider";

                await setDoc(doc(db, "active_riders", auth.currentUser.uid), {
                    name: riderDisplayName,
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude, 
                    lastSeen: serverTimestamp()
                }, { merge: true });
            } catch (err) { console.error("Location Update Error:", err); }
        }
    }, (err) => console.error(err), { enableHighAccuracy: true });
}

// --- ၃။ Order စောင့်ကြည့်ခြင်း (Core Logic) ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // A. အော်ဒါအသစ်များ (Pending)
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") { alarmSound.play().catch(e => 0); }
        });

        const activeSnap = await getDocs(query(collection(db, "orders"), 
            where("riderId", "==", myUid),
            where("status", "in", ["accepted", "on_the_way", "arrived"])));
        
        const isFull = activeSnap.size >= 7;
        const limitInfo = document.getElementById('rider-limit-info');
        if(limitInfo) limitInfo.innerHTML = `လက်ရှိအော်ဒါ: <b>${activeSnap.size} / 7</b> ${isFull ? '<span style="color:red">(Full)</span>' : ''}`;

        const container = document.getElementById('available-orders');
        if(container) {
            container.innerHTML = snap.empty ? "<p class='empty-msg'>အော်ဒါမရှိသေးပါ</p>" : "";
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
                    <div style="font-size:0.8rem; color:#ffcc00; font-weight:bold;">ORDER #${id.slice(-5)}</div>
                    <b style="font-size:1.2rem; display:block; margin:5px 0;">📦 ${order.item}</b>
                    <div style="color:#00ff00; font-size:1.1rem; font-weight:bold; margin-bottom:8px;">💰 ပို့ခ: ${order.deliveryFee?.toLocaleString()} KS</div>
                    
                    <div style="font-size:0.8rem; background:#333; padding:10px; border-radius:8px; margin-bottom:12px;">
                        👤 Customer: <b>${order.customerName || order.userName || "အမည်မသိသူ"}</b><br>
                        📞 ဖုန်း: <b style="color:#00ff00;">${order.phone || "မရှိပါ"}</b>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <button class="btn-accept" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                        <button class="btn-accept" ${isFull ? 'disabled' : ''} style="background:#444; color:white;" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                    </div>`;
                container.appendChild(card);
            });
        }
    });

    // B. Waiting Confirmation Section
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending_confirmation"), where("tempRiderId", "==", myUid)), (snap) => {
        const confirmBox = document.getElementById('waiting-confirmation-section');
        if(!confirmBox) return;
        confirmBox.innerHTML = ""; 
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            const id = orderDoc.id;
            const div = document.createElement('div');
            div.className = 'active-order-card';
            div.style = "border: 1px solid #ffcc00; background: #222; padding: 15px; border-radius: 12px; margin-bottom: 10px;";
            div.innerHTML = `
                <div style="color:#ffcc00; font-weight:bold; font-size:0.85rem;">⏳ အတည်ပြုချက် စောင့်ဆိုင်းဆဲ (မနက်ဖြန်)</div>
                <p style="margin:8px 0;">📦 <b>${d.item}</b></p>
                <button onclick="cancelOrder('${id}', 'tomorrow')" style="width:100%; background:#444; color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer;">အော်ဒါပြန်လွှတ်မည် (Cancel)</button>
            `;
            confirmBox.appendChild(div);
        });
    });

    // C. Rejected by Customer
    onSnapshot(query(collection(db, "orders"), where("status", "==", "rejected"), where("tempRiderId", "==", myUid)), (snap) => {
        const rejectedContainer = document.getElementById('rejected-orders-section');
        if(!rejectedContainer) return;
        rejectedContainer.innerHTML = ""; 
        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            const id = orderDoc.id;
            const div = document.createElement('div');
            div.className = 'active-order-card rejected-card';
            div.innerHTML = `
                <div style="color:#ff4444; font-weight:bold; font-size:0.85rem;">❌ CUSTOMER REJECTED</div>
                <p>📦 <b>${data.item}</b></p>
                <button onclick="cancelOrder('${id}', 'rejected_by_customer')" class="btn-clear-reject">စာရင်းမှဖယ်ရှားမည်</button>
            `;
            rejectedContainer.appendChild(div);
        });
    });

    // D. Active Orders (Reject Button ပါဝင်သည်)
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "in", ["accepted", "on_the_way", "arrived"])), (snap) => {
        const list = document.getElementById('active-orders-list');
        if(!list) return;
        list.innerHTML = snap.empty ? "<p class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိပါ။</p>" : "";
        
        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            const id = orderDoc.id;
            let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way", icon = "📦";

            if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived", icon = "🚴"; }
            if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး", nextStatus = "completed", icon = "🏁"; }

            const div = document.createElement('div');
            div.className = 'active-order-card';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b>${icon} ${data.status.toUpperCase()}</b>
                    <a href="track.html?id=${id}" style="color:var(--primary); font-size:0.8rem; text-decoration:none;">🗺️ မြေပုံကြည့်ရန်</a>
                </div>
                <p style="margin:8px 0; font-size:1.1rem;">📦 <b>${data.item}</b></p>
                <div style="font-size:0.85rem; color:#aaa; margin-bottom:10px;">👤 ${data.customerName || "Customer"} | 📞 <b style="color:#00ff00;">${data.phone}</b></div>
                
                <button class="btn-status" onclick="updateStatus('${id}', '${nextStatus === 'completed' ? 'completed' : nextStatus}')">
                    ${btnText}
                </button>
                
                <button onclick="cancelOrder('${id}', 'now')" style="width:100%; background:none; color:#ff4444; border:1px solid #ff4444; padding:8px; border-radius:8px; margin-top:10px; cursor:pointer; font-size:0.85rem; font-weight:bold;">
                    ❌ အော်ဒါပြန်လွှတ်မည် (Reject)
                </button>
            `;
            list.appendChild(div);
        });
    });
}

// --- ၄။ Global Functions (Window Object သို့ ချိတ်ဆက်ခြင်း) ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        if(!orderSnap.exists()) return;
        const order = orderSnap.data();
        
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const riderName = userSnap.exists() ? userSnap.data().name : "Rider";

        if(time === 'tomorrow') {
            await updateDoc(docRef, { status: "pending_confirmation", pickupSchedule: "tomorrow", tempRiderId: auth.currentUser.uid, tempRiderName: riderName });
            alert(`မနက်ဖြန်မှ လာယူမည့်အကြောင်း Customer ဆီ ပို့လိုက်ပါပြီ။`);
        } else {
            await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp() });
            
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName: riderName, status: "Accepted" }) });

            const msg = `✅ <b>Order Accepted!</b>\n📦: <b>${order.item}</b>\n🚴 Rider: <b>${riderName}</b>`;
            await notifyTelegram(msg);
        }
    } catch (err) { console.error(err); alert("Error accepting order"); }
};

window.cancelOrder = async (id, type) => {
    const msgType = type === 'now' ? "လက်ရှိယူထားသော အော်ဒါ" : "မနက်ဖြန်ယူမည့်အစီအစဉ်";
    if(confirm(`${msgType}ကို ဖျက်သိမ်းပြီး အော်ဒါကို အများမြင်ကွင်းသို့ ပြန်ပို့မလား?`)) {
        try {
            const docRef = doc(db, "orders", id);
            const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            const riderName = userSnap.exists() ? userSnap.data().name : "Rider";

            await updateDoc(docRef, { 
                status: "pending", 
                riderId: null, riderName: null, 
                tempRiderId: null, tempRiderName: null,
                pickupSchedule: null,
                lastRejectedRiderId: auth.currentUser.uid 
            });

            const msg = `⚠️ <b>Order Cancelled!</b>\n🚴 Rider: <b>${riderName}</b> မှ အော်ဒါကို ပြန်လွှတ်လိုက်ပါသည်။`;
            await notifyTelegram(msg);
            alert("အော်ဒါကို ပြန်လွှတ်လိုက်ပါပြီ။");
        } catch (err) { console.error(err); alert("Error cancelling order"); }
    }
};

window.updateStatus = async (id, status) => {
    if (status === 'completed') {
        if(!confirm("ပို့ဆောင်မှု ပြီးမြောက်ပြီလား?")) return;
    }
    
    try {
        const docRef = doc(db, "orders", id);
        await updateDoc(docRef, { 
            status: status,
            ...(status === 'completed' ? { completedAt: serverTimestamp() } : {})
        });
        
        fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, status: status.toUpperCase() }) });
        await notifyTelegram(`🚀 <b>Status Update!</b>\n📊: ${status.toUpperCase()}`);
    } catch (err) { console.error(err); alert("Error updating status"); }
};

auth.onAuthStateChanged((user) => { if(user) startTracking(); });
