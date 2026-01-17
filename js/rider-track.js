import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let routingControl = null;

// --- Main Logic ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), async (docSnap) => {
        document.getElementById('loading').style.display = 'none';

        if (!docSnap.exists()) {
            Swal.fire('Error', 'Order မရှိတော့ပါ', 'error').then(() => {
                window.location.href = 'rider-dashboard.html';
            });
            return;
        }

        const data = docSnap.data();

        // UI Detail Updates
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase();
        document.getElementById('det-item').innerText = data.item || "ပစ္စည်း";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";
        document.getElementById('det-value').innerText = (data.itemValue || 0).toLocaleString() + " KS";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-phone').innerText = data.phone || "-";
        document.getElementById('call-link').href = `tel:${data.phone}`;

        const pAddr = data.pickup ? `${data.pickup.township}၊ ${data.pickup.address}` : (data.pickupAddress || "-");
        const dAddr = data.dropoff ? `${data.dropoff.township}၊ ${data.dropoff.address}` : (data.dropoffAddress || "-");
        document.getElementById('det-pickup').innerText = pAddr;
        document.getElementById('det-dropoff').innerText = dAddr;

        // Route & Maps
        if (data.pickup?.lat && data.dropoff?.lat) {
            drawRoute(data.pickup, data.dropoff);
            document.getElementById('map-pickup').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${data.pickup.lat},${data.pickup.lng}`);
            document.getElementById('map-dropoff').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${data.dropoff.lat},${data.dropoff.lng}`);
        }

        updateActionButtons(data.status, data);
    });
} else {
    window.location.href = 'rider-dashboard.html';
}

function drawRoute(p, d) {
    if (routingControl) map.removeControl(routingControl);
    routingControl = L.Routing.control({
        waypoints: [L.latLng(p.lat, p.lng), L.latLng(d.lat, d.lng)],
        show: false, addWaypoints: false, draggableWaypoints: false,
        lineOptions: { styles: [{ color: '#ff4444', weight: 6, opacity: 0.8 }] }, // Red Line
        createMarker: (i, wp) => L.marker(wp.latLng, {
            icon: L.icon({
                iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${i===0?'green':'red'}.png`,
                iconSize: [25, 41], iconAnchor: [12, 41]
            })
        })
    }).addTo(map);
    map.fitBounds(L.latLngBounds([p.lat, p.lng], [d.lat, d.lng]), { padding: [50, 50] });
}

function updateActionButtons(status, orderData) {
    const btn = document.getElementById('main-action-btn');
    if (!btn) return;

    btn.style.background = "var(--primary)"; // Reset color

    if (status === "accepted") {
        btn.innerHTML = `<i class="fas fa-motorcycle"></i> <span>ပစ္စည်းသွားယူမည် (On the Way)</span>`;
        btn.onclick = () => changeStatus("on_the_way", "ပစ္စည်းသွားယူနေပါပြီ");
    } else if (status === "on_the_way") {
        btn.innerHTML = `<i class="fas fa-map-marker-alt"></i> <span>ဆိုင်သို့ရောက်ပြီ (Arrived)</span>`;
        btn.onclick = () => changeStatus("arrived", "ဆိုင်သို့ရောက်ရှိပါပြီ");
    } else if (status === "arrived") {
        btn.innerHTML = `<i class="fas fa-check-circle"></i> <span>ပို့ဆောင်မှုပြီးမြောက်ပြီ (Complete)</span>`;
        btn.style.background = "var(--success)";
        btn.onclick = () => completeOrder(orderData);
    } else if (status === "completed") {
        btn.parentElement.style.display = "none";
    }
}

async function changeStatus(newStatus, statusText) {
    try {
        await updateDoc(doc(db, "orders", orderId), { status: newStatus });
        const name = await getRiderName();
        await notifyTelegram(`🚴 Status: ${statusText}\n📦 Order: ${orderId}\n👤 Rider: ${name}`);
        Swal.fire({ icon: 'success', title: 'Updated', timer: 800, showConfirmButton: false });
    } catch (err) { console.error(err); }
}

async function completeOrder(data) {
    const res = await Swal.fire({
        title: 'ပို့ဆောင်ပြီးပြီလား?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'အတည်ပြုသည်',
        background: '#1a1a1a', color: '#fff'
    });

    if (res.isConfirmed) {
        await updateDoc(doc(db, "orders", orderId), { status: "completed", completedAt: serverTimestamp() });
        const name = await getRiderName();
        await notifyTelegram(`✅ Completed\n📦 Item: ${data.item}\n👤 Rider: ${name}`);
        window.location.replace("rider-dashboard.html");
    }
}

async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}
