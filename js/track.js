import { db } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, serverTimestamp, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Map Setup ---
// မြေပုံကို ချက်ချင်း Load ဖြစ်အောင် ထားပါမယ်
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

        // (က) Rider က Reject လုပ်လိုက်လို့ သို့မဟုတ် Customer ကိုယ်တိုင် ငြင်းလိုက်လို့ Pending ပြန်ဖြစ်သွားရင်
        if (data.status === "pending") {
            const detRider = document.getElementById('det-rider');
            if (detRider) detRider.innerHTML = "<span style='color:#ffcc00; font-weight:bold;'>Rider အသစ် ထပ်မံရှာဖွေနေပါသည်...</span>";
            
            // မြေပုံပေါ်က Rider ကို ဖယ်ထုတ်မယ်
            if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
            if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }
        }

        // (ခ) Progress Bar Update
        const steps = ["pending", "accepted", "on_the_way", "arrived"];
        const currentStatusIdx = steps.indexOf(data.status);
        
        steps.forEach((step, idx) => {
            const el = document.getElementById(`step-${idx + 1}`);
            if (el) {
                // Completed ဆိုရင် အကုန်လုံးကို အစိမ်းရောင်ပြမယ်
                if (data.status === "completed" || currentStatusIdx >= idx) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            }
        });

        // (ဂ) Status Badge & Details
        let statusText = data.status ? data.status.replace("_", " ").toUpperCase() : "LOADING...";
        const statusBadge = document.getElementById('status-badge');
        if (statusBadge) statusBadge.innerText = statusText;

        const detItem = document.getElementById('det-item');
        const detFee = document.getElementById('det-fee');
        if (detItem) detItem.innerText = data.item || "-";
        if (detFee) detFee.innerText = data.deliveryFee ? data.deliveryFee.toLocaleString() : "0";

        // (ဃ) Rider Information Display
        let riderDisplay = data.riderName || 'ရှာဖွေနေဆဲ...';
        if (data.status === "pending_confirmation") riderDisplay = "ယာယီစောင့်ဆိုင်းဆဲ (Rider ကမ်းလှမ်းထားသည်)";
        
        if (data.pickupSchedule === "tomorrow") riderDisplay += " (မနက်ဖြန်လာယူမည်)";
        else if (data.pickupSchedule === "now") riderDisplay += " (ယနေ့လာယူမည်)";

        const detRider = document.getElementById('det-rider');
        if (detRider) detRider.innerText = riderDisplay;

        // (င) Confirmation UI (မနက်ဖြန်/ယနေ့ ခလုတ်များ)
        const confirmBox = document.getElementById('confirmation-ui');
        if (confirmBox) {
            confirmBox.style.display = (data.status === "pending_confirmation") ? "block" : "none";
            const confirmMsg = document.getElementById('confirm-msg');
            if (confirmMsg && data.status === "pending_confirmation") {
                const timeText = data.pickupSchedule === "now" ? "ယနေ့ (ချက်ချင်း)" : "မနက်ဖြန်မှ";
                confirmMsg.innerHTML = `🛵 Rider <b>${data.tempRiderName || "Rider"}</b> က <b>${timeText}</b> လာယူရန် ကမ်းလှမ်းထားပါသည်။`;
            }
        }

        // --- ၃။ Live Rider Tracking (Rider တည်နေရာပြခြင်း) ---
        if (data.riderId && ["accepted", "on_the_way", "arrived"].includes(data.status)) {
            // အဟောင်းရှိရင် ရှင်းထုတ်ပြီး အသစ်ပြန်နားထောင်မယ်
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
                    map.setView(pos, 15); // Rider ဆီကို မြေပုံ ညွှန်ပြမယ်
                }
            }, (err) => console.error("Tracking Error:", err));
        }

        // (စ) ပို့ဆောင်မှု ပြီးဆုံးသွားလျှင်
        if (data.status === "completed") {
            setTimeout(() => {
                alert("လူကြီးမင်း၏ ပါဆယ်ပို့ဆောင်မှု အောင်မြင်ပြီးဆုံးပါပြီ။");
                window.location.href = "index.html"; 
            }, 1000);
        }
    }, (error) => {
        console.error("Main Listener Error:", error);
    });
}

// --- ၄။ Functions ---

// Rider ကို လက်ခံခြင်း/ငြင်းပယ်ခြင်း
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
            // Customer က ငြင်းလိုက်ရင် Rider အသစ်ပြန်ရှာမယ်
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
    } catch (error) { console.error(error); }
};

// Customer ကိုယ်တိုင် Cancel လုပ်ခြင်း
window.cancelOrder = async () => {
    if (confirm("အော်ဒါကို ဖျက်သိမ်းမှာ သေချာပါသလား?")) {
        try {
            await updateDoc(doc(db, "orders", orderId), { status: "cancelled" });
            alert("အော်ဒါဖျက်သိမ်းပြီးပါပြီ။");
            window.location.href = "index.html";
        } catch (err) { console.error(err); }
    }
};
