import { db, auth } from './firebase-config.js';
import { 
    doc, onSnapshot, updateDoc, getDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// URL ကနေ Order ID ကို ယူမယ်
const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

// ၁။ မြေပုံ Setup (Zoom Control ပိတ်ထားမယ်)
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routingControl = null;

// ၂။ အချက်အလက်များ နားထောင်ခြင်း
if (orderId) {
    onSnapshot(doc(db, "orders", orderId), async (docSnap) => {
        // Loading ဖျောက်မယ်
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.style.display = 'none';

        if (!docSnap.exists()) {
            Swal.fire('Error', 'အော်ဒါရှာမတွေ့ပါ', 'error').then(() => {
                window.location.href = 'rider-dashboard.html';
            });
            return;
        }

        const data = docSnap.data();

        // UI အချက်အလက်များ ထည့်မယ်
        document.getElementById('status-badge').innerText = (data.status || "PENDING").toUpperCase();
        document.getElementById('det-item').innerText = data.item || "ပစ္စည်း";
        document.getElementById('det-weight').innerText = (data.weight || 0) + " KG";
        document.getElementById('det-value').innerText = (data.itemValue || 0).toLocaleString() + " KS";
        document.getElementById('det-fee').innerText = (data.deliveryFee || 0).toLocaleString() + " KS";
        document.getElementById('det-phone').innerText = data.phone || "-";
        document.getElementById('call-link').href = `tel:${data.phone}`;

        // လိပ်စာပြမယ်
        document.getElementById('det-pickup').innerText = data.pickup ? `${data.pickup.township}၊ ${data.pickup.address}` : (data.pickupAddress || "-");
        document.getElementById('det-dropoff').innerText = data.dropoff ? `${data.dropoff.township}၊ ${data.dropoff.address}` : (data.dropoffAddress || "-");

        // ၃။ လမ်းကြောင်းအနီရောင် ဆွဲခြင်း Logic
        if (data.pickup?.lat && data.dropoff?.lat) {
            if (routingControl) map.removeControl(routingControl);

            routingControl = L.Routing.control({
                waypoints: [
                    L.latLng(data.pickup.lat, data.pickup.lng),
                    L.latLng(data.dropoff.lat, data.dropoff.lng)
                ],
                show: false, // အဖြူရောင် box ကြီး မပြအောင်
                addWaypoints: false,
                draggableWaypoints: false,
                lineOptions: {
                    styles: [{ color: '#ff4444', weight: 6, opacity: 0.8 }] // အနီရောင်မျဉ်း
                },
                createMarker: function() { return null; } // Marker အပိုတွေ မပြအောင်
            }).addTo(map);

            // မြေပုံကို ပစ္စည်းယူမယ့်နေရာနဲ့ ပို့မယ့်နေရာကြား Fit ဖြစ်အောင် ချဲ့မယ်
            const bounds = L.latLngBounds([data.pickup.lat, data.pickup.lng], [data.dropoff.lat, data.dropoff.lng]);
            map.fitBounds(bounds, { padding: [50, 50] });

            // Google Map ဖွင့်ဖို့ Link ချိတ်မယ်
            document.getElementById('map-pickup').onclick = () => window.open(`https://www.google.com/maps?q=${data.pickup.lat},${data.pickup.lng}`);
            document.getElementById('map-dropoff').onclick = () => window.open(`https://www.google.com/maps?q=${data.dropoff.lat},${data.dropoff.lng}`);
        }

        updateActionButtons(data.status, data);
    });
} else {
    window.location.href = 'rider-dashboard.html';
}

// ၄။ ခလုတ်များ Logic (စတင်မည်/ပြီးဆုံးမည်)
function updateActionButtons(status, orderData) {
    const btn = document.getElementById('main-action-btn');
    if (!btn) return;

    if (status === "accepted") {
        btn.innerHTML = `<span>ပစ္စည်းသွားယူမည် (On the Way)</span>`;
        btn.onclick = () => changeOrderStatus("on_the_way", "ပစ္စည်းသွားယူနေပါပြီ");
    } else if (status === "on_the_way") {
        btn.innerHTML = `<span>ဆိုင်သို့ရောက်ပြီ (Arrived)</span>`;
        btn.onclick = () => changeOrderStatus("arrived", "ဆိုင်သို့ရောက်ရှိပါပြီ");
    } else if (status === "arrived") {
        btn.innerHTML = `<span>ပို့ဆောင်မှုပြီးမြောက်ပြီ (Complete)</span>`;
        btn.style.background = "#2ed573";
        btn.onclick = () => confirmDelivery(orderData);
    } else {
        btn.parentElement.style.display = 'none';
    }
}

// ၅။ Status ပြောင်းလဲခြင်း
async function changeOrderStatus(newStatus, text) {
    try {
        await updateDoc(doc(db, "orders", orderId), { status: newStatus });
        const riderName = await getRiderName();
        await notifyTelegram(`🚴 **Update:** ${text}\n👤 Rider: ${riderName}`);
        Swal.fire({ icon: 'success', title: text, timer: 1000, showConfirmButton: false });
    } catch (err) {
        Swal.fire('Error', 'Update မအောင်မြင်ပါ', 'error');
    }
}

// ၆။ ပို့ဆောင်မှု ပြီးဆုံးကြောင်း အတည်ပြုချက် (SweetAlert 2)
async function confirmDelivery(orderData) {
    const res = await Swal.fire({
        title: 'ပို့ဆောင်ပြီးပြီလား?',
        text: 'ပစ္စည်းကို Customer ထံ စနစ်တကျ ပို့ဆောင်ပြီးပါသလား?',
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
            await notifyTelegram(`✅ **Order Completed**\n📦 ပစ္စည်း: ${orderData.item}\n👤 Rider: ${riderName}`);

            Swal.fire({
                title: 'အောင်မြင်ပါသည်!',
                text: 'အော်ဒါပို့ဆောင်မှု ပြီးဆုံးပါပြီ။',
                icon: 'success',
                background: '#1e1e1e', color: '#fff'
            }).then(() => {
                window.location.href = 'rider-dashboard.html';
            });
        } catch (err) {
            Swal.fire('Error', 'မအောင်မြင်ပါ', 'error');
        }
    }
}

// Rider နာမည်ယူခြင်း
async function getRiderName() {
    try {
        const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
        return snap.exists() ? snap.data().name : "Rider";
    } catch { return "Rider"; }
}
