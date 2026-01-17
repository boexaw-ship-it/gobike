import { db, auth } from '../firebase-config.js'; // လမ်းကြောင်းမှန်အောင် စစ်ပါ
import { 
    doc, onSnapshot, updateDoc, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- Map Initialization ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let routingControl = null;

// --- Main Logic ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), async (docSnap) => {
        // Loading ကို အရင်ဖျောက်မယ်
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            Swal.fire('အော်ဒါမရှိတော့ပါ', '', 'error').then(() => {
                window.location.href = './rider-dashboard.html';
            });
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

        const pAddr = data.pickup ? `${data.pickup.township}၊ ${data.pickup.address}` : (data.pickupAddress || "-");
        const dAddr = data.dropoff ? `${data.dropoff.township}၊ ${data.dropoff.address}` : (data.dropoffAddress || "-");
        document.getElementById('det-pickup').innerText = pAddr;
        document.getElementById('det-dropoff').innerText = dAddr;

        // Draw Route
        if (data.pickup?.lat && data.dropoff?.lat) {
            drawRoute(data.pickup, data.dropoff);
            
            // Google Maps Redirect
            document.getElementById('map-pickup').onclick = (e) => {
                e.preventDefault();
                window.open(`https://www.google.com/maps?q=${data.pickup.lat},${data.pickup.lng}`);
            };
            document.getElementById('map-dropoff').onclick = (e) => {
                e.preventDefault();
                window.open(`https://www.google.com/maps?q=${data.dropoff.lat},${data.dropoff.lng}`);
            };
        }

        updateActionButtons(data.status, data);
    });
} else {
    window.location.href = './rider-dashboard.html';
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
    
    const bounds = L.latLngBounds([p.lat, p.lng], [d.lat, d.lng]);
    map.fitBounds(bounds, { padding: [50, 50] });
}

function updateActionButtons(status, orderData) {
    const btn = document.getElementById('main-action-btn');
    if (!btn) return;

    // Reset button styles
    btn.style.pointerEvents = "auto";
    btn.style.opacity = "1";

    if (status === "accepted") {
        btn.innerHTML = `<span>ပစ္စည်းသွားယူမည် (On the Way)</span>`;
        btn.onclick = () => updateStatus("on_the_way");
    } else if (status === "on_the_way") {
        btn.innerHTML = `<span>ဆိုင်သို့ရောက်ပြီ (Arrived)</span>`;
        btn.onclick = () => updateStatus("arrived");
    } else if (status === "arrived") {
        btn.innerHTML = `<span>ပို့ဆောင်မှုပြီးမြောက်ပြီ (Complete)</span>`;
        btn.style.background = "#2ed573";
        btn.onclick = () => completeOrder(orderData);
    } else if (status === "completed") {
        btn.parentElement.style.display = "none";
    }
}

async function updateStatus(newStatus) {
    try {
        await updateDoc(doc(db, "orders", orderId), { status: newStatus });
        Swal.fire({ icon: 'success', title: 'အခြေအနေပြောင်းပြီးပါပြီ', timer: 1000, showConfirmButton: false });
    } catch (err) {
        console.error(err);
    }
}

async function completeOrder(data) {
    const res = await Swal.fire({
        title: 'ပို့ဆောင်ပြီးပြီလား?',
        text: "ယခုအော်ဒါ ပို့ဆောင်မှုပြီးမြောက်ကြောင်း အတည်ပြုပါသလား?",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#2ed573',
        confirmButtonText: 'အတည်ပြုသည်'
    });

    if (res.isConfirmed) {
        await updateDoc(doc(db, "orders", orderId), { 
            status: "completed", 
            completedAt: serverTimestamp() 
        });
        window.location.href = './rider-dashboard.html';
    }
}
