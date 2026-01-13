import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = {}; 

// --- ၂။ Live Location ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
            await setDoc(doc(db, "active_riders", auth.currentUser.uid), {
                lat: pos.coords.latitude, lng: pos.coords.longitude, lastSeen: serverTimestamp()
            }, { merge: true });
        }
    });
}

// --- ၃။ Order စောင့်ကြည့်ခြင်း (New & Active) ---
function startTracking() {
    if (!auth.currentUser) return;

    // Available Orders & Limit Logic
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const activeSnap = await getDocs(query(collection(db, "orders"), 
            where("riderId", "==", auth.currentUser.uid),
            where("status", "in", ["accepted", "on_the_way", "arrived"])));
        
        const count = activeSnap.size;
        const isFull = count >= 7;
        document.getElementById('rider-limit-info').innerHTML = `လက်ရှိအော်ဒါ: <b>${count} / 7</b> ${isFull ? '(Full)' : ''}`;

        const container = document.getElementById('available-orders');
        container.innerHTML = snap.empty ? "<p>အော်ဒါမရှိသေးပါ</p>" : "";

        // မြေပုံရှင်းလင်းရေး
        Object.values(markers).forEach(m => map.removeLayer(m));
        markers = {};

        snap.forEach(orderDoc => {
            const order = orderDoc.data();
            const id = orderDoc.id;

            // Marker ပြခြင်း
            if(order.pickup) {
                markers[id] = L.marker([order.pickup.lat, order.pickup.lng]).addTo(map).bindPopup(order.item);
            }

            const card = document.createElement('div');
            card.className = 'order-card';
            const btnStyle = isFull ? "background:#666; opacity:0.5; cursor:not-allowed;" : "";
            
            card.innerHTML = `
                <div style="font-size:0.8rem; color:#ffcc00">NEW ORDER</div>
                <b>📦 ${order.item}</b> - ${order.deliveryFee} KS
                <p style="font-size:0.8rem; color:#ccc;">📍 ${order.pickup.address} <br> 🏁 ${order.dropoff.address}</p>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <button class="btn-accept" ${isFull ? 'disabled' : ''} style="${btnStyle}" onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                    <button class="btn-accept" ${isFull ? 'disabled' : ''} style="background:#444; color:white; ${btnStyle}" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                </div>`;
            container.appendChild(card);
        });
    });

    // Active Orders List
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", auth.currentUser.uid), where("status", "in", ["accepted", "on_the_way", "arrived"])), (snap) => {
        const list = document.getElementById('active-orders-list');
        list.innerHTML = snap.empty ? "<p>လက်ခံထားသော အော်ဒါမရှိပါ။</p>" : "";
        
        snap.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way", icon = "📦";

            if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်"; nextStatus = "arrived"; icon = "🚴"; }
            if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး (Complete)"; nextStatus = "completed"; icon = "🏁"; }

            const div = document.createElement('div');
            div.className = 'active-order-card';
            div.innerHTML = `
                <b>${icon} ${data.status.toUpperCase()}</b> <small style="float:right">#${id.slice(-4)}</small>
                <p style="font-size:0.85rem;">📦 ${data.item} | 💰 ${data.deliveryFee} KS</p>
                <button class="btn-status" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
            `;
            list.appendChild(div);
        });
    });
}

// --- ၄။ Functions ---
window.handleAccept = async (id, time) => {
    if(time === 'tomorrow') {
        await updateDoc(doc(db, "orders", id), { status: "pending_confirmation", tempRiderId: auth.currentUser.uid, tempRiderName: auth.currentUser.email });
        alert("Customer အတည်ပြုချက်တောင်းခံထားပါသည်။");
    } else {
        await updateDoc(doc(db, "orders", id), { status: "accepted", riderId: auth.currentUser.uid, riderName: auth.currentUser.email, acceptedAt: serverTimestamp() });
        notifyTelegram(`✅ Order Accepted\n📦 Item: ${id}\n🚴 Rider: ${auth.currentUser.email}`);
    }
};

window.updateStatus = async (id, status) => {
    await updateDoc(doc(db, "orders", id), { status: status });
    notifyTelegram(`🚀 Status Update: ${status}\nOrder ID: ${id}`);
};

window.completeOrder = async (id) => {
    if(confirm("ပို့ဆောင်မှုပြီးမြောက်ပြီလား?")) {
        await updateDoc(doc(db, "orders", id), { status: "completed", completedAt: serverTimestamp() });
        notifyTelegram(`💰 Order Completed!\nOrder ID: ${id}`);
    }
};

// Login ဝင်ပြီးမှ Tracking စရန်
auth.onAuthStateChanged((user) => { if(user) startTracking(); });
