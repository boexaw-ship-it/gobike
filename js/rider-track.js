import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// Global variables for Map
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let routingControl = null;
let currentOrderData = null;

// --- ၁။ Screen Back Button Logic ---
const backBtn = document.getElementById('back-to-list-btn');
if (backBtn) {
    backBtn.onclick = () => {
        window.location.replace("delivery.html");
    };
}

// --- ၂။ Main Listener ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            console.error("Order not found");
            return;
        }

        const data = docSnap.data();
        currentOrderData = data; // Save for map buttons

        // --- UI Updates (HTML နဲ့ အကိုက်ဖြစ်အောင် ပြင်ဆင်ခြင်း) ---
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase();
        document.getElementById('det-item').innerText = data.item || "ပစ္စည်းအမည်မရှိ";
        
        // Township/Address ပြသခြင်း
        document.getElementById('det-pickup').innerText = data.pickup?.address || "လိပ်စာမရှိ";
        document.getElementById('det-dropoff').innerText = data.dropoff?.address || "လိပ်စာမရှိ";

        // Stats (တန်ဖိုး၊ အလေးချိန်၊ ပို့ခ)
        // မှတ်ချက် - Firebase မှာ itemValue ဆိုတဲ့ field ရှိရပါမယ်
        document.getElementById('det-value').innerText = (data.itemValue || 0).toLocaleString() + " KS";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";

        // Phone Update
        const phone = data.phone || data.customerPhone; // field name နှစ်မျိုးလုံးအတွက်
        document.getElementById('det-phone').innerText = phone || "-";
        document.getElementById('call-link').href = `tel:${phone}`;

        // Map Setup
        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
            
            // Google Maps ဖွင့်ရန် link များ
            document.getElementById('map-pickup-link').href = `https://www.google.com/maps?q=${data.pickup.lat},${data.pickup.lng}`;
            document.getElementById('map-dropoff-link').href = `https://www.google.com/maps?q=${data.dropoff.lat},${data.dropoff.lng}`;
        }

        updateActionButtons(data.status);
    });
} else {
    window.location.replace("delivery.html");
}

// --- ၃။ Draw Route Function ---
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

// --- ၄။ Action Buttons Logic ---
function updateActionButtons(status) {
    const mainBtn = document.getElementById('main-action-btn');
    const mapBtn = document.getElementById('map-pickup-btn');

    if (!mainBtn) return;

    // Pickup တည်နေရာကြည့်ရန် ခလုတ် (အပြာရောင်ခလုတ်)
    mapBtn.onclick = () => {
        if (currentOrderData?.pickup) {
            window.open(`https://www.google.com/maps?q=${currentOrderData.pickup.lat},${currentOrderData.pickup.lng}`, '_blank');
        }
    };

    // အောက်ခြေခလုတ်ကြီး (Main Action)
    let btnText = "";
    let nextStatus = "";

    switch(status) {
        case "pending":
            btnText = "အော်ဒါလက်ခံမည်";
            nextStatus = "accepted";
            break;
        case "accepted":
            btnText = "ပစ္စည်းသွားယူမည်";
            nextStatus = "on_the_way";
            break;
        case "on_the_way":
            btnText = "ပစ္စည်းရရှိပြီ (Picked Up)";
            nextStatus = "arrived";
            break;
        case "arrived":
            btnText = "ပို့ဆောင်ပြီး (Completed)";
            nextStatus = "completed";
            break;
        default:
            mainBtn.style.display = "none";
            return;
    }

    mainBtn.querySelector('span').innerText = btnText;
    mainBtn.onclick = () => changeStatus(nextStatus);
}

// --- ၅။ Change Status Function ---
async function changeStatus(newStatus) {
    try {
        const orderRef = doc(db, "orders", orderId);
        let updateData = { status: newStatus };

        if (newStatus === "accepted") {
            const riderId = auth.currentUser?.uid;
            if (riderId) {
                const riderSnap = await getDoc(doc(db, "riders", riderId));
                updateData.riderId = riderId;
                updateData.riderName = riderSnap.exists() ? riderSnap.data().name : "Rider";
            }
        }

        await updateDoc(orderRef, updateData);
        
        Swal.fire({
            icon: 'success', 
            title: 'Update အောင်မြင်ပါသည်',
            timer: 1000, 
            showConfirmButton: false,
            background: '#1e1e1e', color: '#fff'
        });

        if (newStatus === "completed") {
            setTimeout(() => window.location.replace("delivery.html"), 1200);
        }
    } catch (err) {
        console.error(err);
        Swal.fire({ icon: 'error', title: 'အမှားအယွင်းရှိနေပါသည်', background: '#1e1e1e', color: '#fff' });
    }
}
