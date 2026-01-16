import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Hardware Back Key အတွက် Logic ---
// ဖုန်းအောက်ခြေက မြှားလေးနှိပ်ပြီး ထွက်ရင်တောင် Dashboard က သိအောင် မှတ်ထားပေးခြင်း
window.onbeforeunload = function() {
    sessionStorage.setItem('justBackFromTrack', 'true');
};

// --- ၂။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routingControl = null;

// --- ၃။ Screen Back Button Logic ---
const backBtn = document.getElementById('back-to-list-btn');
if (backBtn) {
    backBtn.onclick = (e) => {
        e.preventDefault();
        // Dashboard မှာ auto-redirect မဖြစ်အောင် session ရော parameter ရော သုံးပြီး ပြန်လွှတ်ခြင်း
        sessionStorage.setItem('justBackFromTrack', 'true');
        window.location.replace("delivery.html?from=track");
    };
}

// --- ၄။ Main Listener ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            console.error("Order not found");
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

        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
        }

        updateButtons(data.status, data.phone);
    }, (error) => {
        console.error("Firebase error:", error);
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';
    });
} else {
    window.location.replace("delivery.html");
}

// --- ၅။ Draw Route Function ---
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

// --- ၆။ Buttons Logic ---
function updateButtons(status, phone) {
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

// --- ၇။ Change Status Function ---
async function changeStatus(newStatus) {
    try {
        const orderRef = doc(db, "orders", orderId);
        let updateData = { status: newStatus };

        if (newStatus === "accepted") {
            const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
            updateData.riderId = auth.currentUser.uid;
            updateData.riderName = snap.exists() ? snap.data().name : "Rider";
        }

        await updateDoc(orderRef, updateData);
        
        Swal.fire({
            icon: 'success', 
            title: 'အောင်မြင်ပါသည်',
            timer: 1500, 
            showConfirmButton: false,
            background: '#1a1a1a', 
            color: '#fff'
        });

        if (newStatus === "completed") {
            setTimeout(() => {
                window.location.replace("delivery.html");
            }, 1600);
        }
    } catch (err) { 
        console.error(err);
        Swal.fire({ icon: 'error', title: 'မှားယွင်းမှုရှိပါသည်', background: '#1a1a1a', color: '#fff' });
    }
}

