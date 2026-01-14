import { db } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, serverTimestamp, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Map Setup ---
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

        // --- (ထပ်တိုး logic) Rider က Reject လုပ်လျှင် သို့မဟုတ် Pending ပြန်ဖြစ်သွားလျှင် ---
        if (data.status === "pending") {
            const detRider = document.getElementById('det-rider');
            if (detRider) detRider.innerHTML = "<span style='color:#ffcc00;'>Rider အသစ် ထပ်မံရှာဖွေနေပါသည်...</span>";
            
            // Rider Marker ရှိနေရင် ဖျောက်မယ်
            if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
            if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }
        }
        
        // --- ၂။ Progress Bar Update ---
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

        // --- ၃။ Status Badge ---
        let statusText = data.status.toUpperCase();
        if (data.status === "pending_confirmation") statusText = "CONFIRMATION NEEDED";
        if (data.status === "cancelled") statusText = "ORDER CANCELLED";
        
        const statusBadge = document.getElementById('status-badge');
        if (statusBadge) statusBadge.innerText = statusText.replace("_", " ");

        // --- ၄။ Item Detail ---
        const detItem = document.getElementById('det-item');
        const detFee = document.getElementById('det-fee');
        if (detItem) detItem.innerText = data.item;
        if (detFee) detFee.innerText = data.deliveryFee ? data.deliveryFee.toLocaleString() : "0";
        
        // --- ၅။ Rider Info ---
        let riderDisplay = data.riderName || 'ရှာဖွေနေဆဲ...';
        
        if (data.status === "pending_confirmation") {
            riderDisplay = "ယာယီစောင့်ဆိုင်းဆဲ...";
        }
        
        if (data.pickupSchedule === "tomorrow") {
            riderDisplay += " (မနက်ဖြန်လာယူမည်)";
        } else if (data.pickupSchedule === "now") {
            riderDisplay += " (ယနေ့လာယူမည်)";
        }

        const detRider = document.getElementById('det-rider');
        if (detRider) detRider.innerText = riderDisplay;
        
        // --- ၆။ Confirmation UI Logic ---
        const confirmBox = document.getElementById('confirmation-ui');
        if (confirmBox) {
            if (data.status === "pending_confirmation") {
                confirmBox.style.display = "block";
                const scheduleTxt = data.pickupSchedule === "now" ? "ယနေ့ (ချက်ချင်း)" : "မနက်ဖြန်မှ";
                const confirmMsg = document.getElementById('confirm-msg');
                if (confirmMsg) {
                    confirmMsg.innerHTML = `🛵 Rider <b>${data.tempRiderName || "Rider"}</b> က <b>${scheduleTxt}</b> လာယူရန် ကမ်းလှမ်းထားပါသည်။ အဆင်ပြေပါသလား?`;
                }
            } else {
                confirmBox.style.display = "none";
            }
        }

        // --- ၇။ Live Tracking Logic ---
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

        // အော်ဒါ ပြီးဆုံးသွားလျှင် (Complete)
        if (data.status === "completed") {
            alert("လူကြီးမင်း၏ ပါဆယ်ပို့ဆောင်မှု အောင်မြင်ပြီးဆုံးပါပြီ။ ကျေးဇူးတင်ပါသည်။");
            window.location.href = "index.html"; // အိမ်ပြန်ပို့မယ်
        }
    });
}

// --- ၈။ Respond Rider Function ---
window.respondRider = async (isAccepted) => {
    try {
        const orderRef = doc(db, "orders", orderId);
        const snap = await getDoc(orderRef);
        if (!snap.exists()) return;
        const d = snap.data();

        if (isAccepted) {
            await updateDoc(orderRef, { 
                status: "accepted", 
                riderId: d.tempRiderId, 
                riderName: d.tempRiderName,
                pickupSchedule: d.pickupSchedule, 
                acceptedAt: serverTimestamp(),
                lastRejectedRiderId: null 
            });
            alert("Rider ကို အတည်ပြုပေးလိုက်ပါပြီ။");
        } else {
            // Customer က Reject လုပ်လျှင် - Pending ပြန်ဖြစ်ပြီး Rider အသစ်ရှာမည်
            await updateDoc(orderRef, { 
                status: "pending", 
                riderId: null, 
                tempRiderId: null, 
                tempRiderName: null,
                pickupSchedule: null,
                lastRejectedRiderId: d.tempRiderId 
            });
            alert("ဤ Rider ကို ငြင်းပယ်လိုက်ပါပြီ။ အခြား Rider များ ပြန်လည်မြင်တွေ့နိုင်ပါပြီ။");
        }
    } catch (error) { 
        console.error("Respond Error:", error); 
        alert("လုပ်ဆောင်ချက် မအောင်မြင်ပါ။");
    }
};

// Customer ကိုယ်တိုင် Order ဖျက်ခြင်း (Rider dashboard မှာ cancelled card ပေါ်စေရန်)
window.cancelOrder = async () => {
    if (confirm("အော်ဒါကို ဖျက်သိမ်းမှာ သေချာပါသလား?")) {
        try {
            await updateDoc(doc(db, "orders", orderId), { 
                status: "cancelled" 
            });
            alert("အော်ဒါဖျက်သိမ်းပြီးပါပြီ။");
            window.location.href = "index.html";
        } catch (err) { console.error(err); }
    }
};
