import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, deleteDoc, serverTimestamp 
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

// --- Helper: Create Detailed Telegram Message ---
const createOrderMessage = (title, order, riderName, statusText = "") => {
    let msg = `${title}\n`;
    if (statusText) msg += `📊 Status: <b>${statusText}</b>\n`;
    msg += `--------------------------\n` +
           `📝 ပစ္စည်း: <b>${order.item}</b>\n` +
           `⚖️ အလေးချိန်: <b>${order.weight || "-"}</b>\n` +
           `💰 ပစ္စည်းတန်ဖိုး: <b>${order.itemValue || "-"}</b>\n` +
           `💵 ပို့ခ: <b>${order.deliveryFee?.toLocaleString()} KS</b>\n` +
           `💳 Payment: <b>${order.paymentMethod || "-"}</b>\n` +
           `📞 ဖုန်း: <b>${order.phone}</b>\n` +
           `👤 Customer: <b>${order.customerName || "အမည်မသိသူ"}</b>\n` +
           `--------------------------\n` +
           `🚴 Rider: <b>${riderName}</b>\n` +
           `📍 ယူရန်: ${order.pickup?.address || "မသိရပါ"}\n` +
           `🏁 ပို့ရန်: ${order.dropoff?.address || "မသိရပါ"}`;
    return msg;
};

// --- ၁။ Map Init ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let markers = {}; 

// --- ၂။ Live Location ---
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(async (pos) => {
        if (auth.currentUser) {
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

    // (က) အော်ဒါသစ်များ (Pending) နှင့် Reject လုပ်ထားသော အော်ဒါများ ပြန်တက်လာခြင်းကို စောင့်ကြည့်
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        snap.docChanges().forEach((change) => {
            // "added" သို့မဟုတ် တခြား Rider တစ်ယောက်က reject လုပ်လိုက်လို့ ကိုယ့် Dashboard မှာ ပြန်ပေါ်လာရင် အသံမြည်မယ်
            if (change.type === "added" || change.type === "modified") {
                const orderData = change.doc.data();
                // ကိုယ်တိုင် reject လုပ်ထားတဲ့ အော်ဒါမဟုတ်မှ အသံမြည်စေရန်
                if (orderData.lastRejectedRiderId !== auth.currentUser.uid) {
                    alarmSound.play().catch(e => console.log("Sound error:", e));
                }
            }
        });

        const activeSnap = await getDocs(query(collection(db, "orders"), 
            where("riderId", "==", auth.currentUser.uid),
            where("status", "in", ["accepted", "on_the_way", "arrived"])));
        
        const count = activeSnap.size;
        const isFull = count >= 7;

        const activeCountEl = document.getElementById('active-count');
        if(activeCountEl) activeCountEl.innerText = `${count} / 7`;
        if(isFull && activeCountEl) activeCountEl.style.color = "red";

        const container = document.getElementById('available-orders');
        if(container) {
            container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
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
                const btnDisabled = isFull ? "disabled" : "";
                const btnOpacity = isFull ? "opacity:0.5; cursor:not-allowed;" : "";

                card.innerHTML = `
                    <div class="item-info">
                        <b>📦 ${order.item}</b>
                        <span class="price">${order.deliveryFee?.toLocaleString()} KS</span>
                    </div>
                    <div style="font-size:0.8rem; color:#aaa; margin-bottom:10px;">
                        📍 ${order.pickup?.address.slice(0,35)}...
                    </div>
                    <div class="btn-group">
                        <button class="btn-accept-now" ${btnDisabled} style="${btnOpacity}" onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                        <button class="btn-accept-tmr" ${btnDisabled} style="${btnOpacity}" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှ</button>
                    </div>`;
                container.appendChild(card);
            });
        }
    });

    // (ခ) ကိုယ်ယူထားသော အော်ဒါများတွင် Customer က Cancel လုပ်လာသည်ကို စောင့်ကြည့်
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", auth.currentUser.uid)), (snap) => {
        const activeList = document.getElementById('active-orders-list');
        const rejectedSection = document.getElementById('rejected-orders-section');
        
        if(activeList) activeList.innerHTML = "";
        if(rejectedSection) rejectedSection.innerHTML = "";
        let hasActive = false;

        snap.forEach(orderDoc => {
            const data = orderDoc.data();
            const id = orderDoc.id;

            if (data.status === "cancelled") {
                // Customer ဖျက်လိုက်ရင် အသံမြည်စေရန်
                alarmSound.play().catch(e => console.log(e));
                
                const rejCard = document.createElement('div');
                rejCard.className = 'order-card rejected-card';
                rejCard.innerHTML = `
                    <span class="rejected-label">CANCELLED</span>
                    <b style="color:#ff4444;">⚠️ Customer မှ အော်ဒါဖျက်လိုက်ပါပြီ</b>
                    <p style="font-size:0.85rem; margin:5px 0;">ပစ္စည်း: ${data.item}</p>
                    <button class="btn-dismiss" onclick="dismissOrder('${id}')">Dashboard မှ ဖယ်ထုတ်မည်</button>
                `;
                rejectedSection.appendChild(rejCard);
                return;
            }

            if (["accepted", "on_the_way", "arrived"].includes(data.status)) {
                hasActive = true;
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way", icon = "📦";

                if(data.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived", icon = "🚴"; }
                if(data.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး (Complete)", nextStatus = "completed", icon = "🏁"; }

                const div = document.createElement('div');
                div.className = 'active-order-card';
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <b>${icon} ${data.status.toUpperCase()}</b>
                        <span style="color:#ffcc00; font-size:0.8rem; cursor:pointer;" onclick="cancelByRider('${id}')">✖ မယူတော့ပါ</span>
                    </div>
                    <p style="margin:10px 0;"><b>${data.item}</b></p>
                    <div style="font-size:0.85rem; color:#aaa; margin-bottom:10px;">
                        📞 ${data.phone} | 👤 ${data.customerName || "Customer"}
                    </div>
                    <button class="btn-status" onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}">${btnText}</button>
                `;
                activeList.appendChild(div);
            }
        });
        if(!hasActive && activeList) activeList.innerHTML = "<div class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိသေးပါ</div>";
    });
}

// --- ၄။ Functions ---

window.cancelByRider = async (id) => {
    if(!confirm("ဤအော်ဒါကို မယူတော့ဘဲ ပြန်လွှတ်မည်မှာ သေချာပါသလား?")) return;
    try {
        const docRef = doc(db, "orders", id);
        const snap = await getDoc(docRef);
        const order = snap.data();
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const riderName = userSnap.exists() ? userSnap.data().name : "Rider";

        await updateDoc(docRef, {
            status: "pending",
            riderId: null,
            riderName: null,
            acceptedAt: null,
            pickupSchedule: null,
            lastRejectedRiderId: auth.currentUser.uid // နောက်တစ်ကြိမ် Dashboard မှာ ပြန်မပေါ်လာစေရန်
        });

        const msg = createOrderMessage("❌ <b>Rider Rejected Order!</b>", order, riderName, "Rider က အော်ဒါပြန်လွှတ်လိုက်ပါပြီ");
        await notifyTelegram(msg);
        alert("အော်ဒါကို ပြန်လွှတ်လိုက်ပါပြီ။");
    } catch (err) { console.error(err); }
};

window.dismissOrder = async (id) => {
    try {
        // Dashboard ကနေ ဖယ်ထုတ်ဖို့ RiderId ကို dismiss လို့ ပြောင်းလိုက်မယ်
        await updateDoc(doc(db, "orders", id), { riderId: "dismissed" }); 
    } catch (err) { console.error(err); }
};

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const snap = await getDoc(docRef);
        const order = snap.data();
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const riderDisplayName = userSnap.exists() ? userSnap.data().name : "Rider";

        if(time === 'tomorrow') {
            await updateDoc(docRef, { 
                status: "pending_confirmation", 
                pickupSchedule: "tomorrow", 
                tempRiderId: auth.currentUser.uid, 
                tempRiderName: riderDisplayName 
            });
            const msg = createOrderMessage("⏳ <b>Rider Scheduled!</b>", order, riderDisplayName, "မနက်ဖြန်မှလာယူပါမည်");
            await notifyTelegram(msg);
            alert(`မနက်ဖြန်မှ လာယူမည့်အကြောင်း Customer ဆီ ပို့လိုက်ပါပြီ။`);
        } else {
            await updateDoc(docRef, { 
                status: "accepted", 
                pickupSchedule: "now",
                riderId: auth.currentUser.uid, 
                riderName: riderDisplayName, 
                acceptedAt: serverTimestamp() 
            });

            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({ action: "update", orderId: id, riderName: riderDisplayName, status: "Accepted" })
            });

            const msg = createOrderMessage("✅ <b>Order Accepted!</b>", order, riderDisplayName, "Rider လက်ခံလိုက်ပါပြီ");
            await notifyTelegram(msg);
        }
    } catch (err) { console.error("Accept Error:", err); }
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const snap = await getDoc(docRef);
        const order = snap.data();
        const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
        const riderName = userSnap.exists() ? userSnap.data().name : "Rider";

        await updateDoc(docRef, { status: status });

        const statusText = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        const msg = createOrderMessage("🚀 <b>Status Update!</b>", order, riderName, statusText);
        await notifyTelegram(msg);
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    if(confirm("ပို့ဆောင်မှုပြီးမြောက်ပြီလား?")) {
        try {
            const docRef = doc(db, "orders", id);
            const snap = await getDoc(docRef);
            const order = snap.data();
            const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
            const riderName = userSnap.exists() ? userSnap.data().name : "Rider";

            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });

            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({ action: "update", orderId: id, status: "COMPLETED" })
            });

            const msg = createOrderMessage("💰 <b>Order Completed!</b>", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ");
            await notifyTelegram(msg);
        } catch (err) { console.error(err); }
    }
};

auth.onAuthStateChanged((user) => { if(user) startTracking(); });
