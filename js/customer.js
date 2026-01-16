import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, query, where, onSnapshot, doc, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၁။ Auth & Profile Logic ---
onAuthStateChanged(auth, (user) => {
    const nameDisplay = document.getElementById('display-name');
    if (user) {
        if (nameDisplay) nameDisplay.innerText = user.displayName || "User";
        displayMyOrders(); 
    } else {
        if (!window.location.pathname.includes('index.html')) window.location.href = "../index.html";
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
                cancelButtonText: 'မထွက်တော့ပါ',
            }).then(async (result) => {
                if (result.isConfirmed) await signOut(auth);
            });
        };
    }
};
setupLogout();

// --- ၂။ Map & Logic Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
window.map = map; 

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker = null; 
let dropoffMarker = null;
let pickupCoords = null; 
let dropoffCoords = null;
let riderMarkers = {}; 

const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
});

// လိပ်စာရှာဖွေပေးသည့် Function
async function fetchAddress(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        const addr = data.display_name;
        document.getElementById('pin-address-display').innerText = `📍 ${addr}`;
        document.getElementById('pickup-address').value = addr;
    } catch (e) { console.log("Geocode error"); }
}

// --- (က) Go To My Location ---
window.goToMyLocation = function() {
    if (navigator.geolocation) {
        const locateBtn = document.querySelector('.locate-btn');
        if(locateBtn) locateBtn.innerText = "⏳"; 

        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.flyTo([lat, lng], 16);
            
            if (!pickupMarker) {
                pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
                window.currentMarker = pickupMarker;
                pickupMarker.on('dragend', () => {
                    const pos = pickupMarker.getLatLng();
                    pickupCoords = { lat: pos.lat, lng: pos.lng };
                    fetchAddress(pos.lat, pos.lng);
                    calculatePrice();
                });
            } else {
                pickupMarker.setLatLng([lat, lng]);
            }

            pickupCoords = { lat, lng };
            fetchAddress(lat, lng);
            calculatePrice();
            if(locateBtn) locateBtn.innerText = "🎯";
        }, (err) => {
            if(locateBtn) locateBtn.innerText = "🎯";
            Swal.fire("Error", "GPS ဖွင့်ထားရန် လိုအပ်ပါသည်", "error");
        }, { enableHighAccuracy: true });
    }
};

// --- (ခ) Live Riders ---
const ridersQuery = query(collection(db, "active_riders"), where("isOnline", "==", true));
onSnapshot(ridersQuery, (snap) => {
    snap.docChanges().forEach((change) => {
        const data = change.doc.data();
        const id = change.doc.id;
        if (change.type === "added" || change.type === "modified") {
            if (riderMarkers[id]) map.removeLayer(riderMarkers[id]);
            riderMarkers[id] = L.marker([data.lat, data.lng], { icon: riderIcon })
                .addTo(map).bindPopup(`<b style="color:#4e342e;">🚴 Rider: ${data.name || 'Active'}</b>`);
        } else if (change.type === "removed") {
            if (riderMarkers[id]) { map.removeLayer(riderMarkers[id]); delete riderMarkers[id]; }
        }
    });
});

// --- (ဂ) Update From Dropdown ---
window.updateLocation = function(type) {
    const select = document.getElementById(`${type}-township`);
    const option = select?.options[select.selectedIndex];
    if (!option?.value) return;

    const lat = parseFloat(option.getAttribute('data-lat'));
    const lng = parseFloat(option.getAttribute('data-lng'));

    if (type === 'pickup') {
        pickupCoords = { lat, lng };
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        window.currentMarker = pickupMarker;
        fetchAddress(lat, lng);
        pickupMarker.on('dragend', () => {
            const pos = pickupMarker.getLatLng();
            pickupCoords = { lat: pos.lat, lng: pos.lng };
            fetchAddress(pos.lat, pos.lng);
            calculatePrice();
        });
    } else {
        dropoffCoords = { lat, lng };
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        dropoffMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        dropoffMarker.on('dragend', () => {
            const pos = dropoffMarker.getLatLng();
            dropoffCoords = { lat: pos.lat, lng: pos.lng };
            calculatePrice();
        });
    }
    map.flyTo([lat, lng], 15);
    calculatePrice();
};

document.addEventListener('change', (e) => {
    if (e.target.id === 'pickup-township') window.updateLocation('pickup');
    if (e.target.id === 'dropoff-township') window.updateLocation('dropoff');
});

map.on('click', (e) => {
    if (!pickupCoords) {
        pickupCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
        pickupMarker = L.marker(e.latlng, { draggable: true }).addTo(map);
        window.currentMarker = pickupMarker;
        fetchAddress(e.latlng.lat, e.latlng.lng);
        calculatePrice();
    }
});

// --- ၃။ Auto Pricing ---
function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2); 
        const weight = parseFloat(document.getElementById('item-weight')?.value) || 0;
        const itemValue = parseFloat(document.getElementById('item-value')?.value) || 0;
        
        const weightExtra = weight > 5 ? (weight - 5) * 200 : 0;
        const total = Math.round(1500 + (dist * 500) + weightExtra + (itemValue > 50000 ? itemValue * 0.01 : 0));
        
        const btn = document.getElementById('placeOrderBtn');
        if (btn) btn.innerText = `ORDER NOW - ${total.toLocaleString()} KS (${dist} km)`;
        return { dist, total };
    }
    return null;
}

['item-weight', 'item-value'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calculatePrice);
});

// --- ၄။ My Orders ---
function displayMyOrders() {
    const listDiv = document.getElementById('orders-list');
    if (!listDiv || !auth.currentUser) return;
    const q = query(collection(db, "orders"), where("userId", "==", auth.currentUser.uid));
    onSnapshot(q, (snap) => {
        listDiv.innerHTML = snap.empty ? "<p style='text-align:center; color:#888; margin-top:30px;'>မှတ်တမ်းမရှိသေးပါ</p>" : "";
        snap.forEach((orderDoc) => {
            const order = orderDoc.data();
            if (order.customerHide) return;
            const card = document.createElement('div');
            card.className = "order-card";
            card.innerHTML = `
                <div onclick="window.location.href='track.html?id=${orderDoc.id}'" style="flex-grow:1;">
                    <b style="color:var(--primary);">📦 ${order.item}</b><br>
                    <span style="font-size:0.7rem; color:gray;">${order.status.toUpperCase()}</span><br>
                    <b>${(order.deliveryFee || 0).toLocaleString()} KS</b>
                </div>
                <span id="del-btn-${orderDoc.id}" style="color:red; font-size:1.2rem; cursor:pointer;">🗑️</span>`;
            listDiv.appendChild(card);
            document.getElementById(`del-btn-${orderDoc.id}`).onclick = (e) => {
                e.stopPropagation();
                window.deleteOrderPermanently(orderDoc.id);
            };
        });
    });
}

window.deleteOrderPermanently = async (id) => {
    const res = await Swal.fire({ title: 'ဖယ်ထုတ်မလား?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#4e342e' });
    if (res.isConfirmed) await updateDoc(doc(db, "orders", id), { customerHide: true });
};

// --- ၅။ Submit Order (Telegram format အပြည့်စုံဖြင့်) ---
const placeOrderBtn = document.getElementById('placeOrderBtn');
if (placeOrderBtn) {
    placeOrderBtn.onclick = async () => {
        try {
            const feeInfo = calculatePrice();
            const item = document.getElementById('item-detail')?.value;
            const phone = document.getElementById('receiver-phone')?.value;
            const weight = document.getElementById('item-weight')?.value || 0;
            const itemValue = document.getElementById('item-value')?.value || 0;
            const pAddr = document.getElementById('pickup-address')?.value;
            const dAddr = document.getElementById('dropoff-address')?.value;

            if (!feeInfo || !item || !phone || !pAddr || !dAddr) {
                Swal.fire({ icon: 'error', title: 'အချက်အလက်မစုံလင်ပါ', text: 'ကျေးဇူးပြု၍ နေရာနှင့် အချက်အလက်များ အကုန်ဖြည့်ပါ။' });
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
                paymentMethod: document.getElementById('payment-method').value,
                deliveryFee: feeInfo.total, status: "pending", createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "orders"), orderData);
            const trackUrl = `https://boexaw-ship-it.github.io/gobike/html/track.html?id=${docRef.id}`;

            // --- Telegram Message Format အတိအကျ ---
            const msg = `📦 <b>New Order Received!</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 Customer: <b>${customerName}</b>\n` +
            `📞 ဖုန်း: <b>${phone}</b>\n` + 
            `📝 ပစ္စည်း: <b>${item}</b>\n` +
            `⚖️ အလေးချိန်: <b>${weight} KG</b>\n` +
            `💰 တန်ဖိုး: <b>${parseFloat(itemValue).toLocaleString()} KS</b>\n` +
            `💵 <b>ပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
            `📍 ယူရန်: ${orderData.pickup.address}\n` +
            `🏁 ပို့ရန်: ${orderData.dropoff.address}\n\n` +
            `✨ <a href="${trackUrl}"><b>📍 ခြေရာခံရန်နှိပ်ပါ</b></a>`;

            await notifyTelegram(msg);

            // Sheet Sync
            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({ action: "create", orderId: docRef.id, ...orderData, deliveryFee: feeInfo.total })
            }).catch(e => console.log("Sheet error"));

            await Swal.fire({ title: 'အော်ဒါတင်ပြီးပါပြီ!', icon: 'success', confirmButtonColor: '#4e342e' });
            window.location.href = `track.html?id=${docRef.id}`;

        } catch (e) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = "ORDER NOW";
            Swal.fire({ icon: 'error', title: 'Error', text: e.message });
        }
    };
}
