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
let riderUnsubscribe = null;

if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        
        // --- ၁။ Progress Bar Update ---
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

        // --- ၂။ Status Badge ---
        let statusText = data.status.toUpperCase();
        if (data.status === "pending_confirmation") statusText = "CONFIRMATION NEEDED";
        document.getElementById('status-badge').innerText = statusText;

        // --- ၃။ Item Detail ---
        document.getElementById('det-item').innerText = data.item;
        document.getElementById('det-fee').innerText = data.deliveryFee.toLocaleString();
        
        // --- ၄။ Rider Info & Schedule ---
        let riderDisplay = data.riderName || 'ရှာဖွေနေဆဲ...';
        if (data.status === "pending_confirmation") {
            riderDisplay = "ယာယီစောင့်ဆိုင်းဆဲ...";
        }
        
        if (data.pickupSchedule === "tomorrow") {
            riderDisplay += " (မနက်ဖြန်လာယူမည်)";
        } else if (data.pickupSchedule === "now") {
            riderDisplay += " (ယနေ့လာယူမည်)";
        }
        document.getElementById('det-rider').innerText = riderDisplay;
        
        // --- ၅။ Confirmation UI Logic ---
        const confirmBox = document.getElementById('confirmation-ui');
        if (data.status === "pending_confirmation") {
            confirmBox.style.display = "block";
            const scheduleTxt = data.pickupSchedule === "now" ? "ယနေ့ (ချက်ချင်း)" : "မနက်ဖြန်မှ";
            document.getElementById('confirm-msg').innerHTML = `🛵 Rider <b>${data.tempRiderName}</b> က <b>${scheduleTxt}</b> လာယူရန် ကမ်းလှမ်းထားပါသည်။ အဆင်ပြေပါသလား?`;
        } else {
            confirmBox.style.display = "none";
        }

        // --- ၆။ Live Tracking Logic ---
        if (data.riderId && (["accepted", "on_the_way", "arrived"].includes(data.status))) {
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
            if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
            if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }
        }
    });
}

// --- ၇။ Respond Rider Function ---
window.respondRider = async (isAccepted) => {
    try {
        const orderRef = doc(db, "orders", orderId);
        const snap = await getDoc(orderRef);
        const d = snap.data();

        if (isAccepted) {
            // Customer လက်ခံလျှင် temp data များကို အတည်ပြု data များထဲသို့ ပြောင်းမည်
            await updateDoc(orderRef, { 
                status: "accepted", 
                riderId: d.tempRiderId, 
                riderName: d.tempRiderName,
                pickupSchedule: d.pickupSchedule, // Rider ရွေးခဲ့သော အချိန်အတိုင်း (now/tomorrow)
                acceptedAt: serverTimestamp() 
            });
            alert("Rider ကို အတည်ပြုပေးလိုက်ပါပြီ။");
        } else {
            // Customer ငြင်းပယ်လျှင် အော်ဒါကို Pending ပြန်ပို့ပြီး temp rider data များ ဖျက်မည်
            await updateDoc(orderRef, { 
                status: "pending", 
                tempRiderId: null, 
                tempRiderName: null,
                pickupSchedule: null
            });
            alert("Rider ကို ငြင်းပယ်လိုက်ပါပြီ။ အခြား Rider များ ပြန်လည်မြင်တွေ့နိုင်ပါပြီ။");
        }
    } catch (error) { 
        console.error(error); 
        alert("လုပ်ဆောင်ချက် မအောင်မြင်ပါ။");
    }
};
