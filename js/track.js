import { db } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, serverTimestamp, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Rider အတွက် အသုံးပြုမည့် Icon
const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

let riderMarker = null;
let riderUnsubscribe = null;
let routingControl = null;

// --- ၂။ Main Listener (Order အခြေအနေစောင့်ကြည့်ခြင်း) ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), async (docSnap) => {
        if (!docSnap.exists()) {
            console.error("Order not found!");
            return;
        }
        
        const data = docSnap.data();

        // --- (က) Completion Logic ---
        if (data.status === "completed") {
            cleanupTracking();
            // Progress Bar ကို အကုန်အပြည့်ပြပေးထားမယ်
            updateProgressBar("arrived"); 
            
            // Alert ကို တစ်ခါပဲ ပြစေချင်ရင် (ဥပမာ- App ထဲမှာရှိနေတုန်း ပြီးသွားတာမျိုး)
            // ဒီနေရာမှာ redirect မလုပ်ဘဲ အောက်က details တွေကို ဆက်ပြခိုင်းထားပါတယ်
            console.log("Order is completed. Viewing History.");
        }

        // --- (ခ) Status Check & UI Update ---
        const detRider = document.getElementById('det-rider');
        if (detRider) {
            if (data.status === "cancelled") {
                detRider.innerHTML = "<span style='color:red;'>အော်ဒါဖျက်သိမ်းပြီးပါပြီ</span>";
            } else if (data.status === "rider_rejected") {
                detRider.innerHTML = "<span style='color:#ff4444; font-weight:bold;'>Rider က ငြင်းပယ်လိုက်ပါသည်။</span>";
            } else {
                detRider.innerText = data.riderName || "Rider ရှာဖွေနေပါသည်...";
            }
        }

        // --- (ဂ) Progress Bar Update ---
        updateProgressBar(data.status);

        // --- (ဃ) Details & Addresses Display ---
        if (document.getElementById('status-badge')) {
            document.getElementById('status-badge').innerText = (data.status || "LOADING").replace("_", " ").toUpperCase();
        }
        if (document.getElementById('det-item')) document.getElementById('det-item').innerText = data.item || "-";
        if (document.getElementById('det-fee')) {
            document.getElementById('det-fee').innerText = data.deliveryFee ? data.deliveryFee.toLocaleString() + " KS" : "0 KS";
        }
        if (document.getElementById('det-pickup')) document.getElementById('det-pickup').innerText = data.pickup?.address || "-";
        if (document.getElementById('det-dropoff')) document.getElementById('det-dropoff').innerText = data.dropoff?.address || "-";

        // --- (င) Route Visualization ---
        if (data.pickup && data.dropoff && !routingControl) {
            drawStaticRoute(data.pickup, data.dropoff);
        }

        // --- (စ) Confirmation UI Logic ---
        const confirmBox = document.getElementById('confirmation-ui');
        if (confirmBox) {
            confirmBox.style.display = (data.status === "pending_confirmation") ? "block" : "none";
            const confirmMsg = document.getElementById('confirm-msg');
            if (confirmMsg && data.status === "pending_confirmation") {
                const timeText = data.pickupSchedule === "now" ? "ယနေ့ (ချက်ချင်း)" : "မနက်ဖြန်မှ";
                confirmMsg.innerHTML = `🛵 Rider <b>${data.tempRiderName || "Rider"}</b> က <b>${timeText}</b> လာယူရန် ကမ်းလှမ်းထားပါသည်။`;
            }
        }

        // --- (ဆ) Live Rider Tracking (Active Location) ---
        // Rider ရှိမှသာ စစ်ဆေးမည်
        if (data.riderId && ["accepted", "on_the_way", "arrived"].includes(data.status)) {
            if (riderUnsubscribe) riderUnsubscribe();
            
            // Rider ရဲ့ Live တည်နေရာကို active_riders ထဲကနေ လှမ်းဖတ်ခြင်း
            riderUnsubscribe = onSnapshot(doc(db, "active_riders", data.riderId), (riderLocSnap) => {
                if (riderLocSnap.exists()) {
                    const loc = riderLocSnap.data();
                    const pos = [loc.lat, loc.lng];
                    
                    if (!riderMarker) {
                        riderMarker = L.marker(pos, { icon: riderIcon }).addTo(map);
                    } else {
                        riderMarker.setLatLng(pos);
                    }
                    // မြေပုံကို Rider ရှိရာသို့ အလိုအလျောက် ရွှေ့ပေးမည်
                    map.setView(pos, map.getZoom(), { animate: true });
                }
            });
        }

    }, (error) => console.error("Main Listener Error:", error));
}

// --- အထောက်အကူပြု Function များ ---

function updateProgressBar(status) {
    const steps = ["pending", "accepted", "on_the_way", "arrived"];
    const currentStatusIdx = steps.indexOf(status);
    steps.forEach((step, idx) => {
        const el = document.getElementById(`step-${idx + 1}`);
        if (el) {
            currentStatusIdx >= idx ? el.classList.add('active') : el.classList.remove('active');
        }
    });
}

function drawStaticRoute(p, d) {
    routingControl = L.Routing.control({
        waypoints: [L.latLng(p.lat, p.lng), L.latLng(d.lat, d.lng)],
        show: false,
        addWaypoints: false,
        draggableWaypoints: false,
        lineOptions: { styles: [{ color: '#ffcc00', weight: 4, opacity: 0.7 }] },
        createMarker: function(i, wp) {
            const iconUrl = i === 0 ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png' : 
                                     'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png';
            return L.marker(wp.latLng, { icon: L.icon({ iconUrl, iconSize: [25, 41], iconAnchor: [12, 41] }) });
        }
    }).addTo(map);
}

function cleanupTracking() {
    if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
    if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }
}

// --- Window Functions ---

window.respondRider = async (isAccepted) => {
    try {
        const orderRef = doc(db, "orders", orderId);
        const snap = await getDoc(orderRef);
        const d = snap.data();

        if (isAccepted) {
            await updateDoc(orderRef, { 
                status: "accepted", 
                riderId: d.tempRiderId, 
                riderName: d.tempRiderName,
                pickupSchedule: d.pickupSchedule, 
                acceptedAt: serverTimestamp()
            });
            Swal.fire({ title: 'အတည်ပြုပြီးပါပြီ', icon: 'success', background: '#1a1a1a', color: '#fff' });
        } else {
            await updateDoc(orderRef, { 
                status: "pending", 
                riderId: null, tempRiderId: null, tempRiderName: null,
                pickupSchedule: null, lastRejectedRiderId: d.tempRiderId 
            });
            Swal.fire({ title: 'ငြင်းပယ်လိုက်ပါပြီ', icon: 'info', background: '#1a1a1a', color: '#fff' });
        }
    } catch (error) { console.error("Respond Error:", error); }
};

window.cancelOrder = async () => {
    const result = await Swal.fire({
        title: 'သေချာပါသလား?',
        text: "အော်ဒါကို ဖျက်သိမ်းမှာ သေချာပါသလား?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff4444',
        confirmButtonText: 'ဖျက်သိမ်းမည်',
        background: '#1a1a1a', color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            await updateDoc(doc(db, "orders", orderId), { status: "cancelled" });
            window.location.href = "customer.html";
        } catch (err) { console.error(err); }
    }
};

