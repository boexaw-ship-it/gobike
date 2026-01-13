import { db } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, serverTimestamp, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Map Initialization ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png', // Rider Icon
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

let riderMarker = null;

if (orderId) {
    // --- ၂။ အော်ဒါအခြေအနေကို Real-time စောင့်ကြည့်ခြင်း ---
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        
        // Progress Bar Logic (Active Class ထည့်ခြင်း)
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

        // Detail ပြသခြင်း
        document.getElementById('status-badge').innerText = data.status.toUpperCase();
        document.getElementById('det-item').innerText = data.item;
        document.getElementById('det-fee').innerText = data.deliveryFee;
        document.getElementById('det-rider').innerText = data.riderName || 'ရှာဖွေနေဆဲ...';
        
        if (data.riderPhone) {
            const phoneEl = document.getElementById('det-phone');
            if (phoneEl) {
                phoneEl.style.display = "block";
                document.getElementById('call-rider').href = `tel:${data.riderPhone}`;
            }
        }

        // --- ၃။ Confirmation UI (မနက်ဖြန်အတွက် Rider ညှိနှိုင်းမှု) ---
        const confirmBox = document.getElementById('confirmation-ui');
        if (data.status === "pending_confirmation") {
            confirmBox.style.display = "block";
            confirmBox.innerHTML = `
                <div style="background:#fff3cd; padding:15px; border-radius:15px; border:1px solid #ffeeba; text-align:center;">
                    <p style="margin-bottom:10px;">🛵 Rider <b>${data.tempRiderName}</b> က မနက်ဖြန်မှ လာယူပါမည်။ အဆင်ပြေပါသလား?</p>
                    <div style="display:flex; gap:10px;">
                        <button onclick="respond(true)" style="flex:1; background:#2ed573; color:white; border:none; padding:10px; border-radius:8px; font-weight:bold;">လက်ခံသည်</button>
                        <button onclick="respond(false)" style="flex:1; background:#ff4757; color:white; border:none; padding:10px; border-radius:8px; font-weight:bold;">ငြင်းပယ်သည်</button>
                    </div>
                </div>`;
        } else {
            confirmBox.style.display = "none";
        }

        // --- ၄။ Rider Live Location ပြသခြင်း ---
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

        // --- ၅။ Completed ဖြစ်လျှင် Receipt ပြခြင်း ---
        if (data.status === "completed") {
            showReceipt(data);
        }
    });
}

// --- ၆။ Rider ၏ တောင်းဆိုမှုကို တုံ့ပြန်ခြင်း ---
window.respond = async (isAccepted) => {
    try {
        const orderRef = doc(db, "orders", orderId);
        const snap = await getDoc(orderRef); // Data အသစ်ကို တစ်ခါဆွဲယူသည်
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
                tempRiderName: null,
                pickupSchedule: null
            });
            alert("Rider ကို ငြင်းပယ်လိုက်ပါပြီ။");
        }
    } catch (error) {
        console.error("Respond Error:", error);
    }
};

function showReceipt(data) {
    // Receipt UI ပြရန် logic (optional)
    const badge = document.getElementById('status-badge');
    badge.style.background = "#2ed573";
    badge.innerText = "✅ DELIVERED SUCCESS";
}
