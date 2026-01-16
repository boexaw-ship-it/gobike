import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routingControl = null;

// --- ၂။ Back Button Logic (Data မစောင့်ဘဲ ချက်ချင်းအလုပ်လုပ်ရန်) ---
const initBackButton = () => {
    const backBtn = document.getElementById('back-to-list-btn');
    if (backBtn) {
        backBtn.onclick = (e) => {
            e.preventDefault();
            window.location.href = "delivery.html";
        };
    }
};

// --- ၃။ Main Listener (Data ရယူခြင်း) ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        // Data ရပြီဆိုတာနဲ့ Loading ကို ဖျောက်မည်
        const loadingOverlay = document.getElementById('loading');
        if (loadingOverlay) loadingOverlay.style.display = 'none';

        if (!docSnap.exists()) {
            Swal.fire("Error", "Order မတွေ့ရှိပါ။", "error");
            return;
        }

        const data = docSnap.data();

        // UI Updates
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase().replace("_", " ");
        document.getElementById('det-item').innerText = "📦 " + (data.item || "ပစ္စည်း");
        document.getElementById('det-pickup').innerText = data.pickup?.address || "-";
        document.getElementById('det-dropoff').innerText = data.dropoff?.address || "-";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";

        // မြေပုံပေါ်တွင် လမ်းကြောင်းဆွဲခြင်း
        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
        }

        // အောက်ခြေခလုတ်များကို Update လုပ်ခြင်း
        updateStatusButtons(data.status, data.phone);
    }, (error) => {
        console.error("Snapshot error:", error);
        // Error တက်ရင်လည်း Loading ကို ဖျောက်ပေးရန်
        document.getElementById('loading').style.display = 'none';
    });
} else {
    // orderId မပါလာရင် Dashboard ပြန်လွှတ်မည်
    window.location.href = "delivery.html";
}

// --- ၄။ Draw Route Function ---
function drawRoute(p, d) {
    if (routingControl) map.removeControl(routingControl);
    routingControl = L.Routing.control({
        waypoints: [L.latLng(p.lat, p.lng), L.latLng(d.lat, d.lng)],
        show: false,
        addWaypoints: false,      
        draggableWaypoints: false,
        lineOptions: { styles: [{ color: '#ffcc00', weight: 6 }] },
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

// --- ၅။ Status Buttons Logic ---
function updateStatusButtons(status, phone) {
    const container = document.getElementById('action-buttons');
    container.innerHTML = "";

    if (phone) {
        const callBtn = document.createElement('a');
        callBtn.href = `tel:${phone}`;
        callBtn.className = "btn btn-phone";
        callBtn.innerHTML = `<i class="fas fa-phone-alt"></i> Call`;
        container.appendChild(callBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = "btn btn-primary";

    if (status === "pending") {
        nextBtn.innerHTML = `<i class="fas fa-check"></i> Accept`;
        nextBtn.onclick = () => changeStatus("accepted");
    } else if (status === "accepted") {
        nextBtn.innerHTML = `<i class="fas fa-motorcycle"></i> Pick Up`;
        nextBtn.onclick = () => changeStatus("on_the_way");
    } else if (status === "on_the_way") {
        nextBtn.innerHTML = `<i class="fas fa-box"></i> Picked Up`;
        nextBtn.onclick = () => changeStatus("arrived");
    } else if (status === "arrived") {
        nextBtn.innerHTML = `<i class="fas fa-hand-holding-heart"></i> Completed`;
        nextBtn.onclick = () => changeStatus("completed");
    }

    if (status !== "completed") container.appendChild(nextBtn);
}

// --- ၆။ Change Status Function ---
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
            icon: 'success', title: 'Success',
            timer: 1500, showConfirmButton: false,
            background: '#1a1a1a', color: '#fff'
        });

        if (newStatus === "completed") {
            setTimeout(() => {
                window.location.href = "delivery.html";
            }, 1600);
        }
    } catch (err) { console.error(err); }
}

// ခေါ်ယူအသုံးပြုခြင်း
initBackButton();
