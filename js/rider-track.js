import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// Map Setup
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let routingControl = null;

if (orderId) {
    onSnapshot(doc(db, "orders", orderId), async (docSnap) => {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            Swal.fire({ icon: 'error', title: 'အော်ဒါမရှိတော့ပါ' })
                .then(() => window.location.href = 'rider-dashboard.html');
            return;
        }

        const data = docSnap.data();

        // UI Updates
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase();
        document.getElementById('det-item').innerText = data.item || "ပစ္စည်း";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";
        document.getElementById('det-value').innerText = (data.itemValue || 0).toLocaleString() + " KS";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-phone').innerText = data.phone || "-";
        document.getElementById('call-link').href = `tel:${data.phone}`;

        document.getElementById('det-pickup').innerText = data.pickup ? `${data.pickup.township}၊ ${data.pickup.address}` : (data.pickupAddress || "-");
        document.getElementById('det-dropoff').innerText = data.dropoff ? `${data.dropoff.township}၊ ${data.dropoff.address}` : (data.dropoffAddress || "-");

        // အနီရောင် လမ်းကြောင်းဆွဲခြင်း
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
        show: false,
        addWaypoints: false,
        draggableWaypoints: false,
        lineOptions: { styles: [{ color: '#ff4444', weight: 6, opacity: 0.8 }] }
    }).addTo(map);
    map.fitBounds(L.latLngBounds([p.lat, p.lng], [d.lat, d.lng]), { padding: [50, 50] });
}

function updateActionButtons(status, data) {
    const btn = document.getElementById('main-action-btn');
    if (status === "accepted") {
        btn.innerHTML = `<span>ပစ္စည်းသွားယူမည်</span>`;
        btn.onclick = () => updateStatus("on_the_way", "ပစ္စည်းသွားယူနေပါပြီ");
    } else if (status === "on_the_way") {
        btn.innerHTML = `<span>ဆိုင်သို့ရောက်ပြီ</span>`;
        btn.onclick = () => updateStatus("arrived", "ဆိုင်သို့ရောက်ရှိပါပြီ");
    } else if (status === "arrived") {
        btn.innerHTML = `<span>ပို့ဆောင်မှုပြီးမြောက်ပြီ</span>`;
        btn.style.background = "var(--success)";
        btn.onclick = () => completeOrder(data);
    } else {
        btn.parentElement.style.display = "none";
    }
}

async function updateStatus(newStatus, text) {
    await updateDoc(doc(db, "orders", orderId), { status: newStatus });
    const rider = await getRiderName();
    await notifyTelegram(`🚴 **Update:** ${text}\n👤 Rider: ${rider}`);
    Swal.fire({ icon: 'success', title: text, timer: 1000, showConfirmButton: false });
}

async function completeOrder(data) {
    const res = await Swal.fire({
        title: 'ပို့ဆောင်ပြီးပြီလား?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'အတည်ပြုသည်',
        background: '#1e1e1e', color: '#fff'
    });

    if (res.isConfirmed) {
        await updateDoc(doc(db, "orders", orderId), { status: "completed", completedAt: serverTimestamp() });
        const rider = await getRiderName();
        await notifyTelegram(`✅ **Completed**\n📦 ${data.item}\n👤 Rider: ${rider}`);
        Swal.fire('အောင်မြင်ပါသည်').then(() => window.location.href = 'rider-dashboard.html');
    }
}

async function getRiderName() {
    try {
        const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
        return snap.exists() ? snap.data().name : "Rider";
    } catch { return "Rider"; }
}
