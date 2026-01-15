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
    onSnapshot(doc(db, "orders", orderId), async (docSnap) => {
        if (!docSnap.exists()) {
            console.error("Order not found!");
            return;
        }
        
        const data = docSnap.data();

        // --- (က) Completion Logic ---
        if (data.status === "completed") {
            if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
            if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }

            await Swal.fire({
                title: 'အောင်မြင်ပါသည်!',
                text: 'လူကြီးမင်း၏ ပါဆယ်ပို့ဆောင်မှု အောင်မြင်ပြီးဆုံးပါပြီ။ ကျေးဇူးတင်ပါသည်။',
                icon: 'success',
                confirmButtonColor: '#ffcc00',
                background: '#1a1a1a',
                color: '#fff',
                allowOutsideClick: false,
                confirmButtonText: 'ပင်မစာမျက်နှာသို့'
            });
            window.location.href = "../index.html"; 
            return;
        }

        // --- (ခ) Status Check & Rider Marker Cleanup ---
        if (data.status === "pending" || data.status === "cancelled" || data.status === "rider_rejected") {
            const detRider = document.getElementById('det-rider');
            if (detRider) {
                if (data.status === "cancelled") {
                    detRider.innerHTML = "<span style='color:red;'>အော်ဒါဖျက်သိမ်းပြီးပါပြီ</span>";
                } else if (data.status === "rider_rejected") {
                    detRider.innerHTML = "<span style='color:#ff4444; font-weight:bold;'>Rider က ဤအော်ဒါကို ငြင်းပယ်လိုက်ပါသည်။ ကျေးဇူးပြု၍ အော်ဒါအသစ် ပြန်တင်ပေးပါ။</span>";
                } else {
                    detRider.innerHTML = "<span style='color:#ffcc00; font-weight:bold;'>Rider အသစ် ထပ်မံရှာဖွေနေပါသည်...</span>";
                }
            }
            if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
            if (riderUnsubscribe) { riderUnsubscribe(); riderUnsubscribe = null; }
            
            if (data.status === "rider_rejected") {
                for(let i=1; i<=4; i++) {
                    const el = document.getElementById(`step-${i}`);
                    if(el) el.classList.remove('active');
                }
                return; 
            }
        }

        // --- (ဂ) Progress Bar Update ---
        const steps = ["pending", "accepted", "on_the_way", "arrived"];
        const currentStatusIdx = steps.indexOf(data.status);
        
        steps.forEach((step, idx) => {
            const el = document.getElementById(`step-${idx + 1}`);
            if (el) {
                if (currentStatusIdx >= idx) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            }
        });

        // --- (ဃ) Details Display (လိပ်စာပြသရန် ပြင်ဆင်ထားသော အပိုင်း) ---
        if (document.getElementById('status-badge')) {
            document.getElementById('status-badge').innerText = (data.status || "LOADING").replace("_", " ").toUpperCase();
        }
        if (document.getElementById('det-item')) document.getElementById('det-item').innerText = data.item || "-";
        if (document.getElementById('det-fee')) {
            document.getElementById('det-fee').innerText = data.deliveryFee ? data.deliveryFee.toLocaleString() + " KS" : "0 KS";
        }
        
        // 🔥 လိပ်စာအသစ်များကို UI တွင် ပြသခြင်း
        if (document.getElementById('det-pickup')) {
            document.getElementById('det-pickup').innerText = data.pickup?.address || data.pickupAddress || "-";
        }
        if (document.getElementById('det-dropoff')) {
            document.getElementById('det-dropoff').innerText = data.dropoff?.address || data.dropoffAddress || "-";
        }

        // --- (င) Rider Information Display ---
        let riderDisplay = data.riderName || 'ရှာဖွေနေဆဲ...';
        if (data.status === "pending_confirmation") riderDisplay = "ယာယီစောင့်ဆိုင်းဆဲ (Rider ကမ်းလှမ်းထားသည်)";
        if (data.pickupSchedule === "tomorrow") riderDisplay += " (မနက်ဖြန်လာယူမည်)";
        else if (data.pickupSchedule === "now") riderDisplay += " (ယနေ့လာယူမည်)";

        const detRider = document.getElementById('det-rider');
        if (detRider && !["rider_rejected", "cancelled"].includes(data.status)) {
            detRider.innerText = riderDisplay;
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

        // --- (ဆ) Live Rider Tracking ---
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

    }, (error) => {
        console.error("Main Listener Error:", error);
    });
}

// --- ၃။ Functions with Swal ---

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
            Swal.fire({
                title: 'အတည်ပြုပြီးပါပြီ',
                text: 'Rider ကို အော်ဒါလက်ခံရန် အကြောင်းကြားလိုက်ပါပြီ။',
                icon: 'success',
                confirmButtonColor: '#ffcc00',
                background: '#1a1a1a',
                color: '#fff'
            });
        } else {
            await updateDoc(orderRef, { 
                status: "pending", 
                riderId: null, 
                tempRiderId: null, 
                tempRiderName: null,
                pickupSchedule: null,
                lastRejectedRiderId: d.tempRiderId 
            });
            Swal.fire({
                title: 'ငြင်းပယ်လိုက်ပါပြီ',
                text: 'အခြား Rider တစ်ဦးကို ထပ်မံရှာဖွေပေးပါမည်။',
                icon: 'info',
                confirmButtonColor: '#ffcc00',
                background: '#1a1a1a',
                color: '#fff'
            });
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
        cancelButtonColor: '#444',
        confirmButtonText: 'ဖျက်သိမ်းမည်',
        cancelButtonText: 'မဖျက်တော့ပါ',
        background: '#1a1a1a',
        color: '#fff'
    });

    if (result.isConfirmed) {
        try {
            await updateDoc(doc(db, "orders", orderId), { status: "cancelled" });
            await Swal.fire({
                title: 'ဖျက်သိမ်းပြီးပါပြီ',
                text: 'အော်ဒါကို အောင်မြင်စွာ ဖျက်သိမ်းလိုက်ပါသည်။',
                icon: 'success',
                background: '#1a1a1a',
                color: '#fff'
            });
            window.location.href = "../index.html";
        } catch (err) { console.error(err); }
    }
};
