
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

// --- ၂။ Main Listener (Order အခြေအနေစောင့်ကြည့်ခြင်း) ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (!docSnap.exists()) {
            console.error("Order not found!");
            return;
        }
        
        const data = docSnap.data();

        // (က) Status Check & Rider Marker Cleanup
        if (data.status === "pending" || data.status === "cancelled") {
            const detRider = document.getElementById('det-rider');
            if (detRider) {
                detRider.innerHTML = data.status === "cancelled" ? 
                    "<span style='color:red;'>အော်ဒါဖျက်သိမ်းပြီးပါပြီ</span>" : 
                    "<span style='color:#ffcc00; font-weight:bold;'>Rider အသစ် ထပ်မံရှာဖွေနေပါသည်...</span>";
            }
            if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
            if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }
        }

        // (ခ) Progress Bar Update
        const steps = ["pending", "accepted", "on_the_way", "arrived"];
        const currentStatusIdx = steps.indexOf(data.status);
        
        steps.forEach((step, idx) => {
            const el = document.getElementById(`step-${idx + 1}`);
            if (el) {
                if (data.status === "completed" || currentStatusIdx >= idx) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            }
        });

        // (ဂ) Details Display
        if (document.getElementById('status-badge')) {
            document.getElementById('status-badge').innerText = (data.status || "LOADING").replace("_", " ").toUpperCase();
        }

        if (document.getElementById('det-item')) document.getElementById('det-item').innerText = data.item || "-";
        if (document.getElementById('det-fee')) {
            document.getElementById('det-fee').innerText = data.deliveryFee ? data.deliveryFee.toLocaleString() + " KS" : "0 KS";
        }

        // (ဃ) Rider Information Display
        let riderDisplay = data.riderName || 'ရှာဖွေနေဆဲ...';
        if (data.status === "pending_confirmation") riderDisplay = "ယာယီစောင့်ဆိုင်းဆဲ (Rider ကမ်းလှမ်းထားသည်)";
        
        if (data.pickupSchedule === "tomorrow") riderDisplay += " (မနက်ွန်လာယူမည်)";
        else if (data.pickupSchedule === "now") riderDisplay += " (ယနေ့လာယူမည်)";

        const detRider = document.getElementById('det-rider');
        if (detRider) detRider.innerText = riderDisplay;

        // (င) Confirmation UI Logic
        const confirmBox = document.getElementById('confirmation-ui');
        if (confirmBox) {
            confirmBox.style.display = (data.status === "pending_confirmation") ? "block" : "none";
            const confirmMsg = document.getElementById('confirm-msg');
            if (confirmMsg && data.status === "pending_confirmation") {
                const timeText = data.pickupSchedule === "now" ? "ယနေ့ (ချက်ချင်း)" : "မနက်ဖြန်မှ";
                confirmMsg.innerHTML = `🛵 Rider <b>${data.tempRiderName || "Rider"}</b> က <b>${timeText}</b> လာယူရန် ကမ်းလှမ်းထားပါသည်။`;
            }
        }

        // --- ၃။ Live Rider Tracking ---
        if (data.riderId && ["accepted", "on_the_way", "arrived"].includes(data.status)) {
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
                    map.setView(pos, 15);
                }
            }, (err) => console.error("Tracking Error:", err));
        }

        // (စ) Completion Logic - FIXED 404 ERROR PATH
        if (data.status === "completed") {
            setTimeout(() => {
                alert("လူကြီးမင်း၏ ပါဆယ်ပို့ဆောင်မှု အောင်မြင်ပြီးဆုံးပါပြီ။");
                // IMPORTANT: track.html သည် html/ folder ထဲတွင်ရှိပြီး index.html သည် Root တွင်ရှိသောကြောင့် ../ သုံးရပါမည်။
                window.location.href = "../index.html"; 
            }, 1000);
        }
    }, (error) => {
        console.error("Main Listener Error:", error);
    });
}

// --- ၄။ Functions ---

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
            alert("Rider ကို အတည်ပြုလိုက်ပါပြီ။");
        } else {
            await updateDoc(orderRef, { 
                status: "pending", 
                riderId: null, 
                tempRiderId: null, 
                tempRiderName: null,
                pickupSchedule: null,
                lastRejectedRiderId: d.tempRiderId 
            });
            alert("Rider ကို ငြင်းပယ်လိုက်ပါပြီ။");
        }
    } catch (error) { console.error("Respond Error:", error); }
};

window.cancelOrder = async () => {
    if (confirm("အော်ဒါကို ဖျက်သိမ်းမှာ သေချာပါသလား?")) {
        try {
            await updateDoc(doc(db, "orders", orderId), { status: "cancelled" });
            alert("အော်ဒါဖျက်သိမ်းပြီးပါပြီ။");
            // Cancel လုပ်လျှင်လည်း Root ရှိ index.html သို့ ပြန်ပို့ပါသည်
            window.location.href = "../index.html";
        } catch (err) { console.error(err); }
    }
};
