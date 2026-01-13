import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp 
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
                name: auth.currentUser.email,
                lat: pos.coords.latitude, 
                lng: pos.coords.longitude, 
                lastSeen: serverTimestamp()
            }, { merge: true });
        }
    }, (err) => console.error(err), { enableHighAccuracy: true });
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
        document.getElementById('rider-limit-info').innerHTML = `လက်ရှိအော်ဒါ: <b>${count} / 7</b> ${isFull ? '<span style="color:red">(Full)</span>' : ''}`;

        const container = document.getElementById('available-orders');
        container.innerHTML = snap.empty ? "<p style='text-align:center; color:#888;'>အော်ဒါမရှိသေးပါ</p>" : "";

        Object.values(markers).forEach(m => map.removeLayer(m));
        markers = {};

        snap.forEach(orderDoc => {
            const order = orderDoc.data();
            const id = orderDoc.id;

            if(order.pickup) {
                markers[id] = L.marker([order.pickup.lat, order.pickup.lng]).addTo(map).bindPopup(order.item);
            }

            const card = document.createElement('div');
            card.className = 'order-card';
            const btnStyle = isFull ? "background:#666; opacity:0.5; cursor:not-allowed;" : "";
            
            // UI ထဲတွင် KG, Value နှင့် Payment Method တို့ကို အသေးစိတ်ပြသခြင်း
            card.innerHTML = `
                <div style="font-size:0.8rem; color:#ffcc00; font-weight:bold;">NEW ORDER</div>
                <b style="font-size:1.1rem;">📦 ${order.item}</b>
                <div style="color:#00ff00; font-weight:bold; margin:5px 0;">💰 ပို့ခ: ${order.deliveryFee.toLocaleString()} KS</div>
                <div style="font-size:0.85rem; background:#333; padding:8px; border-radius:8px; margin-bottom:10px;">
                    ⚖️ အလေးချိန်: <b>${order.weight}</b><br>
                    💎 တန်ဖိုး: <b>${order.itemValue}</b><br>
                    💳 Payment: <b>${order.paymentMethod}</b>
                </div>
                <p style="font-size:0.85rem; color:#ccc; margin-bottom:10px;">
                    📍 <b>From:</b> ${order.pickup.address} <br> 
                    🏁 <b>To:</b> ${order.dropoff.address}
                </p>
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
                    <b>${icon} ${data.status.toUpperCase()}</b> <small style="float:right; color:#888;">#${id.slice(-5)}</small>
                </div>
                <p style="font-size:0.9rem; margin:5px 0;">📦 <b>${data.item}</b> | 💰 <b>${data.deliveryFee.toLocaleString()} KS</b></p>
                <p style="font-size:0.85rem; color:#ffcc00; margin:5px 0;">📞 Phone: <b>${data.phone}</b></p>
                <p style="font-size:0.8rem; color:#aaa;">🏁 ${data.dropoff.address}</p>
                <button class="btn-status" style="width:100%; margin-top:10px;" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
            `;
            list.appendChild(div);
        });
    });
}

// --- ၄။ Functions (Telegram Data အပြည့်အစုံထည့်ထားသည်) ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const snap = await getDoc(docRef);
        const order = snap.data();

        if(time === 'tomorrow') {
            await updateDoc(docRef, { 
                status: "pending_confirmation", 
                tempRiderId: auth.currentUser.uid, 
                tempRiderName: auth.currentUser.email 
            });
            alert("Customer အတည်ပြုချက်တောင်းခံထားပါသည်။");
        } else {
            await updateDoc(docRef, { 
                status: "accepted", 
                riderId: auth.currentUser.uid, 
                riderName: auth.currentUser.email, 
                acceptedAt: serverTimestamp() 
            });

            // Telegram သို့ သတင်းပို့ရာတွင် KG, Value, Payment, Phone အကုန်ထည့်ခြင်း
            const msg = `✅ <b>Order Accepted!</b>\n` +
                        `--------------------------\n` +
                        `📝 ပစ္စည်း: <b>${order.item}</b>\n` +
                        `⚖️ အလေးချိန်: ${order.weight}\n` +
                        `💰 ပစ္စည်းတန်ဖိုး: ${order.itemValue}\n` +
                        `💵 ပို့ခ: <b>${order.deliveryFee.toLocaleString()} KS</b>\n` +
                        `💳 Payment: ${order.paymentMethod}\n` +
                        `📞 ဖုန်း: ${order.phone}\n` +
                        `--------------------------\n` +
                        `🚴 Rider: ${auth.currentUser.email}\n` +
                        `📍 ယူရန်: ${order.pickup.address}`;
            await notifyTelegram(msg);
        }
    } catch (err) { console.error(err); }
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const snap = await getDoc(docRef);
        const order = snap.data();

        await updateDoc(docRef, { status: status });

        let statusText = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        
        const msg = `🚀 <b>Status Update!</b>\n` +
                    `--------------------------\n` +
                    `📦 ပစ္စည်း: ${order.item}\n` +
                    `⚖️ အလေးချိန်: ${order.weight}\n` +
                    `📊 အခြေအနေ: ${statusText}\n` +
                    `🏁 ပို့ရန်: ${order.dropoff.address}\n` +
                    `📞 ဖုန်း: ${order.phone}`;
        await notifyTelegram(msg);
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    if(confirm("ပို့ဆောင်မှုပြီးမြောက်ပြီလား?")) {
        try {
            const docRef = doc(db, "orders", id);
            const snap = await getDoc(docRef);
            const order = snap.data();

            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });

            const msg = `💰 <b>Order Completed!</b>\n` +
                        `--------------------------\n` +
                        `📦 ပစ္စည်း: ${order.item}\n` +
                        `⚖️ အလေးချိန်: ${order.weight}\n` +
                        `💰 စုစုပေါင်း: ${order.deliveryFee.toLocaleString()} KS\n` +
                        `🏁 အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`;
            await notifyTelegram(msg);
        } catch (err) { console.error(err); }
    }
};

// Login ဝင်ပြီးမှ Tracking စရန်
auth.onAuthStateChanged((user) => { if(user) startTracking(); });
