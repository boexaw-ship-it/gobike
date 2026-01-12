import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 13); 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

const bikeIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/71/71422.png',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

let pickupCoords = null;
let dropoffCoords = null;
let pickupMarker, dropoffMarker;
let pickupAddr = ""; 
let dropoffAddr = ""; 
const riderMarkers = {}; 

// --- ၂။ Search Box (Geocoder Plugin) ---
const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: "နေရာရှာရန်...",
})
.on('markgeocode', function(e) {
    const latlng = e.geocode.center;
    map.setView(latlng, 16);
    handleMapSelection(latlng, e.geocode.name);
})
.addTo(map);

// Lat/Long ကို လိပ်စာအဖြစ်ပြောင်းပေးမည့် Function
async function fetchAddress(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        return data.display_name.split(',').slice(0, 3).join(',') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// --- ၃။ Active Rider Live Tracking ---
onSnapshot(collection(db, "active_riders"), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const id = change.doc.id;
        if (data.lat && data.lng) {
            if (riderMarkers[id]) {
                riderMarkers[id].setLatLng([data.lat, data.lng]);
            } else {
                riderMarkers[id] = L.marker([data.lat, data.lng], { icon: bikeIcon })
                    .addTo(map)
                    .bindPopup(`Rider: ${data.name || "Active Rider"}`);
            }
        }
    });
});

// --- ၄။ တည်နေရာ ရွေးချယ်မှု နှင့် စာသားသတ်မှတ်မှု Logic ---
async function handleMapSelection(latlng, address = null) {
    const { lat, lng } = latlng;

    if (!pickupCoords) {
        pickupCoords = { lat, lng };
        document.getElementById('pickup-text').value = "လိပ်စာ ရှာဖွေနေသည်...";
        pickupAddr = address || await fetchAddress(lat, lng); 
        
        pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map)
            .bindPopup(`ယူရန်: ${pickupAddr}`).openPopup();
        document.getElementById('pickup-text').value = pickupAddr;

        pickupMarker.on('dragend', async (e) => {
            const newPos = e.target.getLatLng();
            pickupCoords = { lat: newPos.lat, lng: newPos.lng };
            pickupAddr = await fetchAddress(newPos.lat, newPos.lng);
            document.getElementById('pickup-text').value = pickupAddr;
            calculateFinalFee();
        });
    } 
    else if (!dropoffCoords) {
        dropoffCoords = { lat, lng };
        document.getElementById('dropoff-text').value = "လိပ်စာ ရှာဖွေနေသည်...";
        dropoffAddr = address || await fetchAddress(lat, lng); 
        
        dropoffMarker = L.marker([lat, lng], { draggable: true }).addTo(map)
            .bindPopup(`ပို့ရန်: ${dropoffAddr}`).openPopup();
        document.getElementById('dropoff-text').value = dropoffAddr;

        dropoffMarker.on('dragend', async (e) => {
            const newPos = e.target.getLatLng();
            dropoffCoords = { lat: newPos.lat, lng: newPos.lng };
            dropoffAddr = await fetchAddress(newPos.lat, newPos.lng);
            document.getElementById('dropoff-text').value = dropoffAddr;
            calculateFinalFee();
        });
        calculateFinalFee();
    }
}

map.on('click', (e) => handleMapSelection(e.latlng));

// --- ၅။ စာရိုက်ပြီး Enter ခေါက်ပါက ရှာပေးမည့်စနစ် ---
function setupInputSearch(inputId) {
    document.getElementById(inputId).addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const query = this.value;
            L.Control.Geocoder.nominatim().geocode(query, (results) => {
                if (results.length > 0) {
                    const res = results[0];
                    map.setView(res.center, 16);
                    handleMapSelection(res.center, res.name);
                } else {
                    alert("ရှာမတွေ့ပါ");
                }
            });
        }
    });
}
setupInputSearch('pickup-text');
setupInputSearch('dropoff-text');

// --- ၆။ Distance & Fee Calculation ---
function calculateFinalFee() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const distanceKm = (p1.distanceTo(p2) / 1000).toFixed(2);
        
        const weight = parseFloat(document.getElementById('item-weight').value) || 0;
        let baseFee = 1500;
        let perKmRate = 500;
        let extraWeightFee = weight > 5 ? (weight - 5) * 200 : 0;

        const totalFee = Math.round(baseFee + (distanceKm * perKmRate) + extraWeightFee);
        
        document.getElementById('placeOrderBtn').innerText = `ORDER NOW - ${totalFee} KS (${distanceKm} km)`;
        return { distanceKm, totalFee };
    }
    return null;
}

document.getElementById('item-weight').addEventListener('input', calculateFinalFee);

// --- ၇။ Order Submission ---
document.getElementById('placeOrderBtn').addEventListener('click', async () => {
    const item = document.getElementById('item-detail').value;
    const phone = document.getElementById('receiver-phone').value;
    const weight = document.getElementById('item-weight').value;
    const itemValue = document.getElementById('item-value').value;
    const feeInfo = calculateFinalFee();

    if (!pickupCoords || !dropoffCoords || !item || !phone || !weight || !itemValue) {
        alert("အချက်အလက်အားလုံး ပြည့်စုံအောင်ဖြည့်ပါ");
        return;
    }

    try {
        const orderData = {
            userId: auth.currentUser?.uid || "anonymous",
            pickup: { ...pickupCoords, address: document.getElementById('pickup-text').value },
            dropoff: { ...dropoffCoords, address: document.getElementById('dropoff-text').value },
            item: item,
            weight: weight + " kg",
            itemValue: itemValue + " KS",
            phone: phone,
            distance: feeInfo.distanceKm + " km",
            deliveryFee: feeInfo.totalFee,
            status: "pending",
            createdAt: serverTimestamp()
        };

        await addDoc(collection(db, "orders"), orderData);

        // Telegram Message Link Format ပြင်ဆင်ထားသည်
        const msg = `📦 <b>Order အသစ် (COD)</b>\n\n` +
                    `📝 <b>ပစ္စည်း:</b> ${item} (${weight} kg)\n` +
                    `💰 <b>ပစ္စည်းတန်ဖိုး:</b> ${itemValue} KS\n` +
                    `🛵 <b>ပို့ခ:</b> ${feeInfo.totalFee} KS\n` +
                    `📞 <b>ဖုန်း:</b> ${phone}\n\n` +
                    `📍 <b>ယူရန်:</b> ${orderData.pickup.address}\n` +
                    `🔗 <a href="https://www.google.com/maps?q=${pickupCoords.lat},${pickupCoords.lng}">Map တွင်ကြည့်ရန်</a>\n\n` +
                    `🏁 <b>ပို့ရန်:</b> ${orderData.dropoff.address}\n` +
                    `🔗 <a href="https://www.google.com/maps?q=${dropoffCoords.lat},${dropoffCoords.lng}">Map တွင်ကြည့်ရန်</a>`;
        
        await notifyTelegram(msg);
        alert("Order အောင်မြင်ပါသည်။ Rider ကို စောင့်ဆိုင်းပေးပါ။");
        location.reload(); 

    } catch (error) {
        alert("Error: " + error.message);
    }
});

