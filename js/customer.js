import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupCoords = null;
let dropoffCoords = null;
let pickupMarker, dropoffMarker;

// *** အရေးကြီးသည်- Pickup က မြို့နယ်စာရင်းကို Drop-off ထဲသို့ ကူးထည့်ခြင်း ***
const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');
dropoffSelect.innerHTML = pickupSelect.innerHTML;

// --- ၂။ မြို့နယ်ရွေးချယ်မှု Logic ---
function handleTownshipChange(type) {
    const select = document.getElementById(type + '-township');
    const option = select.options[select.selectedIndex];
    
    if (!option.value) return;

    const lat = parseFloat(option.getAttribute('data-lat'));
    const lng = parseFloat(option.getAttribute('data-lng'));
    const townshipName = option.text;

    if (type === 'pickup') {
        pickupCoords = { lat, lng };
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map)
            .bindPopup(`ယူရန်: ${townshipName}`).openPopup();
    } else {
        dropoffCoords = { lat, lng };
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        dropoffMarker = L.marker([lat, lng], { draggable: true }).addTo(map)
            .bindPopup(`ပို့ရန်: ${townshipName}`).openPopup();
    }
    
    map.setView([lat, lng], 14);
    updatePricing();

    // Marker Dragging
    const marker = type === 'pickup' ? pickupMarker : dropoffMarker;
    marker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        if (type === 'pickup') pickupCoords = { lat: pos.lat, lng: pos.lng };
        else dropoffCoords = { lat: pos.lat, lng: pos.lng };
        updatePricing();
    });
}

pickupSelect.addEventListener('change', () => handleTownshipChange('pickup'));
dropoffSelect.addEventListener('change', () => handleTownshipChange('dropoff'));

// --- ၃။ ဈေးနှုန်းတွက်ချက်မှု ---
function updatePricing() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const distanceKm = (p1.distanceTo(p2) / 1000).toFixed(2);
        
        const weight = parseFloat(document.getElementById('item-weight').value) || 0;
        let fee = 1500 + (distanceKm * 500); 
        if (weight > 5) fee += (weight - 5) * 200;

        const totalFee = Math.round(fee);
        document.getElementById('placeOrderBtn').innerText = `ORDER NOW - ${totalFee} KS (${distanceKm} km)`;
        return { distanceKm, totalFee };
    }
    return null;
}

document.getElementById('item-weight').addEventListener('input', updatePricing);

// --- ၄။ Order Submission ---
document.getElementById('placeOrderBtn').addEventListener('click', async () => {
    const item = document.getElementById('item-detail').value;
    const weight = document.getElementById('item-weight').value;
    const value = document.getElementById('item-value').value;
    const phone = document.getElementById('receiver-phone').value;
    const feeInfo = updatePricing();

    const pTown = pickupSelect.options[pickupSelect.selectedIndex].text;
    const pAddr = document.getElementById('pickup-address').value;
    const dTown = dropoffSelect.options[dropoffSelect.selectedIndex].text;
    const dAddr = document.getElementById('dropoff-address').value;

    if (!pickupCoords || !dropoffCoords || !item || !phone || !weight || !value) {
        alert("အချက်အလက်အားလုံး ပြည့်စုံအောင်ဖြည့်ပါ");
        return;
    }

    try {
        const orderData = {
            pickup: { ...pickupCoords, address: `${pTown}၊ ${pAddr}` },
            dropoff: { ...dropoffCoords, address: `${dTown}၊ ${dAddr}` },
            item, weight: weight + " kg", itemValue: value + " KS",
            phone, deliveryFee: feeInfo.totalFee, status: "pending", createdAt: serverTimestamp()
        };

        await addDoc(collection(db, "orders"), orderData);

        const msg = `📦 <b>New Order!</b>\n\n📝 ပစ္စည်း: ${item}\n💰 ပို့ခ: ${feeInfo.totalFee} KS\n📍 ယူရန်: ${orderData.pickup.address}\n🏁 ပို့ရန်: ${orderData.dropoff.address}`;
        await notifyTelegram(msg);
        alert("Order တင်ခြင်း အောင်မြင်ပါသည်!");
        location.reload();
    } catch (e) {
        alert("Error: " + e.message);
    }
});
