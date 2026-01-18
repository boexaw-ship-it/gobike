import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, query, where, onSnapshot, doc, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.react-auth-kit.com/firebase-auth.js"; // Note: Ensure your import source is correct, standard is "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
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

// Logout setup
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

// --- (က) Go To My Location ---
window.goToMyLocation = function() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude, lng = position.coords.longitude;
            map.flyTo([lat, lng], 16);
            
            if (pickupMarker) map.removeLayer(pickupMarker);
            pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
            pickupCoords = { lat, lng };
            
            pickupMarker.on('dragend', () => {
                const pos = pickupMarker.getLatLng();
                pickupCoords = { lat: pos.lat, lng: pos.lng };
                calculatePrice();
            });
            calculatePrice();
        }, () => Swal.fire("Error", "GPS ဖွင့်ပေးပါ သို့မဟုတ် ခွင့်ပြုချက်ပေးပါ", "error"));
    }
};

// --- (ခ) Live Riders ---
const ridersQuery = query(collection(db, "active_riders"), where("isOnline", "==", true));
onSnapshot(ridersQuery, (snap) => {
    snap.docChanges().forEach((change) => {
        const data = change.doc.data(), id = change.doc.id;
        if (change.type === "added" || change.type === "modified") {
            if (riderMarkers[id]) map.removeLayer(riderMarkers[id]);
            riderMarkers[id] = L.marker([data.lat, data.lng], { icon: riderIcon }).addTo(map);
        } else if (change.type === "removed" && riderMarkers[id]) {
            map.removeLayer(riderMarkers[id]); delete riderMarkers[id];
        }
    });
});

// --- (ဂ) Update Location From Dropdown ---
window.updateLocation = function(type) {
    const select = document.getElementById(`${type}-township`);
    const option = select?.options[select.selectedIndex];
    if (!option || option.value === "") return;

    const lat = parseFloat(option.getAttribute('data-lat')), lng = parseFloat(option.getAttribute('data-lng'));

    if (type === 'pickup') {
        pickupCoords = { lat, lng };
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        pickupMarker.on('dragend', () => {
            pickupCoords = { lat: pickupMarker.getLatLng().lat, lng: pickupMarker.getLatLng().lng };
            calculatePrice();
        });
    } else {
        dropoffCoords = { lat, lng };
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        dropoffMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        dropoffMarker.on('dragend', () => {
            dropoffCoords = { lat: dropoffMarker.getLatLng().lat, lng: dropoffMarker.getLatLng().lng };
            calculatePrice();
        });
    }
    map.flyTo([lat, lng], 15);
    calculatePrice();
};

// Event Listeners for Dropdowns
document.getElementById('pickup-township')?.addEventListener('change', () => window.updateLocation('pickup'));
document.getElementById('dropoff-township')?.addEventListener('change', () => window.updateLocation('dropoff'));

// --- ၃။ Auto Pricing ---
function calculatePrice() {
    const btn = document.getElementById('placeOrderBtn');
    if (pickupCoords && dropoffCoords) {
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng), p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2); 
        
        const weight = parseFloat(document.getElementById('item-weight')?.value) || 0;
        const itemValue = parseFloat(document.getElementById('item-value')?.value) || 0;
        
        const weightExtra = weight > 5 ? (weight - 5) * 200 : 0;
        const total = Math.round(1500 + (dist * 500) + weightExtra + (itemValue > 50000 ? itemValue * 0.01 : 0));
        
        if (btn) btn.innerText = `CONFIRM ORDER - ${total.toLocaleString()} KS (${dist} km)`;
        return { dist, total };
    }
    if (btn) btn.innerText = "CONFIRM ORDER";
    return null;
}

// အလေးချိန်နှင့် တန်ဖိုးပြောင်းလဲလျှင် ဈေးနှုန်းချက်ချင်းတွက်ရန်
['item-weight', 'item-value'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calculatePrice);
});

// --- ၄။ Display My Orders (Tabs Logic) ---
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
            card.style.cssText = "background:white; padding:15px; border-radius:15px; margin-bottom:12px; display:flex; align-items:center; box-shadow:0 4px 10px rgba(0,0,0,0.05); position:relative;";
            
            // Status Color Logic
            let statusColor = "#e67e22"; // Orange for pending/accepted
            if (order.status === "completed") statusColor = "var(--success)";
            if (order.status === "cancelled") statusColor = "var(--danger)";

            card.innerHTML = `
                <div style="flex-grow:1;" onclick="window.location.href='track.html?id=${orderDoc.id}'">
                    <b style="color:var(--primary); display:block; margin-bottom:4px;">📦 ${order.item}</b>
                    <span style="font-size:0.75rem; font-weight:bold; color:${statusColor}; background:${statusColor}22; padding:2px 8px; border-radius:10px;">${order.status.toUpperCase()}</span>
                    <b style="font-size:0.85rem; margin-left:10px;">${(order.deliveryFee || 0).toLocaleString()} KS</b>
                    <div style="font-size:0.7rem; color:#888; margin-top:6px;">
                        <i class="fas fa-map-marker-alt"></i> ${order.pickup.township} ➔ <i class="fas fa-flag-checkered"></i> ${order.dropoff.township}
                    </div>
                </div>
                <div onclick="window.deleteOrder('${orderDoc.id}')" style="padding:10px; color:#ff4757; cursor:pointer;">
                    <i class="fas fa-trash-alt"></i>
                </div>
            `;

            if (order.status === "completed" || order.status === "cancelled") {
                historyList.appendChild(card);
            } else {
                activeList.appendChild(card);
            }
        });
    });
}

// မှတ်တမ်းဖျောက်ရန်
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

// --- ၅။ Submit Order ---
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
                Swal.fire({ icon: 'error', title: 'အချက်အလက်မစုံလင်ပါ', text: 'မြို့နယ်နှင့် လိပ်စာများ မှန်ကန်စွာ ဖြည့်သွင်းပေးပါ' }); 
                return;
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
                deliveryFee: feeInfo.total, 
                distance: feeInfo.dist,
                status: "pending", 
                createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "orders"), orderData);
            
            // Telegram Notification
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

            // Google Sheets Sync (Optional)
            fetch(SCRIPT_URL, { 
                method: "POST", mode: "no-cors", 
                body: JSON.stringify({ action: "create", orderId: docRef.id, ...orderData, deliveryFee: feeInfo.total }) 
            });

            await Swal.fire({ title: 'အော်ဒါတင်ပြီးပါပြီ!', icon: 'success', timer: 2000 });
            window.location.href = `track.html?id=${docRef.id}`;
        } catch (e) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = "CONFIRM ORDER";
            Swal.fire("Error", e.message, "error");
        }
    };
}

