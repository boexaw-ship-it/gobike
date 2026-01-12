import { db, auth } from './firebase-config.js';
import { collection, query, where, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Map Initialization ---
const map = L.map('map').setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const ordersContainer = document.getElementById('available-orders');

// --- Listen to Pending Orders ---
const q = query(collection(db, "orders"), where("status", "==", "pending"));

onSnapshot(q, (snapshot) => {
    ordersContainer.innerHTML = ""; // Clear list
    
    if (snapshot.empty) {
        ordersContainer.innerHTML = `<p style="text-align: center; color: #888;">လောလောဆယ် Order မရှိသေးပါ</p>`;
    }

    snapshot.forEach((orderDoc) => {
        const order = orderDoc.data();
        const orderId = orderDoc.id;

        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="status-tag">NEW ORDER</div>
            <div class="order-info"><b>ပစ္စည်း:</b> ${order.item}</div>
            <div class="order-info"><b>ဖုန်း:</b> ${order.phone}</div>
            <div class="order-info"><b>ယူရန်:</b> ${order.pickup.lat.toFixed(4)}, ${order.pickup.lng.toFixed(4)}</div>
            <div class="order-info"><b>ပို့ရန်:</b> ${order.dropoff.lat.toFixed(4)}, ${order.dropoff.lng.toFixed(4)}</div>
            <button class="btn-accept" data-id="${orderId}">လက်ခံမည် (Accept)</button>
        `;
        
        ordersContainer.appendChild(card);

        // Map ပေါ်မှာ Location ပြရန်
        L.marker([order.pickup.lat, order.pickup.lng]).addTo(map)
            .bindPopup(`ပစ္စည်းယူရန်: ${order.item}`).openPopup();
    });
});

// --- Accept Order Logic ---
document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-accept')) {
        const orderId = e.target.getAttribute('data-id');
        
        try {
            const orderRef = doc(db, "orders", orderId);
            await updateDoc(orderRef, {
                status: "accepted",
                riderId: auth.currentUser.uid,
                riderName: auth.currentUser.displayName || "Rider"
            });
            
            alert("Order ကို လက်ခံလိုက်ပါပြီ။ Customer ဆီသို့ သွားရောက်ပေးပါ!");
        } catch (error) {
            console.error(error);
            alert("Error: Order လက်ခံ၍မရပါ");
        }
    }
});
