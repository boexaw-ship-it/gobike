import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, query, where, onSnapshot, doc, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

// --- 0. Google Apps Script URL ---
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၁။ Auth & Profile Logic ---
onAuthStateChanged(auth, (user) => {
    const nameDisplay = document.getElementById('display-name');
    const roleDisplay = document.getElementById('display-role');
    if (user) {
        if (nameDisplay) nameDisplay.innerText = user.displayName || "User";
        if (roleDisplay) roleDisplay.innerText = "Customer Account";
        displayMyOrders(); 
    } else {
        if (!window.location.pathname.includes('index.html')) {
            window.location.href = "../index.html";
        }
    }
});

// Logout Logic
const setupLogout = () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            Swal.fire({
                title: 'အကောင့်မှ ထွက်မလား?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ffcc00',
                cancelButtonColor: '#d33',
                confirmButtonText: 'ထွက်မည်',
                cancelButtonText: 'မထွက်တော့ပါ',
                background: '#1a1a1a',
                color: '#ffffff'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    await signOut(auth);
                }
            });
        };
    }
};
setupLogout();

// --- ၂။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker, dropoffMarker;
let pickupCoords = null, dropoffCoords = null;

const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');

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

        const total = Math.round(1500 + (dist * 500) + (weight > 5 ? (weight - 5) * 200 : 0) + (itemValue > 50000 ? itemValue * 0.01 : 0));
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
                    <span style="font-size: 0.7rem; color: #ffcc00;">${order.deliveryFee.toLocaleString()} KS</span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="color:#ffcc00; font-size: 1.2rem;" onclick="window.location.href='track.html?id=${id}'">📍</span>
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

// --- ၅။ Rider Accept & Delete Logic ---
window.acceptRiderFromCustomer = async (orderId, riderId, riderName) => {
    try {
        const orderRef = doc(db, "orders", orderId);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) return;
        const currentOrderData = orderSnap.data();

        const scheduleType = currentOrderData.pickupSchedule || "now";
        const isTomorrow = scheduleType === "tomorrow";

        await updateDoc(orderRef, {
            status: "accepted",
            riderId: riderId,
            riderName: riderName,
            pickupSchedule: scheduleType,
            tempRiderId: null,
            confirmedAt: serverTimestamp()
        });

        Swal.fire({
            title: isTomorrow ? 'မနက်ဖြန်အတွက် အတည်ပြုပြီး!' : 'Rider လက်ခံပြီးပါပြီ!',
            text: isTomorrow ? 'အော်ဒါသည် Rider ၏ မနက်ဖြန်စာရင်းတွင် ဆက်ရှိနေပါမည်။' : 'Rider ပစ္စည်းလာယူပါလိမ့်မည်။',
            icon: 'success',
            background: '#1a1a1a', color: '#fff'
        });

        fetch(SCRIPT_URL, {
            method: "POST", mode: "no-cors",
            body: JSON.stringify({ action: "update", orderId, status: "Accepted", riderName })
        });

        await notifyTelegram(`✅ <b>Rider Confirmed!</b>\n📝 ပစ္စည်း: ${currentOrderData.item}\n📅 Schedule: <b>${isTomorrow ? 'Tomorrow' : 'Now'}</b>\n🚴 Rider: <b>${riderName}</b>`);

    } catch (e) {
        console.error("Error:", e);
        Swal.fire({ icon: 'error', title: 'Error', text: 'လုပ်ဆောင်ချက် မအောင်မြင်ပါ။' });
    }
};

window.deleteOrderPermanently = async (id) => {
    Swal.fire({
        title: 'ဖယ်ထုတ်မလား?',
        text: 'ဤအော်ဒါမှတ်တမ်းကို Dashboard မှ ဖယ်ထုတ်ပါလိမ့်မည်။',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#ffcc00',
        confirmButtonText: 'ဖယ်မည်',
        cancelButtonText: 'မဖယ်ပါ',
        background: '#1a1a1a', color: '#fff'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await updateDoc(doc(db, "orders", id), { customerHide: true });
        }
    });
};

// --- ၆။ Submit Order (အကြိမ်ပေါင်းများစွာ ထပ်တင်နိုင်ရန် Reset Logic ပါဝင်သည်) ---
const placeOrderBtn = document.getElementById('placeOrderBtn');
if (placeOrderBtn) {
    placeOrderBtn.onclick = async () => {
        const feeInfo = calculatePrice();
        const item = document.getElementById('item-detail').value;
        const phone = document.getElementById('receiver-phone').value;
        const weight = document.getElementById('item-weight').value;
        const itemValue = document.getElementById('item-value').value;
        const payment = document.getElementById('payment-method').value;
        const pAddr = document.getElementById('pickup-address').value;
        const dAddr = document.getElementById('dropoff-address').value;

        if (!feeInfo || !item || !phone || !pAddr || !dAddr || !pickupCoords || !dropoffCoords) {
            Swal.fire({ icon: 'error', title: 'အချက်အလက်မစုံလင်ပါ', text: 'မြို့နယ်နှင့် လိပ်စာအပြည့်အစုံ ဖြည့်ပေးပါ', background: '#1a1a1a', color: '#fff' });
            return;
        }

        try {
            placeOrderBtn.disabled = true;
            placeOrderBtn.innerText = "Processing...";

            const pTown = pickupSelect.options[pickupSelect.selectedIndex].text;
            const dTown = dropoffSelect.options[dropoffSelect.selectedIndex].text;
            const customerName = auth.currentUser?.displayName || "Customer";

            const orderData = {
                userId: auth.currentUser.uid, customerName,
                pickup: { ...pickupCoords, address: `${pTown}, ${pAddr}` },
                dropoff: { ...dropoffCoords, address: `${dTown}, ${dAddr}` },
                item, weight, itemValue, phone,
                paymentMethod: payment === "COD" ? "Cash on Delivery" : "Cash at Pickup",
                deliveryFee: feeInfo.total, status: "pending", customerHide: false, createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, "orders"), orderData);
            const orderId = docRef.id;

            // Google Sheet & Telegram Notifications
            fetch(SCRIPT_URL, {
                method: "POST", mode: "no-cors",
                body: JSON.stringify({
                    action: "create", orderId, item, weight: weight + " kg",
                    price: itemValue + " KS", deliveryFee: feeInfo.total,
                    payment: orderData.paymentMethod, phone, address: orderData.dropoff.address,
                    customerName, riderName: "-" 
                })
            });

            const trackUrl = `https://boexaw-ship-it.github.io/gobike/html/track.html?id=${orderId}`;
            const msg = `📦 <b>New Order Received!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━\n` +
                        `👤 Customer: <b>${customerName}</b>\n` +
                        `📝 ပစ္စည်း: <b>${item}</b>\n` +
                        `💵 <b>ပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
                        `📍 ယူရန်: ${orderData.pickup.address}\n` +
                        `🏁 ပို့ရန်: ${orderData.dropoff.address}\n\n` +
                        `✨ <a href="${trackUrl}"><b>📍 ခြေရာခံရန်နှိပ်ပါ</b></a>`;

            await notifyTelegram(msg);

            // Success Alert ပြပြီး Form Reset လုပ်ကာ Tab ရွှေ့ပေးခြင်း
            Swal.fire({
                title: 'အော်ဒါတင်ပြီးပါပြီ!',
                text: 'နောက်ထပ်အော်ဒါများလည်း ထပ်မံတင်နိုင်ပါသည်ဗျာ။',
                icon: 'success',
                confirmButtonColor: '#ffcc00',
                confirmButtonText: 'အော်ဒါစာရင်းကြည့်မည်',
                background: '#1a1a1a', color: '#fff'
            }).then(() => {
                // Form Reset
                document.getElementById('orderForm').reset();
                
                // Map markers များကို ရှင်းထုတ်ခြင်း
                if (pickupMarker) map.removeLayer(pickupMarker);
                if (dropoffMarker) map.removeLayer(dropoffMarker);
                pickupCoords = null; dropoffCoords = null;
                
                // Button Reset
                placeOrderBtn.disabled = false;
                placeOrderBtn.innerText = "ORDER NOW";
                
                // My Orders Tab သို့ ရွှေ့ခြင်း
                if (typeof window.showSection === 'function') {
                    const listTab = document.querySelectorAll('.nav-item')[1];
                    window.showSection('list', listTab);
                }
            });

        } catch (e) {
            placeOrderBtn.disabled = false;
            placeOrderBtn.innerText = "ORDER NOW";
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1a1a1a', color: '#fff' });
        }
    };
}
