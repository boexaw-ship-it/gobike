import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routingControl = null;

// --- ၂။ Main Listener ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        document.getElementById('loading').style.display = 'none';

        // UI Updates
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase().replace("_", " ");
        document.getElementById('det-item').innerText = "📦 " + (data.item || "ပစ္စည်း");
        document.getElementById('det-pickup').innerText = data.pickup?.address || "-";
        document.getElementById('det-dropoff').innerText = data.dropoff?.address || "-";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";

        // Navigation Route
        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
        }

        // Action Buttons
        updateButtons(data.status, data.phone);
    });
}

// --- ၃။ Draw Route Function ---
function drawRoute(p, d) {
    if (routingControl) map.removeControl(routingControl);
    routingControl = L.Routing.control({
        waypoints: [L.latLng(p.lat, p.lng), L.latLng(d.lat, d.lng)],
        lineOptions: { styles: [{ color: '#ffcc00', weight: 6 }] },
        addWaypoints: false,
        draggableWaypoints: false,
        createMarker: function(i, wp) {
            const color = i === 0 ? 'green' : 'red';
            return L.marker(wp.latLng, {
                icon: L.icon({
                    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
                    iconSize: [25, 41], iconAnchor: [12, 41]
                })
            });
        }
    }).addTo(map);
}

// --- ၄။ Buttons Logic ---
function updateButtons(status, phone) {
    const container = document.getElementById('action-buttons');
    container.innerHTML = "";

    if (phone) {
        const callBtn = document.createElement('a');
        callBtn.href = `tel:${phone}`;
        callBtn.className = "btn btn-phone";
        callBtn.innerHTML = `<i class="fas fa-phone-alt"></i> Customer ထံ ဖုန်းဆက်မည်`;
        container.appendChild(callBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = "btn btn-primary";

    if (status === "pending") {
        nextBtn.innerHTML = `<i class="fas fa-check"></i> အော်ဒါလက်ခံမည် (Accept)`;
        nextBtn.onclick = () => changeStatus("accepted");
    } else if (status === "accepted") {
        nextBtn.innerHTML = `<i class="fas fa-motorcycle"></i> ပစ္စည်းယူရန် ထွက်ခွာပြီ`;
        nextBtn.onclick = () => changeStatus("on_the_way");
    } else if (status === "on_the_way") {
        nextBtn.innerHTML = `<i class="fas fa-box"></i> ပစ္စည်းယူဆောင်ပြီးပြီ`;
        nextBtn.onclick = () => changeStatus("arrived");
    } else if (status === "arrived") {
        nextBtn.innerHTML = `<i class="fas fa-hand-holding-heart"></i> ပို့ဆောင်မှု ပြီးဆုံးပြီ`;
        nextBtn.onclick = () => changeStatus("completed");
    }

    if (status !== "completed") container.appendChild(nextBtn);
}

// --- ၅။ Change Status Function ---
async function changeStatus(newStatus) {
    try {
        const orderRef = doc(db, "orders", orderId);
        let updateData = { status: newStatus };

        if (newStatus === "accepted") {
            updateData.riderId = auth.currentUser.uid;
            updateData.riderName = auth.currentUser.displayName || "Rider";
        }

        await updateDoc(orderRef, updateData);
        
        Swal.fire({
            icon: 'success',
            title: 'အောင်မြင်ပါသည်',
            text: `အခြေအနေကို ${newStatus.replace("_", " ")} သို့ ပြောင်းလိုက်ပါပြီ။`,
            timer: 1500,
            showConfirmButton: false,
            background: '#1a1a1a', color: '#fff'
        });

        if (newStatus === "completed") {
            setTimeout(() => window.location.href = "rider.html", 1600);
        }
    } catch (err) { console.error(err); }
}
