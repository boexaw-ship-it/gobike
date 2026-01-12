import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker, dropoffMarker;
let pickupCoords = null;
let dropoffCoords = null;

// --- ၂။ Sync Dropdown Options ---
const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');
dropoffSelect.innerHTML = pickupSelect.innerHTML;

// --- ၃။ Township Change Handle ---
function updateLocation(type) {
    const select = document.getElementById(`${type}-township`);
    const option = select.options[select.selectedIndex];
    
    if (!option.value) return;

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
}

pickupSelect.onchange = () => updateLocation('pickup');
dropoffSelect.onchange = () => updateLocation('dropoff');

// --- ၄။ Pricing logic ---
function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2);
        
        const weight = parseFloat(document.getElementById('item-weight').value) || 0;
        let fee = 1500 + (dist * 500); 
        if (weight > 5) fee += (weight - 5) * 200;

        const total = Math.round(fee);
        document.getElementById('placeOrderBtn').innerText = `ORDER NOW - ${total} KS (${dist} km)`;
        return { dist, total };
    }
}

document.getElementById('item-weight').oninput = calculatePrice;

// --- ၅။ Submit Order ---
document.getElementById('placeOrderBtn').onclick = async () => {
    const feeInfo = calculatePrice();
    const item = document.getElementById('item-detail').value;
    const phone = document.getElementById('receiver-phone').value;
    const payment = document.getElementById('payment-method').value;

    if (!feeInfo || !item || !phone) {
        alert("အချက်အလက်များကို ပြည့်စုံအောင် ဖြည့်ပေးပါခင်ဗျာ။");
        return;
    }

    try {
        const pTown = pickupSelect.options[pickupSelect.selectedIndex].text;
        const dTown = dropoffSelect.options[dropoffSelect.selectedIndex].text;

        const orderData = {
            pickup: { ...pickupCoords, address: `${pTown}, ${document.getElementById('pickup-address').value}` },
            dropoff: { ...dropoffCoords, address: `${dTown}, ${document.getElementById('dropoff-address').value}` },
            item,
            weight: document.getElementById('item-weight').value + " kg",
            itemValue: document.getElementById('item-value').value + " KS",
            phone,
            paymentMethod: payment === "COD" ? "Cash on Delivery" : "Cash at Pickup",
            deliveryFee: feeInfo.total,
            status: "pending",
            createdAt: serverTimestamp()
        };

        // Firebase သို့ သိမ်းဆည်းခြင်း
        await addDoc(collection(db, "orders"), orderData);
        
        // Telegram သို့ အသိပေးခြင်း
        const msg = `📦 <b>New Order Received!</b>\n` +
                    `--------------------------\n` +
                    `📝 ပစ္စည်း: ${item}\n` +
                    `💰 ပို့ခ: ${feeInfo.total} KS\n` +
                    `💳 Payment: ${orderData.paymentMethod}\n` +
                    `📞 ဖုန်း: ${phone}\n` +
                    `📍 ယူရန်: ${orderData.pickup.address}\n` +
                    `🏁 ပို့ရန်: ${orderData.dropoff.address}`;

        await notifyTelegram(msg);

        alert("Order အောင်မြင်စွာ တင်ပြီးပါပြီ။");
        location.reload();
    } catch (e) {
        alert("Error: " + e.message);
    }
};

