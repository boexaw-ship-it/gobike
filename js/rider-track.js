import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// Global variables for Map
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let routingControl = null;

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

        // --- UI Updates ---
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase();
        document.getElementById('det-item').innerText = data.item || "ပစ္စည်းအမည်မရှိ";
        
        const pickupAddr = data.pickup?.township ? `(${data.pickup.township}) ${data.pickup.address}` : (data.pickup?.address || "လိပ်စာမရှိ");
        const dropoffAddr = data.dropoff?.township ? `(${data.dropoff.township}) ${data.dropoff.address}` : (data.dropoff?.address || "လိပ်စာမရှိ");

        document.getElementById('det-pickup').innerText = pickupAddr;
        document.getElementById('det-dropoff').innerText = dropoffAddr;

        document.getElementById('det-value').innerText = (data.itemValue || 0).toLocaleString() + " KS";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";

        const phone = data.phone || data.customerPhone || "ဖုန်းနံပါတ်မရှိ";
        const phoneDisplay = document.getElementById('det-phone');
        const callLink = document.getElementById('call-link');
        
        if (phoneDisplay) phoneDisplay.innerText = phone;
        if (callLink && phone !== "ဖုန်းနံပါတ်မရှိ") {
            callLink.href = `tel:${phone}`;
        }

        // Map Setup
        if (data.pickup && data.dropoff) {
            drawRoute(data.pickup, data.dropoff);
            
            const pickupLink = document.getElementById('map-pickup-link');
            const dropoffLink = document.getElementById('map-dropoff-link');
            // Google Maps Link template literals fixation
            if(pickupLink) pickupLink.href = `https://www.google.com/maps/dir/?api=1&destination=${data.pickup.lat},${data.pickup.lng}`;
            if(dropoffLink) dropoffLink.href = `https://www.google.com/maps/dir/?api=1&destination=${data.dropoff.lat},${data.dropoff.lng}`;
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
        lineOptions: { 
            styles: [{ color: '#ff4757', weight: 6, opacity: 0.8 }] 
        },
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
    if (!mainBtn) return;

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
            mainBtn.parentElement.style.display = "none";
            return;
    }

    const btnSpan = mainBtn.querySelector('span');
    if (btnSpan) btnSpan.innerText = btnText;
    
    mainBtn.onclick = () => changeStatus(nextStatus);
}

// --- ၅။ Change Status Function ---
async function changeStatus(newStatus) {
    try {
        const orderRef = doc(db, "orders", orderId);
        let updateData = { 
            status: newStatus,
            lastUpdated: serverTimestamp() 
        };

        if (newStatus === "accepted") {
            const riderId = auth.currentUser?.uid;
            if (riderId) {
                const riderSnap = await getDoc(doc(db, "riders", riderId));
                updateData.riderId = riderId;
                updateData.riderName = riderSnap.exists() ? riderSnap.data().name : "Rider";
                updateData.coinDeducted = false; // Accept လုပ်ချိန်တွင် coinDeducted field ကို စတင်ထည့်သွင်းသည်
            }
        }

        // --- အဓိကပြင်ဆင်ချက်- အော်ဒါပြီးဆုံးချိန်တွင် coinDeducted ကို false ဖြစ်ကြောင်း confirm လုပ်သည် ---
        if (newStatus === "completed") {
            updateData.completedAt = serverTimestamp();
            updateData.coinDeducted = false; // ဒီ field က listenForCoinDeduction ကို trigger ပေးမှာဖြစ်ပါတယ်
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
            // Coin နှုတ်သည့် Listener အလုပ်လုပ်ချိန်ရစေရန် ခဏစောင့်ပြီးမှ ပြန်ထွက်မည်
            setTimeout(() => window.location.replace("delivery.html"), 1500);
        }
    } catch (err) {
        console.error(err);
        Swal.fire({ icon: 'error', title: 'အမှားအယွင်းရှိနေပါသည်', background: '#1e1e1e', color: '#fff' });
    }
}
