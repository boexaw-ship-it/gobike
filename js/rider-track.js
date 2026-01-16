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

// --- ၂။ Back Button Logic (Updated) ---
// Dashboard ဆီ ပြန်သွားတဲ့အခါ parameter ပါသွားစေဖို့ ပြင်ဆင်ထားပါတယ်
const backBtn = document.getElementById('back-to-list-btn');
if (backBtn) {
    backBtn.onclick = (e) => {
        e.preventDefault();
        // Dashboard မှာ auto-redirect မဖြစ်အောင် ?from=track ထည့်ပေးလိုက်တယ်
        window.location.replace("delivery.html?from=track");
    };
}

// --- ၃။ Main Listener ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        // Loading screen ကို ဖယ်ထုတ်မယ်
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            console.error("Order not found");
            return;
        }

        const data = docSnap.data();

        // UI အချက်အလက်များ Update လုပ်ခြင်း
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase().replace("_", " ");
        document.getElementById('det-item').innerText = "📦 " + (data.item || "ပစ္စည်း");
        document.getElementById('det-pickup').innerText = data.pickup?.address || "-";
        document.getElementById('det-dropoff').innerText = data.dropoff?.address || "-";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";

        // မြေပုံပေါ်မှာ လမ်းကြောင်းဆွဲခြင်း
        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
        }

        // ခလုတ်များ (Call / Status Change) Update လုပ်ခြင်း
        updateButtons(data.status, data.phone);
    }, (error) => {
        console.error("Firebase error:", error);
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';
    });
} else {
    // ID မပါရင် Dashboard ကိုပဲ ပြန်ပို့မယ်
    window.location.replace("delivery.html");
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

// --- ၅။ Buttons Logic ---
function updateButtons(status, phone) {
    const container = document.getElementById('action-buttons');
    container.innerHTML = "";

    // ဖုန်းခေါ်ဆိုရန် ခလုတ်
    if (phone) {
        const callBtn = document.createElement('a');
        callBtn.href = `tel:${phone}`;
        callBtn.className = "btn btn-phone";
        callBtn.innerHTML = `<i class="fas fa-phone-alt"></i> Call`;
        container.appendChild(callBtn);
    }

    // အဆင့်အလိုက် ပြောင်းလဲမည့် Status ခလုတ်
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

        // Accepted လုပ်လိုက်လျှင် Rider အချက်အလက် ထည့်သွင်းခြင်း
        if (newStatus === "accepted") {
            updateData.riderId = auth.currentUser.uid;
            updateData.riderName = auth.currentUser.displayName || "Rider";
        }

        await updateDoc(orderRef, updateData);
        
        Swal.fire({
            icon: 'success', 
            title: 'အောင်မြင်ပါသည်',
            text: `Status: ${newStatus.replace("_", " ")}`,
            timer: 1500, 
            showConfirmButton: false,
            background: '#1a1a1a', 
            color: '#fff'
        });

        // ပြီးဆုံးသွားလျှင် Dashboard သို့ ပြန်ပို့မယ်
        if (newStatus === "completed") {
            setTimeout(() => {
                window.location.replace("delivery.html");
            }, 1600);
        }
    } catch (err) { 
        console.error("Update status error:", err);
        Swal.fire({ icon: 'error', title: 'မှားယွင်းမှုရှိပါသည်', background: '#1a1a1a', color: '#fff' });
    }
}

