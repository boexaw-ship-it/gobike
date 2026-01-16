import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, query, where, onSnapshot, doc, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

// --- 0. Setup ---
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၁။ Auth Logic ---
onAuthStateChanged(auth, (user) => {
    const nameDisplay = document.getElementById('display-name');
    if (user) {
        if (nameDisplay) nameDisplay.innerText = user.displayName || "User";
        displayMyOrders(); 
        findMyInitialLocation(); 
    } else if (!window.location.pathname.includes('index.html')) {
        window.location.href = "../index.html";
    }
});

const setupLogout = () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            Swal.fire({
                title: 'အကောင့်မှ ထွက်မလား?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#4e342e',
                confirmButtonText: 'ထွက်မည်',
                cancelButtonText: 'မထွက်တော့ပါ'
            }).then(async (result) => {
                if (result.isConfirmed) await signOut(auth);
            });
        };
    }
};
setupLogout();

// --- ၂။ Map & Marker Logic ---
window.map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.map);

let pickupMarker = null, dropoffMarker = null;
let pickupCoords = null, dropoffCoords = null;
let riderMarkers = {}; 

const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2263/2263051.png', 
    iconSize: [40, 40], iconAnchor: [20, 40]
});

const redIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// Pickup Marker Logic
function updatePickupMarker(latlng) {
    const pos = Array.isArray(latlng) ? { lat: latlng[0], lng: latlng[1] } : latlng;
    if (!pickupMarker) {
        pickupMarker = L.marker(pos, { draggable: true, zIndexOffset: 1000 }).addTo(window.map);
        pickupMarker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            pickupCoords = { lat: newPos.lat, lng: newPos.lng };
            reverseGeocode(newPos.lat, newPos.lng);
            calculatePrice();
        });
    } else {
        pickupMarker.setLatLng(pos);
    }
    pickupCoords = { lat: pos.lat, lng: pos.lng };
}

// Map Click Logic
window.map.on('click', (e) => {
    if (!pickupCoords) {
        updatePickupMarker(e.latlng);
        reverseGeocode(e.latlng.lat, e.latlng.lng);
    } else if (!dropoffCoords) {
        updateDropoffMarker(e.latlng);
    } else {
        // အကယ်၍ marker နှစ်ခုလုံးရှိနေရင် pickup ကို အရင်ရွှေ့ပေးပါမယ်
        updatePickupMarker(e.latlng);
        reverseGeocode(e.latlng.lat, e.latlng.lng);
    }
    calculatePrice();
});

function updateDropoffMarker(pos) {
    if (dropoffMarker) window.map.removeLayer(dropoffMarker);
    dropoffMarker = L.marker(pos, { draggable: true, icon: redIcon }).addTo(window.map);
    dropoffCoords = { lat: pos.lat, lng: pos.lng };
    dropoffMarker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        dropoffCoords = { lat: newPos.lat, lng: newPos.lng };
        calculatePrice();
    });
}

// Reverse Geocoding
async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        const address = data.display_name;
        if (document.getElementById('pin-address-display')) 
            document.getElementById('pin-address-display').innerText = `📍 ${address}`;
        if (document.getElementById('pickup-address'))
            document.getElementById('pickup-address').value = address;
    } catch (e) { console.error("Geocode error"); }
}

// --- ၃။ Auto Pricing & Location Select ---
window.updateLocation = function(type) {
    const select = document.getElementById(`${type}-township`);
    if (!select || !select.value) return;
    const option = select.options[select.selectedIndex];
    const lat = parseFloat(option.getAttribute('data-lat'));
    const lng = parseFloat(option.getAttribute('data-lng'));

    if (type === 'pickup') {
        updatePickupMarker({ lat, lng });
        reverseGeocode(lat, lng);
    } else {
        updateDropoffMarker({ lat, lng });
    }
    window.map.flyTo([lat, lng], 15);
    calculatePrice();
};

function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2); 

        const weight = parseFloat(document.getElementById('item-weight')?.value) || 0;
        const itemVal = parseFloat(document.getElementById('item-value')?.value) || 0;

        const weightExtra = weight > 5 ? (weight - 5) * 200 : 0;
        const total = Math.round(1500 + (dist * 500) + weightExtra + (itemVal > 50000 ? itemVal * 0.01 : 0));
        
        const btn = document.getElementById('placeOrderBtn');
        if (btn) btn.innerText = `ORDER NOW - ${total.toLocaleString()} KS (${dist} km)`;
        return { dist, total };
    }
    return null;
}

// Event Listeners for inputs
['item-weight', 'item-value'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = calculatePrice;
});

// --- ၄။ Order Management ---
function displayMyOrders() {
    const listDiv = document.getElementById('orders-list');
    if (!listDiv || !auth.currentUser) return;

    const q = query(collection(db, "orders"), where("userId", "==", auth.currentUser.uid));
    onSnapshot(q, (snap) => {
        listDiv.innerHTML = snap.empty ? "<p style='text-align:center; color:#888;'>မှတ်တမ်းမရှိသေးပါ</p>" : "";
        snap.forEach((orderDoc) => {
            const order = orderDoc.data();
            if (order.customerHide) return;
            const card = document.createElement('div');
            card.className = "order-card";
            card.style = "padding:16px; margin-bottom:12px; border:1px solid #eee; border-radius:12px; display:flex; justify-content:space-between; align-items:center; background:#fff;";
            card.innerHTML = `
                <div onclick="window.location.href='track.html?id=${orderDoc.id}'" style="cursor:pointer; flex-grow:1;">
                    <b>📦 ${order.item || 'Parcel'}</b><br>
                    <small>Status: ${order.status}</small><br>
                    <span style="color:#4e342e; font-weight:bold;">${(order.deliveryFee || 0).toLocaleString()} KS</span>
                </div>
                <span onclick="window.deleteOrderPermanently('${orderDoc.id}')" style="cursor:pointer; color:red;">🗑️</span>
            `;
            listDiv.appendChild(card);
        });
    });
}

window.deleteOrderPermanently = async (id) => {
    const res = await Swal.fire({ title: 'ဖယ်ထုတ်မလား?', icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) await updateDoc(doc(db, "orders", id), { customerHide: true });
};

// --- ၅။ Submit Order (Telegram logic အပြည့်အစုံ) ---
const placeOrderBtn = document.getElementById('placeOrderBtn');
if (placeOrderBtn) {
    placeOrderBtn.onclick = async () => {
        try {
            const feeInfo = calculatePrice();
            const item = document.getElementById('item-detail')?.value;
            const phone = document.getElementById('receiver-phone')?.value;
            const weight = document.getElementById('item-weight')?.value || 0;
            const itemValue = document.getElementById('item-value')?.value || 0;
            const payment = document.getElementById('payment-method')?.value;
            const pAddr = document.getElementById('pickup-address')?.value;
            const dAddr = document.getElementById('dropoff-address')?.value || "မြေပုံပေါ်ရှိ သတ်မှတ်နေရာ";

            if (!feeInfo || !item || !phone || !pAddr || !pickupCoords || !dropoffCoords) {
                Swal.fire("သတိပေးချက်", "အချက်အလက်များ ပြည့်စုံစွာဖြည့်ပါ", "warning");
                return;
            }

            placeOrderBtn.disabled = true;
            placeOrderBtn.innerText = "Processing...";

            const customerName = auth.currentUser?.displayName || "Customer";
            const orderData = {
                userId: auth.currentUser.uid,
                customerName: customerName,
                pickup: { ...pickupCoords, address: pAddr },
                dropoff: { ...dropoffCoords, address: dAddr },
                item, weight, itemValue, phone,
                paymentMethod: payment === "COD" ? "Cash on Delivery" : "Cash at Pickup",
                deliveryFee: feeInfo.total, status: "pending", customerHide: false, createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "orders"), orderData);
            const trackUrl = `https://boexaw-ship-it.github.io/gobike/html/track.html?id=${docRef.id}`;

            // Telegram Message
            const msg = `📦 <b>New Order Received!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━\n` +
                        `👤 Customer: <b>${customerName}</b>\n` +
                        `📞 ဖုန်း: <b>${phone}</b>\n` + 
                        `📝 ပစ္စည်း: <b>${item}</b>\n` +
                        `⚖️ အလေးချိန်: <b>${weight} KG</b>\n` +
                        `💰 တန်ဖိုး: <b>${parseFloat(itemValue).toLocaleString()} KS</b>\n` +
                        `💵 <b>ပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
                        `📍 ယူရန်: ${pAddr}\n` +
                        `🏁 ပို့ရန်: ${dAddr}\n\n` +
                        `✨ <a href="${trackUrl}"><b>📍 ခြေရာခံရန်နှိပ်ပါ</b></a>`;

            await notifyTelegram(msg);

            // Google Sheets Log
            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({ action: "create", orderId: docRef.id, item, weight, deliveryFee: feeInfo.total, customerName })
            }).catch(e => console.log("Sheet error"));

            await Swal.fire("အောင်မြင်ပါသည်", "အော်ဒါတင်ပြီးပါပြီ!", "success");
            window.location.href = `track.html?id=${docRef.id}`;

        } catch (e) {
            console.error(e);
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = "ORDER NOW";
            Swal.fire("Error", "အော်ဒါတင်လို့မရပါ- " + e.message, "error");
        }
    };
}

// Utility
window.goToMyLocation = function() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const loc = [pos.coords.latitude, pos.coords.longitude];
            window.map.flyTo(loc, 16);
            updatePickupMarker(loc);
            reverseGeocode(loc[0], loc[1]);
        });
    }
};

function findMyInitialLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const loc = [pos.coords.latitude, pos.coords.longitude];
            window.map.setView(loc, 15);
            updatePickupMarker(loc);
            reverseGeocode(loc[0], loc[1]);
        });
    }
}
