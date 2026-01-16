import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, query, where, onSnapshot, doc, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

// --- 0. Setup ---
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၁။ Auth & Profile Logic ---
onAuthStateChanged(auth, (user) => {
    const nameDisplay = document.getElementById('display-name');
    if (user) {
        if (nameDisplay) nameDisplay.innerText = user.displayName || "User";
        displayMyOrders(); 
        findMyInitialLocation(); 
    } else {
        if (!window.location.pathname.includes('index.html')) {
            window.location.href = "../index.html";
        }
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
                background: '#ffffff', color: '#1a1a1a'
            }).then(async (result) => {
                if (result.isConfirmed) await signOut(auth);
            });
        };
    }
};
setupLogout();

// --- ၂။ Map & Live Rider Logic ---
window.map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.map);

let pickupMarker = null, dropoffMarker = null;
let pickupCoords = null, dropoffCoords = null;
let riderMarkers = {}; 

// Rider အတွက် စက်ဘီး Icon
const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2263/2263051.png', 
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
});

// (က) "My Location" ခလုတ်နှိပ်လျှင် သွားမည့် Function
window.goToMyLocation = function() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const { latitude, longitude } = pos.coords;
            const userLoc = [latitude, longitude];
            window.map.flyTo(userLoc, 16);
            updatePickupMarker(userLoc);
            reverseGeocode(latitude, longitude);
        }, (err) => {
            Swal.fire("Error", "တည်နေရာကြည့်ရှုခွင့်ကို ခွင့်ပြုပေးပါ", "error");
        }, { enableHighAccuracy: true });
    }
};

// (ခ) Customer စဖွင့်ချင်း လက်ရှိနေရာ ရှာဖွေခြင်း
function findMyInitialLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const { latitude, longitude } = pos.coords;
            const userLoc = [latitude, longitude];
            window.map.setView(userLoc, 15);
            updatePickupMarker(userLoc);
            reverseGeocode(latitude, longitude);
            L.circle(userLoc, { color: '#2196f3', fillColor: '#2196f3', fillOpacity: 0.2, radius: 100 }).addTo(window.map);
        }, (err) => console.log("Location access denied"));
    }
}

// (ဂ) Pickup Pin Update လုပ်ခြင်း
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

window.map.on('click', (e) => {
    updatePickupMarker(e.latlng);
    reverseGeocode(e.latlng.lat, e.latlng.lng);
    calculatePrice();
});

// (ဃ) လိပ်စာကို Lat/Lng မှ စာအဖြစ်ပြောင်းခြင်း
async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        const address = data.display_name;
        document.getElementById('pin-address-display').innerText = `📍 ${address}`;
        document.getElementById('pickup-address').value = address;
    } catch (e) {
        console.log("Geocode error");
    }
}

// (င) Real-time ONLINE Riders display (Boolean & String "true" နှစ်မျိုးလုံးစစ်သည်)
const ridersRef = collection(db, "active_riders");
onSnapshot(ridersRef, (snap) => {
    snap.docChanges().forEach((change) => {
        const data = change.doc.data();
        const id = change.doc.id;
        const isOnline = data.isOnline === true || data.isOnline === "true";

        if (change.type === "added" || change.type === "modified") {
            if (isOnline && data.lat && data.lng) {
                const lat = parseFloat(data.lat);
                const lng = parseFloat(data.lng);
                
                if (riderMarkers[id]) {
                    riderMarkers[id].setLatLng([lat, lng]);
                } else {
                    riderMarkers[id] = L.marker([lat, lng], { icon: riderIcon })
                        .addTo(window.map)
                        .bindPopup(`🚴 Rider: ${data.name || 'Active'}`);
                }
            } else if (riderMarkers[id]) {
                window.map.removeLayer(riderMarkers[id]);
                delete riderMarkers[id];
            }
        } else if (change.type === "removed") {
            if (riderMarkers[id]) {
                window.map.removeLayer(riderMarkers[id]);
                delete riderMarkers[id];
            }
        }
    });
});

// (စ) မြို့နယ်ရွေးရင် မြေပုံရွှေ့ခြင်း (Drop-off နှိပ်မရသည့်ပြဿနာ ပြင်ပြီး)
window.updateLocation = function(type) {
    const select = document.getElementById(`${type}-township`);
    if (!select) return;
    const option = select.options[select.selectedIndex];
    if (!option || !option.value) return;

    const lat = parseFloat(option.getAttribute('data-lat'));
    const lng = parseFloat(option.getAttribute('data-lng'));

    if (type === 'pickup') {
        updatePickupMarker({ lat, lng });
        reverseGeocode(lat, lng);
    } else {
        // Drop-off Marker Logic
        dropoffCoords = { lat, lng };
        if (dropoffMarker) window.map.removeLayer(dropoffMarker);
        dropoffMarker = L.marker([lat, lng], { draggable: true }).addTo(window.map);
        
        // Drop-off Marker ကို ဆွဲရွှေ့ရင် ဈေးနှုန်းပြန်တွက်မယ်
        dropoffMarker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            dropoffCoords = { lat: newPos.lat, lng: newPos.lng };
            calculatePrice();
        });
    }
    window.map.flyTo([lat, lng], 15);
    calculatePrice();
};

// Select Dropdown များအတွက် Event Listeners
const pSelect = document.getElementById('pickup-township');
const dSelect = document.getElementById('dropoff-township');
if (pSelect) pSelect.onchange = () => window.updateLocation('pickup');
if (dSelect) dSelect.onchange = () => window.updateLocation('dropoff');

// --- ၃။ Auto Pricing Logic ---
function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2); 
        
        const weightInput = document.getElementById('item-weight');
        const valueInput = document.getElementById('item-value');
        const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
        const itemValue = valueInput ? parseFloat(valueInput.value) || 0 : 0;

        const weightExtra = weight > 5 ? (weight - 5) * 200 : 0;
        const total = Math.round(1500 + (dist * 500) + weightExtra + (itemValue > 50000 ? itemValue * 0.01 : 0));
        
        const btn = document.getElementById('placeOrderBtn');
        if (btn) btn.innerText = `ORDER NOW - ${total.toLocaleString()} KS (${dist} km)`;
        return { dist, total };
    }
    return null;
}

const wInput = document.getElementById('item-weight');
const vInput = document.getElementById('item-value');
if (wInput) wInput.oninput = calculatePrice;
if (vInput) vInput.oninput = calculatePrice;

// --- ၄။ My Orders Logic ---
function displayMyOrders() {
    const listDiv = document.getElementById('orders-list');
    if (!listDiv || !auth.currentUser) return;

    const q = query(collection(db, "orders"), where("userId", "==", auth.currentUser.uid));
    onSnapshot(q, (snap) => {
        listDiv.innerHTML = snap.empty ? "<p style='text-align:center; color:#888; font-size:0.8rem;'>မှတ်တမ်းမရှိသေးပါ</p>" : "";
        snap.forEach((orderDoc) => {
            const order = orderDoc.data();
            const id = orderDoc.id;
            if (order.customerHide) return;

            const card = document.createElement('div');
            card.className = "order-card";
            card.style = `cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 16px; margin-bottom: 12px; background: #ffffff; border-radius: 16px; border-left: 5px solid ${order.status === 'completed' ? '#388e3c' : '#4e342e'}; border: 1px solid #eee; box-shadow: 0 2px 8px rgba(0,0,0,0.02);`;
            
            card.innerHTML = `
                <div onclick="window.location.href='track.html?id=${id}'" style="flex-grow:1;">
                    <b style="color: #4e342e;">📦 ${order.item || 'Parcel'}</b><br>
                    <span style="font-size: 0.75rem; color: #757575;">Status: ${(order.status || 'pending').toUpperCase()}</span><br>
                    <span style="font-size: 0.85rem; font-weight: bold; color: #4e342e;">${(order.deliveryFee || 0).toLocaleString()} KS</span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span id="del-btn-${id}" style="color: #d32f2f; font-size: 1.1rem; cursor: pointer;">🗑️</span>
                </div>`;
            listDiv.appendChild(card);

            const delBtn = document.getElementById(`del-btn-${id}`);
            if (delBtn) {
                delBtn.onclick = (e) => { e.stopPropagation(); window.deleteOrderPermanently(id); };
            }
        });
    });
}

window.deleteOrderPermanently = async (id) => {
    const result = await Swal.fire({
        title: 'ဖယ်ထုတ်မလား?',
        text: 'ဤအော်ဒါမှတ်တမ်းကို ဖယ်ထုတ်ပါလိမ့်မည်။',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#d32f2f',
        background: '#ffffff', color: '#1a1a1a'
    });
    if (result.isConfirmed) {
        try { await updateDoc(doc(db, "orders", id), { customerHide: true }); } 
        catch (err) { console.error("Delete Error:", err); }
    }
};

// --- ၅။ Submit Order ---
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
            const dAddr = document.getElementById('dropoff-address')?.value;

            if (!feeInfo || !item || !phone || !pAddr || !dAddr || !pickupCoords || !dropoffCoords) {
                Swal.fire({ icon: 'error', title: 'အချက်အလက်မစုံလင်ပါ', text: 'ကျေးဇူးပြု၍ နေရာနှင့် အချက်အလက်များ အကုန်ဖြည့်ပါ။', background: '#ffffff', color: '#1a1a1a' });
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
                item: item, weight: weight, itemValue: itemValue, phone: phone,
                paymentMethod: payment === "COD" ? "Cash on Delivery" : "Cash at Pickup",
                deliveryFee: feeInfo.total, status: "pending", customerHide: false, createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "orders"), orderData);
            const orderId = docRef.id;

            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({
                    action: "create", orderId, item, weight: weight + " kg",
                    price: itemValue + " KS", deliveryFee: feeInfo.total,
                    payment: orderData.paymentMethod, phone, address: orderData.dropoff.address,
                    customerName, riderName: "-" 
                })
            }).catch(e => console.log("Sheet Error:", e));

            const trackUrl = `https://boexaw-ship-it.github.io/gobike/html/track.html?id=${orderId}`;
            
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
            await Swal.fire({ title: 'အော်ဒါတင်ပြီးပါပြီ!', text: 'Rider ကို အကြောင်းကြားထားပါသည်။', icon: 'success', confirmButtonColor: '#4e342e', background: '#ffffff', color: '#1a1a1a' });
            window.location.href = `track.html?id=${orderId}`;

        } catch (e) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = "ORDER NOW";
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#ffffff', color: '#1a1a1a' });
        }
    };
}
