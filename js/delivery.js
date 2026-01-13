import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const availableOrdersContainer = document.getElementById('available-orders');
const activeOrdersList = document.getElementById('active-orders-list'); // Rider ကိုင်ထားသော ၇ ခုပြရန်

// --- ၂။ Rider Limit စစ်ဆေးခြင်း (Max 7) ---
async function canAcceptMore() {
    const q = query(collection(db, "orders"), 
              where("riderId", "==", auth.currentUser.uid), 
              where("status", "in", ["accepted", "on_the_way", "arrived"]));
    const snap = await getDocs(q);
    return snap.size < 7;
}

// --- ၃။ Available Orders (Pending) ကို စောင့်ကြည့်ခြင်း ---
onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), (snapshot) => {
    availableOrdersContainer.innerHTML = snapshot.empty ? `<p>လောလောဆယ် Order မရှိသေးပါ</p>` : "";
    snapshot.forEach((orderDoc) => {
        const order = orderDoc.data();
        const id = orderDoc.id;
        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="status-tag">NEW</div>
            <p>📦 <b>${order.item}</b> | 💰 <b>${order.deliveryFee} KS</b></p>
            <p>📍 ${order.pickup.address} -> 🏁 ${order.dropoff.address}</p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
                <button onclick="handleAccept('${id}', 'now')">ချက်ချင်းယူမည်</button>
                <button style="background:#444;color:#fff" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်မှယူမည်</button>
            </div>`;
        availableOrdersContainer.appendChild(card);
    });
});

// --- ၄။ Rider လက်ရှိကိုင်ထားသော (Active 7) Orders ကို စောင့်ကြည့်ခြင်း ---
if (auth.currentUser) {
    const qActive = query(collection(db, "orders"), 
                    where("riderId", "==", auth.currentUser.uid),
                    where("status", "in", ["accepted", "on_the_way", "arrived"]));

    onSnapshot(qActive, (snapshot) => {
        activeOrdersList.innerHTML = "";
        snapshot.forEach((orderDoc) => {
            const order = orderDoc.data();
            const id = orderDoc.id;
            let statusIcon = "📦", statusText = "Accepted", btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way";

            if (order.status === "on_the_way") { statusIcon = "🚴"; statusText = "On the Way"; btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်"; nextStatus = "arrived"; }
            if (order.status === "arrived") { statusIcon = "✅"; statusText = "Arrived"; btnText = "💰 ပစ္စည်းအပ်နှံပြီး (Complete)"; nextStatus = "completed"; }

            const card = document.createElement('div');
            card.className = 'active-order-card';
            card.innerHTML = `
                <div style="border-bottom: 1px solid #eee; padding-bottom:5px; margin-bottom:5px;">
                    <b>${statusIcon} ${statusText}</b> <small style="float:right">#${id.slice(-5)}</small>
                </div>
                <p>📦 ${order.item} (${order.weight}kg) | 💵 ${order.deliveryFee} KS</p>
                <p>🏁 ${order.dropoff.address}</p>
                <button onclick="${nextStatus === 'completed' ? `completeOrder('${id}')` : `updateStatus('${id}', '${nextStatus}')`}" 
                        style="width:100%; background:#ffcc00; border:none; padding:10px; border-radius:5px;">${btnText}</button>`;
            activeOrdersList.appendChild(card);
        });
    });
}

// --- ၅။ Accept & Status Logic ---
window.handleAccept = async (orderId, timeOption) => {
    if (!auth.currentUser) return alert("Login အရင်ဝင်ပါ");
    if (!(await canAcceptMore())) return alert("အော်ဒါ ၇ ခု ပြည့်နေပါပြီ");

    const orderRef = doc(db, "orders", orderId);
    if (timeOption === 'tomorrow') {
        await updateDoc(orderRef, { status: "pending_confirmation", tempRiderId: auth.currentUser.uid, tempRiderName: auth.currentUser.email, pickupSchedule: "tomorrow" });
        alert("Customer အတည်ပြုချက် စောင့်ဆိုင်းနေပါသည်");
    } else {
        await updateDoc(orderRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: auth.currentUser.email, pickupSchedule: "now", acceptedAt: serverTimestamp() });
        await sendDetailedTelegram(orderId, "Accepted ✅");
    }
};

window.updateStatus = async (orderId, newStatus) => {
    await updateDoc(doc(db, "orders", orderId), { status: newStatus });
    await sendDetailedTelegram(orderId, newStatus.toUpperCase());
};

window.completeOrder = async (orderId) => {
    if (confirm("ပို့ဆောင်မှု ပြီးမြောက်ကြောင်း အတည်ပြုပါသလား?")) {
        await updateDoc(doc(db, "orders", orderId), { status: "completed", completedAt: serverTimestamp() });
        await sendDetailedTelegram(orderId, "Completed 💰");
    }
};

async function sendDetailedTelegram(orderId, statusLabel) {
    const snap = await getDocs(query(collection(db, "orders"), where("__name__", "==", orderId)));
    const order = snap.docs[0].data();
    const msg = `🔔 <b>STATUS UPDATE: ${statusLabel}</b>\n📦 Item: ${order.item}\n💵 Fee: ${order.deliveryFee} KS\n🚴 Rider: ${auth.currentUser.email}\n🏁 Destination: ${order.dropoff.address}`;
    await notifyTelegram(msg);
}
