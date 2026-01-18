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
        logoutBtn.onclick = async () => {
            const res = await Swal.fire({
                title: 'အကောင့်မှ ထွက်မလား?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#4e342e',
                confirmButtonText: 'ထွက်မည်',
                cancelButtonText: 'မထွက်တော့ပါ'
            });
            if (res.isConfirmed) await signOut(auth);
        };
    }
};
setupLogout();

// --- ၂။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker = null, dropoffMarker = null;
let pickupCoords = null, dropoffCoords = null;
let riderMarkers = {};

const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
});

// Marker create လုပ်ရာတွင် title မပါဝင်စေရန်နှင့် Keyboard suggestion ကို ရှောင်ရန် helper
const createCustomMarker = (latlng, options = {}) => {
    return L.marker(latlng, {
        ...options,
        title: "", // စာသားအလွတ်ပေးထားခြင်းဖြင့် suggestion တက်ခြင်းကို ကာကွယ်သည်
        alt: ""
    });
};

// --- (က) Go To My Location ---
window.goToMyLocation = function() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude, lng = position.coords.longitude;
            map.flyTo([lat, lng], 16);
            if (pickupMarker) map.removeLayer(pickupMarker);
            
            pickupMarker = createCustomMarker([lat, lng], { draggable: true }).addTo(map);
            pickupCoords = { lat, lng };
            
            pickupMarker.on('dragend', () => {
                const pos = pickupMarker.getLatLng();
                pickupCoords = { lat: pos.lat, lng: pos.lng };
                calculatePrice();
            });
            calculatePrice();
        }, () => Swal.fire("Error", "GPS ဖွင့်ပေးပါ", "error"));
    }
};

// --- (ခ) Live Riders ---
const ridersQuery = query(collection(db, "active_riders"), where("isOnline", "==", true));
onSnapshot(ridersQuery, (snap) => {
    snap.docChanges().forEach((change) => {
        const data = change.doc.data(), id = change.doc.id;
        if (change.type === "added" || change.type === "modified") {
            if (riderMarkers[id]) map.removeLayer(riderMarkers[id]);
            riderMarkers[id] = createCustomMarker([data.lat, data.lng], { icon: riderIcon }).addTo(map);
        } else if (change.type === "removed" && riderMarkers[id]) {
            map.removeLayer(riderMarkers[id]); delete riderMarkers[id];
        }
    });
});

// --- (ဂ) Update From Dropdown ---
window.updateLocation = function(type) {
    const select = document.getElementById(`${type}-township`);
    const option = select?.options[select.selectedIndex];
    if (!option?.value) return;
    const lat = parseFloat(option.getAttribute('data-lat')), lng = parseFloat(option.getAttribute('data-lng'));

    if (type === 'pickup') {
        pickupCoords = { lat, lng };
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = createCustomMarker([lat, lng], { draggable: true }).addTo(map);
        pickupMarker.on('dragend', () => {
            const pos = pickupMarker.getLatLng();
            pickupCoords = { lat: pos.lat, lng: pos.lng };
            calculatePrice();
        });
    } else {
        dropoffCoords = { lat, lng };
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        dropoffMarker = createCustomMarker([lat, lng], { draggable: true }).addTo(map);
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

// --- ၃။ Auto Pricing ---
function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng), p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
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
['item-weight', 'item-value'].forEach(id => document.getElementById(id)?.addEventListener('input', calculatePrice));

// --- ၄။ Order Details Modal Logic ---
window.showOrderDetails = async (orderId) => {
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('modal-content');
    content.innerHTML = "<p style='text-align:center;'>ရယူနေပါသည်...</p>";
    modal.style.display = 'flex';

    try {
        const orderSnap = await getDoc(doc(db, "orders", orderId));
        if (orderSnap.exists()) {
            const data = orderSnap.data();
            content.innerHTML = `
                <div style="display:grid; gap:8px;">
                    <p>📦 <b>ပစ္စည်း:</b> ${data.item} (${data.weight || 0} kg)</p>
                    <p>💵 <b>ပို့ခ:</b> <span style="color:#2ed573;">${(data.deliveryFee || 0).toLocaleString()} KS</span></p>
                    <p>💰 <b>တန်ဖိုး:</b> ${(data.itemValue || 0).toLocaleString()} KS</p>
                    <hr style="border:0.5px solid #333; margin:10px 0;">
                    <p style="color:#ff4757; font-size:0.9rem;">📍 <b>Pickup:</b><br>${data.pickup.township}၊ ${data.pickup.address}</p>
                    <p style="color:#2ed573; font-size:0.9rem;">🏁 <b>Drop:</b><br>${data.dropoff.township}၊ ${data.dropoff.address}</p>
                    <p>📞 <b>ဖုန်း:</b> ${data.phone}</p>
                    <p>🏍️ <b>Rider:</b> ${data.riderName || 'N/A'}</p>
                    <p>📅 <b>ရက်စွဲ:</b> ${data.createdAt?.toDate().toLocaleString() || 'N/A'}</p>
                </div>
            `;
        }
    } catch (e) { content.innerHTML = "Error loading data."; }
};

window.closeModal = () => { document.getElementById('detailModal').style.display = 'none'; };

// --- ၅။ Display My Orders (Tabs Logic) ---
function displayMyOrders() {
    const activeList = document.getElementById('active-orders');
    const historyList = document.getElementById('history-orders');
    
    if (!activeList || !historyList || !auth.currentUser) return;

    const q = query(collection(db, "orders"), where("userId", "==", auth.currentUser.uid));
    
    onSnapshot(q, (snap) => {
        activeList.innerHTML = "";
        historyList.innerHTML = "";

        if (snap.empty) {
            const emptyMsg = "<p style='text-align:center; color:#888; margin-top:30px;'>မှတ်တမ်းမရှိပါ</p>";
            activeList.innerHTML = emptyMsg;
            historyList.innerHTML = emptyMsg;
            return;
        }

        snap.forEach((orderDoc) => {
            const order = orderDoc.data();
            if (order.customerHide) return;

            const card = document.createElement('div');
            card.className = "order-card";
            
            if (order.status === "completed") {
                card.onclick = () => window.showOrderDetails(orderDoc.id);
            } else {
                card.onclick = () => window.location.href = `track.html?id=${orderDoc.id}`;
            }

            const statusColor = order.status === "completed" ? "var(--success)" : "#e67e22";

            card.innerHTML = `
                <div style="flex-grow:1;">
                    <b style="color:var(--primary);">📦 ${order.item}</b><br>
                    <span style="font-size:0.7rem; font-weight:bold; color:${statusColor}">${order.status.toUpperCase()}</span> | <b>${(order.deliveryFee || 0).toLocaleString()} KS</b>
                    <div style="font-size:0.65rem; color:#888; margin-top:4px;">${order.pickup.township} ➔ ${order.dropoff.township}</div>
                </div>
                <span onclick="event.stopPropagation(); window.deleteOrder('${orderDoc.id}')" style="color:red; cursor:pointer; font-size: 1.2rem; padding: 10px;">🗑️</span>`;

            if (order.status === "completed") {
                historyList.appendChild(card);
            } else {
                activeList.appendChild(card);
            }
        });

        if (activeList.innerHTML === "") activeList.innerHTML = "<p style='text-align:center; color:#888; margin-top:30px;'>လက်ရှိတင်ထားသော အော်ဒါမရှိပါ</p>";
        if (historyList.innerHTML === "") historyList.innerHTML = "<p style='text-align:center; color:#888; margin-top:30px;'>ပို့ဆောင်ပြီး မှတ်တမ်းမရှိပါ</p>";
    });
}

window.deleteOrder = async (id) => {
    const res = await Swal.fire({ 
        title: 'မှတ်တမ်းမှ ဖယ်ထုတ်မလား?', 
        text: "အော်ဒါစာရင်းမှ ဖျောက်လိုက်ပါမည်။",
        icon: 'warning', 
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'ဖယ်ထုတ်မည်'
    });
    if (res.isConfirmed) await updateDoc(doc(db, "orders", id), { customerHide: true });
};

// --- ၆။ Submit Order ---
const placeOrderBtn = document.getElementById('placeOrderBtn');
if (placeOrderBtn) {
    placeOrderBtn.onclick = async () => {
        try {
            const feeInfo = calculatePrice();
            const item = document.getElementById('item-detail')?.value;
            const phone = document.getElementById('receiver-phone')?.value;
            const pAddr = document.getElementById('pickup-address')?.value;
            const dAddr = document.getElementById('dropoff-address')?.value;
            const weight = document.getElementById('item-weight')?.value || 0;
            const itemValue = document.getElementById('item-value')?.value || 0;

            const pTSel = document.getElementById('pickup-township');
            const dTSel = document.getElementById('dropoff-township');
            const pTownship = pTSel.options[pTSel.selectedIndex]?.text;
            const dTownship = dTSel.options[dTSel.selectedIndex]?.text;

            if (!feeInfo || !item || !phone || !pAddr || !dAddr || pTSel.value === "" || dTSel.value === "") {
                Swal.fire({ icon: 'error', title: 'အချက်အလက်မစုံလင်ပါ' }); return;
            }

            placeOrderBtn.disabled = true;
            placeOrderBtn.innerText = "Processing...";

            const customerName = auth.currentUser?.displayName || "Customer";
            const orderData = {
                userId: auth.currentUser.uid,
                customerName,
                pickup: { ...pickupCoords, address: pAddr, township: pTownship },
                dropoff: { ...dropoffCoords, address: dAddr, township: dTownship },
                item, weight, itemValue, phone,
                paymentMethod: document.getElementById('payment-method').value,
                deliveryFee: feeInfo.total, status: "pending", createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "orders"), orderData);
            
            const trackUrl = `https://boexaw-ship-it.github.io/gobike/html/track.html?id=${docRef.id}`;
            const msg = `📦 <b>New Order Received!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━\n` +
                        `👤 Customer: <b>${customerName}</b>\n` +
                        `📞 ဖုန်း: <b>${phone}</b>\n` + 
                        `📝 ပစ္စည်း: <b>${item}</b>\n` +
                        `⚖️ အလေးချိန်: <b>${weight} KG</b>\n` +
                        `💰 တန်ဖိုး: <b>${parseFloat(itemValue).toLocaleString()} KS</b>\n` +
                        `💵 <b>ပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
                        `📍 ယူရန်: ${pTownship}၊ ${pAddr}\n` +
                        `🏁 ပို့ရန်: ${dTownship}၊ ${dAddr}\n\n` +
                        `✨ <a href="${trackUrl}"><b>📍 ခြေရာခံရန်နှိပ်ပါ</b></a>`;

            await notifyTelegram(msg);

            fetch(SCRIPT_URL, { 
                method: "POST", mode: "no-cors", 
                body: JSON.stringify({ action: "create", orderId: docRef.id, ...orderData, deliveryFee: feeInfo.total }) 
            });

            await Swal.fire({ title: 'အော်ဒါတင်ပြီးပါပြီ!', icon: 'success' });
            window.location.href = `track.html?id=${docRef.id}`;
        } catch (e) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = "ORDER NOW";
            Swal.fire("Error", e.message, "error");
        }
    };
                                             }

