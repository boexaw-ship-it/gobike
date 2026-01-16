import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// URL ကနေ ID ကိုယူမယ်
const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ မြေပုံ အခြေခံ Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let routingControl = null;

// --- ၂။ Back Button Logic (Data မစောင့်ဘဲ အလုပ်လုပ်ရန် ချက်ချင်း Run မည်) ---
const backBtn = document.getElementById('back-to-list-btn');
if (backBtn) {
    backBtn.onclick = (e) => {
        e.preventDefault();
        window.location.href = "delivery.html";
    };
}

// --- ၃။ Main Listener (Firebase Data) ---
if (orderId) {
    // onSnapshot က data ရရမရရ ချက်ချင်း အလုပ်လုပ်ပါတယ်
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        
        // ဘာပဲဖြစ်ဖြစ် Loading ကို အရင်ပိတ်မယ်
        const loadingOverlay = document.getElementById('loading');
        if (loadingOverlay) loadingOverlay.style.display = 'none';

        if (!docSnap.exists()) {
            Swal.fire({
                icon: 'error',
                title: 'ဒေတာမတွေ့ပါ',
                text: 'ဤအော်ဒါမှာ မရှိတော့ပါ သို့မဟုတ် ပယ်ဖျက်လိုက်ပြီ ဖြစ်သည်။',
                confirmButtonText: 'ပြန်သွားရန်'
            }).then(() => {
                window.location.href = "delivery.html";
            });
            return;
        }

        const data = docSnap.data();

        // UI ကို Data တွေနဲ့ ဖြည့်မယ်
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase().replace("_", " ");
        document.getElementById('det-item').innerText = "📦 " + (data.item || "ပစ္စည်း");
        document.getElementById('det-pickup').innerText = data.pickup?.address || "-";
        document.getElementById('det-dropoff').innerText = data.dropoff?.address || "-";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";

        // လမ်းကြောင်းဆွဲမယ်
        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
        }

        // ခလုတ်တွေကို Update လုပ်မယ်
        updateStatusButtons(data.status, data.phone);

    }, (error) => {
        // Firebase Error တက်ခဲ့ရင် Loading ကို ပိတ်လိုက်မယ်
        console.error("Firebase Error:", error);
        document.getElementById('loading').style.display = 'none';
        Swal.fire("Error", "အချက်အလက်ရယူရာတွင် အမှားအယွင်းရှိနေပါသည်။", "error");
    });
} else {
    // ID မပါရင် Dashboard ပြန်ပို့မယ်
    window.location.href = "delivery.html";
}

// --- ၄။ မြေပုံပေါ် လမ်းကြောင်းဆွဲသည့် Function ---
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

// --- ၅။ ခလုတ်များ Logic ---
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

// --- ၆။ အဆင့်မြှင့်တင်သည့် Function ---
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
            icon: 'success', title: 'အောင်မြင်ပါသည်',
            timer: 1500, showConfirmButton: false,
            background: '#1a1a1a', color: '#fff'
        });

        if (newStatus === "completed") {
            setTimeout(() => { window.location.href = "delivery.html"; }, 1600);
        }
    } catch (err) { 
        console.error(err);
        Swal.fire("Error", "Update လုပ်၍မရပါ။", "error");
    }
}

