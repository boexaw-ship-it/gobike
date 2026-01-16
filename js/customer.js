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
                confirmButtonColor: '#ffcc00',
                confirmButtonText: 'ထွက်မည်',
                cancelButtonText: 'မထွက်တော့ပါ',
                background: '#1a1a1a', color: '#ffffff'
            }).then(async (result) => {
                if (result.isConfirmed) await signOut(auth);
            });
        };
    }
};
setupLogout();

// --- ၂။ Map & Live Rider Logic ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker, dropoffMarker;
let pickupCoords = null, dropoffCoords = null;
let riderMarkers = {}; 

const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
});

navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    map.setView([latitude, longitude], 13);
}, (err) => console.log("Location access denied"));

onSnapshot(collection(db, "active_riders"), (snap) => {
    snap.docChanges().forEach((change) => {
        const data = change.doc.data();
        const id = change.doc.id;
        if (change.type === "added" || change.type === "modified") {
            if (riderMarkers[id]) map.removeLayer(riderMarkers[id]);
            riderMarkers[id] = L.marker([data.lat, data.lng], { icon: riderIcon })
                .addTo(map)
                .bindPopup(`🚴 Rider: ${data.name || 'Active'}`);
        } else if (change.type === "removed") {
            if (riderMarkers[id]) {
                map.removeLayer(riderMarkers[id]);
                delete riderMarkers[id];
            }
        }
    });
});

window.updateLocation = function(type) {
    const select = document.getElementById(`${type}-township`);
    if (!select) return;
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

const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');
if (pickupSelect) pickupSelect.onchange = () => window.updateLocation('pickup');
if (dropoffSelect) dropoffSelect.onchange = () => window.updateLocation('dropoff');

// --- ၃။ Auto Pricing Logic ---
function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2); 
        
        const weight = parseFloat(document.getElementById('item-weight').value) || 0;
        const itemValue = parseFloat(document.getElementById('item-value').value) || 0;

        const weightExtra = weight > 5 ? (weight - 5) * 200 : 0;
        const total = Math.round(1500 + (dist * 500) + weightExtra + (itemValue > 50000 ? itemValue * 0.01 : 0));
        
        const btn = document.getElementById('placeOrderBtn');
        if (btn) btn.innerText = `ORDER NOW - ${total.toLocaleString()} KS (${dist} km)`;
        return { dist, total };
    }
    return null;
}
document.getElementById('item-weight').oninput = calculatePrice;
document.getElementById('item-value').oninput = calculatePrice;

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
            card.style = `cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 10px; background: #2a2a2a; border-radius: 12px; border-left: 5px solid ${order.status === 'completed' ? '#00ff00' : '#ffcc00'}; border: 1px solid #444;`;
            card.innerHTML = `
                <div onclick="window.location.href='track.html?id=${id}'" style="flex-grow:1;">
                    <b style="color: #fff;">📦 ${order.item}</b><br>
                    <span style="font-size: 0.75rem; color: #aaa;">Status: ${order.status.toUpperCase()}</span><br>
                    <span style="font-size: 0.7rem; color: #ffcc00;">${(order.deliveryFee || 0).toLocaleString()} KS</span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span id="del-btn-${id}" style="color: #ff4444; font-size: 1.1rem; cursor: pointer;">🗑️</span>
                </div>`;
            listDiv.appendChild(card);

            document.getElementById(`del-btn-${id}`).onclick = (e) => {
                e.stopPropagation();
                window.deleteOrderPermanently(id);
            };
        });
    });
}

window.deleteOrderPermanently = async (id) => {
    const result = await Swal.fire({
        title: 'ဖယ်ထုတ်မလား?',
        text: 'ဤအော်ဒါမှတ်တမ်းကို Dashboard မှ ဖယ်ထုတ်ပါလိမ့်မည်။',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#ffcc00',
        background: '#1a1a1a', color: '#fff'
    });
    if (result.isConfirmed) {
        await updateDoc(doc(db, "orders", id), { customerHide: true });
    }
};

// --- ၅။ Submit Order ---
const placeOrderBtn = document.getElementById('placeOrderBtn');
if (placeOrderBtn) {
    placeOrderBtn.onclick = async () => {
        const feeInfo = calculatePrice();
        const item = document.getElementById('item-detail').value;
        const phone = document.getElementById('receiver-phone').value;
        const weight = document.getElementById('item-weight').value || 0;
        const itemValue = document.getElementById('item-value').value || 0;
        const payment = document.getElementById('payment-method').value;
        const pAddr = document.getElementById('pickup-address').value;
        const dAddr = document.getElementById('dropoff-address').value;

        if (!feeInfo || !item || !phone || !pAddr || !dAddr || !pickupCoords || !dropoffCoords) {
            Swal.fire({ icon: 'error', title: 'အချက်အလက်မစုံလင်ပါ', background: '#1a1a1a', color: '#fff' });
            return;
        }

        try {
            placeOrderBtn.disabled = true;
            placeOrderBtn.innerText = "Processing...";

            const pTown = pickupSelect.options[pickupSelect.selectedIndex].text;
            const dTown = dropoffSelect.options[dropoffSelect.selectedIndex].text;
            const customerName = auth.currentUser?.displayName || "Customer";

            const orderData = {
                userId: auth.currentUser.uid,
                customerName,
                pickup: { ...pickupCoords, address: `${pTown}, ${pAddr}` },
                dropoff: { ...dropoffCoords, address: `${dTown}, ${dAddr}` },
                item, weight, itemValue, phone,
                paymentMethod: payment === "COD" ? "Cash on Delivery" : "Cash at Pickup",
                deliveryFee: feeInfo.total, 
                status: "pending", 
                customerHide: false, 
                createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "orders"), orderData);
            const orderId = docRef.id;

            // Google Sheet Update
            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({
                    action: "create", orderId, item, weight: weight + " kg",
                    price: itemValue + " KS", deliveryFee: feeInfo.total,
                    payment: orderData.paymentMethod, phone, address: orderData.dropoff.address,
                    customerName, riderName: "-" 
                })
            });

            // Telegram Notification
            const trackUrl = `https://boexaw-ship-it.github.io/gobike/html/track.html?id=${orderId}`;
            const msg = `📦 <b>New Order Received!</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 Customer: <b>${customerName}</b>\n` +
            `📞 ဖုန်းနံပါတ်: <b>${phone}</b>\n` + 
            `📝 ပစ္စည်း: <b>${item}</b>\n` +
            `⚖️ အလေးချိန်: <b>${weight} KG</b>\n` +
            `💰 တန်ဖိုး: <b>${parseFloat(itemValue).toLocaleString()} KS</b>\n` +
            `💵 <b>ပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
            `📍 ယူရန်: ${orderData.pickup.address}\n` +
            `🏁 ပို့ရန်: ${orderData.dropoff.address}\n\n` +
            `✨ <a href="${trackUrl}"><b>📍 ခြေရာခံရန်နှိပ်ပါ</b></a>`;

            await notifyTelegram(msg);

            Swal.fire({
                title: 'အော်ဒါတင်ပြီးပါပြီ!',
                icon: 'success',
                confirmButtonColor: '#ffcc00',
                background: '#1a1a1a', color: '#fff'
            }).then(() => {
                window.location.href = `track.html?id=${orderId}`;
            });

        } catch (e) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = "ORDER NOW";
            Swal.fire({ icon: 'error', title: 'Error', text: e.message });
        }
    };
}
