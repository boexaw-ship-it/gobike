import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- 0. Google Apps Script URL ---
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၁။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker, dropoffMarker;
let pickupCoords = null;
let dropoffCoords = null;

// --- ၂။ Sync Dropdown Options ---
const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');
if (pickupSelect && dropoffSelect) {
    dropoffSelect.innerHTML = pickupSelect.innerHTML; 
}

// --- ၃။ Township Change & Map Update ---
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

// --- ၄။ Auto Pricing Logic ---
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

// --- ၅။ My Orders Logic (With Delete Function) ---
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
    event.stopPropagation(); // Card Click မဖြစ်အောင် တားသည်
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
        <div class="order-card" onclick="window.location.href='track.html?id=${order.id}'" style="cursor: pointer; margin-bottom: 10px; padding: 12px; background: #fafafa; border-radius: 12px; border: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
            <div class="order-info">
                <b style="display: block; font-size: 0.9rem;">📦 ${order.item}</b>
                <span style="font-size: 0.75rem; color: #888;">${order.time}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 15px;">
                <div class="track-icon" style="color: #ffcc00; font-size: 1.2rem;">📍</div>
                <div onclick="deleteLocalOrder('${order.id}', event)" style="color: #ff4444; font-size: 1.1rem; padding: 5px;">🗑️</div>
            </div>
        </div>
    `).join('');
}
displayMyOrders();

// --- ၆။ Submit Order ---
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

        // --- Logic: Signup Name ကို ဦးစားပေးယူခြင်း ---
        const customerDisplayName = auth.currentUser?.displayName || "Customer";

        const orderData = {
            userId: auth.currentUser?.uid || "anonymous",
            customerName: customerDisplayName, // နာမည်ရင်းကို Database ထဲသိမ်းသည်
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

        // --- ၇။ Google Sheets ပို့ခြင်း ---
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

        // --- ၈။ Telegram Notification ---
        const msg = `📦 <b>New Order Received!</b>\n` +
                    `--------------------------\n` +
                    `👤 Customer: <b>${customerDisplayName}</b>\n` + // နာမည်ရင်းပြသည်
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

auth.onAuthStateChanged((user) => { if(user) displayMyOrders(); });
