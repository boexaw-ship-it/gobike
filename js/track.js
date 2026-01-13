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
let riderUnsubscribe = null; // Rider location listener ကို သိမ်းရန်

if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        
        // Progress Bar Update
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

        // Status Badge ပြသခြင်း
        let statusText = data.status.toUpperCase();
        if (data.status === "pending_confirmation") statusText = "CONFIRMATION NEEDED";
        document.getElementById('status-badge').innerText = statusText;

        // ပစ္စည်းနှင့် Rider အချက်အလက်
        document.getElementById('det-item').innerText = data.item;
        document.getElementById('det-fee').innerText = data.deliveryFee.toLocaleString();
        
        // Rider လာမည့်အချိန်ကိုပါ တွဲပြခြင်း
        let riderDisplay = data.riderName || 'ရှာဖွေနေဆဲ...';
        if (data.pickupSchedule === "tomorrow") {
            riderDisplay += " (မနက်ဖြန်လာယူမည်)";
        } else if (data.pickupSchedule === "now") {
            riderDisplay += " (ယနေ့လာယူမည်)";
        }
        document.getElementById('det-rider').innerText = riderDisplay;
        
        // Confirmation UI (Rider က မနက်ဖြန်လာယူမယ်ပြောရင်)
        const confirmBox = document.getElementById('confirmation-ui');
        if (data.status === "pending_confirmation") {
            confirmBox.style.display = "block";
            document.getElementById('confirm-msg').innerHTML = `🛵 Rider <b>${data.tempRiderName}</b> က မနက်ဖြန်မှ လာယူပါမည်။ အဆင်ပြေပါသလား?`;
        } else {
            confirmBox.style.display = "none";
        }

        // --- Live Tracking Logic ---
        if (data.riderId && (data.status === "accepted" || data.status === "on_the_way" || data.status === "arrived")) {
            // အရင် Listener ရှိနေရင် ပိတ်လိုက်ပါ (Listener အထပ်ထပ်မဖြစ်အောင်)
            if (riderUnsubscribe) riderUnsubscribe();

            riderUnsubscribe = onSnapshot(doc(db, "active_riders", data.riderId), (riderLocSnap) => {
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
        } else {
            // Rider မရှိတော့ရင် (သို့) Reject လုပ်လိုက်ရင် Marker ကို ဖျက်ပါ
            if (riderMarker) {
                map.removeLayer(riderMarker);
                riderMarker = null;
            }
            if (riderUnsubscribe) {
                riderUnsubscribe();
                riderUnsubscribe = null;
            }
        }
    });
}

// Respond Rider Function
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
                pickupSchedule: "tomorrow", // မနက်ဖြန်လာယူမည်ကို အတည်ပြုကြောင်း မှတ်သားသည်
                acceptedAt: serverTimestamp() 
            });
            alert("Rider ကို အတည်ပြုပေးလိုက်ပါပြီ။");
        } else {
            await updateDoc(orderRef, { 
                status: "pending", 
                tempRiderId: null, 
                tempRiderName: null,
                pickupSchedule: null
            });
            alert("Rider ကို ငြင်းပယ်လိုက်ပါပြီ။ အော်ဒါကို အခြား Rider များပြန်မြင်ရပါမည်။");
        }
    } catch (error) { 
        console.error(error); 
        alert("လုပ်ဆောင်ချက် မအောင်မြင်ပါ။");
    }
};
