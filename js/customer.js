import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp 
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
        // Login ဝင်ထားလျှင် နာမည်ပြမည်
        if (nameDisplay) nameDisplay.innerText = user.displayName || "User";
        if (roleDisplay) roleDisplay.innerText = "Customer Account";
        displayMyOrders(); // အော်ဒါမှတ်တမ်းပြရန်
    } else {
        // Login မဝင်ထားလျှင် Login Page (index.html) သို့ ပြန်ပို့မည်
        // html/ folder ထဲမှာ ရှိနေသဖြင့် ../index.html ကို သုံးရပါသည်
        window.location.href = "../index.html";
    }
});

// Logout Function
window.handleLogout = async () => {
    if (confirm("အကောင့်မှ ထွက်မှာ သေချာပါသလား?")) {
        try {
            await signOut(auth);
            // signOut ပြီးလျှင် onAuthStateChanged မှ အလိုအလျောက် redirect လုပ်သွားပါမည်
        } catch (error) {
            console.error("Logout Error:", error);
        }
    }
};

// Logout Button Event Listener
document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

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

// --- ၆။ My Orders Logic (Local Record) ---
function saveOrderToLocal(id, item) {
    let orders = JSON.parse(localStorage.getItem('myOrders') || "[]");
    const newOrder = {
        id: id,
        item: item,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    orders.unshift(newOrder); 
    if (orders.length > 5) orders = orders.slice(0, 5); 
    localStorage.setItem('myOrders', JSON.stringify(orders));
    displayMyOrders();
}

window.deleteLocalOrder = function(id, event) {
    event.stopPropagation(); 
    if(confirm("ဤအော်ဒါမှတ်တမ်းကို ဖျက်လိုပါသလား?")) {
        let orders = JSON.parse(localStorage.getItem('myOrders') || "[]");
        orders = orders.filter(o => o.id !== id);
        localStorage.setItem('myOrders', JSON.stringify(orders));
        displayMyOrders();
    }
}

function displayMyOrders() {
    const listDiv = document.getElementById('orders-list');
    if (!listDiv) return;
    
    const orders = JSON.parse(localStorage.getItem('myOrders') || "[]");
    
    if (orders.length === 0) {
        listDiv.innerHTML = "<p style='text-align:center; color:#888; font-size:0.8rem;'>မှတ်တမ်းမရှိသေးပါ</p>";
        return;
    }

    listDiv.innerHTML = orders.map(order => `
        <div class="order-card" onclick="window.location.href='track.html?id=${order.id}'">
            <div class="order-info">
                <b>📦 ${order.item}</b>
                <span>${order.time}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 15px;">
                <div class="track-icon">📍</div>
                <div onclick="deleteLocalOrder('${order.id}', event)" style="color: #ff4444; font-size: 1.1rem; padding: 5px;">🗑️</div>
            </div>
        </div>
    `).join('');
}

// --- ၇။ Submit Order ---
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
            weight: weight + " kg",
            itemValue: itemValue + " KS",
            phone: phone,
            paymentMethod: payment === "COD" ? "Cash on Delivery (ပို့ခအိမ်ရောက်ချေ)" : "Cash at Pickup (ပို့ခကြိုပေး)",
            deliveryFee: feeInfo.total,
            status: "pending",
            createdAt: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, "orders"), orderData);
        const orderId = docRef.id;

        saveOrderToLocal(orderId, item);

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

        // Telegram Notification
        const msg = `📦 <b>New Order Received!</b>\n` +
                    `--------------------------\n` +
                    `👤 Customer: <b>${customerDisplayName}</b>\n` +
                    `📝 ပစ္စည်း: <b>${item}</b>\n` +
                    `⚖️ အလေးချိန်: ${weight} kg\n` +
                    `💰 ပစ္စည်းတန်ဖိုး: ${itemValue} KS\n` +
                    `--------------------------\n` +
                    `💵 <b>စုစုပေါင်းပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
                    `💳 Payment: ${orderData.paymentMethod}\n` +
                    `📞 ဖုန်း: ${phone}\n\n` +
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

