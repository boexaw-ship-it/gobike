import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Hardware Back Key & Dashboard Logic ---
window.onbeforeunload = function() {
    sessionStorage.setItem('justBackFromTrack', 'true');
};

// --- ၂။ Map Setup (50% View အတွက်) ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routingControl = null;

// --- ၃။ Main Listener ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            console.error("Order not found");
            return;
        }

        const data = docSnap.data();

        // UI Updates (Details အပြည့်အစုံ)
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase().replace("_", " ");
        document.getElementById('det-item').innerText = data.item || "ပစ္စည်းအမည်";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";
        
        const itemVal = data.itemValue || 0;
        const delFee = data.deliveryFee || 0;
        document.getElementById('det-value').innerText = itemVal.toLocaleString() + " KS";
        document.getElementById('det-fee').innerText = delFee.toLocaleString() + " KS";
        document.getElementById('det-total').innerText = (itemVal + delFee).toLocaleString() + " KS";

        // Phone & Address
        document.getElementById('det-phone').innerText = data.phone || "-";
        document.getElementById('call-link').href = `tel:${data.phone}`;
        
        const pAddr = data.pickup ? `${data.pickup.township}၊ ${data.pickup.address}` : (data.pickupAddress || "-");
        const dAddr = data.dropoff ? `${data.dropoff.township}၊ ${data.dropoff.address}` : (data.dropoffAddress || "-");
        document.getElementById('det-pickup').innerText = pAddr;
        document.getElementById('det-dropoff').innerText = dAddr;

        // Map Route & Directions
        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
            document.getElementById('map-pickup').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${data.pickup.lat},${data.pickup.lng}`);
            document.getElementById('map-dropoff').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${data.dropoff.lat},${data.dropoff.lng}`);
        }

        updateActionButtons(data.status);
    }, (error) => {
        console.error("Firebase error:", error);
    });
} else {
    window.location.replace("rider-dashboard.html");
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
    
    // Fit map to markers
    const group = new L.featureGroup([L.marker([p.lat, p.lng]), L.marker([d.lat, d.lng])]);
    map.fitBounds(group.getBounds().pad(0.2));
}

// --- ၅။ Buttons Logic ---
function updateActionButtons(status) {
    const btn = document.getElementById('main-action-btn');
    if (!btn) return;

    // Reset styles
    btn.style.display = "flex";
    
    if (status === "accepted") {
        btn.innerHTML = `<i class="fas fa-motorcycle"></i> <span>ပစ္စည်းသွားယူမည် (On the Way)</span>`;
        btn.onclick = () => changeStatus("on_the_way");
    } else if (status === "on_the_way") {
        btn.innerHTML = `<i class="fas fa-map-marker-alt"></i> <span>ဆိုင်သို့ရောက်ပြီ (Arrived)</span>`;
        btn.onclick = () => changeStatus("arrived");
    } else if (status === "arrived") {
        btn.innerHTML = `<i class="fas fa-check-circle"></i> <span>ပို့ဆောင်မှုပြီးမြောက်ပြီ (Complete)</span>`;
        btn.style.background = "#2ed573";
        btn.onclick = () => changeStatus("completed");
    } else if (status === "completed") {
        btn.style.display = "none"; // ပို့ပြီးရင် ခလုတ်ဖျောက်မယ်
    }
}

// --- ၆။ Change Status Function ---
async function changeStatus(newStatus) {
    try {
        const orderRef = doc(db, "orders", orderId);
        let updateData = { status: newStatus };

        if (newStatus === "completed") {
            const res = await Swal.fire({
                title: 'ပို့ဆောင်ပြီးပြီလား?',
                text: "ယခုအော်ဒါကို အောင်မြင်စွာ ပို့ဆောင်ပြီးကြောင်း အတည်ပြုပါသလား?",
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#2ed573',
                confirmButtonText: 'အတည်ပြုသည်',
                cancelButtonText: 'မလုပ်သေးပါ',
                background: '#1a1a1a', color: '#fff'
            });
            if (!res.isConfirmed) return;
            updateData.completedAt = serverTimestamp();
        }

        await updateDoc(orderRef, updateData);
        
        Swal.fire({
            icon: 'success', 
            title: 'အောင်မြင်ပါသည်',
            timer: 1000, 
            showConfirmButton: false,
            background: '#1a1a1a', 
            color: '#fff'
        });

        if (newStatus === "completed") {
            setTimeout(() => {
                window.location.replace("rider-dashboard.html");
            }, 1200);
        }
    } catch (err) { 
        console.error(err);
        Swal.fire({ icon: 'error', title: 'မှားယွင်းမှုရှိပါသည်', background: '#1a1a1a', color: '#fff' });
    }
}
