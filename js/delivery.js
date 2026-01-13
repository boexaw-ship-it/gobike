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
    alarmSound.play().then(() => {
        soundBtn.style.display = 'none'; 
    });
};

// --- ၁။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = {}; 

// --- ၂။ Live Location & Update Profile Name ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
            // Firestore users collection ထဲက Rider နာမည်ရင်းကို ယူခြင်း
            const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            const riderDisplayName = userSnap.exists() ? userSnap.data().name : "Rider";

            await setDoc(doc(db, "active_riders", auth.currentUser.uid), {
                name: riderDisplayName,
                lat: pos.coords.latitude, 
                lng: pos.coords.longitude, 
                lastSeen: serverTimestamp()
            }, { merge: true });
        }
    }, (err) => console.error(err), { enableHighAccuracy: true });
}

// --- ၃။ Order စောင့်ကြည့်ခြင်း ---
function startTracking() {
    if (!auth.currentUser) return;

    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        
        // --- Alarm on New Order ---
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                alarmSound.play().catch(e => console.log("Sound error:", e));
            }
        });

        const activeSnap = await getDocs(query(collection(db, "orders"), 
            where("riderId", "==", auth.currentUser.uid),
            where("status", "in", ["accepted", "on_the_way", "arrived"])));
        
        const count = activeSnap.size;
        const isFull = count >= 7;
        const limitInfo = document.getElementById('rider-limit-info');
        if(limitInfo) limitInfo.innerHTML = `လက်ရှိအော်ဒါ: <b>${count} / 7</b> ${isFull ? '<span style="color:red">(Full)</span>' : ''}`;

        const container = document.getElementById('available-orders');
        if(container) {
            container.innerHTML = snap.empty ? "<p style='text-align:center; color:#888;'>အော်ဒါမရှိသေးပါ</p>" : "";
            Object.values(markers).forEach(m => map.removeLayer(m));
            markers = {};

            snap.forEach(orderDoc => {
                const order = orderDoc.data();
                const id = orderDoc.id;
                if (order.lastRejectedRiderId === auth.currentUser.uid) return; 

                if(order.pickup) {
                    markers[id] = L.marker([order.pickup.lat, order.pickup.lng]).addTo(map).bindPopup(order.item);
                }

                const card = document.createElement('div');
                card.className = 'order-card';
                const btnStyle = isFull ? "background:#666; opacity:0.5; cursor:not-allowed;" : "";
                
                // Rider View Card - ရှင်းလင်းအောင် ပြင်ဆင်ထားသည်
                card.innerHTML = `
                    <div style="font-size:0.8rem; color:#ffcc00; font-weight:bold;">ORDER #${id.slice(-5)}</div>
                    <b style="font-size:1.2rem; display:block; margin:5px 0;">📦 ${order.item}</b>
                    <div style="color:#00ff00; font-size:1.1rem; font-weight:bold; margin-bottom:8px;">💰 ပို့ခ: ${order.deliveryFee?.toLocaleString()} KS</div>
                    
                    <div style="font-size:0.85rem; background:#222; padding:10px; border-radius:8px; border-left:4px solid #ffcc00; margin-bottom:10px;">
                        📍 <b>ယူရန်:</b> ${order.pickup?.address} <br> 
                        🏁 <b>ပို့ရန်:</b> ${order.dropoff?.address}
                    </div>

                    <div style="font-size:0.8rem; background:#333; padding:10px; border-radius:8px; margin-bottom:12px; line-height:1.6;">
                        👤 Customer: <b>${order.customerName || "အမည်မသိသူ"}</b><br>
                        📞 ဖုန်း: <b style="color:#00ff00;">${order.phone}</b><br>
                        ⚖️ အလေးချိန်: <b>${order.weight || "-"}</b> | 💎 တန်ဖိုး: <b>${order.itemValue || "-"}</b><br>
                        💳 Payment: <b>${order.paymentMethod || "-"}</b>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                        <button class="btn-accept" ${isFull ? 'disabled' : ''} style="${btnStyle}" onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                        <button class="btn-accept" ${isFull ? 'disabled' : ''} style="background:#444; color:white; ${btnStyle}" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                    </div>`;
                container.appendChild(card);
            });
        }
    });

    // လက်ခံထားသော Active Orders စာရင်း
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", auth.currentUser.uid), where("status", "in", ["accepted", "on_the_way", "arrived"])), (snap) => {
        const list = document.getElementById('active-orders-list');
        if(!list) return;
        list.innerHTML = snap.empty ? "<p style='padding:10px; color:#888;'>လက်ခံထားသော အော်ဒါမရှိပါ။</p>" : "";
        
        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            const id = orderDoc.id;
            let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way", icon = "📦";

            if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived", icon = "🚴"; }
            if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး (Complete)", nextStatus = "completed", icon = "🏁"; }

            const div = document.createElement('div');
            div.className = 'active-order-card';
            div.innerHTML = `
                <div style="border-bottom:1px solid #444; padding-bottom:5px; margin-bottom:5px;">
                    <b>${icon} ${data.status.toUpperCase()}</b>
                </div>
                <p style="font-size:0.95rem; margin:8px 0;">📦 <b>${data.item}</b></p>
                <div style="font-size:0.85rem; color:#aaa; margin-bottom:5px;">
                    👤 <b>${data.customerName || "Customer"}</b> | 📞 <b style="color:#00ff00;">${data.phone}</b>
                </div>
                <p style="font-size:0.8rem; color:#ccc;">🏁 ${data.dropoff?.address}</p>
                <button class="btn-status" style="width:100%; margin-top:10px; padding:12px;" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
            `;
            list.appendChild(div);
        });
    });
}

// --- ၄။ Functions (Handle Accept & Telegram) ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const snap = await getDoc(docRef);
        const order = snap.data();

        // Firestore ထဲက Rider Name အမှန်ကို ယူခြင်း
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const riderDisplayName = userSnap.exists() ? userSnap.data().name : (auth.currentUser.displayName || "Rider");

        if(time === 'tomorrow') {
            await updateDoc(docRef, { 
                status: "pending_confirmation", 
                pickupSchedule: "tomorrow", 
                tempRiderId: auth.currentUser.uid, 
                tempRiderName: riderDisplayName 
            });
            alert(`မနက်ဖြန်မှ လာယူမည့်အကြောင်း Customer ဆီ ပို့လိုက်ပါပြီ။`);
        } else {
            await updateDoc(docRef, { 
                status: "accepted", 
                pickupSchedule: "now",
                riderId: auth.currentUser.uid, 
                riderName: riderDisplayName, 
                acceptedAt: serverTimestamp() 
            });

            // Google Sheets Update
            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({
                    action: "update", orderId: id,
                    riderName: riderDisplayName, status: "Accepted"
                })
            });

            // Telegram Notification (အချက်အလက်အစုံအလင်)
            const msg = `✅ <b>Order Accepted!</b>\n` +
                        `--------------------------\n` +
                        `📝 ပစ္စည်း: <b>${order.item}</b>\n` +
                        `⚖️ အလေးချိန်: <b>${order.weight || "-"}</b>\n` +
                        `💰 ပစ္စည်းတန်ဖိုး: <b>${order.itemValue || "-"}</b>\n` +
                        `💵 ပို့ခ: <b>${order.deliveryFee?.toLocaleString()} KS</b>\n` +
                        `💳 Payment: <b>${order.paymentMethod || "-"}</b>\n` +
                        `📞 ဖုန်း: <b>${order.phone}</b>\n` +
                        `👤 Customer: <b>${order.customerName || "အမည်မသိသူ"}</b>\n` +
                        `--------------------------\n` +
                        `🚴 Rider: <b>${riderDisplayName}</b>\n` +
                        `📍 ယူရန်: ${order.pickup?.address}`;
            await notifyTelegram(msg);
        }
    } catch (err) { console.error("Accept Error:", err); }
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const riderName = userSnap.exists() ? userSnap.data().name : "Rider";

        await updateDoc(docRef, { status: status });

        fetch(SCRIPT_URL, {
            method: "POST", mode: "no-cors",
            body: JSON.stringify({ action: "update", orderId: id, status: status.toUpperCase() })
        });

        const statusText = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        const msg = `🚀 <b>Status Update!</b>\n--------------------------\n📊: ${statusText}\n🚴 Rider: <b>${riderName}</b>`;
        await notifyTelegram(msg);
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    if(confirm("ပို့ဆောင်မှုပြီးမြောက်ပြီလား?")) {
        try {
            const docRef = doc(db, "orders", id);
            const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            const riderName = userSnap.exists() ? userSnap.data().name : "Rider";

            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });

            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({ action: "update", orderId: id, status: "COMPLETED" })
            });

            const msg = `💰 <b>Order Completed!</b>\n--------------------------\n🚴 Rider: <b>${riderName}</b>\n🏁 အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`;
            await notifyTelegram(msg);
        } catch (err) { console.error(err); }
    }
};

auth.onAuthStateChanged((user) => { if(user) startTracking(); });
