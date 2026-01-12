import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
// မြေပုံမပေါ်လျှင် map.invalidateSize() သုံးရန်လိုအပ်နိုင်သည်
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupCoords = null;
let dropoffCoords = null;
let pickupMarker, dropoffMarker;

// *** Drop-off မြို့နယ်စာရင်းကို Pickup အတိုင်း ကူးထည့်ခြင်း ***
const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');
dropoffSelect.innerHTML = pickupSelect.innerHTML;

// --- ၂။ Township Select logic ---
function onTownshipChange(type) {
    const select = document.getElementById(type + '-township');
    const option = select.options[select.selectedIndex];
    
    if (!option.value) return;

    const lat = parseFloat(option.getAttribute('data-lat'));
    const lng = parseFloat(option.getAttribute('data-lng'));
    const townshipName = option.text;

    if (type === 'pickup') {
        pickupCoords = { lat, lng };
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng]).addTo(map).bindPopup("ယူရန်: " + townshipName).openPopup();
    } else {
        dropoffCoords = { lat, lng };
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        dropoffMarker = L.marker([lat, lng]).addTo(map).bindPopup("ပို့ရန်: " + townshipName).openPopup();
    }
    
    map.setView([lat, lng], 14);
    calculateFee();
}

pickupSelect.addEventListener('change', () => onTownshipChange('pickup'));
dropoffSelect.addEventListener('change', () => onTownshipChange('dropoff'));

// --- ၃။ Pricing Calculation ---
function calculateFee() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const distance = (p1.distanceTo(p2) / 1000).toFixed(2);
        
        const weight = parseFloat(document.getElementById('item-weight').value) || 0;
        let fee = 1500 + (distance * 500); // 1km ကို ၅၀၀ နှုန်း
        if (weight > 5) fee += (weight - 5) * 200;

        const total = Math.round(fee);
        document.getElementById('placeOrderBtn').innerText = `ORDER NOW - ${total} KS (${distance} km)`;
        return { distance, total };
    }
    return null;
}

document.getElementById('item-weight').addEventListener('input', calculateFee);

// --- ၄။ Place Order ---
document.getElementById('placeOrderBtn').addEventListener('click', async () => {
    const feeInfo = calculateFee();
    const item = document.getElementById('item-detail').value;
    const phone = document.getElementById('receiver-phone').value;
    const weight = document.getElementById('item-weight').value;
    const value = document.getElementById('item-value').value;

    if (!feeInfo || !item || !phone) {
        alert("မြို့နယ်နှင့် အချက်အလက်များ ပြည့်စုံအောင်ဖြည့်ပါ");
        return;
    }

    const pTown = pickupSelect.options[pickupSelect.selectedIndex].text;
    const pAddr = document.getElementById('pickup-address').value;
    const dTown = dropoffSelect.options[dropoffSelect.selectedIndex].text;
    const dAddr = document.getElementById('dropoff-address').value;

    try {
        const orderData = {
            pickup: { ...pickupCoords, address: `${pTown}၊ ${pAddr}` },
            dropoff: { ...dropoffCoords, address: `${dTown}၊ ${dAddr}` },
            item, weight, itemValue: value,
            deliveryFee: feeInfo.total,
            status: "pending",
            createdAt: serverTimestamp()
        };

        await addDoc(collection(db, "orders"), orderData);
        
        const msg = `📦 <b>Order New!</b>\n\nယူရန်: ${orderData.pickup.address}\nပို့ရန်: ${orderData.dropoff.address}\nပို့ခ: ${feeInfo.total} KS`;
        notifyTelegram(msg);
        
        alert("Order တင်ခြင်း အောင်မြင်ပါသည်");
        location.reload();
    } catch (e) {
        alert("Error: " + e.message);
    }
});
