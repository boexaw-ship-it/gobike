import { db } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, serverTimestamp, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

let riderMarker = null;

if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        
        // Progress Bar
        const steps = ["pending", "accepted", "on_the_way", "arrived"];
        const currentStatusIdx = steps.indexOf(data.status);
        
        steps.forEach((step, idx) => {
            const el = document.getElementById(`step-${idx + 1}`);
            if (el) {
                if (currentStatusIdx >= idx || data.status === "completed") {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            }
        });

        document.getElementById('status-badge').innerText = data.status.toUpperCase();
        document.getElementById('det-item').innerText = data.item;
        document.getElementById('det-fee').innerText = data.deliveryFee.toLocaleString();
        document.getElementById('det-rider').innerText = data.riderName || 'ရှာဖွေနေဆဲ...';
        
        // Confirmation UI (Rider က မနက်ဖြန်လာယူမယ်ပြောရင်)
        const confirmBox = document.getElementById('confirmation-ui');
        if (data.status === "pending_confirmation") {
            confirmBox.style.display = "block";
            document.getElementById('confirm-msg').innerHTML = `🛵 Rider <b>${data.tempRiderName}</b> က မနက်ဖြန်မှ လာယူပါမည်။ အဆင်ပြေပါသလား?`;
        } else {
            confirmBox.style.display = "none";
        }

        // Live Tracking
        if (data.riderId && (data.status === "accepted" || data.status === "on_the_way")) {
            onSnapshot(doc(db, "active_riders", data.riderId), (riderLocSnap) => {
                if (riderLocSnap.exists()) {
                    const loc = riderLocSnap.data();
                    const pos = [loc.lat, loc.lng];
                    if (!riderMarker) {
                        riderMarker = L.marker(pos, { icon: riderIcon }).addTo(map);
                    } else {
                        riderMarker.setLatLng(pos);
                    }
                    map.panTo(pos);
                }
            });
        }
    });
}

// HTML ထဲက respondRider နှင့် ချိတ်ဆက်ရန် window object ထဲထည့်ခြင်း
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
                acceptedAt: serverTimestamp() 
            });
            alert("Rider ကို အတည်ပြုပေးလိုက်ပါပြီ။");
        } else {
            await updateDoc(orderRef, { 
                status: "pending", 
                tempRiderId: null, 
                tempRiderName: null 
            });
            alert("Rider ကို ငြင်းပယ်လိုက်ပါပြီ။ အော်ဒါကို အခြား Rider များပြန်မြင်ရပါမည်။");
        }
    } catch (error) { console.error(error); }
};
