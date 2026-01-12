import { db } from './firebase-config.js';
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const riderIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3198/3198336.png',
    iconSize: [45, 45], iconAnchor: [22, 22]
});

let riderMarker = null;
const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();

        // ဘေလ် နှင့် အချက်အလက်များ ပြသခြင်း
        document.getElementById('fee-amount').innerText = data.deliveryFee;
        document.getElementById('payment-type').innerText = `(${data.paymentMethod})`;
        document.getElementById('status-badge').innerText = data.status;

        if (data.status === "accepted") {
            document.getElementById('status-text').innerText = "Rider လာနေပါပြီ";
            document.getElementById('rider-info').style.display = "block";
            document.getElementById('rider-name').innerText = data.riderName;
            document.getElementById('call-link').href = `tel:${data.riderPhone || ''}`;
            document.getElementById('schedule-text').innerText = data.pickupSchedule === 'tomorrow' ? "📅 မနက်ဖြန်မှ လာယူပါမည်" : "🛵 ယခု လာယူနေပါပြီ";
        }

        if (data.status === "completed") {
            document.getElementById('status-text').innerText = "ရောက်ရှိသွားပါပြီ";
            document.getElementById('receipt-overlay').style.display = "block";
            document.getElementById('rider-info').style.display = "none";
            if(riderMarker) map.removeLayer(riderMarker);
        }

        // Rider Live Location Tracking
        if (data.riderId && data.status === "accepted") {
            onSnapshot(doc(db, "active_riders", data.riderId), (riderSnap) => {
                if (riderSnap.exists()) {
                    const loc = riderSnap.data();
                    const pos = [loc.lat, loc.lng];
                    if (!riderMarker) {
                        riderMarker = L.marker(pos, { icon: riderIcon }).addTo(map);
                    } else {
                        riderMarker.setLatLng(pos);
                    }
                    map.flyTo(pos, 16);
                }
            });
        }
    });
}

