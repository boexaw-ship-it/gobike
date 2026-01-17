import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// --- ၁။ Map Setup (Zoom Control ပိတ်ထားပြီး အလယ်မှတ်ချခြင်း) ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
let routingControl = null;

// --- ၂။ Back Button Logic (404 Error မတက်အောင် လမ်းကြောင်းထိန်းခြင်း) ---
const backBtn = document.getElementById('back-to-list-btn');
if (backBtn) {
    backBtn.onclick = (e) => {
        e.preventDefault();
        window.location.href = 'rider-dashboard.html';
    };
}

// --- ၃။ Order Listener (Firebase မှ Data ရယူခြင်း) ---
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), async (docSnap) => {
        // Loading ကို ဖျောက်ခြင်း
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'အော်ဒါရှာမတွေ့ပါ သို့မဟုတ် ဖျက်လိုက်ပါပြီ',
                background: '#1e1e1e', color: '#fff'
            }).then(() => window.location.href = 'rider-dashboard.html');
            return;
        }

        const data = docSnap.data();

        // UI Updates (HTML Elements များထဲသို့ Data ထည့်ခြင်း)
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase();
        document.getElementById('det-item').innerText = data.item || "ပစ္စည်း";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";
        document.getElementById('det-value').innerText = (data.itemValue || 0).toLocaleString() + " KS";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-phone').innerText = data.phone || "-";
        document.getElementById('call-link').href = `tel:${data.phone}`;

        // လိပ်စာများ
        document.getElementById('det-pickup').innerText = data.pickup ? `${data.pickup.township}၊ ${data.pickup.address}` : (data.pickupAddress || "-");
        document.getElementById('det-dropoff').innerText = data.dropoff ? `${data.dropoff.township}၊ ${data.dropoff.address}` : (data.dropoffAddress || "-");

        // မြေပုံပေါ်တွင် အနီရောင်လမ်းကြောင်းဆွဲခြင်း
        if (data.pickup?.lat && data.dropoff?.lat) {
            drawRoute(data.pickup, data.dropoff);
            
            // Google Maps ဖွင့်ရန် ခလုတ်များ
            document.getElementById('map-pickup').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${data.pickup.lat},${data.pickup.lng}`);
            document.getElementById('map-dropoff').onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${data.dropoff.lat},${data.dropoff.lng}`);
        }

        updateActionButtons(data.status, data);
    });
} else {
    window.location.href = 'rider-dashboard.html';
}

// --- ၄။ Draw Route Function (Tracking line အနီရောင်) ---
function drawRoute(p, d) {
    if (routingControl) map.removeControl(routingControl);

    // Leaflet Routing Machine ကို အသုံးပြု၍ အနီရောင်လမ်းကြောင်းဆွဲခြင်း
    routingControl = L.Routing.control({
        waypoints: [L.latLng(p.lat, p.lng), L.latLng(d.lat, d.lng)],
        show: false,
        addWaypoints: false,
        draggableWaypoints: false,
        lineOptions: {
            styles: [{ color: '#ff4444', weight: 6, opacity: 0.8 }] // အနီရောင်မျဉ်း
        },
        createMarker: (i, wp) => {
            const iconUrl = i === 0 
                ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png' 
                : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png';
            return L.marker(wp.latLng, {
                icon: L.icon({ iconUrl, iconSize: [25, 41], iconAnchor: [12, 41] })
            });
        }
    }).addTo(map);

    const bounds = L.latLngBounds([p.lat, p.lng], [d.lat, d.lng]);
    map.fitBounds(bounds, { padding: [50, 50] });
}

// --- ၅။ Action Button Update (စတင်မည် နှိပ်ရန် logic) ---
function updateActionButtons(status, orderData) {
    const btn = document.getElementById('main-action-btn');
    if (!btn) return;

    // Default Style
    btn.style.background = "var(--primary)";

    if (status === "accepted") {
        btn.innerHTML = `<span>ပစ္စည်းသွားယူမည် (On the Way)</span>`;
        btn.onclick = () => changeStatus("on_the_way", "ပစ္စည်းသွားယူနေပါပြီ");
    } else if (status === "on_the_way") {
        btn.innerHTML = `<span>ဆိုင်သို့ရောက်ပြီ (Arrived)</span>`;
        btn.onclick = () => changeStatus("arrived", "ဆိုင်သို့ရောက်ရှိပါပြီ");
    } else if (status === "arrived") {
        btn.innerHTML = `<span>ပို့ဆောင်မှုပြီးမြောက်ပြီ (Complete)</span>`;
        btn.style.background = "var(--success)";
        btn.onclick = () => completeOrder(orderData);
    } else {
        btn.parentElement.style.display = "none";
    }
}

// --- ၆။ Status Change Function ---
async function changeStatus(newStatus, statusText) {
    try {
        await updateDoc(doc(db, "orders", orderId), { status: newStatus });
        
        const riderName = await getRiderName();
        await notifyTelegram(`🚴 **Status Update**\n📦 Order: ${orderId}\n📊 Status: ${statusText}\n👤 Rider: ${riderName}`);

        Swal.fire({
            icon: 'success',
            title: 'Updated!',
            text: statusText,
            timer: 1500,
            showConfirmButton: false,
            background: '#1e1e1e', color: '#fff'
        });
    } catch (err) {
        console.error(err);
        Swal.fire('Error', 'မအောင်မြင်ပါ၊ ပြန်ကြိုးစားပါ', 'error');
    }
}

// --- ၇။ Complete Order Function (ပို့ဆောင်မှု ပြီးဆုံးကြောင်း Alert) ---
async function completeOrder(data) {
    const res = await Swal.fire({
        title: 'ပို့ဆောင်ပြီးပြီလား?',
        text: "ယခုအော်ဒါ ပို့ဆောင်မှုပြီးမြောက်ကြောင်း အတည်ပြုပါသလား?",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#2ed573',
        cancelButtonColor: '#ff4757',
        confirmButtonText: 'အတည်ပြုသည်',
        cancelButtonText: 'မလုပ်သေးပါ',
        background: '#1e1e1e', color: '#fff'
    });

    if (res.isConfirmed) {
        try {
            await updateDoc(doc(db, "orders", orderId), { 
                status: "completed", 
                completedAt: serverTimestamp() 
            });

            const riderName = await getRiderName();
            await notifyTelegram(`✅ **Order Completed**\n📦 ပစ္စည်း: ${data.item}\n💵 ပို့ခ: ${data.deliveryFee} KS\n👤 Rider: ${riderName}`);

            Swal.fire({
                icon: 'success',
                title: 'အောင်မြင်ပါသည်',
                text: 'ယနေ့အတွက် နောက်ထပ်အော်ဒါများ ထပ်ယူနိုင်ပါပြီ',
                background: '#1e1e1e', color: '#fff'
            }).then(() => {
                window.location.replace("rider-dashboard.html");
            });
        } catch (err) {
            console.error(err);
            Swal.fire('Error', 'သိမ်းဆည်းရာတွင် အမှားရှိနေပါသည်', 'error');
        }
    }
}

// --- ၈။ Rider Name ရယူရန် Function ---
async function getRiderName() {
    try {
        const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
        return snap.exists() ? snap.data().name : "Rider";
    } catch (e) {
        return "Rider";
    }
}
