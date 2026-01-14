import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, query, where, onSnapshot, doc, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

// --- 0. Google Apps Script URL ---
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၁။ Auth & Profile Logic ---
onAuthStateChanged(auth, (user) => {
    const nameDisplay = document.getElementById('display-name');
    const roleDisplay = document.getElementById('display-role');

    if (user) {
        if (nameDisplay) nameDisplay.innerText = user.displayName || "User";
        if (roleDisplay) roleDisplay.innerText = "Customer Account";
        // Firestore မှ Real-time အော်ဒါမှတ်တမ်းကို စောင့်ကြည့်မည်
        displayMyOrders(); 
    } else {
        // အမှန်တကယ် Logout လုပ်မှသာ index ကို ပြန်ပို့မည် (Complete ဖြစ်ရုံနဲ့ Redirect မလုပ်စေရန်)
        if (!window.location.pathname.includes('index.html')) {
            window.location.href = "../index.html";
        }
    }
});

window.handleLogout = async () => {
    if (confirm("အကောင့်မှ ထွက်မှာ သေချာပါသလား?")) {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout Error:", error);
            alert("Logout လုပ်၍ မရပါ။");
        }
    }
};

// --- ၂။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker, dropoffMarker;
let pickupCoords = null;
let dropoffCoords = null;

// --- ၃။ Sync Dropdown Options ---
const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');
if (pickupSelect && dropoffSelect) {
    dropoffSelect.innerHTML = pickupSelect.innerHTML; 
}

// --- ၄။ Township Change & Map Update ---
window.updateLocation = function(type) {
    const select = document.getElementById(`${type}-township`);
    const option = select.options[select.selectedIndex];
    if (!option || !option.value) return;

    const lat = parseFloat(option.getAttribute('data-lat'));
    const lng = parseFloat(option.getAttribute('data-lng'));

    if (type === 'pickup') {
        pickupCoords = { lat, lng };
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    } else {
        dropoffCoords = { lat, lng };
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        dropoffMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    }

    map.flyTo([lat, lng], 15);
    calculatePrice();
};

if (pickupSelect) pickupSelect.onchange = () => updateLocation('pickup');
if (dropoffSelect) dropoffSelect.onchange = () => updateLocation('dropoff');

// --- ၅။ Auto Pricing Logic ---
function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2); 
        
        const weight = parseFloat(document.getElementById('item-weight').value) || 0;
        const itemValue = parseFloat(document.getElementById('item-value').value) || 0;

        let baseFee = 1500; 
        let distanceFee = dist * 500; 
        let weightExtra = weight > 5 ? (weight - 5) * 200 : 0;
        let insuranceFee = itemValue > 50000 ? itemValue * 0.01 : 0;

        const total = Math.round(baseFee + distanceFee + weightExtra + insuranceFee);
        
        const btn = document.getElementById('placeOrderBtn');
        if (btn) btn.innerText = `ORDER NOW - ${total.toLocaleString()} KS (${dist} km)`;
        
        return { dist, total, insuranceFee, weightExtra };
    }
}

document.getElementById('item-weight').oninput = calculatePrice;
document.getElementById('item-value').oninput = calculatePrice;

// --- ၆။ My Orders Logic (Firestore-based) ---
function displayMyOrders() {
    const listDiv = document.getElementById('orders-list');
    if (!listDiv || !auth.currentUser) return;

    const q = query(collection(db, "orders"), where("userId", "==", auth.currentUser.uid));
    
    onSnapshot(q, (snap) => {
        listDiv.innerHTML = "";
        if (snap.empty) {
            listDiv.innerHTML = "<p style='text-align:center; color:#888; font-size:0.8rem;'>မှတ်တမ်းမရှိသေးပါ</p>";
            return;
        }

        snap.forEach((orderDoc) => {
            const order = orderDoc.data();
            const id = orderDoc.id;

            if (order.customerHide === true) return;

            const card = document.createElement('div');
            card.className = "order-card";
            card.style = "cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 10px; background: #2a2a2a; border-radius: 8px; border-left: 4px solid ${order.status === 'completed' ? '#00ff00' : '#ffcc00'};";
            card.onclick = () => window.location.href = `track.html?id=${id}`;

            card.innerHTML = `
                <div class="order-info">
                    <b style="color: #fff;">📦 ${order.item}</b><br>
                    <span style="font-size: 0.75rem; color: #aaa;">Status: ${order.status.toUpperCase()}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="color:#ffcc00; font-size: 1.2rem;">📍</span>
                    <span onclick="deleteOrderPermanently('${id}', event)" style="color: #ff4444; font-size: 1.1rem; cursor: pointer;">🗑️</span>
                </div>
            `;
            listDiv.appendChild(card);
        });
    });
}

window.deleteOrderPermanently = async (id, event) => {
    event.stopPropagation(); 
    if(confirm("ဤအော်ဒါမှတ်တမ်းကို ဖယ်ထုတ်လိုပါသလား?")) {
        try {
            await updateDoc(doc(db, "orders", id), { customerHide: true });
        } catch (err) {
            console.error(err);
        }
    }
}

// --- ၇။ Submit Order (With Full Telegram Info) ---
document.getElementById('placeOrderBtn').onclick = async () => {
    const feeInfo = calculatePrice();
    const item = document.getElementById('item-detail').value;
    const phone = document.getElementById('receiver-phone').value;
    const payment = document.getElementById('payment-method').value;
    const weight = document.getElementById('item-weight').value;
    const itemValue = document.getElementById('item-value').value;

    if (!feeInfo || !item || !phone || !weight) {
        alert("ကျေးဇူးပြု၍ အချက်အလက်များကို ပြည့်စုံအောင် ဖြည့်ပေးပါခင်ဗျာ။");
        return;
    }

    try {
        const pTown = pickupSelect.options[pickupSelect.selectedIndex].text;
        const dTown = dropoffSelect.options[dropoffSelect.selectedIndex].text;
        const pAddr = document.getElementById('pickup-address').value;
        const dAddr = document.getElementById('dropoff-address').value;

        const customerDisplayName = auth.currentUser?.displayName || "Customer";

        const orderData = {
            userId: auth.currentUser?.uid || "anonymous",
            customerName: customerDisplayName,
            pickup: { ...pickupCoords, address: `${pTown}, ${pAddr}` },
            dropoff: { ...dropoffCoords, address: `${dTown}, ${dAddr}` },
            item: item,
            weight: weight,
            itemValue: itemValue,
            phone: phone,
            paymentMethod: payment === "COD" ? "Cash on Delivery (ပို့ခအိမ်ရောက်ချေ)" : "Cash at Pickup (ပို့ခကြိုပေး)",
            deliveryFee: feeInfo.total,
            status: "pending",
            customerHide: false,
            createdAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, "orders"), orderData);
        const orderId = docRef.id;

        // Google Sheets Sync
        fetch(SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({
                action: "create",
                orderId: orderId,
                item: item,
                weight: weight + " kg",
                price: itemValue + " KS",
                deliveryFee: feeInfo.total,
                payment: orderData.paymentMethod,
                phone: phone,
                address: orderData.dropoff.address,
                customerName: customerDisplayName,
                riderName: "-" 
            })
        });

        // 🔥 Telegram Notification (သင်တောင်းဆိုထားသော အချက်အလက်အပြည့်အစုံ)
        const msg = `📦 <b>New Order Received!</b>\n` +
                    `--------------------------\n` +
                    `👤 Customer: <b>${customerDisplayName}</b>\n` +
                    `📝 ပစ္စည်း: <b>${item}</b>\n` +
                    `⚖️ အလေးချိန်: <b>${weight} kg</b>\n` +
                    `💰 ပစ္စည်းတန်ဖိုး: <b>${itemValue} KS</b>\n` +
                    `--------------------------\n` +
                    `💵 <b>စုစုပေါင်းပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
                    `💳 Payment: <b>${orderData.paymentMethod}</b>\n` +
                    `📞 ဖုန်း: <b>${phone}</b>\n\n` +
                    `📍 ယူရန်: ${orderData.pickup.address}\n` +
                    `🏁 ပို့ရန်: ${orderData.dropoff.address}\n\n` +
                    `🔗 <a href="https://boexaw-ship-it.github.io/gobike/html/track.html?id=${orderId}">Track Order</a>`;

        await notifyTelegram(msg);

        alert("Order အောင်မြင်စွာ တင်ပြီးပါပြီ။");
        window.location.href = `track.html?id=${orderId}`;

    } catch (e) {
        console.error("Order Submit Error:", e);
        alert("Error: " + e.message);
    }
};

